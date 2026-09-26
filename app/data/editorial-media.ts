import manifest from "../../content/approved-community-editorial-media.json";
import type { ImageAsset } from "./site";

// Exact retired defaults only. These files remain in the archive/media library;
// this list is used solely by the approved public editorial placements below.
const retiredSources = [
  "/images/rosy-bagolie-coverage.jpg",
  "/images/graduation-community.jpg",
  "/images/outdoor-district-visit.jpg",
  "/images/capitol-visit.jpg",
  "/images/constituent-meeting.jpg",
  "/images/district-outreach.jpg",
  "/images/expungement-clinic.jpg",
  "/images/professional/community-primary-desktop.webp",
  "/images/professional/community-primary-mobile.webp",
  "/images/professional/resources-supporting-desktop.webp",
  "/images/professional/resources-supporting-mobile.webp",
] as const;

export function isRetiredEditorialSource(src: string): boolean {
  return retiredSources.some((retired) => retired === src);
}

export function getEditorialPhoto(key: string, regionId?: string): ImageAsset {
  const photo = manifest.assets.find((item) => item.key === key);
  if (!photo) throw new Error(`Unknown approved editorial photo: ${key}`);
  return {
    key: photo.key,
    regionId: regionId ?? photo.id,
    src: photo.derivatives.desktop.path,
    mobileSrc: photo.derivatives.mobile.path,
    width: photo.derivatives.desktop.width,
    height: photo.derivatives.desktop.height,
    fullFrame: true,
    alt: photo.alt.en, altEs: photo.alt.es,
    caption: photo.caption.en, captionEs: photo.caption.es,
    retiredSources,
    ...(regionId === "media.editorial.home-volunteer"
      ? { legacyRegionIds: ["media.professional.community-primary"] } : {}),
  };
}

const pageSelections: Record<string, { hero?: [string, string]; supporting: [string, string] }> = {
  about: { supporting: ["chamber-group", "media.coverage"] },
  resources: { supporting: ["chamber-group", "media.professional.resources-supporting"] },
  community: { hero: ["parade-wave", "media.professional.community-primary"], supporting: ["parade-selfie", "media.graduation"] },
  contact: { supporting: ["office-group", "media.coverage"] },
  voting: { supporting: ["hallway-portrait", "media.coverage"] },
  survey: { hero: ["outreach-table", "media.outdoor-visit"], supporting: ["community-greeting", "media.coverage"] },
  social: { hero: ["parade-smiles", "media.capitol"], supporting: ["community-greeting", "media.coverage"] },
};

export function getEditorialPagePhoto(slug: string, placement: "hero" | "supporting"): ImageAsset | undefined {
  const selection = pageSelections[slug]?.[placement];
  if (!selection) return undefined;
  const [key, legacyId] = selection;
  const regionId = placement === "hero" ? legacyId : `media.editorial.${slug}-supporting`;
  return { ...getEditorialPhoto(key, regionId), legacyRegionIds: placement === "hero" ? [] : [legacyId] };
}

export const editorialImageRegions = [
  { id: "media.editorial.home-volunteer", kind: "image" as const, label: "Home volunteer invitation photograph" },
  ...Object.keys(pageSelections).map((slug) => ({
    id: `media.editorial.${slug}-supporting`, kind: "image" as const, label: `${slug} supporting photograph`,
  })),
];
