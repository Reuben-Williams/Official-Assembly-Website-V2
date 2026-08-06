import {
  createSupabaseAdapter,
  type BuilderContentAdapter,
  type BuilderSiteConfig,
  type EditableValue,
  type MediaAsset
} from "@reuben-williams/core";
import { createBuilderRouteHandlers } from "@reuben-williams/next/routes";
import type { SupabaseClient } from "@supabase/supabase-js";

import { BuilderAuthorizationError } from "./authorization";

const STABLE_REGION = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

type NormalizedMediaAssetRow = {
  id: unknown;
  site_id: unknown;
  label: unknown;
  created_by: unknown;
  created_at: unknown;
};

type NormalizedMediaRevisionRow = {
  media_id: unknown;
  id: unknown;
  object_key: unknown;
  mime_type: unknown;
  width: unknown;
  height: unknown;
  created_at: unknown;
};

export function mapNormalizedMediaAssets(
  assetRows: readonly NormalizedMediaAssetRow[],
  revisionRows: readonly NormalizedMediaRevisionRow[],
  signedUrls: ReadonlyMap<string, string>
): MediaAsset[] {
  const latestRevision = new Map<string, NormalizedMediaRevisionRow>();
  for (const revision of [...revisionRows].sort((left, right) =>
    String(right.created_at).localeCompare(String(left.created_at)))) {
    const mediaId = String(revision.media_id);
    if (!latestRevision.has(mediaId)) latestRevision.set(mediaId, revision);
  }

  return assetRows.flatMap((asset) => {
    const revision = latestRevision.get(String(asset.id));
    if (!revision) return [];
    const objectKey = String(revision.object_key);
    const url = signedUrls.get(objectKey);
    if (!url) return [];
    return [{
      id: String(asset.id),
      siteId: String(asset.site_id),
      path: objectKey,
      url,
      alt: String(asset.label),
      label: String(asset.label),
      mimeType: String(revision.mime_type),
      source: "upload" as const,
      ...(revision.width ? { width: Number(revision.width) } : {}),
      ...(revision.height ? { height: Number(revision.height) } : {}),
      userId: String(asset.created_by),
      createdAt: String(asset.created_at)
    }];
  });
}

export async function listNormalizedMediaAssets(
  client: SupabaseClient,
  siteId: string
): Promise<MediaAsset[]> {
  const assetsResult = await client
    .from("builder_media_assets")
    .select("id, site_id, label, created_by, created_at")
    .eq("site_id", siteId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (assetsResult.error) throw assetsResult.error;
  const assets = (assetsResult.data ?? []) as NormalizedMediaAssetRow[];
  if (assets.length === 0) return [];

  const revisionsResult = await client
    .from("builder_media_revisions")
    .select("media_id, id, object_key, mime_type, width, height, created_at")
    .eq("site_id", siteId)
    .in("media_id", assets.map((asset) => String(asset.id)))
    .order("created_at", { ascending: false });
  if (revisionsResult.error) throw revisionsResult.error;
  const revisions = (revisionsResult.data ?? []) as NormalizedMediaRevisionRow[];
  const objectKeys = [...new Set(revisions.map((revision) => String(revision.object_key)))];
  const signedUrls = new Map<string, string>();
  await Promise.all(objectKeys.map(async (objectKey) => {
    const result = await client.storage.from("builder-media").createSignedUrl(objectKey, 60 * 60);
    if (result.error) throw result.error;
    if (result.data?.signedUrl) signedUrls.set(objectKey, result.data.signedUrl);
  }));
  return mapNormalizedMediaAssets(assets, revisions, signedUrls);
}

function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Response.json(
    { error: { code, message }, ...extra },
    { status, headers: { "cache-control": "no-store" } }
  );
}

function secured(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function safeCall(action: () => Promise<Response>): Promise<Response> {
  try {
    return secured(await action());
  } catch (error) {
    if (error instanceof BuilderAuthorizationError) {
      return jsonError(error.status, error.code, error.message);
    }
    if (error instanceof TypeError) {
      return jsonError(400, "INVALID_REQUEST", "The builder request is invalid.");
    }
    return jsonError(503, "BUILDER_UNAVAILABLE", "The editor data service is unavailable.");
  }
}

async function readJsonObject(request: Request, limit = 65_536): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new TypeError("JSON required");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limit) throw new TypeError("Request too large");
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Object required");
  return parsed as Record<string, unknown>;
}

function validPagePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[?#\\\s]/.test(value);
}

function validEditableValue(value: unknown): value is EditableValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!["text", "richText", "image", "link", "sections", "icon"].includes(String(record.type))) return false;
  const encoded = JSON.stringify(value);
  if (encoded.length > 32_768) return false;
  if (record.type === "sections") return Array.isArray(record.value) && record.value.every((item) => typeof item === "string");
  if (record.type === "image") return typeof record.src === "string" && typeof record.alt === "string";
  if (record.type === "link") return typeof record.label === "string" && typeof record.href === "string";
  return typeof (record.value ?? record.icon) === "string";
}

function recreatedRequest(request: Request, body: unknown): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
    redirect: request.redirect
  });
}

export function createSiteKeyResolvingAdapter(input: {
  client: SupabaseClient;
  siteKey: string;
}): BuilderContentAdapter {
  const base = createSupabaseAdapter({ url: "http://localhost", serviceKey: "server-only", client: input.client });
  let siteIdPromise: Promise<string> | undefined;
  const siteId = () => {
    siteIdPromise ??= (async () => {
      const { data, error } = await input.client
        .from("builder_sites")
        .select("id")
        .eq("site_key", input.siteKey)
        .single();
      if (error || !data?.id) throw new Error("Site is not provisioned.");
      return String(data.id);
    })();
    return siteIdPromise;
  };

  return {
    getPublishedContent: async (_site, path) => base.getPublishedContent(await siteId(), path),
    getDraftContent: async (_site, path) => base.getDraftContent(await siteId(), path),
    saveDraft: async (value) => base.saveDraft({ ...value, siteId: await siteId() }),
    publishVersion: async (value) => base.publishVersion({ ...value, siteId: await siteId() }),
    rollbackToVersion: async (value) => base.rollbackToVersion({ ...value, siteId: await siteId() }),
    undoRollback: async (value) => base.undoRollback({ ...value, siteId: await siteId() }),
    listAuditLog: async (_site, path) => base.listAuditLog(await siteId(), path),
    createMediaAsset: async (value) => base.createMediaAsset({ ...value, siteId: await siteId() }),
    listMediaAssets: async () => listNormalizedMediaAssets(input.client, await siteId())
  };
}

export function createSecuredBuilderHandlers(input: {
  site: BuilderSiteConfig;
  adapter: BuilderContentAdapter;
  authorize: Parameters<typeof createBuilderRouteHandlers>[0]["authorize"];
  getUserId: NonNullable<Parameters<typeof createBuilderRouteHandlers>[0]["getUserId"]>;
  validateLinkedPost?: (entryId: string) => Promise<boolean>;
}) {
  const base = createBuilderRouteHandlers(input);

  return {
    GET: (request: Request) => safeCall(() => base.GET(request)),
    async POST(request: Request) {
      return safeCall(async () => {
        const resource = new URL(request.url).searchParams.get("resource") ?? "draft";
        if (resource !== "draft") return base.POST(request);

        const body = await readJsonObject(request);
        const allowed = new Set(["pagePath", "regionId", "value", "expectedVersionId"]);
        if (Object.keys(body).some((key) => !allowed.has(key)) ||
            !validPagePath(body.pagePath) || typeof body.regionId !== "string" ||
            !STABLE_REGION.test(body.regionId) || !validEditableValue(body.value) ||
            (body.expectedVersionId !== undefined && typeof body.expectedVersionId !== "string")) {
          throw new TypeError("Invalid draft request");
        }

        if (body.expectedVersionId !== undefined) {
          const current = await input.adapter.getDraftContent(input.site.siteId, body.pagePath);
          if ((current.versionId ?? null) !== body.expectedVersionId) {
            return jsonError(409, "STALE_REVISION", "The draft changed. Refresh and try again.", {
              currentVersionId: current.versionId ?? null
            });
          }
        }
        const { expectedVersionId: _expected, ...sanitized } = body;
        const editableValue = body.value as EditableValue;
        const postEntryId = editableValue.type === "link"
          ? editableValue.postEntryId
          : editableValue.type === "sections" || editableValue.type === "postCollection"
            ? undefined
            : editableValue.link?.postEntryId;
        if (postEntryId && input.validateLinkedPost && !(await input.validateLinkedPost(postEntryId))) {
          return jsonError(409, "POST_UNAVAILABLE", "The selected post is no longer available to link.");
        }
        return base.POST(recreatedRequest(request, sanitized));
      });
    },
    PUT: (request: Request) => safeCall(() => base.PUT(request)),
    PATCH: (request: Request) => safeCall(() => base.PATCH(request))
  };
}
