import type { Metadata } from "next";
import { describe, expect, it } from "vitest";

import {
  brandBannerSeedAssets,
  normalizeProtectedBrandValue,
  validateProtectedBrandSnapshot,
  validateHomeBrandBannerValue,
  verifyApprovedBrandAssets,
  type ApprovedBrandAssetDefinition,
} from "../lib/brand/assets";
import { districtConnections } from "../app/data/district-connections";
import { withBrandSocialMetadata } from "../lib/brand/metadata";

const digest = (character: string) => character.repeat(64);

function definition(): ApprovedBrandAssetDefinition {
  return {
    entries: [
      {
        id: "banner-desktop-avif",
        sourceSha256: digest("a"),
        publicSha256: digest("1"),
        publicPath: "/brand/banner-desktop.avif",
        mimeType: "image/avif",
        width: 1800,
        height: 560,
        purpose: "homepage_banner",
        variant: "banner_desktop_avif",
        approvedBy: "site-owner",
        approvedAt: "2026-08-27T17:00:00.000Z",
      },
      {
        id: "banner-desktop-webp",
        sourceSha256: digest("a"),
        publicSha256: digest("2"),
        publicPath: "/brand/banner-desktop.webp",
        mimeType: "image/webp",
        width: 1800,
        height: 560,
        purpose: "homepage_banner",
        variant: "banner_desktop_webp",
        approvedBy: "site-owner",
        approvedAt: "2026-08-27T17:00:00.000Z",
      },
      {
        id: "banner-mobile-avif",
        sourceSha256: digest("a"),
        publicSha256: digest("3"),
        publicPath: "/brand/banner-mobile.avif",
        mimeType: "image/avif",
        width: 900,
        height: 420,
        purpose: "homepage_banner",
        variant: "banner_mobile_avif",
        approvedBy: "site-owner",
        approvedAt: "2026-08-27T17:00:00.000Z",
      },
      {
        id: "banner-mobile-webp",
        sourceSha256: digest("a"),
        publicSha256: digest("4"),
        publicPath: "/brand/banner-mobile.webp",
        mimeType: "image/webp",
        width: 900,
        height: 420,
        purpose: "homepage_banner",
        variant: "banner_mobile_webp",
        approvedBy: "site-owner",
        approvedAt: "2026-08-27T17:00:00.000Z",
      },
      {
        id: "social-cover",
        sourceSha256: digest("a"),
        publicSha256: digest("5"),
        publicPath: "/brand/social-cover.png",
        mimeType: "image/png",
        width: 1200,
        height: 630,
        purpose: "social_cover",
        variant: "social_1200x630_png",
        approvedBy: "site-owner",
        approvedAt: "2026-08-27T17:00:00.000Z",
      },
    ],
    renderMap: {
      banner: {
        mobileMaxWidthPx: 620,
        fallbackBannerSetId: "primary",
        sets: [{
          id: "primary",
          pickerPublicPath: "/brand/banner-desktop.webp",
          desktop: { avifId: "banner-desktop-avif", webpId: "banner-desktop-webp" },
          mobile: { avifId: "banner-mobile-avif", webpId: "banner-mobile-webp" },
        }],
      },
      socialCoverId: "social-cover",
    },
  };
}

describe("approved brand asset contract", () => {
  it("maps one stable editor path to a complete responsive set and seed choice", () => {
    const verified = verifyApprovedBrandAssets(definition());

    expect(validateHomeBrandBannerValue({
      type: "image",
      src: "/brand/banner-desktop.webp",
      alt: "User supplied alt",
    }, verified)).toEqual({
      type: "image",
      src: "/brand/banner-desktop.webp",
      alt: "Assemblywoman Carmen T. Morales — Legislative District 34",
    });
    expect(verified.fallbackBannerSet.mobile.webp.publicPath).toBe("/brand/banner-mobile.webp");
    expect(brandBannerSeedAssets("official-assembly-website-v2", verified)).toEqual([
      expect.objectContaining({
        id: "brand-banner-primary",
        source: "seed",
        url: "/brand/banner-desktop.webp",
      }),
    ]);
  });

  it("rejects individual derivatives and duplicate picker paths", () => {
    const verified = verifyApprovedBrandAssets(definition());
    expect(() => validateHomeBrandBannerValue({
      type: "image",
      src: "/brand/banner-mobile.webp",
      alt: "Mobile derivative",
    }, verified)).toThrow(/approved homepage brand banner/i);

    const duplicate = definition();
    duplicate.renderMap.banner.sets.push({
      ...duplicate.renderMap.banner.sets[0]!,
      id: "secondary",
    });
    expect(() => verifyApprovedBrandAssets(duplicate)).toThrow(/picker path/i);
  });

  it("adds the controlled social cover without dropping route metadata", () => {
    const base: Metadata = {
      title: { default: "Office", template: "%s | Office" },
      description: "Base description",
      metadataBase: new URL("https://www.assemblywomanmorales.com"),
      alternates: { canonical: "/news/example" },
      robots: { index: false, follow: false },
      referrer: "no-referrer",
      openGraph: { type: "article", siteName: "District 34" },
      twitter: { site: "@district34" },
    };

    const result = withBrandSocialMetadata(base, {
      title: "Example update",
      description: "Example description",
      locale: "es",
      canonicalUrl: "https://www.assemblywomanmorales.com/news/example",
    }, verifyApprovedBrandAssets(definition()));

    expect(result.title).toEqual(base.title);
    expect(result.alternates).toEqual(base.alternates);
    expect(result.robots).toEqual(base.robots);
    expect(result.referrer).toBe("no-referrer");
    expect(result.openGraph).toMatchObject({
      type: "article",
      siteName: "District 34",
      title: "Example update",
      url: "https://www.assemblywomanmorales.com/news/example",
      images: [{
        url: "https://www.assemblywomanmorales.com/brand/social-cover.png",
        width: 1200,
        height: 630,
        alt: "Logotipo oficial de la asambleísta Carmen T. Morales, Distrito Legislativo 34",
      }],
    });
    expect(result.twitter).toMatchObject({
      card: "summary_large_image",
      site: "@district34",
      title: "Example update",
    });
  });

  it("keeps the Volunteer label editable while forcing the canonical form destination", () => {
    const verified = verifyApprovedBrandAssets(definition());

    expect(normalizeProtectedBrandValue({
      pagePath: "/",
      regionId: "home.hero.volunteer-cta",
      value: { type: "link", href: "https://example.com/wrong", label: "Join the team" },
    }, verified)).toEqual({
      type: "link",
      href: districtConnections.volunteer.href,
      label: "Join the team",
    });

    expect(() => validateProtectedBrandSnapshot({
      pagePath: "/",
      regions: {
        "home.hero.volunteer-cta": {
          type: "link",
          href: "https://example.com/wrong",
          label: "Volunteer",
        },
      },
    }, verified)).toThrow(/canonical volunteer form/i);
  });

  it("restricts the homepage official portrait to the approved single-person asset", () => {
    const verified = verifyApprovedBrandAssets(definition());

    expect(normalizeProtectedBrandValue({
      pagePath: "/",
      regionId: "media.professional.home-official-portrait",
      value: {
        type: "image",
        src: "/images/professional/home-supporting-desktop.webp",
        alt: "Wrong multi-person image",
      },
    }, verified)).toEqual({
      type: "image",
      src: "/images/professional/about-primary-desktop.webp",
      alt: "Assemblywoman Carmen Morales speaking from her desk in a New Jersey State House committee room",
    });

    expect(() => validateProtectedBrandSnapshot({
      pagePath: "/",
      regions: {
        "media.professional.home-official-portrait": {
          type: "image",
          src: "/images/professional/home-supporting-desktop.webp",
          alt: "Wrong multi-person image",
        },
      },
    }, verified)).toThrow(/approved single-person portrait/i);
  });
});
