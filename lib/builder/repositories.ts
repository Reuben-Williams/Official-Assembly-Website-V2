import {
  createSupabaseAdapter,
  type BuilderContentAdapter,
  type BuilderSiteConfig,
  type EditableValue
} from "@reuben-williams/core";
import { createBuilderRouteHandlers } from "@reuben-williams/next/routes";
import type { SupabaseClient } from "@supabase/supabase-js";

import { BuilderAuthorizationError } from "./authorization";

const STABLE_REGION = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

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
    listMediaAssets: async () => base.listMediaAssets(await siteId())
  };
}

export function createSecuredBuilderHandlers(input: {
  site: BuilderSiteConfig;
  adapter: BuilderContentAdapter;
  authorize: Parameters<typeof createBuilderRouteHandlers>[0]["authorize"];
  getUserId: NonNullable<Parameters<typeof createBuilderRouteHandlers>[0]["getUserId"]>;
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
        return base.POST(recreatedRequest(request, sanitized));
      });
    },
    PUT: (request: Request) => safeCall(() => base.PUT(request)),
    PATCH: (request: Request) => safeCall(() => base.PATCH(request))
  };
}
