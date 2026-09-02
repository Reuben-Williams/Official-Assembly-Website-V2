import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/builder/server-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/builder/server-content")>();
  return { ...actual, loadBuilderServerContent: vi.fn(async () => ({ regions: {} })) };
});
vi.mock("../app/i18n/server", () => ({ readPublicLocale: vi.fn(async () => "en") }));
vi.mock("../app/ui/LanguageToggle", () => ({ LanguageToggle: () => <button type="button">English</button> }));
vi.mock("../app/ui/MobileNavigation", () => ({
  MobileNavigation: ({ items }: { items: Array<{ href: string; label: string }> }) => (
    <nav data-test-mobile-navigation>{items.map((item) => <a href={item.href} key={item.href}>{item.label}</a>)}</nav>
  ),
}));
vi.mock("../lib/calendar/server", () => ({
  loadOfficialAssemblyPublicCalendar: vi.fn(async () => ({ status: "ready", events: [] })),
}));

import site from "../builder.config";
import EventsPage, { generateMetadata } from "../app/events/page";
import { AppHeader } from "../app/ui/AppHeader";

describe("public Events page", () => {
  it("is editor-listed with stable page copy regions", () => {
    const page = site.pages.find((candidate) => candidate.path === "/events");
    expect(page?.label).toBe("Events");
    expect(page?.regions.map((region) => region.id)).toEqual(expect.arrayContaining([
      "events.hero.eyebrow",
      "events.hero.title",
      "events.hero.body",
      "events.agenda.eyebrow",
      "events.agenda.title",
      "events.agenda.body",
      "events.empty.title",
      "events.empty.body",
      "events.unavailable.title",
      "events.unavailable.body",
    ]));
  });

  it("renders one h1, an accessible agenda, and truthful empty copy", async () => {
    const html = renderToStaticMarkup(await EventsPage());
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('data-builder-region="events.hero.title"');
    expect(html).toContain('data-public-events-variant="agenda"');
    expect(html).toContain("No upcoming public events are posted");
  });

  it("uses localized canonical and social metadata", async () => {
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Community Events");
    expect(metadata.alternates?.canonical).toBe("https://www.assemblywomanmorales.com/events");
    expect(metadata.openGraph?.title).toBe("Community Events");
  });

  it("keeps Events out of primary and mobile site navigation", () => {
    const html = renderToStaticMarkup(<AppHeader content={{ regions: {} }} locale="en" />);
    expect(html).not.toContain('href="/events"');
  });
});
