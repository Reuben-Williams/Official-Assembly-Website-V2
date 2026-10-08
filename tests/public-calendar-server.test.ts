import { describe, expect, it, vi } from "vitest";

import type { CalendarRepository } from "../lib/calendar/repository";
import { calendarMediaIsPublished, loadOfficialAssemblyPublicCalendar } from "../lib/calendar/server";
import type { PageMediaReference } from "../lib/builder/page-media";
import type { SupabaseClient } from "@supabase/supabase-js";

const mediaMocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../lib/builder/repositories", () => ({ listNormalizedMediaAssets: mediaMocks.list }));
vi.mock("../lib/supabase/admin", () => ({ getBuilderAdminClient: () => null, resolveBuilderSiteId: async () => "site-id" }));

function repository(readPublic: CalendarRepository["readPublic"]): CalendarRepository {
  return {
    readPublic,
    listManagement: vi.fn(),
    executeCommand: vi.fn(),
  };
}

describe("public calendar server loader", () => {
  it("authorizes only the exact ready revision used by a currently public event", async () => {
    const ref = { mediaId: "asset-id", revisionId: "revision-id", ready: true, archived: false } as PageMediaReference;
    const event = { id: "event-id", mediaAssetId: "asset-id", effectiveEndAt: "2099-01-01T00:00:00Z", startAt: "2098-12-01T00:00:00Z" };
    const read = vi.fn(async () => [event as never]);
    const deps = { client: {} as SupabaseClient, repository: repository(read) };
    mediaMocks.list.mockResolvedValue([{ id: "asset-id", revisionId: "revision-id", replicaStatus: "ready", url: "/api/builder/media/revision-id?preview=1" }]);
    expect(await calendarMediaIsPublished(ref, deps)).toBe(true);
    expect(await calendarMediaIsPublished({ ...ref, revisionId: "old-revision" }, deps)).toBe(false);
    expect(await calendarMediaIsPublished({ ...ref, mediaId: "other-asset" }, deps)).toBe(false);
    expect(await calendarMediaIsPublished({ ...ref, archived: true }, deps)).toBe(false);
    expect(await calendarMediaIsPublished({ ...ref, ready: false }, deps)).toBe(false);
    // Removing the publication also removes access on the next image request.
    read.mockResolvedValue([]);
    expect(await calendarMediaIsPublished(ref, deps)).toBe(false);
    read.mockRejectedValue(new Error("unavailable"));
    expect(await calendarMediaIsPublished(ref, deps)).toBe(false);
  });
  it("omits unavailable media while preserving the event", async () => {
    const event = { id: "event-id", mediaAssetId: "asset-id", effectiveEndAt: "2099-01-01T00:00:00Z", startAt: "2098-12-01T00:00:00Z" };
    mediaMocks.list.mockResolvedValue([{ id: "asset-id", revisionId: "revision-id", replicaStatus: "pending", url: "/api/builder/media/revision-id?preview=1" }]);
    const calendar = await loadOfficialAssemblyPublicCalendar({ limit: 3 }, { client: {} as SupabaseClient, repository: repository(vi.fn(async () => [event as never])) });
    expect(calendar).toEqual({ status: "ready", events: [event] });
  });
  it("uses a visitor-accessible revision URL rather than the editor preview URL", async () => {
    const event = { id: "event-id", mediaAssetId: "asset-id", effectiveEndAt: "2027-01-01T00:00:00Z", startAt: "2026-12-01T00:00:00Z" };
    mediaMocks.list.mockResolvedValue([{ id: "asset-id", revisionId: "revision-id", replicaStatus: "ready", url: "/api/builder/media/revision-id?preview=1" }]);
    const calendar = await loadOfficialAssemblyPublicCalendar({ limit: 3, evaluatedAt: "2026-10-08T00:00:00Z" }, {
      client: {} as SupabaseClient,
      repository: repository(vi.fn(async () => [event as never])),
    });
    expect(calendar.status).toBe("ready");
    if (calendar.status === "ready") expect(calendar.events[0].mediaUrl).toBe("/api/builder/media/revision-id");
  });
  it("performs a fresh authoritative read for every request", async () => {
    const readPublic = vi.fn(async () => []);
    const calendarRepository = repository(readPublic);

    await loadOfficialAssemblyPublicCalendar(
      { limit: 3, evaluatedAt: "2026-09-01T12:00:00.000Z" },
      { client: null, repository: calendarRepository },
    );
    await loadOfficialAssemblyPublicCalendar(
      { limit: 3, evaluatedAt: "2026-09-01T12:01:00.000Z" },
      { client: null, repository: calendarRepository },
    );

    expect(readPublic).toHaveBeenCalledTimes(2);
    expect(readPublic).toHaveBeenNthCalledWith(1, {
      siteKey: "official-assembly-website-v2",
      evaluatedAt: "2026-09-01T12:00:00.000Z",
      limit: 3,
    });
  });

  it("reports unavailable instead of presenting a failed read as an empty calendar", async () => {
    const calendarRepository = repository(vi.fn(async () => {
      throw new Error("database offline");
    }));

    await expect(loadOfficialAssemblyPublicCalendar(
      { limit: 100, evaluatedAt: "2026-09-01T12:00:00.000Z" },
      { client: null, repository: calendarRepository },
    )).resolves.toEqual({ status: "unavailable" });
  });
});
