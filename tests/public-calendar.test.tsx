import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PublicCalendarEvent } from "../lib/calendar/contract";
import { PublicEventsSection } from "../app/ui/PublicEventsSection";

const events: PublicCalendarEvent[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    titleEn: "Constituent services evening",
    titleEs: "Noche de servicios para residentes",
    descriptionEn: "Meet with the District 34 office team.",
    descriptionEs: "Reúnase con el equipo de la oficina del Distrito 34.",
    startAt: "2026-09-16T22:00:00.000Z",
    endAt: "2026-09-16T23:30:00.000Z",
    effectiveEndAt: "2026-09-16T23:30:00.000Z",
    displayTimeZone: "America/New_York",
    locationName: "District Office",
    locationAddress: "152 Franklin Street, Belleville, NJ 07109",
    actionUrl: "https://www.njleg.state.nj.us/legislative-roster/491/assemblywoman-morales",
    actionLabelEn: "View official details",
    actionLabelEs: "Ver detalles oficiales",
    mediaAssetId: null,
  },
];

describe("public calendar presentation", () => {
  it("renders public event content, semantic time values, and the selected locale", () => {
    const html = renderToStaticMarkup(
      <PublicEventsSection
        calendar={{ status: "ready", events }}
        content={{ regions: {} }}
        locale="es"
        variant="agenda"
      />,
    );

    expect(html).toContain("Noche de servicios para residentes");
    expect(html).toContain("Reúnase con el equipo de la oficina del Distrito 34.");
    expect(html).toContain("Ver detalles oficiales");
    expect(html).not.toContain("Meet with the District 34 office team.");
    expect(html).toContain('<time dateTime="2026-09-16T22:00:00.000Z"');
    expect(html).toContain('data-public-event-id="11111111-1111-4111-8111-111111111111"');
    expect(html).not.toMatch(/draftRevision|publicApproved|hostedByOffice/);
  });

  it("keeps an empty calendar distinct from an unavailable calendar", () => {
    const emptyHtml = renderToStaticMarkup(
      <PublicEventsSection
        calendar={{ status: "ready", events: [] }}
        content={{ regions: {} }}
        locale="en"
        variant="home"
      />,
    );
    const unavailableHtml = renderToStaticMarkup(
      <PublicEventsSection
        calendar={{ status: "unavailable" }}
        content={{ regions: {} }}
        locale="en"
        variant="home"
      />,
    );

    expect(emptyHtml).toContain("No upcoming public events are posted");
    expect(emptyHtml).not.toContain("temporarily unavailable");
    expect(unavailableHtml).toContain("temporarily unavailable");
    expect(unavailableHtml).not.toContain("No upcoming public events are posted");
  });

  it("limits the homepage summary to three events and links to the full agenda", () => {
    const fourEvents = Array.from({ length: 4 }, (_, index) => ({
      ...events[0],
      id: `${index + 1}1111111-1111-4111-8111-111111111111`,
      titleEn: `Event ${index + 1}`,
      startAt: `2026-09-${16 + index}T22:00:00.000Z`,
    }));
    const html = renderToStaticMarkup(
      <PublicEventsSection
        calendar={{ status: "ready", events: fourEvents }}
        content={{ regions: {} }}
        locale="en"
        variant="home"
      />,
    );

    expect(html.match(/data-public-event-id=/g)).toHaveLength(3);
    expect(html).toContain('href="/events"');
    expect(html).not.toContain("Event 4");
  });
});
