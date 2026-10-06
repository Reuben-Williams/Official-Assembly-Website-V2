import type { PublicLocale } from "../../app/i18n/locale";
import type { PublicCalendarEvent } from "./contract";
import { localizedCalendarField } from "./localization";

export const PUBLIC_CALENDAR_URL = "https://www.assemblywomanmorales.com/events/calendar.ics";

function utcTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid calendar timestamp.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function eventText(event: PublicCalendarEvent, locale: PublicLocale) {
  return {
    title: localizedCalendarField(event, locale, "title").text,
    description: localizedCalendarField(event, locale, "description").text,
    location: [event.locationName, event.locationAddress].filter(Boolean).join(", "),
  };
}
export function googleCalendarEventUrl(event: PublicCalendarEvent, locale: PublicLocale) {
  const text = eventText(event, locale);
  const url = new URL("https://calendar.google.com/calendar/render");
  url.search = new URLSearchParams({
    action: "TEMPLATE", text: text.title,
    dates: `${utcTimestamp(event.startAt)}/${utcTimestamp(event.endAt ?? event.startAt)}`,
    details: `${text.description}\n\nhttps://www.assemblywomanmorales.com/events#event-${event.id}`,
    location: text.location, ctz: event.displayTimeZone,
  }).toString();
  return url.toString();
}
function escapeText(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}
// RFC 5545: fold at 75 UTF-8 octets, including the continuation space.
function foldLine(value: string) {
  const encoder = new TextEncoder();
  let line = "", length = 0;
  const lines: string[] = [];
  for (const character of value) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) { lines.push(line); line = " "; length = 1; }
    line += character; length += bytes;
  }
  lines.push(line);
  return lines.join("\r\n");
}
export function serializePublicCalendar(events: readonly PublicCalendarEvent[], locale: PublicLocale, generatedAt: string) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//District 34//Public Events//EN", "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${locale === "es" ? "Eventos del Distrito 34" : "District 34 Community Events"}`, "X-WR-TIMEZONE:America/New_York"];
  for (const event of events) {
    const text = eventText(event, locale);
    lines.push("BEGIN:VEVENT", `UID:district34-${event.id}@assemblywomanmorales.com`, `DTSTAMP:${utcTimestamp(generatedAt)}`,
      `DTSTART:${utcTimestamp(event.startAt)}`);
    // An unspecified end is not the expiry timestamp used to filter the agenda.
    if (event.endAt) lines.push(`DTEND:${utcTimestamp(event.endAt)}`);
    lines.push(`SUMMARY:${escapeText(text.title)}`, `DESCRIPTION:${escapeText(text.description)}`,
      `LOCATION:${escapeText(text.location)}`, `URL:https://www.assemblywomanmorales.com/events#event-${event.id}`,
      "STATUS:CONFIRMED", "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
