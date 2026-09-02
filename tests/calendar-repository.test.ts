import { describe, expect, it, vi } from "vitest";

import {
  CalendarRepositoryError,
  loadPublicCalendar,
  type CalendarRepository
} from "../lib/calendar/repository";
import { createSupabaseCalendarRepository } from "../lib/calendar/supabase-repository";

const siteId = "182c3a48-a024-452b-bc88-44e795c55b95";
const siteKey = "official-assembly-website-v2";
const eventId = "0bb3a51c-3c88-4d4e-a5b1-4a8d2192f34b";
const revisionId = "60dca582-43fe-4f31-b3cf-820e2498082d";

const publicEvent = {
  id: eventId,
  titleEn: "District meeting",
  titleEs: "Reunión del distrito",
  descriptionEn: "Meet with the district office.",
  descriptionEs: "Reúnase con la oficina del distrito.",
  startAt: "2026-09-20T18:00:00.000Z",
  endAt: null,
  effectiveEndAt: "2026-09-21T04:00:00.000Z",
  displayTimeZone: "America/New_York" as const,
  locationName: "District Office",
  locationAddress: "152 Franklin Street, Belleville, NJ 07109",
  actionUrl: null,
  actionLabelEn: "",
  actionLabelEs: "",
  mediaAssetId: null
};

function supabase(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn(async () => result) };
}

describe("Supabase calendar repository", () => {
  it("uses site-scoped functions and returns bounded management records", async () => {
    const client = supabase({
      data: {
        schemaVersion: 1,
        events: [{
          entity: {
            id: eventId,
            siteId,
            lifecycleState: "active",
            draftRevisionId: revisionId,
            publishedRevisionId: null,
            createdByMemberId: "24cdb58e-8cb4-4638-972f-649a01196e42",
            updatedByMemberId: "24cdb58e-8cb4-4638-972f-649a01196e42",
            createdAt: "2026-09-01T14:00:00.000Z",
            updatedAt: "2026-09-01T14:00:00.000Z",
            publishedAt: null,
            archivedAt: null,
            commandVersion: 1
          },
          draftRevision: null,
          publishedRevision: null
        }]
      },
      error: null
    });
    const repository = createSupabaseCalendarRepository(client as never);

    const result = await repository.listManagement({
      siteId,
      siteKey,
      userId: "24cdb58e-8cb4-4638-972f-649a01196e42",
      role: "viewer"
    });

    expect(result.events).toHaveLength(1);
    expect(client.rpc).toHaveBeenCalledWith("builder_calendar_list_v1", {
      p_site_id: siteId
    });
  });

  it("runs commands with exact actor, site, version, and idempotency scope", async () => {
    const client = supabase({ data: { schemaVersion: 1, event: { id: eventId } }, error: null });
    const repository = createSupabaseCalendarRepository(client as never);

    await repository.executeCommand({
      context: {
        siteId,
        siteKey,
        userId: "24cdb58e-8cb4-4638-972f-649a01196e42",
        role: "contributor"
      },
      command: "save_draft",
      eventId,
      expectedVersion: 3,
      idempotencyKey: "calendar:save:request-1",
      draft: {
        titleEn: "Updated title",
        titleEs: "Título actualizado",
        descriptionEn: "Description",
        descriptionEs: "Descripción",
        startAt: "2026-09-20T18:00:00.000Z",
        endAt: null,
        displayTimeZone: "America/New_York",
        locationName: "District Office",
        locationAddress: "152 Franklin Street, Belleville, NJ 07109",
        actionUrl: null,
        actionLabelEn: "",
        actionLabelEs: "",
        mediaAssetId: null,
        publicApproved: false,
        hostedByOffice: false
      }
    });

    expect(client.rpc).toHaveBeenCalledWith("builder_calendar_command_v1", expect.objectContaining({
      p_site_id: siteId,
      p_actor_id: "24cdb58e-8cb4-4638-972f-649a01196e42",
      p_command: "save_draft",
      p_event_id: eventId,
      p_expected_version: 3,
      p_idempotency_key: "calendar:save:request-1"
    }));
  });

  it("maps stale and unavailable database responses to safe repository errors", async () => {
    const stale = createSupabaseCalendarRepository(supabase({
      data: null,
      error: { code: "40001", message: "STALE_CALENDAR_VERSION internal detail" }
    }) as never);
    await expect(stale.executeCommand({
      context: { siteId, siteKey, userId: "24cdb58e-8cb4-4638-972f-649a01196e42", role: "editor" },
      command: "publish",
      eventId,
      expectedVersion: 1,
      idempotencyKey: "calendar:publish:request-1"
    })).rejects.toMatchObject({ code: "STALE_VERSION", status: 409 });

    const unavailable = createSupabaseCalendarRepository(supabase({
      data: null,
      error: { code: "08006", message: "connection failed with private details" }
    }) as never);
    await expect(unavailable.readPublic({
      siteKey,
      evaluatedAt: "2026-09-01T14:00:00.000Z",
      limit: 3
    })).rejects.toMatchObject({ code: "UNAVAILABLE", status: 503 });
  });
});

describe("public calendar loader", () => {
  it("keeps an unavailable read distinct from an empty successful read", async () => {
    const emptyRepository = {
      readPublic: vi.fn(async () => []),
    } as unknown as CalendarRepository;
    await expect(loadPublicCalendar(emptyRepository, {
      siteKey,
      evaluatedAt: "2026-09-01T14:00:00.000Z",
      limit: 3
    })).resolves.toEqual({ status: "ready", events: [] });

    const failingRepository = {
      readPublic: vi.fn(async () => {
        throw new CalendarRepositoryError("UNAVAILABLE", 503, "Calendar unavailable.");
      })
    } as unknown as CalendarRepository;
    await expect(loadPublicCalendar(failingRepository, {
      siteKey,
      evaluatedAt: "2026-09-01T14:00:00.000Z",
      limit: 3
    })).resolves.toEqual({ status: "unavailable" });
  });

  it("returns only eligible, deterministic, limited public projections", async () => {
    const repository = {
      readPublic: vi.fn(async () => [
        { ...publicEvent, id: "00000000-0000-4000-8000-000000000003", startAt: "2026-09-22T18:00:00.000Z" },
        { ...publicEvent, id: "00000000-0000-4000-8000-000000000002" },
        { ...publicEvent, id: "00000000-0000-4000-8000-000000000001" },
        { ...publicEvent, id: "00000000-0000-4000-8000-000000000004", startAt: "2026-09-23T18:00:00.000Z" }
      ])
    } as unknown as CalendarRepository;

    const result = await loadPublicCalendar(repository, {
      siteKey,
      evaluatedAt: "2026-09-01T14:00:00.000Z",
      limit: 3
    });

    expect(result).toMatchObject({
      status: "ready",
      events: [
        { id: "00000000-0000-4000-8000-000000000001" },
        { id: "00000000-0000-4000-8000-000000000002" },
        { id: "00000000-0000-4000-8000-000000000003" }
      ]
    });
  });
});
