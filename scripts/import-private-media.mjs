import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SITE_KEY = "official-assembly-website-v2";
const OWNER_USER_ID = "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1";
const DEFAULT_SOURCE = "morales4assembly";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_BYTES = 250 * 1024 * 1024;
const MAX_FILES = 250;
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 40_000_000;
const DEFAULT_API_BASE_URL = "https://assemblywomanmorales.vercel.app";
const DEFAULT_SUPABASE_URL = "https://rriebibkxymeqhafssvw.supabase.co";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requestFingerprint(value) {
  return digest(JSON.stringify(value, Object.keys(value).sort()));
}

async function requireResult(promise, operation) {
  const result = await promise;
  if (result.error) {
    const error = new Error(`${operation} failed: ${result.error.message}`);
    error.code = result.error.code;
    throw error;
  }
  return result.data;
}

async function inspectJpeg(filePath, sourceRoot) {
  const bytes = await readFile(filePath);
  if (bytes.byteLength < 3 || bytes.byteLength > MAX_FILE_BYTES ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error(`${path.basename(filePath)} is not an allowed JPEG.`);
  }
  const image = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_PIXELS });
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (metadata.format !== "jpeg" || width < 1 || height < 1 ||
      width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new Error(`${path.basename(filePath)} exceeds the trusted JPEG limits.`);
  }
  await image.clone().resize(1, 1, { fit: "fill" }).raw().toBuffer();
  return {
    absolutePath: filePath,
    relativePath: path.relative(sourceRoot, filePath).split(path.sep).join("/"),
    name: path.basename(filePath),
    bytes,
    byteSize: bytes.byteLength,
    width,
    height,
    sha256: digest(bytes)
  };
}

async function collectJpegs(sourceRoot) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && /\.jpe?g$/i.test(entry.name)) files.push(target);
    }
  }
  await visit(sourceRoot);
  const inspected = [];
  for (const file of files) inspected.push(await inspectJpeg(file, sourceRoot));
  const totalBytes = inspected.reduce((total, file) => total + file.byteSize, 0);
  const uniqueDigests = new Set(inspected.map((file) => file.sha256));
  if (inspected.length < 1 || inspected.length > MAX_FILES || totalBytes > MAX_BATCH_BYTES) {
    throw new Error("The source folder exceeds the private media batch limits.");
  }
  if (uniqueDigests.size !== inspected.length) {
    throw new Error("The source folder contains duplicate JPEG bytes.");
  }
  return { files: inspected, totalBytes };
}

async function apiRequest(baseUrl, token, route, requestBody, key) {
  const result = await fetch(new URL(route, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-builder-media-import-token": token,
      "x-idempotency-key": key
    },
    body: JSON.stringify(requestBody)
  });
  const value = await result.json().catch(() => null);
  if (!result.ok) {
    throw new Error(`Media API ${route} failed (${result.status}): ${value?.error?.message ?? "unknown error"}`);
  }
  return value;
}

async function uploadWithSignedToken(supabaseUrl, objectKey, token, bytes) {
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  const target = new URL(`/storage/v1/object/upload/sign/builder-media/${encodedKey}`, supabaseUrl);
  target.searchParams.set("token", token);
  const result = await fetch(target, {
    method: "PUT",
    headers: {
      "cache-control": "max-age=3600",
      "content-type": "image/jpeg",
      "x-upsert": "false"
    },
    body: bytes
  });
  if (!result.ok) {
    const detail = await result.text().catch(() => "");
    throw new Error(`Signed private upload failed (${result.status}): ${detail.slice(0, 200)}`);
  }
}

async function importViaApi({ files, totalBytes, sourceManifestSha256, sourceRoot, token }) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("The media operator token must be 64 lowercase hexadecimal characters.");
  const baseUrl = process.env.MEDIA_IMPORT_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const supabaseUrl = process.env.MEDIA_IMPORT_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL;
  const runId = randomUUID();
  const manifest = await apiRequest(baseUrl, token, "/api/builder/media/manifests", {
    sourceLabel: path.basename(sourceRoot),
    sourceManifestSha256,
    fileCount: files.length,
    totalBytes
  }, `operator:${runId}:manifest`);
  const manifestId = String(manifest.manifestId ?? "");
  if (!manifestId) throw new Error("The media API did not create an import manifest.");

  const report = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const plan = await apiRequest(baseUrl, token, "/api/builder/media/plans", {
      mode: "batch",
      manifestId,
      sourceName: file.name,
      claimedMimeType: "image/jpeg",
      claimedByteSize: file.byteSize,
      claimedWidth: file.width,
      claimedHeight: file.height,
      expectedSha256: file.sha256
    }, `operator:${runId}:plan:${index.toString().padStart(3, "0")}`);
    if (plan.outcome === "skipped_active") report.push({ name: file.name, status: "skipped" });
    else if (plan.outcome === "skipped_archived") report.push({ name: file.name, status: "archived" });
    else if (plan.outcome === "upload" && plan.planId && plan.path && plan.token) {
      await uploadWithSignedToken(supabaseUrl, String(plan.path), String(plan.token), file.bytes);
      const finalized = await apiRequest(
        baseUrl,
        token,
        `/api/builder/media/plans/${encodeURIComponent(String(plan.planId))}/finalize`,
        {},
        `operator:${runId}:finalize:${index.toString().padStart(3, "0")}`
      );
      if (finalized.outcome === "finalized") report.push({ name: file.name, status: "uploaded" });
      else if (finalized.outcome === "deduplicated") report.push({ name: file.name, status: "skipped" });
      else throw new Error(`Unexpected finalize result for ${file.name}.`);
    } else {
      throw new Error(`Unexpected plan result for ${file.name}.`);
    }
    if ((index + 1) % 20 === 0 || index + 1 === files.length) console.log(`Processed ${index + 1}/${files.length}`);
  }

  const completed = await apiRequest(
    baseUrl,
    token,
    `/api/builder/media/manifests/${encodeURIComponent(manifestId)}/complete`,
    { report },
    `operator:${runId}:complete`
  );
  const counts = {
    uploaded: report.filter((item) => item.status === "uploaded").length,
    skipped: report.filter((item) => item.status === "skipped").length,
    archived: report.filter((item) => item.status === "archived").length
  };
  console.log(JSON.stringify({ manifestId, receiptId: completed.receiptId, result: completed.result, ...counts, failed: 0 }));
}

function planObjectKey(siteId, planId) {
  return `${siteId}/${planId}/${randomUUID()}.jpg`;
}

async function main() {
  const sourceRoot = path.resolve(process.argv[2] ?? DEFAULT_SOURCE);
  const { files, totalBytes } = await collectJpegs(sourceRoot);
  const sourceManifestSha256 = digest(JSON.stringify(files.map((file) => ({
    path: file.relativePath,
    sha256: file.sha256,
    byteSize: file.byteSize,
    width: file.width,
    height: file.height
  }))));

  if (process.env.IMPORT_DRY_RUN === "1") {
    console.log(JSON.stringify({ mode: "dry-run", fileCount: files.length, totalBytes, sourceManifestSha256 }));
    return;
  }

  const operatorToken = process.env.BUILDER_MEDIA_IMPORT_TOKEN?.trim();
  if (operatorToken) {
    await importViaApi({ files, totalBytes, sourceManifestSha256, sourceRoot, token: operatorToken });
    return;
  }

  const client = createClient(
    requireEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const site = await requireResult(
    client.from("builder_sites").select("id").eq("site_key", SITE_KEY).maybeSingle(),
    "Site lookup"
  );
  if (!site?.id) throw new Error(`The ${SITE_KEY} site is not provisioned.`);
  const siteId = String(site.id);
  const receipt = await requireResult(
    client.from("builder_media_inventory_receipts")
      .select("id, problems, valid_until")
      .eq("site_id", siteId)
      .eq("status", "succeeded")
      .gt("valid_until", new Date().toISOString())
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "Inventory receipt lookup"
  );
  if (!receipt?.id || !Array.isArray(receipt.problems) || receipt.problems.length !== 0) {
    throw new Error("A current clean private media inventory receipt is required.");
  }

  const manifestId = randomUUID();
  const manifestValue = {
    sourceLabel: path.basename(sourceRoot),
    sourceManifestSha256,
    fileCount: files.length,
    totalBytes
  };
  const expiresAt = new Date(Date.now() + (23 * 60 * 60 + 59 * 60) * 1000).toISOString();
  await requireResult(client.from("builder_media_import_manifests").insert({
    site_id: siteId,
    id: manifestId,
    status: "active",
    source_label: manifestValue.sourceLabel,
    source_manifest_sha256: sourceManifestSha256,
    file_count: files.length,
    total_bytes: totalBytes,
    idempotency_key: `operator:${sourceManifestSha256}:${randomUUID()}`,
    request_fingerprint: requestFingerprint(manifestValue),
    inventory_receipt_id: receipt.id,
    expires_at: expiresAt,
    created_by: OWNER_USER_ID
  }), "Manifest creation");

  const report = [];
  let completed = false;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const identity = await requireResult(
        client.from("builder_media_identities")
          .select("media_id")
          .eq("site_id", siteId)
          .eq("sha256", file.sha256)
          .maybeSingle(),
        "Media identity lookup"
      );
      let status = "planned";
      if (identity?.media_id) {
        const asset = await requireResult(
          client.from("builder_media_assets")
            .select("archived_at")
            .eq("site_id", siteId)
            .eq("id", identity.media_id)
            .maybeSingle(),
          "Canonical media lookup"
        );
        status = asset?.archived_at ? "skipped_archived" : "skipped_active";
      }

      const planId = randomUUID();
      const objectKey = planObjectKey(siteId, planId);
      const planValue = {
        mode: "batch",
        manifestId,
        sourceName: file.name,
        claimedMimeType: "image/jpeg",
        claimedByteSize: file.byteSize,
        claimedWidth: file.width,
        claimedHeight: file.height,
        expectedSha256: file.sha256
      };
      await requireResult(client.from("builder_media_upload_plans").insert({
        site_id: siteId,
        id: planId,
        manifest_id: manifestId,
        mode: "batch",
        status,
        source_name: file.name,
        object_key: objectKey,
        claimed_mime_type: "image/jpeg",
        claimed_byte_size: file.byteSize,
        claimed_width: file.width,
        claimed_height: file.height,
        expected_sha256: file.sha256,
        idempotency_key: `operator:${manifestId}:${index.toString().padStart(3, "0")}`,
        request_fingerprint: requestFingerprint(planValue),
        expires_at: expiresAt,
        created_by: OWNER_USER_ID
      }), `Plan creation for ${file.name}`);

      if (status === "skipped_active") report.push({ name: file.name, status: "skipped" });
      else if (status === "skipped_archived") report.push({ name: file.name, status: "archived" });
      else {
        await requireResult(client.rpc("builder_issue_media_upload_capability", {
          p_site_id: siteId,
          p_plan_id: planId,
          p_actor_id: OWNER_USER_ID
        }), `Capability issuance for ${file.name}`);
        const signed = await requireResult(
          client.storage.from("builder-media").createSignedUploadUrl(objectKey, { upsert: false }),
          `Signed upload creation for ${file.name}`
        );
        if (!signed?.token) throw new Error(`Storage did not issue an upload token for ${file.name}.`);
        await requireResult(
          client.storage.from("builder-media").uploadToSignedUrl(objectKey, signed.token, file.bytes, {
            contentType: "image/jpeg",
            upsert: false
          }),
          `Private upload for ${file.name}`
        );
        const objectUploadedAt = new Date().toISOString();
        await requireResult(client.from("builder_media_upload_plans")
          .update({ status: "uploaded", object_uploaded_at: objectUploadedAt, updated_at: objectUploadedAt })
          .eq("site_id", siteId)
          .eq("id", planId), `Upload acknowledgement for ${file.name}`);
        const downloaded = await requireResult(
          client.storage.from("builder-media").download(objectKey),
          `Trusted object read for ${file.name}`
        );
        const stored = Buffer.from(await downloaded.arrayBuffer());
        const trusted = await inspectJpegBytes(stored, file.name);
        if (trusted.sha256 !== file.sha256 || trusted.byteSize !== file.byteSize ||
            trusted.width !== file.width || trusted.height !== file.height) {
          throw new Error(`Trusted storage verification failed for ${file.name}.`);
        }
        const claimed = await requireResult(client.rpc("builder_claim_media_identity", {
          p_site_id: siteId,
          p_plan_id: planId,
          p_actor_id: OWNER_USER_ID,
          p_sha256: trusted.sha256,
          p_mime_type: "image/jpeg",
          p_byte_size: trusted.byteSize,
          p_width: trusted.width,
          p_height: trusted.height
        }), `Identity claim for ${file.name}`);
        if (claimed?.status !== "finalized") {
          throw new Error(`Unexpected claim result for ${file.name}: ${claimed?.status ?? "missing"}.`);
        }
        report.push({ name: file.name, status: "uploaded" });
      }
      if ((index + 1) % 20 === 0 || index + 1 === files.length) {
        console.log(`Processed ${index + 1}/${files.length}`);
      }
    }

    const counts = {
      uploaded: report.filter((item) => item.status === "uploaded").length,
      skipped: report.filter((item) => item.status === "skipped").length,
      archived: report.filter((item) => item.status === "archived").length
    };
    const receiptId = randomUUID();
    await requireResult(client.from("builder_media_import_receipts").insert({
      site_id: siteId,
      id: receiptId,
      manifest_id: manifestId,
      result: "completed",
      uploaded_count: counts.uploaded,
      skipped_count: counts.skipped,
      archived_count: counts.archived,
      failed_count: 0,
      report,
      created_by: OWNER_USER_ID
    }), "Import receipt creation");
    const completedAt = new Date().toISOString();
    await requireResult(client.from("builder_media_import_manifests")
      .update({ status: "completed", completed_at: completedAt })
      .eq("site_id", siteId)
      .eq("id", manifestId), "Manifest completion");
    completed = true;
    console.log(JSON.stringify({ manifestId, receiptId, result: "completed", ...counts, failed: 0 }));
  } finally {
    if (!completed) {
      const completedAt = new Date().toISOString();
      await client.from("builder_media_import_manifests")
        .update({ status: "blocked", completed_at: completedAt })
        .eq("site_id", siteId)
        .eq("id", manifestId)
        .in("status", ["planning", "active", "draining"]);
    }
  }
}

async function inspectJpegBytes(bytes, name) {
  if (bytes.byteLength < 3 || bytes.byteLength > MAX_FILE_BYTES ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error(`${name} is not a trusted JPEG.`);
  }
  const image = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_PIXELS });
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (metadata.format !== "jpeg" || width < 1 || height < 1 ||
      width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new Error(`${name} failed trusted JPEG verification.`);
  }
  await image.clone().resize(1, 1, { fit: "fill" }).raw().toBuffer();
  return { sha256: digest(bytes), byteSize: bytes.byteLength, width, height };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Private media import failed.");
  process.exitCode = 1;
});
