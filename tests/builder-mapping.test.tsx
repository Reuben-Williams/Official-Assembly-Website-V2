import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import site from "../builder.config";
import HomePage from "../app/page";
import { imageAssets, pages } from "../app/data/site";
import { PageTemplate } from "../app/ui/PageTemplate";

const expectedRoutes = [
  "/",
  "/about",
  "/resources",
  "/news",
  "/community",
  "/voting",
  "/contact",
  "/newsletter",
  "/survey",
  "/social"
];

describe("approved builder mapping", () => {
  it("declares a protected Supabase-backed editor for every public route", () => {
    expect(site.adapter).toBe("supabase");
    expect(site.editor).toEqual({ path: "/admin/editor", protected: true });
    expect(site.pages.map((page) => page.path)).toEqual(expectedRoutes);

    const configured = site.pages.flatMap((page) =>
      page.regions.map((region) => (typeof region === "string" ? region : region.id))
    );
    expect(configured).toContain("home.hero.title");
    expect(configured).toContain("contact.form");
    expect(configured).toContain("newsletter.form");
    expect(configured).not.toContain("survey.form");
  });

  it("uses stable media region IDs rather than filenames as editor identity", () => {
    expect(imageAssets.map((asset) => asset.regionId)).toEqual([
      "media.hero",
      "media.about",
      "media.graduation",
      "media.vote-board",
      "media.clinic",
      "media.coverage",
      "media.event-group",
      "media.outdoor-visit",
      "media.business",
      "media.meeting",
      "media.outreach",
      "media.capitol"
    ]);
  });

  it("renders the home mapping on the real design elements", () => {
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('data-builder-region="home.sections"');
    expect(html).toContain('data-builder-item-id="hero"');
    expect(html).toContain('data-builder-region="home.hero.title"');
    expect(html).toContain('data-builder-region="home.portal.cards"');
    expect(html).toContain('data-builder-region="media.hero"');
  });

  it("renders a managed contact surface and durable card item IDs", async () => {
    const contact = pages.find((page) => page.slug === "contact");
    expect(contact).toBeDefined();

    const html = renderToStaticMarkup(await PageTemplate({ page: contact! }));
    expect(html).toContain('data-builder-region="contact.sections"');
    expect(html).toContain('data-builder-region="contact.form"');
    expect(html).toContain('data-builder-item-id="send-message"');
    expect(html).toContain('data-builder-form-unavailable="true"');
  });
});
