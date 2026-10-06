import { describe, expect, it } from "vitest";
import { googleCalendarEventUrl, serializePublicCalendar } from "../lib/calendar/integrations";
import { createCalendarDownloadHandler } from "../lib/calendar/downloads";
import type { PublicCalendarEvent } from "../lib/calendar/contract";

const event: PublicCalendarEvent = {
  id: "11111111-1111-4111-8111-111111111111", titleEn: "Meet, share; connect", titleEs: "Reunión comunitaria",
  descriptionEn: "First line\nSecond line", descriptionEs: "Información del encuentro",
  startAt: "2026-11-04T23:00:00Z", endAt: "2026-11-05T00:00:00Z", effectiveEndAt: "2026-11-05T00:00:00Z",
  displayTimeZone: "America/New_York", locationName: "District Office", locationAddress: "152 Franklin Street",
  actionUrl: null, actionLabelEn: "", actionLabelEs: "", mediaAssetId: null,
};
const generatedAt = "2026-10-06T03:00:00Z";

describe("public calendar connections", () => {
  it("uses original English for missing Spanish in both Google and ICS", () => {
    const fallback = { ...event, titleEs: " ", descriptionEs: "" };
    expect(new URL(googleCalendarEventUrl(fallback, "es")).searchParams.get("text")).toBe(event.titleEn);
    expect(serializePublicCalendar([fallback], "es", generatedAt)).toContain("DESCRIPTION:First line\\nSecond line");
  });
  it("offers a Google event with exact UTC times and selected-language content", () => {
    const url = new URL(googleCalendarEventUrl(event, "es"));
    expect(url.origin).toBe("https://calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(event.titleEs);
    expect(url.searchParams.get("dates")).toBe("20261104T230000Z/20261105T000000Z");
    expect(url.searchParams.get("location")).toContain(event.locationAddress);
  });
  it("escapes iCalendar content and folds UTF-8 lines without splitting a character", () => {
    const text = serializePublicCalendar([{ ...event, descriptionEn: "Información 💬 ".repeat(50) + "\nBEGIN:VEVENT" }], "en", generatedAt);
    const lines = text.split("\r\n");
    expect(lines.every(line => new TextEncoder().encode(line).length <= 75)).toBe(true);
    const unfolded = text.replace(/\r\n /g, "");
    expect(unfolded).toContain("SUMMARY:Meet\\, share\\; connect");
    expect(unfolded).toContain("\\nBEGIN:VEVENT");
    expect(lines.filter(line => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(text).not.toContain("�");
    expect(unfolded).toContain("DTSTART:20261104T230000Z");
    expect(unfolded).toContain("DTEND:20261105T000000Z");
    expect(unfolded).not.toMatch(/mediaAssetId|service_role|authorMemberId/);
  });
  it("keeps a stable event identity after edits and does not invent an end time", () => {
    const original = serializePublicCalendar([event], "en", generatedAt);
    const edited = serializePublicCalendar([{ ...event, titleEn: "New title", endAt: null }], "en", generatedAt);
    expect(original.match(/UID:[^\r]+/)?.[0]).toBe(edited.match(/UID:[^\r]+/)?.[0]);
    expect(edited).not.toContain("DTEND:");
  });
  it("exports only the published public projection and does not mask outages as an empty calendar", async () => {
    const handler = createCalendarDownloadHandler(async () => ({ status: "ready", events: [event] }), () => generatedAt);
    const response = await handler(new Request(`https://www.assemblywomanmorales.com/events/calendar.ics?event=${event.id}&locale=es`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    expect(await response.text()).toContain(event.titleEs);
    expect((await handler(new Request("https://www.assemblywomanmorales.com/events/calendar.ics?event=22222222-2222-4222-8222-222222222222"))).status).toBe(404);
    expect((await handler(new Request("https://www.assemblywomanmorales.com/events/calendar.ics?event=invalid"))).status).toBe(400);
    const unavailable = createCalendarDownloadHandler(async () => ({ status: "unavailable" }));
    expect((await unavailable(new Request("https://www.assemblywomanmorales.com/events/calendar.ics"))).status).toBe(503);
  });
});
