import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BuilderAuthorizationError,
  allowedBuilderOrigins,
  authorizeBuilderRequest,
  type ActiveBuilderIdentity
} from "../../../../../lib/builder/authorization";
import {
  MEDIA_BATCH_MAX_BYTES,
  MEDIA_BATCH_MAX_FILES,
  createMediaObjectKey,
  validateMediaClaim,
  verifyTrustedJpeg
} from "../../../../../lib/builder/media-upload";
import { authenticateBuilderRequest } from "../../../../../lib/builder/request-auth";
import { listNormalizedMediaAssets } from "../../../../../lib/builder/repositories";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof BuilderAuthorizationError) {
    return response({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof TypeError) {
    return response({ error: { code: "INVALID_MEDIA_REQUEST", message: error.message } }, 400);
  }
  const candidate = error as { code?: string; message?: string };
  if (candidate?.code === "23505") {
    return response({ error: { code: "MEDIA_CONFLICT", message: "This media operation is already active." } }, 409);
  }
  if (candidate?.code === "P0001") {
    return response({ error: { code: "MEDIA_LIMIT", message: candidate.message ?? "The media operation is not available." } }, 409);
  }
  console.error("Private media API failed", { code: candidate?.code ?? "unknown" });
  return response({ error: { code: "MEDIA_UNAVAILABLE", message: "The media service is unavailable." } }, 503);
}

async function body(request: Request, allowed: readonly string[]) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new TypeError("A JSON media request is required.");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > 32_768) throw new TypeError("The media request is too large.");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new TypeError("The media request contains invalid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("The media request is invalid.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) throw new TypeError("The media request has unknown properties.");
  return record;
}

function idempotencyKey(request: Request) {
  const value = request.headers.get("x-idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9:._-]{8,200}$/.test(value)) throw new TypeError("A valid idempotency key is required.");
  return value;
}

function fingerprint(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value, Object.keys(value).sort())).digest("hex");
}

async function authorize(request: Request) {
  const identity = await authorizeBuilderRequest({
    request,
    operation: "media.create",
    allowedOrigins: allowedBuilderOrigins(new URL(request.url).origin),
    authenticate: () => authenticateBuilderRequest(request)
  });
  if (!identity) throw new BuilderAuthorizationError("AUTH_REQUIRED", 401, "A verified editor session is required.");
  return identity;
}

function adminClient(): SupabaseClient {
  const admin = getBuilderAdminClient();
  if (!admin) throw new Error("Supabase is unavailable.");
  return admin;
}

async function currentInventoryReceipt(admin: SupabaseClient, identity: ActiveBuilderIdentity) {
  const result = await admin
    .from("builder_media_inventory_receipts")
    .select("id, status, valid_until, problems")
    .eq("site_id", identity.siteId)
    .eq("status", "succeeded")
    .gt("valid_until", new Date().toISOString())
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  const problems = result.data?.problems;
  if (!result.data?.id || !Array.isArray(problems) || problems.length !== 0) {
    throw Object.assign(new Error("A current verified private-media inventory is required before uploads."), { code: "P0001" });
  }
  return String(result.data.id);
}

async function createManifest(request: Request, admin: SupabaseClient, identity: ActiveBuilderIdentity) {
  if (identity.role !== "owner") {
    throw new BuilderAuthorizationError("ROLE_DENIED", 403, "Folder import is available to site owners only.");
  }
  const value = await body(request, ["sourceLabel", "sourceManifestSha256", "fileCount", "totalBytes"]);
  const sourceLabel = String(value.sourceLabel ?? "").trim();
  const sourceManifestSha256 = String(value.sourceManifestSha256 ?? "");
  const fileCount = Number(value.fileCount);
  const totalBytes = Number(value.totalBytes);
  if (!sourceLabel || sourceLabel.length > 200 || !/^[0-9a-f]{64}$/.test(sourceManifestSha256) ||
      !Number.isSafeInteger(fileCount) || fileCount < 1 || fileCount > MEDIA_BATCH_MAX_FILES ||
      !Number.isSafeInteger(totalBytes) || totalBytes < 1 || totalBytes > MEDIA_BATCH_MAX_BYTES) {
    throw new TypeError("The media import manifest is invalid.");
  }
  const key = idempotencyKey(request);
  const requestFingerprint = fingerprint(value);
  const inventoryReceiptId = await currentInventoryReceipt(admin, identity);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + (24 * 60 * 60 - 60) * 1000).toISOString();
  const inserted = await admin.from("builder_media_import_manifests").insert({
    site_id: identity.siteId,
    id,
    status: "active",
    source_label: sourceLabel,
    source_manifest_sha256: sourceManifestSha256,
    file_count: fileCount,
    total_bytes: totalBytes,
    idempotency_key: key,
    request_fingerprint: requestFingerprint,
    inventory_receipt_id: inventoryReceiptId,
    expires_at: expiresAt,
    created_by: identity.userId
  });
  if (inserted.error) throw inserted.error;
  return response({ manifestId: id }, 201);
}

async function activeAsset(admin: SupabaseClient, identity: ActiveBuilderIdentity, mediaId: string) {
  return (await listNormalizedMediaAssets(admin, identity.siteId)).find((asset) => asset.id === mediaId) ?? null;
}

async function createPlan(request: Request, admin: SupabaseClient, identity: ActiveBuilderIdentity) {
  const value = await body(request, [
    "mode", "manifestId", "sourceName", "claimedMimeType", "claimedByteSize",
    "claimedWidth", "claimedHeight", "expectedSha256", "label", "alt"
  ]);
  const mode = value.mode;
  if (mode !== "single" && mode !== "batch") throw new TypeError("The media upload mode is invalid.");
  if (mode === "batch" && identity.role !== "owner") {
    throw new BuilderAuthorizationError("ROLE_DENIED", 403, "Folder import is available to site owners only.");
  }
  const claim = validateMediaClaim({
    name: String(value.sourceName ?? ""),
    mimeType: String(value.claimedMimeType ?? ""),
    byteSize: Number(value.claimedByteSize),
    width: Number(value.claimedWidth),
    height: Number(value.claimedHeight)
  });
  const expectedSha256 = String(value.expectedSha256 ?? "");
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw new TypeError("A valid media digest is required.");
  const label = String(value.label ?? claim.name).trim();
  const alt = String(value.alt ?? label).trim();
  if (!label || label.length > 200 || !alt || alt.length > 500) {
    throw new TypeError("Media name and alt text are required and must fit their allowed lengths.");
  }
  const manifestId = mode === "batch" ? String(value.manifestId ?? "") : null;
  if (mode === "batch" && !manifestId) throw new TypeError("A batch manifest is required.");
  await currentInventoryReceipt(admin, identity);

  let expiresAt = new Date(Date.now() + (24 * 60 * 60 - 60) * 1000).toISOString();
  if (manifestId) {
    const manifest = await admin
      .from("builder_media_import_manifests")
      .select("expires_at, status")
      .eq("site_id", identity.siteId)
      .eq("id", manifestId)
      .eq("created_by", identity.userId)
      .in("status", ["planning", "active"])
      .maybeSingle();
    if (manifest.error) throw manifest.error;
    if (!manifest.data?.expires_at) throw new TypeError("The media import manifest is not active.");
    expiresAt = String(manifest.data.expires_at);
  }

  const planId = crypto.randomUUID();
  const path = createMediaObjectKey({
    siteId: identity.siteId,
    planId,
    nonce: crypto.randomUUID(),
    sourceName: claim.name
  });
  const key = idempotencyKey(request);
  const identityResult = await admin
    .from("builder_media_identities")
    .select("media_id")
    .eq("site_id", identity.siteId)
    .eq("sha256", expectedSha256)
    .maybeSingle();
  if (identityResult.error) throw identityResult.error;
  let duplicate: { outcome: "skipped_active"; asset: Awaited<ReturnType<typeof activeAsset>> } |
    { outcome: "skipped_archived" } | null = null;
  if (identityResult.data?.media_id) {
    const mediaId = String(identityResult.data.media_id);
    const assetResult = await admin
      .from("builder_media_assets")
      .select("archived_at")
      .eq("site_id", identity.siteId)
      .eq("id", mediaId)
      .maybeSingle();
    if (assetResult.error) throw assetResult.error;
    if (assetResult.data?.archived_at) duplicate = { outcome: "skipped_archived" };
    else {
      const asset = await activeAsset(admin, identity, mediaId);
      if (!asset) throw new Error("The canonical media asset could not be loaded.");
      duplicate = { outcome: "skipped_active", asset };
    }
  }
  const inserted = await admin.from("builder_media_upload_plans").insert({
    site_id: identity.siteId,
    id: planId,
    manifest_id: manifestId,
    mode,
    status: duplicate?.outcome ?? "planned",
    source_name: claim.name,
    object_key: path,
    claimed_mime_type: claim.mimeType,
    claimed_byte_size: claim.byteSize,
    claimed_width: claim.width,
    claimed_height: claim.height,
    expected_sha256: expectedSha256,
    requested_label: label,
    requested_alt: alt,
    idempotency_key: key,
    request_fingerprint: fingerprint(value),
    expires_at: expiresAt,
    created_by: identity.userId
  });
  if (inserted.error) throw inserted.error;
  if (duplicate) return response(duplicate);
  const issued = await admin.rpc("builder_issue_media_upload_capability", {
    p_site_id: identity.siteId,
    p_plan_id: planId,
    p_actor_id: identity.userId
  });
  if (issued.error) throw issued.error;
  const signed = await admin.storage.from("builder-media").createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data?.token) {
    await admin.from("builder_media_upload_plans").update({
      status: "rejected",
      rejection_code: "CAPABILITY_ISSUANCE_FAILED",
      updated_at: new Date().toISOString()
    }).eq("site_id", identity.siteId).eq("id", planId);
    throw signed.error ?? new Error("Storage did not issue an upload capability.");
  }
  return response({ outcome: "upload", planId, path, token: signed.data.token });
}

async function finalizePlan(request: Request, admin: SupabaseClient, identity: ActiveBuilderIdentity, planId: string) {
  const value = await body(request, []);
  if (Object.keys(value).length !== 0) throw new TypeError("Finalization does not accept media metadata.");
  idempotencyKey(request);
  const selected = await admin
    .from("builder_media_upload_plans")
    .select("id, manifest_id, status, object_key, expected_sha256, claimed_byte_size, claimed_width, claimed_height, created_by")
    .eq("site_id", identity.siteId)
    .eq("id", planId)
    .maybeSingle();
  if (selected.error) throw selected.error;
  if (!selected.data || String(selected.data.created_by) !== identity.userId ||
      !["capability_issued", "uploaded"].includes(String(selected.data.status))) {
    throw new TypeError("The media upload plan is not finalizable.");
  }
  const downloaded = await admin.storage.from("builder-media").download(String(selected.data.object_key));
  if (downloaded.error || !downloaded.data) throw downloaded.error ?? new Error("The uploaded object is unavailable.");
  const stored = Buffer.from(await downloaded.data.arrayBuffer());
  const now = new Date().toISOString();
  await admin.from("builder_media_upload_plans").update({ status: "uploaded", object_uploaded_at: now, updated_at: now })
    .eq("site_id", identity.siteId).eq("id", planId);
  const verified = await verifyTrustedJpeg(stored);
  if (verified.sha256 !== selected.data.expected_sha256 ||
      verified.byteSize !== Number(selected.data.claimed_byte_size) ||
      verified.width !== Number(selected.data.claimed_width) ||
      verified.height !== Number(selected.data.claimed_height)) {
    await admin.from("builder_media_upload_plans").update({
      status: "rejected",
      rejection_code: "TRUSTED_BYTES_MISMATCH",
      cleanup_after: new Date(Date.now() + (2 * 60 * 60 + 15 * 60) * 1000).toISOString(),
      updated_at: now
    }).eq("site_id", identity.siteId).eq("id", planId);
    return response({ error: { code: "TRUSTED_BYTES_MISMATCH", message: "The uploaded bytes do not match the approved plan." } }, 422);
  }
  const claimed = await admin.rpc("builder_claim_media_identity_v2", {
    p_site_id: identity.siteId,
    p_plan_id: planId,
    p_actor_id: identity.userId,
    p_sha256: verified.sha256,
    p_mime_type: verified.mimeType,
    p_byte_size: verified.byteSize,
    p_width: verified.width,
    p_height: verified.height
  });
  if (claimed.error) throw claimed.error;
  const result = claimed.data as { status?: string; mediaId?: string; revisionId?: string };
  const mediaId = String(result.mediaId ?? "");
  const asset = mediaId ? await activeAsset(admin, identity, mediaId) : null;
  if (!asset) throw new Error("The finalized media asset could not be loaded.");
  return response({ outcome: result.status === "finalized" ? "finalized" : "deduplicated", asset });
}

type ImportReportItem = {
  name: string;
  status: "uploaded" | "skipped" | "archived" | "failed";
  message?: string;
};

function importReport(value: unknown): ImportReportItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MEDIA_BATCH_MAX_FILES) {
    throw new TypeError("The media import report is invalid.");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError("The media import report is invalid.");
    }
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["name", "status", "message"].includes(key)) ||
        typeof record.name !== "string" || record.name.length < 1 || record.name.length > 255 ||
        !["uploaded", "skipped", "archived", "failed"].includes(String(record.status)) ||
        (record.message !== undefined && (typeof record.message !== "string" || record.message.length > 500))) {
      throw new TypeError("The media import report is invalid.");
    }
    return {
      name: record.name,
      status: record.status as ImportReportItem["status"],
      ...(record.message ? { message: record.message as string } : {})
    };
  });
}

async function completeManifest(
  request: Request,
  admin: SupabaseClient,
  identity: ActiveBuilderIdentity,
  manifestId: string
) {
  if (identity.role !== "owner") {
    throw new BuilderAuthorizationError("ROLE_DENIED", 403, "Folder import is available to site owners only.");
  }
  idempotencyKey(request);
  const value = await body(request, ["report"]);
  const report = importReport(value.report);
  const manifestResult = await admin
    .from("builder_media_import_manifests")
    .select("id, status, file_count, created_by")
    .eq("site_id", identity.siteId)
    .eq("id", manifestId)
    .maybeSingle();
  if (manifestResult.error) throw manifestResult.error;
  const manifest = manifestResult.data;
  if (!manifest || String(manifest.created_by) !== identity.userId || Number(manifest.file_count) !== report.length) {
    throw new TypeError("The media import manifest does not match this report.");
  }
  const existing = await admin
    .from("builder_media_import_receipts")
    .select("id, result")
    .eq("site_id", identity.siteId)
    .eq("manifest_id", manifestId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) return response({ receiptId: existing.data.id, result: existing.data.result }, 201);
  if (!['active', 'draining'].includes(String(manifest.status))) {
    throw new TypeError("The media import manifest is not completable.");
  }

  const plansResult = await admin
    .from("builder_media_upload_plans")
    .select("status")
    .eq("site_id", identity.siteId)
    .eq("manifest_id", manifestId);
  if (plansResult.error) throw plansResult.error;
  const statuses = (plansResult.data ?? []).map((plan) => String(plan.status));
  if (statuses.length !== report.length || statuses.some((status) => ["planned", "capability_issued", "uploaded"].includes(status))) {
    throw Object.assign(new Error("The media import still has unfinished upload plans."), { code: "P0001" });
  }
  const expected = {
    uploaded: statuses.filter((status) => status === "finalized").length,
    skipped: statuses.filter((status) => status === "deduplicated" || status === "skipped_active").length,
    archived: statuses.filter((status) => status === "skipped_archived").length,
    failed: statuses.filter((status) => ["rejected", "expired", "cleaned", "cleanup_pending"].includes(status)).length
  };
  const reported = {
    uploaded: report.filter((item) => item.status === "uploaded").length,
    skipped: report.filter((item) => item.status === "skipped").length,
    archived: report.filter((item) => item.status === "archived").length,
    failed: report.filter((item) => item.status === "failed").length
  };
  if (Object.keys(expected).some((key) => expected[key as keyof typeof expected] !== reported[key as keyof typeof reported])) {
    throw new TypeError("The media import report does not match the finalized upload plans.");
  }
  const result = reported.failed === 0 ? "completed" : "completed_with_failures";
  const receiptId = crypto.randomUUID();
  const inserted = await admin.from("builder_media_import_receipts").insert({
    site_id: identity.siteId,
    id: receiptId,
    manifest_id: manifestId,
    result,
    uploaded_count: reported.uploaded,
    skipped_count: reported.skipped,
    archived_count: reported.archived,
    failed_count: reported.failed,
    report,
    created_by: identity.userId
  });
  if (inserted.error) throw inserted.error;
  const completedAt = new Date().toISOString();
  const completed = await admin.from("builder_media_import_manifests")
    .update({ status: "completed", completed_at: completedAt })
    .eq("site_id", identity.siteId)
    .eq("id", manifestId)
    .in("status", ["active", "draining"]);
  if (completed.error) throw completed.error;
  return response({ receiptId, result }, 201);
}

async function handlePost(request: Request, segments: string[]) {
  const identity = await authorize(request);
  const admin = adminClient();
  if (segments.length === 1 && segments[0] === "manifests") return createManifest(request, admin, identity);
  if (segments.length === 3 && segments[0] === "manifests" && segments[2] === "complete") {
    return completeManifest(request, admin, identity, segments[1]!);
  }
  if (segments.length === 1 && segments[0] === "plans") return createPlan(request, admin, identity);
  if (segments.length === 3 && segments[0] === "plans" && segments[2] === "finalize") {
    return finalizePlan(request, admin, identity, segments[1]!);
  }
  return response({ error: { code: "ROUTE_NOT_FOUND", message: "Media route not found." } }, 404);
}

export async function POST(request: Request, context: { params: Promise<{ segments?: string[] }> }) {
  try {
    return await handlePost(request, (await context.params).segments ?? []);
  } catch (error) {
    return errorResponse(error);
  }
}
