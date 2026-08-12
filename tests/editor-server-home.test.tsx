import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const published = vi.hoisted(() => ({
  regions: {
    "home.hero.title": { type: "text" as const, value: "Current server title" },
    "home.hero.primary-cta": { type: "link" as const, href: "/resources", label: "Current action" },
    "media.hero": { type: "image" as const, src: "/images/meeting.jpg", alt: "Current meeting" },
  },
}));

vi.mock("../lib/builder/server-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/builder/server-content")>();
  return { ...actual, loadBuilderServerContent: vi.fn(async () => published) };
});
vi.mock("../app/i18n/server", () => ({ readPublicLocale: vi.fn(async () => "en") }));

import HomePage from "../app/page";
import { pages } from "../app/data/site";
import { PageTemplate } from "../app/ui/PageTemplate";

describe("server-rendered home route", () => {
  it("puts published values in the initial HTML", async () => {
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain("Current server title");
    expect(html).toContain('href="/resources"');
    expect(html).toContain("Current action");
    expect(html).toContain("Current meeting");
  });

  it("puts dynamic-page published values in the initial HTML", async () => {
    const resources = pages.find((page) => page.slug === "resources");
    expect(resources).toBeDefined();
    const view = await PageTemplate({
      page: resources!,
      content: {
        regions: {
          "resources.hero.title": { type: "text", value: "Current resources title" },
          "resources.hero.secondary-cta": { type: "link", href: "/news", label: "Current resources action" },
          "media.clinic": { type: "image", src: "/images/meeting.jpg", alt: "Current resources media" },
        },
      },
    });
    const html = renderToStaticMarkup(view);

    expect(html).toContain("Current resources title");
    expect(html).toContain('href="/news"');
    expect(html).toContain("Current resources action");
    expect(html).toContain("Current resources media");
  });
});
