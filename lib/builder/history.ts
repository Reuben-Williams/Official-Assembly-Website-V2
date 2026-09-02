import type { SupabaseClient } from "@supabase/supabase-js";

export const HISTORY_SOURCES = ["page", "media", "post", "form", "calendar"] as const;
export const HISTORY_CATEGORIES = ["text", "media", "links", "sections", "posts", "forms", "events", "publishing"] as const;
export type HistorySource = typeof HISTORY_SOURCES[number];
export type HistoryCategory = typeof HISTORY_CATEGORIES[number];

export type HistoryQueryV1 = {
  limit: number;
  cursor?: string;
  categories?: HistoryCategory[];
  sources?: HistorySource[];
  search?: string;
  pagePath?: string;
  actorId?: string;
  action?: string;
};

export type HistoryEventV1 = {
  schemaVersion: 1;
  eventId: string;
  siteId: string;
  source: HistorySource;
  sourceEventId: string;
  category: HistoryCategory;
  action: string;
  workspace: string;
  pagePath?: string;
  targetId: string;
  targetLabel: string;
  actorId: string;
  actorLabel: string;
  createdAt: string;
  versions: { parentVersionId: string | null; sourceVersionId: string | null; resultVersionId: string | null };
  change: { before: string | null; after: string | null; changedFieldCount: number };
  provenance: { legacy: boolean; limited: boolean; redactedFields: string[] };
  restore: { allowed: boolean; operation: "restore" | "undo_restore" | null; reason: string | null };
};

export type HistoryPageV1 = {
  items: HistoryEventV1[];
  nextCursor: string | null;
  partial: boolean;
  unavailableSources: { source: HistorySource; code: string }[];
};

export type HistorySourceReaderV1 = (query: HistoryQueryV1) => Promise<readonly HistoryEventV1[]>;
export type HistoryBuilderRole = "owner" | "editor" | "contributor" | "viewer";

function required(label: string, value: unknown, maximum = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new TypeError(`${label} is required and must be at most ${maximum} characters.`);
  }
}

function canonicalInstant(value: unknown) {
  required("History timestamp", value, 40);
  if (new Date(value as string).toISOString() !== value) throw new TypeError("History timestamp must be canonical UTC.");
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 1_024) throw new TypeError("History cursor is invalid.");
  return Buffer.from(value, "base64url").toString("utf8");
}

export function createHistoryEventId(siteId: string, source: HistorySource, sourceEventId: string) {
  required("History site ID", siteId);
  required("History source event ID", sourceEventId, 300);
  if (!HISTORY_SOURCES.includes(source)) throw new TypeError("History source is invalid.");
  return `history:v1:${encodeURIComponent(siteId)}:${source}:${encodeURIComponent(sourceEventId)}`;
}

export function encodeHistoryCursorV1(input: { createdAt: string; source: HistorySource; sourceEventId: string }) {
  canonicalInstant(input.createdAt);
  if (!HISTORY_SOURCES.includes(input.source)) throw new TypeError("History cursor source is invalid.");
  required("History cursor source event ID", input.sourceEventId, 300);
  return encode(JSON.stringify([1, input.createdAt, input.source, input.sourceEventId]));
}

export function decodeHistoryCursorV1(cursor: string) {
  let value: unknown;
  try {
    value = JSON.parse(decode(cursor));
  } catch {
    throw new TypeError("History cursor is invalid.");
  }
  if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1) throw new TypeError("History cursor is invalid.");
  const result = { createdAt: value[1], source: value[2], sourceEventId: value[3] } as {
    createdAt: string; source: HistorySource; sourceEventId: string;
  };
  if (encodeHistoryCursorV1(result) !== cursor) throw new TypeError("History cursor is invalid.");
  return result;
}

export function validateHistoryQueryV1(query: Partial<HistoryQueryV1>): HistoryQueryV1 {
  const limit = query.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("History limit must be between 1 and 100.");
  if (query.cursor) decodeHistoryCursorV1(query.cursor);
  if (query.categories?.some((category) => !HISTORY_CATEGORIES.includes(category))) throw new TypeError("History category is invalid.");
  if (query.sources?.some((source) => !HISTORY_SOURCES.includes(source))) throw new TypeError("History source is invalid.");
  for (const [label, value] of [
    ["History search", query.search], ["History page path", query.pagePath],
    ["History actor ID", query.actorId], ["History action", query.action],
  ] as const) if (value !== undefined) required(label, value);
  return { ...query, limit };
}

export function parseHistoryRequestQueryV1(url: URL): HistoryQueryV1 {
  const allowed = new Set(["resource", "limit", "cursor", "category", "source", "search", "pagePath", "actorId", "action"]);
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw new TypeError(`History query contains unknown parameter: ${key}.`);
  const singleton = (key: string) => {
    const values = url.searchParams.getAll(key);
    if (values.length > 1) throw new TypeError(`History query parameter ${key} must be singular.`);
    return values[0];
  };
  return validateHistoryQueryV1({
    limit: singleton("limit") === undefined ? 50 : Number(singleton("limit")),
    ...(singleton("cursor") ? { cursor: singleton("cursor") } : {}),
    ...(url.searchParams.has("category") ? { categories: url.searchParams.getAll("category") as HistoryCategory[] } : {}),
    ...(url.searchParams.has("source") ? { sources: url.searchParams.getAll("source") as HistorySource[] } : {}),
    ...(singleton("search") ? { search: singleton("search") } : {}),
    ...(singleton("pagePath") ? { pagePath: singleton("pagePath") } : {}),
    ...(singleton("actorId") ? { actorId: singleton("actorId") } : {}),
    ...(singleton("action") ? { action: singleton("action") } : {}),
  });
}

function compareEvents(left: Pick<HistoryEventV1, "createdAt" | "source" | "sourceEventId">, right: Pick<HistoryEventV1, "createdAt" | "source" | "sourceEventId">) {
  return right.createdAt.localeCompare(left.createdAt) ||
    right.source.localeCompare(left.source) ||
    right.sourceEventId.localeCompare(left.sourceEventId);
}

function matches(event: HistoryEventV1, query: HistoryQueryV1) {
  if (query.categories && !query.categories.includes(event.category)) return false;
  if (query.sources && !query.sources.includes(event.source)) return false;
  if (query.pagePath && event.pagePath !== query.pagePath) return false;
  if (query.actorId && event.actorId !== query.actorId) return false;
  if (query.action && event.action !== query.action) return false;
  if (query.search) {
    const haystack = [event.targetLabel, event.action, event.actorLabel, event.pagePath, event.workspace].filter(Boolean).join(" ").toLocaleLowerCase();
    if (!haystack.includes(query.search.toLocaleLowerCase())) return false;
  }
  return true;
}

function currentRestore(event: HistoryEventV1, role: HistoryBuilderRole): HistoryEventV1["restore"] {
  if (event.source === "calendar") {
    return {
      allowed: false,
      operation: null,
      reason: "Event recovery is performed in the Calendar workspace."
    };
  }
  if (event.source !== "page") return { allowed: false, operation: null, reason: "This event is not restorable from website History." };
  if (event.provenance.limited) return { allowed: false, operation: null, reason: "This legacy event does not contain a verified version reference." };
  if (role !== "owner" && role !== "editor") return { allowed: false, operation: null, reason: "Your current role cannot restore page versions." };
  if (event.action === "version.restored" && event.versions.resultVersionId) return { allowed: true, operation: "undo_restore", reason: null };
  if (event.versions.sourceVersionId || event.versions.resultVersionId) return { allowed: true, operation: "restore", reason: null };
  return { allowed: false, operation: null, reason: "This event does not identify a restorable version." };
}

export async function collectHistoryPageV1(input: {
  query: Partial<HistoryQueryV1>;
  readers: Record<HistorySource, HistorySourceReaderV1>;
  role?: HistoryBuilderRole;
}): Promise<HistoryPageV1> {
  const query = validateHistoryQueryV1(input.query);
  const sources = query.sources ?? [...HISTORY_SOURCES];
  const settled = await Promise.all(sources.map(async (source) => {
    try {
      return { source, items: await input.readers[source](query) } as const;
    } catch {
      return { source, error: true } as const;
    }
  }));
  const unavailableSources = settled.flatMap((result) => "error" in result
    ? [{ source: result.source, code: "HISTORY_SOURCE_UNAVAILABLE" }]
    : []);
  const unique = new Map<string, HistoryEventV1>();
  for (const result of settled) {
    if ("error" in result) continue;
    for (const item of result.items) {
      const key = `${item.siteId}:${item.source}:${item.sourceEventId}`;
      const prior = unique.get(key);
      if (!prior || (prior.provenance.legacy && !item.provenance.legacy)) unique.set(key, item);
    }
  }
  const cursor = query.cursor ? decodeHistoryCursorV1(query.cursor) : null;
  const items = [...unique.values()]
    .filter((item) => matches(item, query))
    .filter((item) => !cursor || compareEvents(item, cursor) > 0)
    .sort(compareEvents)
    .map((item) => ({ ...item, restore: currentRestore(item, input.role ?? "viewer") }));
  const pageItems = items.slice(0, query.limit);
  const last = pageItems.at(-1);
  return {
    items: pageItems,
    nextCursor: items.length > query.limit && last ? encodeHistoryCursorV1(last) : null,
    partial: unavailableSources.length > 0,
    unavailableSources,
  };
}

export async function createHistoryResponseV1(input: {
  request: Request;
  readers: Record<HistorySource, HistorySourceReaderV1>;
  role: HistoryBuilderRole;
}): Promise<Response> {
  const page = await collectHistoryPageV1({
    query: parseHistoryRequestQueryV1(new URL(input.request.url)),
    readers: input.readers,
    role: input.role,
  });
  return Response.json(page, { headers: { "cache-control": "no-store" } });
}

function instant(value: unknown) {
  return new Date(String(value)).toISOString();
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullable(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function summary(value: unknown) {
  if (value === null || value === undefined) return null;
  const result = typeof value === "string" ? value : JSON.stringify(value);
  return result.length > 500 ? `${result.slice(0, 497)}...` : result;
}

function categoryForPage(row: Record<string, unknown>): HistoryCategory {
  if (/publish|rollback|restore|undo/u.test(String(row.action))) return "publishing";
  if (row.kind === "image") return "media";
  if (row.kind === "link") return "links";
  if (row.kind === "sections") return "sections";
  return "text";
}

function eventBase(input: {
  siteId: string; source: HistorySource; sourceEventId: string; category: HistoryCategory;
  action: string; workspace: string; pagePath?: string; targetId: string; targetLabel: string;
  actorId: string; actorLabel: string; createdAt: string;
  parentVersionId?: string | null; sourceVersionId?: string | null; resultVersionId?: string | null;
  before?: string | null; after?: string | null; changedFieldCount?: number;
  legacy: boolean; limited: boolean; redactedFields?: string[];
}): HistoryEventV1 {
  return {
    schemaVersion: 1,
    eventId: createHistoryEventId(input.siteId, input.source, input.sourceEventId),
    siteId: input.siteId,
    source: input.source,
    sourceEventId: input.sourceEventId,
    category: input.category,
    action: input.action,
    workspace: input.workspace,
    ...(input.pagePath ? { pagePath: input.pagePath } : {}),
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    actorId: input.actorId,
    actorLabel: input.actorLabel,
    createdAt: input.createdAt,
    versions: {
      parentVersionId: input.parentVersionId ?? null,
      sourceVersionId: input.sourceVersionId ?? null,
      resultVersionId: input.resultVersionId ?? null,
    },
    change: { before: input.before ?? null, after: input.after ?? null, changedFieldCount: input.changedFieldCount ?? 0 },
    provenance: { legacy: input.legacy, limited: input.limited, redactedFields: input.redactedFields ?? [] },
    restore: { allowed: false, operation: null, reason: "Restore permission has not been evaluated." },
  };
}

function pageSize(query: HistoryQueryV1) {
  return Math.min(500, Math.max(query.limit + 1, query.limit * 4));
}

function fixedSourceCursor<T>(builder: T, source: HistorySource, idColumn: string, query: HistoryQueryV1): T {
  if (!query.cursor) return builder;
  const cursor = decodeHistoryCursorV1(query.cursor);
  const escapedDate = `"${cursor.createdAt}"`;
  if (source > cursor.source) return (builder as T & { lt(column: string, value: string): T }).lt("created_at", cursor.createdAt);
  if (source < cursor.source) return (builder as T & { lte(column: string, value: string): T }).lte("created_at", cursor.createdAt);
  const escapedId = `"${cursor.sourceEventId.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  return (builder as T & { or(filters: string): T }).or(
    `created_at.lt.${escapedDate},and(created_at.eq.${escapedDate},${idColumn}.lt.${escapedId})`
  );
}

async function currentEvents(client: SupabaseClient, siteId: string, source: HistorySource, query: HistoryQueryV1) {
  let builder = client.from("builder_history_events_v1").select("*")
    .eq("site_id", siteId).eq("source", source)
    .order("created_at", { ascending: false }).order("source_event_id", { ascending: false })
    .limit(pageSize(query));
  builder = fixedSourceCursor(builder, source, "source_event_id", query);
  const result = await builder;
  if (result.error) throw result.error;
  return (result.data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    const change = row.change_summary as Record<string, unknown> | null;
    const provenance = row.provenance as Record<string, unknown> | null;
    return eventBase({
      siteId, source, sourceEventId: text(row.source_event_id), category: row.category as HistoryCategory,
      action: text(row.action), workspace: text(row.workspace), pagePath: text(row.page_path) || undefined,
      targetId: text(row.target_id), targetLabel: text(row.target_label), actorId: text(row.actor_id, "system"),
      actorLabel: text(row.actor_label, "Team member"), createdAt: instant(row.created_at),
      parentVersionId: nullable(row.parent_version_id), sourceVersionId: nullable(row.source_version_id),
      resultVersionId: nullable(row.result_version_id), before: summary(change?.before), after: summary(change?.after),
      changedFieldCount: Number(change?.changedFieldCount ?? 0), legacy: Boolean(provenance?.legacy),
      limited: Boolean(provenance?.limited), redactedFields: Array.isArray(provenance?.redactedFields)
        ? provenance.redactedFields.map(String) : [],
    });
  });
}

async function legacyPageEvents(client: SupabaseClient, siteId: string, query: HistoryQueryV1) {
  let builder = client.from("builder_audit_log").select("*").eq("site_id", siteId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize(query));
  builder = fixedSourceCursor(builder, "page", "id", query);
  const result = await builder;
  if (result.error) throw result.error;
  return (result.data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return eventBase({
      siteId, source: "page", sourceEventId: text(row.id), category: categoryForPage(row),
      action: text(row.action), workspace: "website.pages", pagePath: text(row.page_path),
      targetId: text(row.region_id, text(row.page_path)), targetLabel: text(row.summary, text(row.page_path)),
      actorId: text(row.user_id, "system"), actorLabel: text(row.user_label, "Team member"), createdAt: instant(row.created_at),
      sourceVersionId: nullable(row.source_version_id) ?? nullable(row.version_id), resultVersionId: nullable(row.result_version_id),
      before: summary(row.before), after: summary(row.after), changedFieldCount: row.before === row.after ? 0 : 1,
      legacy: true, limited: !row.source_version_id && !row.version_id && !row.result_version_id,
    });
  });
}

async function postEvents(client: SupabaseClient, siteId: string, query: HistoryQueryV1) {
  let builder = client.from("builder_audit_events").select("*").eq("site_id", siteId).not("entry_id", "is", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize(query));
  builder = fixedSourceCursor(builder, "post", "id", query);
  const result = await builder;
  if (result.error) throw result.error;
  return (result.data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return eventBase({
      siteId, source: "post", sourceEventId: text(row.id), category: "posts", action: text(row.action),
      workspace: "website.posts", pagePath: text(row.page_path) || undefined, targetId: text(row.entry_id),
      targetLabel: text(row.summary, "Post change"), actorId: text(row.actor_id, "system"),
      actorLabel: text(row.actor_email, "Team member"), createdAt: instant(row.created_at),
      sourceVersionId: nullable(row.source_version_id), resultVersionId: nullable(row.result_version_id),
      changedFieldCount: row.before_value === row.after_value ? 0 : 1,
      legacy: true, limited: true, redactedFields: ["postContent"],
    });
  });
}

async function mediaEvents(client: SupabaseClient, siteId: string, query: HistoryQueryV1) {
  let builder = client.from("builder_media_revisions")
    .select("id, media_id, mime_type, created_by, created_at").eq("site_id", siteId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize(query));
  builder = fixedSourceCursor(builder, "media", "id", query);
  const result = await builder;
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as Record<string, unknown>[];
  const ids = [...new Set(rows.map((row) => text(row.media_id)).filter(Boolean))];
  const labels = new Map<string, string>();
  if (ids.length) {
    const assets = await client.from("builder_media_assets").select("id, label").eq("site_id", siteId).in("id", ids);
    if (assets.error) throw assets.error;
    for (const asset of assets.data ?? []) labels.set(String(asset.id), String(asset.label));
  }
  return rows.map((row) => eventBase({
    siteId, source: "media", sourceEventId: text(row.id), category: "media", action: "media.uploaded",
    workspace: "website.media", targetId: text(row.media_id), targetLabel: labels.get(text(row.media_id)) ?? "Media image",
    actorId: text(row.created_by, "system"), actorLabel: "Team member", createdAt: instant(row.created_at),
    changedFieldCount: 1, legacy: true, limited: false,
  }));
}

async function formEvents(client: SupabaseClient, siteId: string, query: HistoryQueryV1) {
  let builder = client.from("builder_form_events").select("id, form_id, event_kind, actor_id, created_at")
    .eq("site_id", siteId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize(query));
  builder = fixedSourceCursor(builder, "form", "id", query);
  const result = await builder;
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as Record<string, unknown>[];
  const ids = [...new Set(rows.map((row) => text(row.form_id)).filter(Boolean))];
  const labels = new Map<string, string>();
  if (ids.length) {
    const forms = await client.from("builder_forms").select("id, form_key").eq("site_id", siteId).in("id", ids);
    if (forms.error) throw forms.error;
    for (const form of forms.data ?? []) labels.set(String(form.id), String(form.form_key));
  }
  return rows.map((row) => {
    const label = labels.get(text(row.form_id)) ?? "Managed form";
    return eventBase({
      siteId, source: "form", sourceEventId: text(row.id), category: "forms", action: `form.${text(row.event_kind, "changed")}`,
      workspace: "website.forms", pagePath: ["contact", "newsletter"].includes(label) ? `/${label}` : undefined,
      targetId: text(row.form_id), targetLabel: label, actorId: text(row.actor_id, "system"), actorLabel: "Team member",
      createdAt: instant(row.created_at), changedFieldCount: 1, legacy: true, limited: false,
      redactedFields: ["submission", "lead", "customer"],
    });
  });
}

export function createSupabaseHistoryReadersV1(client: SupabaseClient, siteId: string): Record<HistorySource, HistorySourceReaderV1> {
  return {
    page: async (query) => [
      ...(await currentEvents(client, siteId, "page", query)),
      ...(await legacyPageEvents(client, siteId, query)),
    ],
    media: async (query) => [
      ...(await currentEvents(client, siteId, "media", query)),
      ...(await mediaEvents(client, siteId, query)),
    ],
    post: async (query) => [
      ...(await currentEvents(client, siteId, "post", query)),
      ...(await postEvents(client, siteId, query)),
    ],
    form: async (query) => [
      ...(await currentEvents(client, siteId, "form", query)),
      ...(await formEvents(client, siteId, query)),
    ],
    calendar: async (query) => currentEvents(client, siteId, "calendar", query),
  };
}
