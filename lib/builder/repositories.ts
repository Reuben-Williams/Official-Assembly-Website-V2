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
const GLOBAL_CONTENT_PATH = "/__builder/global";

type ContentCommandOperation = "save" | "publish" | "restore";
type ContentCommandScope = {
  scope: { kind: "global" | "page"; path: string };
  expectedDraftVersionId: string | null;
  expectedPublishedVersionId: string | null;
  values?: Record<string, EditableValue>;
  sourceVersionId?: string;
};
type BuilderContentCommand = {
  schemaVersion: 2;
  siteId: string;
  commandId: string;
  idempotencyKey: string;
  payloadDigest: string;
  actorId: string;
  operation: ContentCommandOperation;
  scopes: ContentCommandScope[];
};
type BuilderContentCommandResult = {
  commandId: string;
  operation: ContentCommandOperation;
  scopes: Array<{ path: string; kind: "global" | "page"; resultVersionId: string }>;
  siteGenerationId: number | null;
};

export interface BuilderContentCommandExecutor {
  execute(siteKey: string, command: BuilderContentCommand): Promise<BuilderContentCommandResult>;
}

export type BuilderContentCommandErrorCode =
  | "STALE_REVISION"
  | "CONTENT_COMMAND_DENIED"
  | "CONTENT_COMMAND_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "CONTENT_COMMAND_UNAVAILABLE";

const CONTENT_COMMAND_MESSAGES: Record<BuilderContentCommandErrorCode, string> = {
  STALE_REVISION: "The content changed. Refresh and try again.",
  CONTENT_COMMAND_DENIED: "This account cannot perform that content action.",
  CONTENT_COMMAND_INVALID: "The content action is invalid.",
  IDEMPOTENCY_CONFLICT: "That content action conflicts with an earlier request.",
  CONTENT_COMMAND_UNAVAILABLE: "The content service is temporarily unavailable."
};

export class BuilderContentCommandError extends Error {
  constructor(
    readonly code: BuilderContentCommandErrorCode,
    readonly status: number
  ) {
    super(CONTENT_COMMAND_MESSAGES[code]);
    this.name = "BuilderContentCommandError";
  }
}

function mapContentCommandError(error: { code?: string; message?: string }) {
  if (error.code === "40001" || /STALE_REVISION/i.test(error.message ?? "")) {
    return new BuilderContentCommandError("STALE_REVISION", 409);
  }
  if (error.code === "42501") return new BuilderContentCommandError("CONTENT_COMMAND_DENIED", 403);
  if (error.code === "22023" || error.code === "23514") {
    return new BuilderContentCommandError("CONTENT_COMMAND_INVALID", 400);
  }
  if (error.code === "23505") return new BuilderContentCommandError("IDEMPOTENCY_CONFLICT", 409);
  return new BuilderContentCommandError("CONTENT_COMMAND_UNAVAILABLE", 503);
}

export function createSupabaseContentCommandExecutor(
  client: SupabaseClient
): BuilderContentCommandExecutor {
  return {
    async execute(siteKey, command) {
      if (command.siteId !== siteKey) throw new TypeError("Cross-site content command rejected.");
      const result = await client.rpc("builder_execute_content_command_v2", {
        p_site_key: siteKey,
        p_command: command
      });
      if (result.error) throw mapContentCommandError(result.error);
      if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
        throw new BuilderContentCommandError("CONTENT_COMMAND_UNAVAILABLE", 503);
      }
      return result.data as unknown as BuilderContentCommandResult;
    }
  };
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) throw new TypeError("Undefined content command field");
      return `${JSON.stringify(key)}:${canonicalJson(entry)}`;
    }).join(",")}}`;
  }
  throw new TypeError("Invalid content command value");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function contentCommand(input: {
  siteId: string;
  actorId: string;
  operation: ContentCommandOperation;
  scopes: ContentCommandScope[];
}): Promise<BuilderContentCommand> {
  const commandId = crypto.randomUUID();
  const payload = {
    schemaVersion: 2 as const,
    siteId: input.siteId,
    commandId,
    idempotencyKey: `${input.operation}:${commandId}`,
    actorId: input.actorId,
    operation: input.operation,
    scopes: [...input.scopes].sort((left, right) => left.scope.path.localeCompare(right.scope.path))
  };
  return { ...payload, payloadDigest: await sha256(canonicalJson(payload)) };
}

type NormalizedMediaAssetRow = {
  id: unknown;
  site_id: unknown;
  label: unknown;
  alt_text?: unknown;
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

type MediaReplicaRow = {
  media_id: unknown;
  revision_id: unknown;
  status: unknown;
};

export type ManagedMediaAsset = MediaAsset & {
  revisionId: string;
  replicaStatus: "pending" | "ready" | "failed";
};

export function mapNormalizedMediaAssets(
  assetRows: readonly NormalizedMediaAssetRow[],
  revisionRows: readonly NormalizedMediaRevisionRow[],
  signedUrls: ReadonlyMap<string, string>,
  replicaRows: readonly MediaReplicaRow[] = []
): ManagedMediaAsset[] {
  const latestRevision = new Map<string, NormalizedMediaRevisionRow>();
  for (const revision of [...revisionRows].sort((left, right) =>
    String(right.created_at).localeCompare(String(left.created_at)))) {
    const mediaId = String(revision.media_id);
    if (!latestRevision.has(mediaId)) latestRevision.set(mediaId, revision);
  }
  const replicaStatus = new Map(replicaRows.map((replica) => [
    `${String(replica.media_id)}:${String(replica.revision_id)}`,
    String(replica.status),
  ]));

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
      alt: String(asset.alt_text ?? asset.label),
      label: String(asset.label),
      mimeType: String(revision.mime_type),
      source: "upload" as const,
      revisionId: String(revision.id),
      replicaStatus: (replicaStatus.get(`${String(asset.id)}:${String(revision.id)}`) ?? "pending") as ManagedMediaAsset["replicaStatus"],
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
): Promise<ManagedMediaAsset[]> {
  const assetsResult = await client
    .from("builder_media_assets")
    .select("id, site_id, label, alt_text, created_by, created_at")
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
  const replicaResult = await client
    .from("builder_media_recovery_replicas")
    .select("media_id, revision_id, status")
    .eq("site_id", siteId)
    .in("revision_id", revisions.map((revision) => String(revision.id)));
  if (replicaResult.error) throw replicaResult.error;
  const objectKeys = [...new Set(revisions.map((revision) => String(revision.object_key)))];
  const signedUrls = new Map<string, string>();
  await Promise.all(objectKeys.map(async (objectKey) => {
    const result = await client.storage.from("builder-media").createSignedUrl(objectKey, 60 * 60);
    if (result.error) throw result.error;
    if (result.data?.signedUrl) signedUrls.set(objectKey, result.data.signedUrl);
  }));
  return mapNormalizedMediaAssets(assets, revisions, signedUrls, (replicaResult.data ?? []) as MediaReplicaRow[]);
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
    if (error instanceof BuilderContentCommandError) {
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
  contentCommands?: BuilderContentCommandExecutor;
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
        if (input.contentCommands) {
          await input.authorize?.(request, "content.editDraft");
          const actorId = await input.getUserId(request);
          const globalIds = new Set((input.site.globalRegions ?? []).map((region) =>
            typeof region === "string" ? region : region.id));
          const pagePath = globalIds.has(body.regionId) ? GLOBAL_CONTENT_PATH : String(body.pagePath);
          const [draft, published] = await Promise.all([
            input.adapter.getDraftContent(input.site.siteId, pagePath),
            input.adapter.getPublishedContent(input.site.siteId, pagePath)
          ]);
          const command = await contentCommand({
            siteId: input.site.siteId,
            actorId,
            operation: "save",
            scopes: [{
              scope: { kind: pagePath === GLOBAL_CONTENT_PATH ? "global" : "page", path: pagePath },
              expectedDraftVersionId: draft.versionId ?? null,
              expectedPublishedVersionId: published.versionId ?? null,
              values: { ...draft.regions, [String(body.regionId)]: editableValue }
            }]
          });
          return Response.json(await input.contentCommands.execute(input.site.siteId, command));
        }
        return base.POST(recreatedRequest(request, sanitized));
      });
    },
    PUT: (request: Request) => safeCall(async () => {
      if (!input.contentCommands) return base.PUT(request);
      const body = await readJsonObject(request);
      if (Object.keys(body).some((key) => key !== "pagePath") || !validPagePath(body.pagePath)) {
        throw new TypeError("Invalid publish request");
      }
      await input.authorize?.(request, "content.publish");
      const actorId = await input.getUserId(request);
      const paths = (input.site.globalRegions?.length ?? 0) > 0
        ? [GLOBAL_CONTENT_PATH, body.pagePath]
        : [body.pagePath];
      const scopes = await Promise.all(paths.map(async (pagePath): Promise<ContentCommandScope> => {
        const [draft, published] = await Promise.all([
          input.adapter.getDraftContent(input.site.siteId, pagePath),
          input.adapter.getPublishedContent(input.site.siteId, pagePath)
        ]);
        return {
          scope: { kind: pagePath === GLOBAL_CONTENT_PATH ? "global" : "page", path: pagePath },
          expectedDraftVersionId: draft.versionId ?? null,
          expectedPublishedVersionId: published.versionId ?? null,
          values: draft.regions
        };
      }));
      const command = await contentCommand({
        siteId: input.site.siteId,
        actorId,
        operation: "publish",
        scopes
      });
      return Response.json(await input.contentCommands.execute(input.site.siteId, command));
    }),
    PATCH: (request: Request) => safeCall(async () => {
      if (!input.contentCommands || new URL(request.url).searchParams.get("resource") === "undo-rollback") {
        return base.PATCH(request);
      }
      const body = await readJsonObject(request);
      if (Object.keys(body).some((key) => key !== "pagePath" && key !== "versionId") ||
          !validPagePath(body.pagePath) || typeof body.versionId !== "string") {
        throw new TypeError("Invalid restore request");
      }
      await input.authorize?.(request, "history.rollback");
      const actorId = await input.getUserId(request);
      const [draft, published] = await Promise.all([
        input.adapter.getDraftContent(input.site.siteId, body.pagePath),
        input.adapter.getPublishedContent(input.site.siteId, body.pagePath)
      ]);
      const command = await contentCommand({
        siteId: input.site.siteId,
        actorId,
        operation: "restore",
        scopes: [{
          scope: {
            kind: body.pagePath === GLOBAL_CONTENT_PATH ? "global" : "page",
            path: body.pagePath
          },
          expectedDraftVersionId: draft.versionId ?? null,
          expectedPublishedVersionId: published.versionId ?? null,
          sourceVersionId: body.versionId
        }]
      });
      return Response.json(await input.contentCommands.execute(input.site.siteId, command));
    })
  };
}
