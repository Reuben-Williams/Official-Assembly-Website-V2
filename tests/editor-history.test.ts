import { describe, expect, it } from "vitest";

import {
  collectHistoryPageV1,
  createHistoryEventId,
  decodeHistoryCursorV1,
  parseHistoryRequestQueryV1,
  type HistoryEventV1,
  type HistorySource,
  type HistorySourceReaderV1,
} from "../lib/builder/history";

function event(source: HistorySource, sourceEventId: string, createdAt: string, overrides: Partial<HistoryEventV1> = {}): HistoryEventV1 {
  const siteId = "official-site";
  return {
    schemaVersion: 1,
    eventId: createHistoryEventId(siteId, source, sourceEventId),
    siteId,
    source,
    sourceEventId,
    category: source === "calendar" ? "events" : source === "post" ? "posts" : source === "form" ? "forms" : source === "media" ? "media" : "text",
    action: `${source}.changed`,
    workspace: `website.${source}`,
    pagePath: source === "page" ? "/about" : undefined,
    targetId: `${source}-target`,
    targetLabel: `${source} target`,
    actorId: "user-1",
    actorLabel: "Editor",
    createdAt,
    versions: { parentVersionId: null, sourceVersionId: null, resultVersionId: null },
    change: { before: null, after: null, changedFieldCount: 1 },
    provenance: { legacy: false, limited: false, redactedFields: [] },
    restore: { allowed: false, operation: null, reason: "This event is not restorable." },
    ...overrides,
  };
}

function readers(values: Partial<Record<HistorySource, readonly HistoryEventV1[]>>): Record<HistorySource, HistorySourceReaderV1> {
  return {
    page: async () => values.page ?? [],
    media: async () => values.media ?? [],
    post: async () => values.post ?? [],
    form: async () => values.form ?? [],
    calendar: async () => values.calendar ?? [],
  };
}

describe("unified website history", () => {
  it("returns page, media, post, form, and calendar events in one site-level page", async () => {
    const result = await collectHistoryPageV1({
      query: { limit: 20 },
      readers: readers({
        page: [event("page", "page-1", "2026-08-07T04:00:04.000Z")],
        media: [event("media", "media-1", "2026-08-07T04:00:03.000Z")],
        post: [event("post", "post-1", "2026-08-07T04:00:02.000Z")],
        form: [event("form", "form-1", "2026-08-07T04:00:01.000Z")],
        calendar: [event("calendar", "calendar-1", "2026-08-07T04:00:00.000Z")],
      }),
    });

    expect(result.items.map((item) => item.source)).toEqual(["page", "media", "post", "form", "calendar"]);
    expect(result).toMatchObject({ partial: false, unavailableSources: [], nextCursor: null });
  });

  it("deduplicates compatible legacy and current projections by source provenance", async () => {
    const current = event("page", "same-command:/about", "2026-08-07T04:00:00.000Z");
    const legacy = { ...current, provenance: { ...current.provenance, legacy: true, limited: true } };
    const result = await collectHistoryPageV1({
      query: { limit: 20 },
      readers: readers({ page: [legacy, current] }),
      role: "owner",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      eventId: current.eventId,
      provenance: { legacy: false, limited: false },
    });
  });

  it("uses a stable source and source-event tie break for equal timestamps", async () => {
    const createdAt = "2026-08-07T04:00:00.000Z";
    const sourceReaders = readers({
      post: [event("post", "post-b", createdAt), event("post", "post-a", createdAt)],
      page: [event("page", "page-z", createdAt)],
    });
    const first = await collectHistoryPageV1({ query: { limit: 2 }, readers: sourceReaders });
    const second = await collectHistoryPageV1({ query: { limit: 2, cursor: first.nextCursor! }, readers: sourceReaders });

    expect(first.items.map((item) => `${item.source}:${item.sourceEventId}`)).toEqual(["post:post-b", "post:post-a"]);
    expect(decodeHistoryCursorV1(first.nextCursor!)).toEqual({ createdAt, source: "post", sourceEventId: "post-a" });
    expect(second.items.map((item) => `${item.source}:${item.sourceEventId}`)).toEqual(["page:page-z"]);
  });

  it("validates bounded URL filters and rejects unknown parameters", () => {
    expect(parseHistoryRequestQueryV1(new URL("https://site.test/api/builder?resource=history&limit=25&category=events&source=calendar&search=town")))
      .toMatchObject({ limit: 25, categories: ["events"], sources: ["calendar"], search: "town" });
    expect(() => parseHistoryRequestQueryV1(new URL("https://site.test/api/builder?resource=history&limit=1000"))).toThrow("between 1 and 100");
    expect(() => parseHistoryRequestQueryV1(new URL("https://site.test/api/builder?resource=history&secret=value"))).toThrow("unknown");
  });

  it("returns explicit partial-source status and never fabricates an empty healthy source", async () => {
    const sourceReaders = readers({ page: [event("page", "page-1", "2026-08-07T04:00:00.000Z")] });
    sourceReaders.post = async () => { throw new Error("database detail that must not escape"); };
    const result = await collectHistoryPageV1({ query: { limit: 20 }, readers: sourceReaders });

    expect(result.items).toHaveLength(1);
    expect(result).toMatchObject({
      partial: true,
      unavailableSources: [{ source: "post", code: "HISTORY_SOURCE_UNAVAILABLE" }],
    });
    expect(JSON.stringify(result)).not.toContain("database detail");
  });

  it("keeps sensitive form payloads outside the history response", async () => {
    const form = event("form", "form-1", "2026-08-07T04:00:00.000Z", {
      targetLabel: "Newsletter form",
      change: { before: null, after: null, changedFieldCount: 1 },
      provenance: { legacy: false, limited: false, redactedFields: ["submission", "lead", "customer"] },
    });
    const result = await collectHistoryPageV1({ query: { limit: 20 }, readers: readers({ form: [form] }) });

    expect(JSON.stringify(result)).not.toMatch(/email@example|phone|message body/i);
    expect(result.items[0]?.provenance.redactedFields).toEqual(["submission", "lead", "customer"]);
  });

  it("preserves calendar command revision semantics and disables global restore", async () => {
    const publishedRevisionId = "60dca582-43fe-4f31-b3cf-820e2498082d";
    const calendar = event("calendar", "calendar-publish-1", "2026-08-07T04:00:00.000Z", {
      category: "events",
      action: "calendar.publish",
      workspace: "website.calendar",
      targetId: "0bb3a51c-3c88-4d4e-a5b1-4a8d2192f34b",
      targetLabel: "District meeting",
      versions: {
        parentVersionId: null,
        sourceVersionId: null,
        resultVersionId: publishedRevisionId
      }
    });
    const result = await collectHistoryPageV1({
      query: { limit: 20, categories: ["events"], sources: ["calendar"] },
      readers: readers({ calendar: [calendar] }),
      role: "owner"
    });

    expect(result.items[0]).toMatchObject({
      source: "calendar",
      category: "events",
      versions: { sourceVersionId: null, resultVersionId: publishedRevisionId },
      restore: {
        allowed: false,
        operation: null,
        reason: "Event recovery is performed in the Calendar workspace."
      }
    });
  });

  it("reports the calendar source independently when its reader is unavailable", async () => {
    const sourceReaders = readers({ page: [event("page", "page-1", "2026-08-07T04:00:00.000Z")] });
    sourceReaders.calendar = async () => { throw new Error("private database detail"); };

    const result = await collectHistoryPageV1({ query: { limit: 20 }, readers: sourceReaders });
    expect(result.unavailableSources).toContainEqual({
      source: "calendar",
      code: "HISTORY_SOURCE_UNAVAILABLE"
    });
    expect(JSON.stringify(result)).not.toContain("private database detail");
  });
});
