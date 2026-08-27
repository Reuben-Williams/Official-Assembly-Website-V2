import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/ui/ResidentForms", () => ({
  ResidentForm: async ({ type }: { type: string }) => (
    <form action={type === "newsletter" ? "/api/forms/newsletter-signup" : `/api/forms/${type}`} />
  ),
}));

import { HomepageBrandBanner } from "../app/ui/HomepageBrandBanner";
import { HomePageView } from "../app/ui/HomePageView";
import {
  verifyApprovedBrandAssets,
  type ApprovedBrandAssetManifestEntry,
} from "../lib/brand/assets";

const sourceSha256 = "a".repeat(64);

function entry(
  id: string,
  publicPath: `/brand/${string}`,
  publicSha256: string,
  width: number,
  height: number,
  purpose: ApprovedBrandAssetManifestEntry["purpose"],
  variant: ApprovedBrandAssetManifestEntry["variant"],
  mimeType: ApprovedBrandAssetManifestEntry["mimeType"],
): ApprovedBrandAssetManifestEntry {
  return {
    id,
    sourceSha256,
    publicSha256,
    publicPath,
    mimeType,
    width,
    height,
    purpose,
    variant,
    approvedBy: "site-owner",
    approvedAt: "2026-08-27T17:00:00.000Z",
  };
}

const assets = verifyApprovedBrandAssets({
  entries: [
    entry("desktop-avif", "/brand/desktop.avif", "1".repeat(64), 1800, 560, "homepage_banner", "banner_desktop_avif", "image/avif"),
    entry("desktop-webp", "/brand/desktop.webp", "2".repeat(64), 1800, 560, "homepage_banner", "banner_desktop_webp", "image/webp"),
    entry("mobile-avif", "/brand/mobile.avif", "3".repeat(64), 900, 420, "homepage_banner", "banner_mobile_avif", "image/avif"),
    entry("mobile-webp", "/brand/mobile.webp", "4".repeat(64), 900, 420, "homepage_banner", "banner_mobile_webp", "image/webp"),
    entry("social-cover", "/brand/social.png", "5".repeat(64), 1200, 630, "social_cover", "social_1200x630_png", "image/png"),
  ],
  renderMap: {
    banner: {
      mobileMaxWidthPx: 620,
      fallbackBannerSetId: "primary",
      sets: [{
        id: "primary",
        pickerPublicPath: "/brand/desktop.webp",
        desktop: { avifId: "desktop-avif", webpId: "desktop-webp" },
        mobile: { avifId: "mobile-avif", webpId: "mobile-webp" },
      }],
    },
    socialCoverId: "social-cover",
  },
});

describe("homepage official brand banner", () => {
  it("renders the selected responsive set with application-owned Spanish alt text", () => {
    const html = renderToStaticMarkup(<HomepageBrandBanner
      assets={assets}
      content={{
        regions: {
          "media.home-brand-banner": {
            type: "image",
            src: "/brand/desktop.webp",
            alt: "Editor value that must not become public alt",
          },
        },
      }}
      locale="es"
    />);

    expect(html).toContain('data-builder-region="media.home-brand-banner"');
    expect(html).toContain('data-brand-banner-set="primary"');
    expect(html).toContain('media="(max-width: 620px)"');
    expect(html).toContain('srcSet="/brand/mobile.avif"');
    expect(html).toContain('srcSet="/brand/mobile.webp"');
    expect(html).toContain('srcSet="/brand/desktop.avif"');
    expect(html).toContain('src="/brand/desktop.webp"');
    expect(html).toContain('--brand-banner-desktop-aspect:1800 / 560');
    expect(html).toContain('--brand-banner-mobile-aspect:900 / 420');
    expect(html).toContain('alt="Asambleísta Carmen T. Morales — Distrito Legislativo 34"');
    expect(html).not.toContain("Editor value that must not become public alt");
  });

  it("renders before the reorderable homepage sections while retaining the existing hero", async () => {
    const html = renderToStaticMarkup(await HomePageView({
      assets,
      content: { regions: {} },
      posts: [],
    }));

    const bannerPosition = html.indexOf('data-home-brand-banner="true"');
    const sectionsPosition = html.indexOf('data-builder-region="home.sections"');
    const heroPosition = html.indexOf('data-builder-item-id="hero"');
    expect(bannerPosition).toBeGreaterThanOrEqual(0);
    expect(bannerPosition).toBeLessThan(sectionsPosition);
    expect(sectionsPosition).toBeLessThan(heroPosition);
  });
});
