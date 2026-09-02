import { describe, expect, it } from "vitest";

import {
  CALENDAR_COMMANDS,
  CALENDAR_DISPLAY_TIME_ZONE,
  CALENDAR_FIELD_LIMITS,
  assertCalendarCommandTransition,
  assertCalendarPublishable,
  calendarIsoToLocalInput,
  calendarLocalDateTimeToIso,
  canRunCalendarCommand,
  getEffectiveCalendarEnd,
  isPublicCalendarEventEligible,
  normalizeCalendarDraft,
  sortPublicCalendarEvents,
  toPublicCalendarEvent,
  type CalendarEventEntity,
  type CalendarEventRevision
} from "../lib/calendar/contract";

const siteId = "182c3a48-a024-452b-bc88-44e795c55b95";
const eventId = "0bb3a51c-3c88-4d4e-a5b1-4a8d2192f34b";
const revisionId = "60dca582-43fe-4f31-b3cf-820e2498082d";
const memberId = "24cdb58e-8cb4-4638-972f-649a01196e42";
const mediaAssetId = "c9db1347-259d-4a3a-9f19-96762935745d";

function completeDraft() {
  return {
    titleEn: " District 34 Community Meeting ",
    titleEs: " Reunión comunitaria del Distrito 34 ",
    descriptionEn: " Meet with the district office. ",
    descriptionEs: " Reúnase con la oficina del distrito. ",
    startAt: "2026-09-20T14:00:00-04:00",
    endAt: "2026-09-20T16:00:00-04:00",
    locationName: " District Office ",
    locationAddress: " 152 Franklin Street, Belleville, NJ 07109 ",
    actionUrl: "https://www.essexclerk.com/Services/5",
    actionLabelEn: "Event information",
    actionLabelEs: "Información del evento",
    mediaAssetId,
    publicApproved: true,
    hostedByOffice: true
  };
}

function revision(overrides: Partial<CalendarEventRevision> = {}): CalendarEventRevision {
  return {
    id: revisionId,
    parentRevisionId: null,
    eventId,
    siteId,
    ...normalizeCalendarDraft(completeDraft()),
    authorMemberId: memberId,
    createdAt: "2026-09-01T14:00:00.000Z",
    ...overrides
  };
}

function entity(overrides: Partial<CalendarEventEntity> = {}): CalendarEventEntity {
  return {
    id: eventId,
    siteId,
    lifecycleState: "active",
    draftRevisionId: revisionId,
    publishedRevisionId: revisionId,
    createdByMemberId: memberId,
    updatedByMemberId: memberId,
    createdAt: "2026-09-01T14:00:00.000Z",
    updatedAt: "2026-09-01T14:00:00.000Z",
    publishedAt: "2026-09-01T14:05:00.000Z",
    archivedAt: null,
    commandVersion: 2,
    ...overrides
  };
}

describe("calendar draft normalization", () => {
  it("converts editor wall-clock values using the fixed New York timezone across DST", () => {
    expect(calendarLocalDateTimeToIso("2026-03-08T09:30")).toBe("2026-03-08T13:30:00.000Z");
    expect(calendarLocalDateTimeToIso("2026-11-01T09:30")).toBe("2026-11-01T14:30:00.000Z");
    expect(calendarIsoToLocalInput("2026-09-20T18:00:00.000Z")).toBe("2026-09-20T14:00");
    expect(() => calendarLocalDateTimeToIso("2026-03-08T02:30")).toThrow(/does not exist/i);
  });

  it("normalizes bilingual content, timestamps, links, and the fixed timezone", () => {
    expect(normalizeCalendarDraft(completeDraft())).toEqual({
      titleEn: "District 34 Community Meeting",
      titleEs: "Reunión comunitaria del Distrito 34",
      descriptionEn: "Meet with the district office.",
      descriptionEs: "Reúnase con la oficina del distrito.",
      startAt: "2026-09-20T18:00:00.000Z",
      endAt: "2026-09-20T20:00:00.000Z",
      displayTimeZone: "America/New_York",
      locationName: "District Office",
      locationAddress: "152 Franklin Street, Belleville, NJ 07109",
      actionUrl: "https://www.essexclerk.com/Services/5",
      actionLabelEn: "Event information",
      actionLabelEs: "Información del evento",
      mediaAssetId,
      publicApproved: true,
      hostedByOffice: true
    });
    expect(CALENDAR_DISPLAY_TIME_ZONE).toBe("America/New_York");
  });

  it("allows an incomplete bounded draft without inventing translations", () => {
    expect(normalizeCalendarDraft({
      titleEn: " Draft ",
      titleEs: "",
      descriptionEn: "",
      descriptionEs: "",
      startAt: null,
      endAt: "",
      locationName: "",
      locationAddress: "",
      actionUrl: "",
      actionLabelEn: "",
      actionLabelEs: "",
      mediaAssetId: null,
      publicApproved: false,
      hostedByOffice: false
    })).toMatchObject({
      titleEn: "Draft",
      titleEs: "",
      startAt: null,
      endAt: null,
      actionUrl: null,
      mediaAssetId: null
    });
  });

  it("rejects invalid dates and an end that is not later than the start", () => {
    expect(() => normalizeCalendarDraft({ ...completeDraft(), startAt: "not-a-date" })).toThrow(/start/i);
    expect(() => normalizeCalendarDraft({ ...completeDraft(), endAt: "not-a-date" })).toThrow(/end/i);
    expect(() => normalizeCalendarDraft({
      ...completeDraft(),
      endAt: "2026-09-20T14:00:00-04:00"
    })).toThrow(/later/i);
    expect(() => normalizeCalendarDraft({
      ...completeDraft(),
      endAt: "2026-09-20T13:59:59-04:00"
    })).toThrow(/later/i);
  });

  it.each([
    ["titleEn", CALENDAR_FIELD_LIMITS.title],
    ["titleEs", CALENDAR_FIELD_LIMITS.title],
    ["descriptionEn", CALENDAR_FIELD_LIMITS.description],
    ["descriptionEs", CALENDAR_FIELD_LIMITS.description],
    ["locationName", CALENDAR_FIELD_LIMITS.locationName],
    ["locationAddress", CALENDAR_FIELD_LIMITS.locationAddress],
    ["actionLabelEn", CALENDAR_FIELD_LIMITS.actionLabel],
    ["actionLabelEs", CALENDAR_FIELD_LIMITS.actionLabel]
  ] as const)("enforces the %s field limit", (field, limit) => {
    expect(() => normalizeCalendarDraft({
      ...completeDraft(),
      [field]: "x".repeat(limit + 1)
    })).toThrow(/length/i);
  });

  it("uses the canonical link policy and validates managed-media IDs", () => {
    expect(() => normalizeCalendarDraft({
      ...completeDraft(),
      actionUrl: "https://example.com/event"
    })).toThrow(/host/i);
    expect(() => normalizeCalendarDraft({
      ...completeDraft(),
      mediaAssetId: "not-a-uuid"
    })).toThrow(/media/i);
  });
});

describe("calendar publication", () => {
  it("accepts a complete approved office-hosted draft and ready site-owned media", () => {
    const draft = normalizeCalendarDraft(completeDraft());

    expect(assertCalendarPublishable(draft, {
      siteId,
      mediaAsset: { id: mediaAssetId, siteId, status: "ready" }
    })).toBe(draft);
  });

  it.each([
    ["titleEn", ""],
    ["titleEs", ""],
    ["descriptionEn", ""],
    ["descriptionEs", ""],
    ["startAt", null],
    ["locationName", ""],
    ["locationAddress", ""],
    ["publicApproved", false],
    ["hostedByOffice", false]
  ] as const)("rejects publication without %s", (field, value) => {
    const draft = normalizeCalendarDraft({ ...completeDraft(), [field]: value });
    expect(() => assertCalendarPublishable(draft, {
      siteId,
      mediaAsset: { id: mediaAssetId, siteId, status: "ready" }
    })).toThrow();
  });

  it("requires both localized link labels when an action URL is present", () => {
    const draft = normalizeCalendarDraft({ ...completeDraft(), actionLabelEs: "" });
    expect(() => assertCalendarPublishable(draft, {
      siteId,
      mediaAsset: { id: mediaAssetId, siteId, status: "ready" }
    })).toThrow(/label/i);
  });

  it.each([
    [undefined, /media/i],
    [{ id: mediaAssetId, siteId: "303c507d-b2f2-47dd-8a8d-626f3ce358c9", status: "ready" as const }, /site/i],
    [{ id: mediaAssetId, siteId, status: "processing" as const }, /ready/i]
  ])("rejects missing, foreign, or unready managed media", (mediaAsset, message) => {
    const draft = normalizeCalendarDraft(completeDraft());
    expect(() => assertCalendarPublishable(draft, { siteId, mediaAsset })).toThrow(message);
  });
});

describe("calendar commands", () => {
  it("exposes only the approved lifecycle commands", () => {
    expect(CALENDAR_COMMANDS).toEqual([
      "create_draft",
      "save_draft",
      "publish",
      "unpublish",
      "archive",
      "restore_to_draft"
    ]);
    expect(CALENDAR_COMMANDS).not.toContain("delete");
  });

  it("enforces role permissions", () => {
    expect(CALENDAR_COMMANDS.filter((command) => canRunCalendarCommand("viewer", command))).toEqual([]);
    expect(CALENDAR_COMMANDS.filter((command) => canRunCalendarCommand("contributor", command)))
      .toEqual(["create_draft", "save_draft"]);
    expect(CALENDAR_COMMANDS.every((command) => canRunCalendarCommand("editor", command))).toBe(true);
    expect(CALENDAR_COMMANDS.every((command) => canRunCalendarCommand("owner", command))).toBe(true);
  });

  it("rejects invalid lifecycle transitions", () => {
    expect(() => assertCalendarCommandTransition(entity({ lifecycleState: "archived" }), "save_draft")).toThrow(/restore/i);
    expect(() => assertCalendarCommandTransition(entity({ draftRevisionId: null }), "publish")).toThrow(/draft/i);
    expect(() => assertCalendarCommandTransition(entity({ publishedRevisionId: null }), "unpublish")).toThrow(/published/i);
    expect(() => assertCalendarCommandTransition(entity({ lifecycleState: "archived" }), "archive")).toThrow(/active/i);
    expect(() => assertCalendarCommandTransition(entity(), "restore_to_draft")).toThrow(/archived/i);
  });

  it("allows the approved lifecycle transitions", () => {
    expect(assertCalendarCommandTransition(entity(), "save_draft")).toBe(true);
    expect(assertCalendarCommandTransition(entity(), "publish")).toBe(true);
    expect(assertCalendarCommandTransition(entity(), "unpublish")).toBe(true);
    expect(assertCalendarCommandTransition(entity(), "archive")).toBe(true);
    expect(assertCalendarCommandTransition(entity({ lifecycleState: "archived" }), "restore_to_draft")).toBe(true);
  });
});

describe("calendar public eligibility and projection", () => {
  it("uses an explicit end timestamp when supplied", () => {
    expect(getEffectiveCalendarEnd(revision())).toBe("2026-09-20T20:00:00.000Z");
  });

  it.each([
    ["2026-03-08T13:00:00.000Z", "2026-03-09T04:00:00.000Z"],
    ["2026-11-01T14:00:00.000Z", "2026-11-02T05:00:00.000Z"],
    ["2026-09-20T18:00:00.000Z", "2026-09-21T04:00:00.000Z"]
  ])("uses the next local midnight as the no-end exclusive cutoff", (startAt, expected) => {
    expect(getEffectiveCalendarEnd(revision({ startAt, endAt: null }))).toBe(expected);
  });

  it("includes ongoing and future events but excludes the exact cutoff and invalid publication state", () => {
    const noEnd = revision({ endAt: null });
    expect(isPublicCalendarEventEligible(entity(), noEnd, "2026-09-20T22:00:00.000Z")).toBe(true);
    expect(isPublicCalendarEventEligible(entity(), noEnd, "2026-09-21T04:00:00.000Z")).toBe(false);
    expect(isPublicCalendarEventEligible(entity({ lifecycleState: "archived" }), noEnd, "2026-09-20T22:00:00.000Z")).toBe(false);
    expect(isPublicCalendarEventEligible(entity({ publishedRevisionId: null }), noEnd, "2026-09-20T22:00:00.000Z")).toBe(false);
    expect(isPublicCalendarEventEligible(entity(), revision({ publicApproved: false }), "2026-09-20T19:00:00.000Z")).toBe(false);
    expect(isPublicCalendarEventEligible(entity(), revision({ hostedByOffice: false }), "2026-09-20T19:00:00.000Z")).toBe(false);
  });

  it("sorts deterministically by start timestamp and then event ID", () => {
    const firstId = "00000000-0000-4000-8000-000000000001";
    const secondId = "00000000-0000-4000-8000-000000000002";
    const laterId = "00000000-0000-4000-8000-000000000003";
    const events = [
      { ...toPublicCalendarEvent(entity({ id: laterId }), revision({ eventId: laterId, startAt: "2026-09-21T14:00:00.000Z" })), id: laterId },
      { ...toPublicCalendarEvent(entity({ id: secondId }), revision({ eventId: secondId, startAt: "2026-09-20T14:00:00.000Z" })), id: secondId },
      { ...toPublicCalendarEvent(entity({ id: firstId }), revision({ eventId: firstId, startAt: "2026-09-20T14:00:00.000Z" })), id: firstId }
    ];

    expect(sortPublicCalendarEvents(events).map((event) => event.id))
      .toEqual([firstId, secondId, laterId]);
  });

  it("projects only public event fields", () => {
    const projected = toPublicCalendarEvent(entity(), revision());

    expect(projected).toMatchObject({
      id: eventId,
      titleEn: "District 34 Community Meeting",
      titleEs: "Reunión comunitaria del Distrito 34",
      startAt: "2026-09-20T18:00:00.000Z",
      displayTimeZone: "America/New_York",
      locationName: "District Office",
      actionUrl: "https://www.essexclerk.com/Services/5",
      mediaAssetId
    });
    for (const privateField of [
      "siteId",
      "draftRevisionId",
      "publishedRevisionId",
      "createdByMemberId",
      "updatedByMemberId",
      "authorMemberId",
      "commandVersion",
      "parentRevisionId",
      "revisionId",
      "publicApproved",
      "hostedByOffice"
    ]) {
      expect(projected).not.toHaveProperty(privateField);
    }
  });
});
