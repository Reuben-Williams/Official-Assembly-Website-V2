import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/ui/ResidentForms", () => ({
  ResidentForm: async ({ type }: { type: string }) => (
    <form action={type === "newsletter" ? "/api/forms/newsletter-signup" : `/api/forms/${type}`} />
  ),
}));

import { districtConnections } from "../app/data/district-connections";
import { approvedBrandAssets } from "../lib/brand/approved-assets";
import { HomePageView } from "../app/ui/HomePageView";

async function renderHome(locale: "en" | "es" = "en") {
  return renderToStaticMarkup(await HomePageView({
    assets: approvedBrandAssets,
    calendar: { status: "ready", events: [] },
    content: { regions: {} },
    posts: [],
    locale,
  }));
}

describe("centered homepage banner release", () => {
  it("ships 2x approved banner sources at the stable editor paths", () => {
    expect(approvedBrandAssets.fallbackBannerSet.desktop.webp).toMatchObject({
      publicPath: "/brand/morales-ld34-banner-desktop.webp",
      width: 2580,
      height: 804,
    });
    expect(approvedBrandAssets.fallbackBannerSet.mobile.webp).toMatchObject({
      publicPath: "/brand/morales-ld34-banner-mobile.webp",
      width: 1920,
      height: 598,
    });
  });

  it("orders the hero introduction, banner, and action dock without a competing hero photo", async () => {
    const html = await renderHome();
    const eyebrow = html.indexOf('data-builder-region="home.hero.eyebrow"');
    const title = html.indexOf('data-builder-region="home.hero.title"');
    const body = html.indexOf('data-builder-region="home.hero.body"');
    const banner = html.indexOf('data-home-brand-banner="true"');
    const actions = html.indexOf('data-home-hero-actions="true"');

    expect(eyebrow).toBeGreaterThanOrEqual(0);
    expect(eyebrow).toBeLessThan(title);
    expect(title).toBeLessThan(body);
    expect(body).toBeLessThan(banner);
    expect(banner).toBeLessThan(actions);
    expect(html).not.toContain('data-builder-instance="home-hero"');
  });

  it("renders four clear actions and locks Volunteer to the canonical external form", async () => {
    const html = await renderHome();

    expect(html).toContain('data-builder-region="home.hero.primary-cta"');
    expect(html).toContain('data-builder-region="home.hero.news-cta"');
    expect(html).toContain('data-builder-region="home.hero.newsletter-cta"');
    expect(html).toContain('data-builder-region="home.hero.volunteer-cta"');
    expect(html).toContain(`href="${districtConnections.volunteer.href.replaceAll("&", "&amp;")}"`);
    expect(html).toMatch(/data-builder-region="home\.hero\.volunteer-cta"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  });

  it("flows directly into the official record, portrait, and then statistics", async () => {
    const html = await renderHome();
    const hero = html.indexOf('data-builder-item-id="hero"');
    const official = html.indexOf('data-builder-item-id="official-profile"');
    const identity = html.indexOf('data-profile-identity="true"');
    const portrait = html.indexOf('data-builder-instance="home-official-portrait"');
    const facts = html.indexOf('data-profile-facts="true"');
    const stats = html.indexOf('data-builder-item-id="stats"');

    expect(hero).toBeGreaterThanOrEqual(0);
    expect(hero).toBeLessThan(official);
    expect(official).toBeLessThan(identity);
    expect(identity).toBeLessThan(portrait);
    expect(portrait).toBeLessThan(facts);
    expect(facts).toBeLessThan(stats);
    expect(html).toContain('data-builder-region="media.professional.home-official-portrait"');
    expect(html).toContain("Assemblywoman Carmen Morales at the New Jersey State House");
  });

  it("localizes the Volunteer action and portrait caption in Spanish", async () => {
    const html = await renderHome("es");

    expect(html).toContain(">Voluntariado<");
    expect(html).toContain("La asambleísta Carmen Morales en la Casa del Estado de Nueva Jersey");
  });
});
