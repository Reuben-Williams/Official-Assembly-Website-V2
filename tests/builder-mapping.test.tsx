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
  "/social",
  "/404"
];

describe("approved builder mapping", () => {
  it("declares a protected Supabase-backed editor for every editable route", () => {
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

  it("registers the canonical 404 page with its editable regions", () => {
    const notFoundPage = site.pages.find((page) => page.path === "/404");

    expect(notFoundPage?.label).toBe("404 - Page not found");
    expect(notFoundPage?.regions).toEqual([
      { id: "404.hero.eyebrow", kind: "text", label: "404 eyebrow" },
      { id: "404.hero.title", kind: "text", label: "404 title" },
      { id: "404.hero.body", kind: "text", label: "404 description" },
      { id: "404.hero.image", kind: "image", label: "404 image" },
      { id: "404.hero.primary-cta", kind: "link", label: "404 primary link" },
      { id: "404.hero.secondary-cta", kind: "link", label: "404 secondary link" }
    ]);
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
