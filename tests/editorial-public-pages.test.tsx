// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The form provider is isolated; assertions below concern server page composition.
vi.mock("../app/ui/ResidentForms", () => ({ ResidentForm: async () => <form /> }));
import { getImage, pages } from "../app/data/site";
import { PageTemplate } from "../app/ui/PageTemplate";
import { DistrictConnectionsSection } from "../app/ui/DistrictConnectionsSection";
import { OfficialProfileSection } from "../app/ui/OfficialProfileSection";
import { translateStableText } from "../app/i18n/translations";
import type { BuilderServerContent } from "../lib/builder/server-content";

async function documentFor(slug: string, children?: React.ReactNode, content?: BuilderServerContent) {
  const page = pages.find((item) => item.slug === slug)!;
  return new DOMParser().parseFromString(renderToStaticMarkup(await PageTemplate({ page, children, content })), "text/html");
}

describe("approved editorial public layout", () => {
  it("translates the compact newsletter introduction without replacing edited content", () => {
    expect(translateStableText("newsletter.form.title", "Request District Newsletter emails", "es")).toBe("Solicite correos del Boletín del distrito");
    expect(translateStableText("newsletter.form.title", "An independently edited title", "es")).toBe("An independently edited title");
  });
  it("keeps narrow newsletter columns fluid and gives the verification widget its full width", () => {
    const css = readFileSync("app/editorial.css", "utf8");
    expect(css).toMatch(/\.editorial-page \.newsletter-first-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toContain("@media (max-width: 380px)");
    expect(css).toContain("width: min(302px, calc(100vw - 16px))");
  });
  it("keeps the community invitation photograph inside its grid column", () => {
    const css = readFileSync("app/ui/district-connections-section.module.css", "utf8");
    expect(css).toMatch(/\.communityPhoto\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.communityPhoto :global\(\.image-card\)\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.communityPhoto :global\(\.image-card\)\s*\{[^}]*height:\s*auto/);
  });
  it("places contact intake before resource cards in document and keyboard order", async () => {
    const doc = await documentFor("contact");
    expect(doc.querySelector('[data-editorial-page="contact"]')).not.toBeNull();
    const sections = [...doc.querySelectorAll('[data-builder-item-id]')].map((node) => node.getAttribute("data-builder-item-id"));
    expect(sections.indexOf("form")).toBeLessThan(sections.indexOf("features"));
    expect(doc.querySelector('[data-builder-item-id="hero"] img')).toBeNull();
  });

  it("puts real news content directly after the masthead", async () => {
    const doc = await documentFor("news", <section data-live-news>Published content</section>);
    expect(doc.querySelector('[data-builder-item-id="hero"]')?.nextElementSibling?.hasAttribute("data-live-news")).toBe(true);
  });

  it("uses an official About portrait and a voting symbol instead of an unrelated photo", async () => {
    const about = await documentFor("about");
    expect(about.querySelector('[data-builder-item-id="hero"] img')?.getAttribute("src")).toContain("DSC01789");
    const voting = await documentFor("voting");
    expect(voting.querySelector('[data-editorial-voting-symbol]')).not.toBeNull();
    expect(voting.querySelector('[data-builder-item-id="hero"] img')).toBeNull();
  });

  it.each([
    ["contact", "office-group"],
    ["community", "parade-selfie"],
    ["voting", "hallway-portrait"],
    ["survey", "community-greeting"],
    ["social", "community-greeting"],
  ])("uses the reviewed %s supporting photograph without a generic flyer", async (slug, photo) => {
    const doc = await documentFor(slug);
    const panel = doc.querySelector('[data-builder-item-id="supporting"]');
    expect(panel?.querySelector("img")?.getAttribute("src")).toContain(photo);
    const caption = panel?.querySelector(".image-caption")?.textContent;
    expect(caption).toBeUndefined();
    expect(doc.querySelector('img[src*="rosy-bagolie-coverage"]')).toBeNull();
  });

  it.each(["about", "resources"])("omits the requested photo-and-trust section on %s", async (slug) => {
    const doc = await documentFor(slug);
    expect(doc.querySelector('[data-builder-item-id="supporting"]')).toBeNull();
    expect(doc.body.textContent).not.toContain("Official sources first");
    expect(doc.querySelector('[data-builder-item-id="features"]')).not.toBeNull();
  });

  it.each([
    ["community", "parade-wave"],
    ["survey", "outreach-table"],
    ["social", "parade-smiles"],
  ])("uses the reviewed %s hero photograph", async (slug, photo) => {
    const doc = await documentFor(slug);
    expect(doc.querySelector('[data-builder-item-id="hero"] img')?.getAttribute("src")).toContain(photo);
  });

  it("keeps the News supporting recognition photo unchanged", async () => {
    const doc = await documentFor("news");
    expect(doc.querySelector('[data-builder-item-id="supporting"] img')?.getAttribute("src")).toContain("news-supporting-desktop");
  });

  it("keeps removed Resources media hidden even when old image edits exist", async () => {
    const page = pages.find((item) => item.slug === "resources")!;
    const doc = await documentFor("resources", undefined, { regions: {
      [getImage(page.imageKey).regionId]: {
        type: "image", src: "/images/professional/resources-supporting-desktop.webp", alt: "Retired default",
      },
    } });
    expect(doc.querySelector('[data-builder-item-id="supporting"]')).toBeNull();
    expect(doc.querySelector('img[alt="Retired default"]')).toBeNull();
  });

  it("preserves a genuine office-published compact-page hero photograph", async () => {
    const page = pages.find((item) => item.slug === "contact")!;
    const doc = await documentFor("contact", undefined, { regions: {
      [getImage(page.imageKey).regionId]: {
        type: "image", src: "/images/office-published-community.jpg", alt: "Office-published community photograph",
      },
    } });
    expect(doc.querySelector('[data-builder-item-id="supporting"] img')?.getAttribute("src")).toContain("office-published-community.jpg");
    expect(doc.querySelector('img[alt="Office-published community photograph"]')).not.toBeNull();
  });

  it.each([
    ["contact", "media.editorial.contact-supporting"],
    ["voting", "media.editorial.voting-supporting"],
    ["news", "media.professional.news-supporting"],
  ])("prefers the %s dedicated supporting edit over an older compact-page hero edit", async (slug, supportingRegion) => {
    const page = pages.find((item) => item.slug === slug)!;
    const doc = await documentFor(slug, undefined, { regions: {
      [getImage(page.imageKey).regionId]: {
        type: "image", src: "/images/legacy-published-hero.jpg", alt: "Previously published hero photograph",
      },
      [supportingRegion]: {
        type: "image", src: "/images/new-published-supporting.jpg", alt: "New supporting photograph",
      },
    } });
    const panel = doc.querySelector('[data-builder-item-id="supporting"]');
    expect(panel?.querySelector("img")?.getAttribute("src")).toContain("new-published-supporting.jpg");
    expect(panel?.querySelector(`[data-builder-region="${supportingRegion}"]`)).not.toBeNull();
    expect(doc.querySelector('img[alt="Previously published hero photograph"]')).toBeNull();
  });

  it("gives the volunteer office group its own editable image without changing the volunteer destination", async () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(await DistrictConnectionsSection({ content: { regions: {} } })), "text/html");
    const panel = doc.querySelector('[data-builder-region="media.editorial.home-volunteer"]');
    expect(panel?.querySelector("img")?.getAttribute("src")).toContain("office-group");
    expect(doc.querySelector('[data-builder-region="media.professional.community-primary"]')).toBeNull();
    expect([...doc.querySelectorAll("a")].find((link) => link.textContent?.includes("Open volunteer form"))?.href).toContain("docs.google.com/forms/");
  });

  it("keeps the relevant official actions inside every fact card", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(<OfficialProfileSection content={{ regions: {} }} />), "text/html");
    const cards = [...doc.querySelectorAll('[data-profile-facts] article')];
    expect(cards).toHaveLength(4);
    for (const card of cards) expect(card.querySelector("a[href]"), card.textContent ?? "").not.toBeNull();
    expect(cards[0].textContent).toContain("Official Legislative Contact Form");
    expect(cards[3].textContent).toContain("Votes by bill");
  });
  it("keeps the official state headshot on the homepage with a complete accessible frame", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(<OfficialProfileSection content={{ regions: {} }} />), "text/html");
    const portrait = doc.querySelector('[data-profile-portrait]');
    expect(portrait?.querySelector("img")?.src).toContain("home-official-portrait-desktop.webp");
    expect(portrait?.querySelector("[data-editorial-full-frame]")).not.toBeNull();
    expect(portrait?.querySelector("img")?.alt).toContain("Morales");
    expect(portrait?.querySelector(".image-caption")).toBeNull();
  });
});
