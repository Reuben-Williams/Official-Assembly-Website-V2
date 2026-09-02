import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/builder/server-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/builder/server-content")>();
  return { ...actual, loadBuilderServerContent: vi.fn(async () => ({ regions: {} })) };
});
vi.mock("../app/i18n/server", () => ({ readPublicLocale: vi.fn(async () => "en") }));

import site from "../builder.config";
import HomePage from "../app/page";
import { imageAssets, pages } from "../app/data/site";
import { PageTemplate } from "../app/ui/PageTemplate";

const expectedRoutes = [
  "/",
  "/about",
  "/resources",
  "/news",
  "/events",
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
    expect(configured).toContain("contact.form.eyebrow");
    expect(configured).toContain("contact.form.title");
    expect(configured).toContain("contact.form.body");
    expect(configured).toContain("contact.form");
    expect(configured).toContain("newsletter.form.eyebrow");
    expect(configured).toContain("newsletter.form.title");
    expect(configured).toContain("newsletter.form.body");
    expect(configured).toContain("newsletter.form");
    expect(configured).not.toContain("newsletter.hero.eyebrow");
    expect(configured).not.toContain("newsletter.hero.title");
    expect(configured).not.toContain("newsletter.hero.body");
    expect(configured).not.toContain("newsletter.hero.primary-cta");
    expect(configured).not.toContain("newsletter.hero.secondary-cta");
    expect(configured).toContain("survey.form.eyebrow");
    expect(configured).toContain("survey.form.title");
    expect(configured).toContain("survey.form.body");
    expect(configured).not.toContain("survey.form");
    expect(site.globalRegions.map((region) => region.id)).not.toEqual(
      expect.arrayContaining([
        "global.template.form-eyebrow",
        "global.template.form-title",
        "global.template.form-body"
      ])
    );
  });

  it("distinguishes the News hub and Newsletter signup in the editor", () => {
    const news = site.pages.find((page) => page.path === "/news");
    const newsletter = site.pages.find((page) => page.path === "/newsletter");

    expect(news?.label).toBe("News & Updates");
    expect(news?.regions).toEqual(expect.arrayContaining([
      { id: "news.newsletter.eyebrow", kind: "text", label: "newsletter signup eyebrow" },
      { id: "news.newsletter.title", kind: "text", label: "newsletter signup title" },
      { id: "news.newsletter.body", kind: "text", label: "newsletter signup introduction" },
      { id: "news.newsletter.form", kind: "sections", label: "newsletter managed form" }
    ]));
    expect(newsletter?.label).toBe("Newsletter signup");
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

  it("renders the home mapping on the real design elements", async () => {
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('data-builder-region="home.sections"');
    expect(html).toContain('data-builder-item-id="hero"');
    expect(html).toContain('data-builder-region="home.hero.title"');
    expect(html).toContain('data-builder-region="home.official.title"');
    expect(html).toContain('data-builder-region="home.connections.title"');
    expect(html).toContain('data-builder-region="home.latest.title"');
    expect(html).toContain('data-builder-region="media.hero"');
  });

  it("renders a managed contact surface and durable card item IDs", async () => {
    const contact = pages.find((page) => page.slug === "contact");
    expect(contact).toBeDefined();

    const html = renderToStaticMarkup(await PageTemplate({ page: contact! }));
    expect(html).toContain('data-builder-region="contact.sections"');
    expect(html).toContain('data-builder-region="contact.form.eyebrow"');
    expect(html).toContain('data-builder-region="contact.form.title"');
    expect(html).toContain('data-builder-region="contact.form.body"');
    expect(html).toContain('data-builder-region="contact.form"');
    expect(html).toContain('data-builder-item-id="send-message"');
    expect(html).toContain('data-builder-form-unavailable="true"');
    expect(html).toContain('data-builder-instance="contact-hero"');
    expect(html).toContain('data-builder-instance="contact-supporting"');
  });

  it("keeps the survey unavailable and outside managed form regions", async () => {
    const survey = pages.find((page) => page.slug === "survey");
    expect(survey).toBeDefined();

    const html = renderToStaticMarkup(await PageTemplate({ page: survey! }));
    expect(html).toContain("This survey is not accepting online responses.");
    expect(html).toContain('data-builder-region="survey.form.eyebrow"');
    expect(html).toContain('data-builder-region="survey.form.title"');
    expect(html).toContain('data-builder-region="survey.form.body"');
    expect(html).not.toContain('data-builder-region="survey.form"');
  });
});
