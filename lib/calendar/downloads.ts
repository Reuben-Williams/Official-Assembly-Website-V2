import "server-only";
import { loadOfficialAssemblyPublicCalendar } from "./server";
import { serializePublicCalendar } from "./integrations";
import type { PublicCalendarLoad } from "./repository";

export function createCalendarDownloadHandler(
  load: () => Promise<PublicCalendarLoad> = () => loadOfficialAssemblyPublicCalendar({ limit: 100 }),
  now: () => string = () => new Date().toISOString(),
) {
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const eventId = url.searchParams.get("event");
    const locale = url.searchParams.get("locale") === "es" ? "es" : "en";
    const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
    if (eventId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
      return new Response("Invalid event ID.", { status: 400, headers });
    }
    try {
      const calendar = await load();
      if (calendar.status !== "ready") return new Response("Calendar temporarily unavailable.", { status: 503, headers });
      const events = eventId ? calendar.events.filter(event => event.id === eventId) : calendar.events;
      if (eventId && !events.length) return new Response("Public event not found.", { status: 404, headers });
      return new Response(serializePublicCalendar(events, locale, now()), { headers: {
        ...headers, "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `${eventId ? "attachment" : "inline"}; filename="district-34${eventId ? `-${eventId}` : ""}-${locale}.ics"`,
      } });
    } catch {
      return new Response("Calendar temporarily unavailable.", { status: 503, headers });
    }
  };
}
