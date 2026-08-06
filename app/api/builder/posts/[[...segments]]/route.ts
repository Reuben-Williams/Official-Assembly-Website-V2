import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BuilderAuthorizationError,
  allowedBuilderOrigins,
  authorizeBuilderRequest,
  type ActiveBuilderIdentity
} from "../../../../../lib/builder/authorization";
import { authenticateBuilderRequest } from "../../../../../lib/builder/request-auth";
import {
  editablePostToSnapshot,
  parseEditablePostDraft,
  postRecordToEditableDraft
} from "../../../../../lib/builder/posts";
import { createRequestSupabaseClient } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EntryRow = {
  id: string;
  status: "draft" | "scheduled" | "published" | "archived";
  active_draft_version_id: string | null;
  active_published_version_id: string | null;
  updated_at: string;
};

type VersionRow = { id: string; snapshot: unknown };

function response(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof BuilderAuthorizationError) {
    return response({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof TypeError) {
    return response({ error: { code: "INVALID_POST", message: error.message } }, 400);
  }
  const candidate = error as { code?: string; message?: string };
  if (["23505", "40001"].includes(String(candidate?.code))) {
    return response({ error: { code: "POST_CONFLICT", message: "The post changed. Refresh and try again." } }, 409);
  }
  if (candidate?.code === "42501") {
    return response({ error: { code: "ROLE_DENIED", message: "This account cannot perform that post action." } }, 403);
  }
  console.error("Live posts API failed", { code: candidate?.code ?? "unknown" });
  return response({ error: { code: "POSTS_UNAVAILABLE", message: "The posts service is unavailable." } }, 503);
}

async function readBody(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new TypeError("A JSON post draft is required.");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > 262_144) throw new TypeError("The post draft is too large.");
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("The post draft is invalid.");
  return parsed as Record<string, unknown>;
}

function idempotencyKey(request: Request) {
  const value = request.headers.get("x-idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9:._-]{8,200}$/.test(value)) throw new TypeError("A valid idempotency key is required.");
  return value;
}

async function authorize(request: Request, mutation: "read" | "edit" | "publish") {
  const operation = mutation === "read"
    ? "content.readDraft"
    : mutation === "publish" ? "content.publish" : "content.editDraft";
  const identity = await authorizeBuilderRequest({
    request,
    operation,
    allowedOrigins: allowedBuilderOrigins(new URL(request.url).origin),
    authenticate: () => authenticateBuilderRequest(request)
  });
  if (!identity) throw new BuilderAuthorizationError("AUTH_REQUIRED", 401, "A verified editor session is required.");
  return identity;
}

async function requestClient(): Promise<SupabaseClient> {
  const client = await createRequestSupabaseClient();
  if (!client) throw new Error("Supabase is unavailable.");
  return client;
}

async function entry(client: SupabaseClient, identity: ActiveBuilderIdentity, entryId: string): Promise<EntryRow> {
  const result = await client
    .from("builder_entries")
    .select("id, status, active_draft_version_id, active_published_version_id, updated_at")
    .eq("site_id", identity.siteId)
    .eq("id", entryId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new TypeError("The selected post does not exist.");
  return result.data as EntryRow;
}

async function editablePost(client: SupabaseClient, identity: ActiveBuilderIdentity, entryId: string) {
  const selectedEntry = await entry(client, identity, entryId);
  const versionId = selectedEntry.active_draft_version_id ?? selectedEntry.active_published_version_id;
  if (!versionId) throw new TypeError("The selected post does not have an editable version.");
  const result = await client
    .from("builder_entry_versions")
    .select("id, snapshot")
    .eq("site_id", identity.siteId)
    .eq("entry_id", entryId)
    .eq("id", versionId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new TypeError("The selected post version does not exist.");
  return postRecordToEditableDraft({ entry: selectedEntry, version: result.data as VersionRow });
}

function taxonomyLabel(key: string) {
  return key.split("-").filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

async function ensureTaxonomies(client: SupabaseClient, identity: ActiveBuilderIdentity, categories: string[], tags: string[]) {
  const requested = [
    ...categories.map((key) => ({ key, kind: "category" as const })),
    ...tags.map((key) => ({ key, kind: "tag" as const }))
  ];
  if (requested.some(({ key }) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key))) {
    throw new TypeError("Category and tag keys must use lowercase letters, numbers, and hyphens.");
  }
  if (requested.length === 0) return {};
  const keys = [...new Set(requested.map(({ key }) => key))];
  const existingResult = await client
    .from("builder_taxonomies")
    .select("key, kind, label, slug")
    .eq("site_id", identity.siteId)
    .in("key", keys);
  if (existingResult.error) throw existingResult.error;
  type TaxonomyRow = { key: string; kind: string; label: string; slug: string };
  const rows = new Map<string, TaxonomyRow>((existingResult.data ?? []).map((row) => [String(row.key), {
    key: String(row.key),
    kind: String(row.kind),
    label: String(row.label),
    slug: String(row.slug)
  }]));
  for (const item of requested) {
    const current = rows.get(item.key);
    if (current && current.kind !== item.kind) throw new TypeError(`Taxonomy key "${item.key}" already has a different type.`);
    if (current) continue;
    const saved = await client.rpc("builder_save_taxonomy", {
      p_site_key: identity.siteKey,
      p_payload: {
        key: item.key,
        kind: item.kind,
        label: taxonomyLabel(item.key),
        slug: item.key,
        description: null,
        colorToken: null
      }
    });
    if (saved.error) throw saved.error;
    const savedRow = saved.data as Record<string, unknown>;
    rows.set(item.key, {
      key: String(savedRow.key ?? item.key),
      kind: String(savedRow.kind ?? item.kind),
      label: String(savedRow.label ?? taxonomyLabel(item.key)),
      slug: String(savedRow.slug ?? item.key)
    });
  }
  return Object.fromEntries(keys.map((key) => {
    const row = rows.get(key);
    return [key, { label: String(row?.label ?? taxonomyLabel(key)), slug: String(row?.slug ?? key) }];
  }));
}

async function transition(
  client: SupabaseClient,
  identity: ActiveBuilderIdentity,
  operation: "save_draft" | "publish" | "archive" | "restore_draft",
  selectedEntry: EntryRow,
  key: string,
  snapshot?: unknown
) {
  const result = await client.rpc("builder_transition_post", {
    p_site_key: identity.siteKey,
    p_operation: operation,
    p_payload: {
      entryId: selectedEntry.id,
      expectedDraftVersionId: selectedEntry.active_draft_version_id,
      expectedPublishedVersionId: selectedEntry.active_published_version_id,
      ...(snapshot ? { snapshot } : {})
    },
    p_idempotency_key: key
  });
  if (result.error) throw result.error;
}

async function handleGet(request: Request, segments: string[]) {
  const identity = await authorize(request, "read");
  const client = await requestClient();
  if (segments.length === 1) return response(await editablePost(client, identity, segments[0]));
  if (segments.length !== 0) return response({ error: { code: "ROUTE_NOT_FOUND", message: "Post route not found." } }, 404);

  const entriesResult = await client
    .from("builder_entries")
    .select("id, status, active_draft_version_id, active_published_version_id, updated_at")
    .eq("site_id", identity.siteId)
    .eq("content_type", "post")
    .order("updated_at", { ascending: false });
  if (entriesResult.error) throw entriesResult.error;
  const entries = (entriesResult.data ?? []) as EntryRow[];
  const versionIds = [...new Set(entries.flatMap((item) => {
    const id = item.active_draft_version_id ?? item.active_published_version_id;
    return id ? [id] : [];
  }))];
  const versions = new Map<string, VersionRow>();
  if (versionIds.length > 0) {
    const versionsResult = await client
      .from("builder_entry_versions")
      .select("id, snapshot")
      .eq("site_id", identity.siteId)
      .in("id", versionIds);
    if (versionsResult.error) throw versionsResult.error;
    for (const item of (versionsResult.data ?? []) as VersionRow[]) versions.set(String(item.id), item);
  }
  return response(entries.flatMap((item) => {
    const versionId = item.active_draft_version_id ?? item.active_published_version_id;
    const version = versionId ? versions.get(versionId) : undefined;
    if (!version) return [];
    const draft = postRecordToEditableDraft({ entry: item, version });
    return [{ entryId: item.id, title: draft.title, slug: draft.slug, status: item.status, updatedAt: item.updated_at }];
  }));
}

async function handlePost(request: Request, segments: string[]) {
  const action = segments[1];
  const mutation = action === "publish" || action === "archive" ? "publish" : "edit";
  const identity = await authorize(request, mutation);
  const client = await requestClient();
  const key = idempotencyKey(request);

  if (segments.length === 0) {
    const draft = parseEditablePostDraft(await readBody(request));
    if (draft.entryId) throw new TypeError("A new post cannot include an entry ID.");
    const taxonomies = await ensureTaxonomies(client, identity, draft.categoryKeys, draft.tagKeys);
    const snapshot = editablePostToSnapshot(draft, taxonomies);
    const entryId = crypto.randomUUID();
    const result = await client.rpc("builder_create_post", {
      p_site_key: identity.siteKey,
      p_entry_id: entryId,
      p_snapshot: snapshot,
      p_idempotency_key: key
    });
    if (result.error) throw result.error;
    return response(await editablePost(client, identity, entryId), 201);
  }

  if (segments.length !== 2 || !["draft", "publish", "archive", "restore-draft"].includes(action)) {
    return response({ error: { code: "ROUTE_NOT_FOUND", message: "Post route not found." } }, 404);
  }
  const entryId = segments[0];
  const selectedEntry = await entry(client, identity, entryId);
  if (action === "draft") {
    const draft = parseEditablePostDraft(await readBody(request));
    if (draft.entryId !== entryId) throw new TypeError("The post entry ID does not match the route.");
    if (draft.draftVersionId !== selectedEntry.active_draft_version_id ||
        draft.publishedVersionId !== selectedEntry.active_published_version_id) {
      return response({ error: { code: "POST_CONFLICT", message: "The post changed. Refresh and try again." } }, 409);
    }
    const taxonomies = await ensureTaxonomies(client, identity, draft.categoryKeys, draft.tagKeys);
    await transition(client, identity, "save_draft", selectedEntry, key, editablePostToSnapshot(draft, taxonomies));
  } else {
    const operation = action === "restore-draft" ? "restore_draft" : action as "publish" | "archive";
    await transition(client, identity, operation, selectedEntry, key);
  }
  return response(await editablePost(client, identity, entryId));
}

export async function GET(request: Request, context: { params: Promise<{ segments?: string[] }> }) {
  try {
    return await handleGet(request, (await context.params).segments ?? []);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ segments?: string[] }> }) {
  try {
    return await handlePost(request, (await context.params).segments ?? []);
  } catch (error) {
    return errorResponse(error);
  }
}
