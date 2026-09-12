// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The form provider is isolated; assertions below concern server page composition.
vi.mock("../app/ui/ResidentForms", () => ({ ResidentForm: async () => <form /> }));
import { pages } from "../app/data/site";
import { PageTemplate } from "../app/ui/PageTemplate";
import { OfficialProfileSection } from "../app/ui/OfficialProfileSection";

async function documentFor(slug: string, children?: React.ReactNode) {
  const page = pages.find((item) => item.slug === slug)!;
  return new DOMParser().parseFromString(renderToStaticMarkup(await PageTemplate({ page, children })), "text/html");
}

describe("approved editorial public layout", () => {
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
    expect(about.querySelector('[data-builder-item-id="hero"] img')?.getAttribute("src")).toContain("home-official-portrait");
    const voting = await documentFor("voting");
    expect(voting.querySelector('[data-editorial-voting-symbol]')).not.toBeNull();
    expect(voting.querySelector('[data-builder-item-id="hero"] img')).toBeNull();
  });

  it("keeps the relevant official actions inside every fact card", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(<OfficialProfileSection content={{ regions: {} }} />), "text/html");
    const cards = [...doc.querySelectorAll('[data-profile-facts] article')];
    expect(cards).toHaveLength(4);
    for (const card of cards) expect(card.querySelector("a[href]"), card.textContent ?? "").not.toBeNull();
    expect(cards[0].textContent).toContain("Official Legislative Contact Form");
    expect(cards[3].textContent).toContain("Votes by bill");
  });
});
