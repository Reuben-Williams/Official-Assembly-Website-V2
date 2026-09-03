import type { EditableValue, MediaAsset } from "@reuben-williams/core";

import { districtConnections } from "../../app/data/district-connections";

export const HOME_BRAND_BANNER_REGION_ID = "media.home-brand-banner";
export const HOME_BRAND_BANNER_ALT_EN = "Assemblywoman Carmen T. Morales — Legislative District 34";
export const HOME_BRAND_BANNER_ALT_ES = "Asambleísta Carmen T. Morales — Distrito Legislativo 34";
export const HOME_VOLUNTEER_REGION_ID = "home.hero.volunteer-cta";
export const HOME_OFFICIAL_PORTRAIT_REGION_ID = "media.professional.home-official-portrait";
export const HOME_OFFICIAL_PORTRAIT_VALUE = Object.freeze({
  type: "image" as const,
  src: "/images/professional/home-official-portrait-desktop.webp",
  alt: "Official portrait of Assemblywoman Carmen Theresa Morales",
});
export const SOCIAL_COVER_ALT_EN = "Official logo of Assemblywoman Carmen T. Morales, Legislative District 34";
export const SOCIAL_COVER_ALT_ES = "Logotipo oficial de la asambleísta Carmen T. Morales, Distrito Legislativo 34";

export type ApprovedBrandAssetVariant =
  | "banner_desktop_avif"
  | "banner_desktop_webp"
  | "banner_mobile_avif"
  | "banner_mobile_webp"
  | "social_1200x630_png";

export type ApprovedBrandAssetManifestEntry = Readonly<{
  id: string;
  sourceSha256: string;
  publicSha256: string;
  publicPath: `/brand/${string}`;
  mimeType: "image/avif" | "image/webp" | "image/png";
  width: number;
  height: number;
  purpose: "homepage_banner" | "social_cover";
  variant: ApprovedBrandAssetVariant;
  approvedBy: string;
  approvedAt: string;
}>;

export type ApprovedBrandBannerSetDefinition = Readonly<{
  id: string;
  pickerPublicPath: `/brand/${string}`;
  desktop: Readonly<{ avifId: string; webpId: string }>;
  mobile: Readonly<{ avifId: string; webpId: string }>;
}>;

export type ApprovedBrandAssetDefinition = {
  entries: ApprovedBrandAssetManifestEntry[];
  renderMap: {
    banner: {
      mobileMaxWidthPx: number;
      fallbackBannerSetId: string;
      sets: ApprovedBrandBannerSetDefinition[];
    };
    socialCoverId: string;
  };
};

export type VerifiedBrandBannerSet = Readonly<{
  id: string;
  pickerPublicPath: `/brand/${string}`;
  desktop: Readonly<{
    avif: ApprovedBrandAssetManifestEntry;
    webp: ApprovedBrandAssetManifestEntry;
  }>;
  mobile: Readonly<{
    avif: ApprovedBrandAssetManifestEntry;
    webp: ApprovedBrandAssetManifestEntry;
  }>;
}>;

export type VerifiedApprovedBrandAssets = Readonly<{
  entries: readonly ApprovedBrandAssetManifestEntry[];
  bannerSets: readonly VerifiedBrandBannerSet[];
  fallbackBannerSet: VerifiedBrandBannerSet;
  mobileMaxWidthPx: number;
  socialCover: ApprovedBrandAssetManifestEntry;
}>;

const SHA256 = /^[0-9a-f]{64}$/;
const STABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

const expectedVariant = {
  desktopAvif: ["homepage_banner", "banner_desktop_avif", "image/avif"],
  desktopWebp: ["homepage_banner", "banner_desktop_webp", "image/webp"],
  mobileAvif: ["homepage_banner", "banner_mobile_avif", "image/avif"],
  mobileWebp: ["homepage_banner", "banner_mobile_webp", "image/webp"],
  social: ["social_cover", "social_1200x630_png", "image/png"],
} as const;

function invalid(message: string): never {
  throw new TypeError(`Invalid approved brand assets: ${message}`);
}

function requireEntry(
  entries: ReadonlyMap<string, ApprovedBrandAssetManifestEntry>,
  id: string,
  expected: readonly [ApprovedBrandAssetManifestEntry["purpose"], ApprovedBrandAssetVariant, ApprovedBrandAssetManifestEntry["mimeType"]],
) {
  const entry = entries.get(id);
  if (!entry) invalid(`missing manifest entry ${id}.`);
  if (entry.purpose !== expected[0] || entry.variant !== expected[1] || entry.mimeType !== expected[2]) {
    invalid(`manifest entry ${id} has the wrong purpose, variant, or MIME type.`);
  }
  return entry;
}

export function verifyApprovedBrandAssets(
  definition: ApprovedBrandAssetDefinition,
): VerifiedApprovedBrandAssets {
  if (!Number.isInteger(definition.renderMap.banner.mobileMaxWidthPx) ||
      definition.renderMap.banner.mobileMaxWidthPx < 320 ||
      definition.renderMap.banner.mobileMaxWidthPx > 1200) {
    invalid("the mobile breakpoint is outside the reviewed range.");
  }
  const entries = new Map<string, ApprovedBrandAssetManifestEntry>();
  const paths = new Set<string>();
  for (const entry of definition.entries) {
    if (!STABLE_ID.test(entry.id) || entries.has(entry.id)) invalid(`duplicate or unstable entry ID ${entry.id}.`);
    if (!entry.publicPath.startsWith("/brand/") || paths.has(entry.publicPath)) invalid(`duplicate or invalid public path ${entry.publicPath}.`);
    if (!SHA256.test(entry.sourceSha256) || !SHA256.test(entry.publicSha256)) invalid(`entry ${entry.id} has an invalid SHA-256 digest.`);
    if (!Number.isSafeInteger(entry.width) || entry.width < 1 || !Number.isSafeInteger(entry.height) || entry.height < 1) {
      invalid(`entry ${entry.id} has invalid dimensions.`);
    }
    if (!entry.approvedBy.trim() || new Date(entry.approvedAt).toISOString() !== entry.approvedAt) {
      invalid(`entry ${entry.id} has invalid approval evidence.`);
    }
    entries.set(entry.id, Object.freeze({ ...entry }));
    paths.add(entry.publicPath);
  }

  const setIds = new Set<string>();
  const pickerPaths = new Set<string>();
  const bannerSets = definition.renderMap.banner.sets.map((set): VerifiedBrandBannerSet => {
    if (!STABLE_ID.test(set.id) || setIds.has(set.id)) invalid(`duplicate or unstable banner set ID ${set.id}.`);
    if (pickerPaths.has(set.pickerPublicPath)) invalid(`duplicate banner picker path ${set.pickerPublicPath}.`);
    const desktopAvif = requireEntry(entries, set.desktop.avifId, expectedVariant.desktopAvif);
    const desktopWebp = requireEntry(entries, set.desktop.webpId, expectedVariant.desktopWebp);
    const mobileAvif = requireEntry(entries, set.mobile.avifId, expectedVariant.mobileAvif);
    const mobileWebp = requireEntry(entries, set.mobile.webpId, expectedVariant.mobileWebp);
    if (desktopWebp.publicPath !== set.pickerPublicPath) invalid(`banner set ${set.id} picker path must select its desktop WebP.`);
    const sources = new Set([desktopAvif, desktopWebp, mobileAvif, mobileWebp].map((entry) => entry.sourceSha256));
    if (sources.size !== 1) invalid(`banner set ${set.id} mixes unrelated source assets.`);
    setIds.add(set.id);
    pickerPaths.add(set.pickerPublicPath);
    return Object.freeze({
      id: set.id,
      pickerPublicPath: set.pickerPublicPath,
      desktop: Object.freeze({ avif: desktopAvif, webp: desktopWebp }),
      mobile: Object.freeze({ avif: mobileAvif, webp: mobileWebp }),
    });
  });
  if (bannerSets.length === 0) invalid("at least one banner set is required.");
  const fallbackBannerSet = bannerSets.find((set) => set.id === definition.renderMap.banner.fallbackBannerSetId);
  if (!fallbackBannerSet) invalid("the fallback banner set does not exist.");
  const socialCover = requireEntry(entries, definition.renderMap.socialCoverId, expectedVariant.social);
  if (socialCover.width !== 1200 || socialCover.height !== 630) invalid("the social cover must be exactly 1200x630.");

  return Object.freeze({
    entries: Object.freeze([...entries.values()]),
    bannerSets: Object.freeze(bannerSets),
    fallbackBannerSet,
    mobileMaxWidthPx: definition.renderMap.banner.mobileMaxWidthPx,
    socialCover,
  });
}

export function validateHomeBrandBannerValue(
  value: unknown,
  assets: VerifiedApprovedBrandAssets,
): Extract<EditableValue, { type: "image" }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("the homepage brand banner value is missing.");
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "image" || typeof candidate.src !== "string") invalid("the homepage brand banner must be an image.");
  const set = assets.bannerSets.find((item) => item.pickerPublicPath === candidate.src);
  if (!set) invalid("select an approved homepage brand banner.");
  return { type: "image", src: set.pickerPublicPath, alt: HOME_BRAND_BANNER_ALT_EN };
}

export function normalizeProtectedBrandValue(
  input: Readonly<{
    pagePath: string;
    regionId: string;
    value: EditableValue;
  }>,
  assets: VerifiedApprovedBrandAssets | null,
): EditableValue {
  if (input.regionId === HOME_VOLUNTEER_REGION_ID) {
    if (input.pagePath !== "/" || input.value.type !== "link") {
      invalid("the canonical Volunteer action is not active.");
    }
    return {
      type: "link",
      href: districtConnections.volunteer.href,
      label: input.value.label,
    };
  }
  if (input.regionId === HOME_OFFICIAL_PORTRAIT_REGION_ID) {
    if (input.pagePath !== "/" || input.value.type !== "image") {
      invalid("the homepage official portrait is not active.");
    }
    return HOME_OFFICIAL_PORTRAIT_VALUE;
  }
  if (input.regionId === HOME_BRAND_BANNER_REGION_ID) {
    if (input.pagePath !== "/" || !assets) invalid("the homepage brand banner is not active.");
    return validateHomeBrandBannerValue(input.value, assets);
  }
  return input.value;
}

export function validateProtectedBrandSnapshot(
  input: Readonly<{
    pagePath: string;
    regions: Readonly<Record<string, EditableValue>>;
  }>,
  assets: VerifiedApprovedBrandAssets | null,
): void {
  const banner = input.regions[HOME_BRAND_BANNER_REGION_ID];
  if (banner !== undefined) {
    if (input.pagePath !== "/" || !assets) invalid("the homepage brand banner is not active.");
    validateHomeBrandBannerValue(banner, assets);
  }

  const volunteer = input.regions[HOME_VOLUNTEER_REGION_ID];
  if (volunteer !== undefined) {
    if (
      input.pagePath !== "/"
      || volunteer.type !== "link"
      || volunteer.href !== districtConnections.volunteer.href
    ) {
      invalid("use the canonical Volunteer form destination.");
    }
  }

  const portrait = input.regions[HOME_OFFICIAL_PORTRAIT_REGION_ID];
  if (portrait !== undefined) {
    if (
      input.pagePath !== "/"
      || portrait.type !== "image"
      || portrait.src !== HOME_OFFICIAL_PORTRAIT_VALUE.src
    ) {
      invalid("select the approved single-person portrait.");
    }
  }
}

export function resolveHomeBrandBannerSet(
  value: unknown,
  assets: VerifiedApprovedBrandAssets,
): VerifiedBrandBannerSet {
  try {
    const normalized = validateHomeBrandBannerValue(value, assets);
    return assets.bannerSets.find((set) => set.pickerPublicPath === normalized.src) ?? assets.fallbackBannerSet;
  } catch {
    return assets.fallbackBannerSet;
  }
}

export function brandBannerSeedAssets(
  siteId: string,
  assets: VerifiedApprovedBrandAssets,
): MediaAsset[] {
  return assets.bannerSets.map((set) => ({
    id: `brand-banner-${set.id}`,
    siteId,
    path: set.pickerPublicPath,
    url: set.pickerPublicPath,
    alt: HOME_BRAND_BANNER_ALT_EN,
    label: set.id === assets.fallbackBannerSet.id ? "Official homepage brand banner" : `Approved brand banner — ${set.id}`,
    mimeType: set.desktop.webp.mimeType,
    source: "seed" as const,
    width: set.desktop.webp.width,
    height: set.desktop.webp.height,
    userId: "approved-brand-release",
    createdAt: set.desktop.webp.approvedAt,
  }));
}
