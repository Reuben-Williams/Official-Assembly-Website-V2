import type { Metadata } from "next";

import {
  SOCIAL_COVER_ALT_EN,
  SOCIAL_COVER_ALT_ES,
  type VerifiedApprovedBrandAssets,
} from "./assets";

type BrandSocialMetadataInput = Readonly<{
  title: string;
  description: string;
  locale: "en" | "es";
  canonicalUrl?: string;
}>;

export function withBrandSocialMetadata(
  base: Metadata,
  input: BrandSocialMetadataInput,
  assets: VerifiedApprovedBrandAssets | null,
): Metadata {
  if (!assets) return base;
  const metadataBase = base.metadataBase ?? new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  );
  const imageUrl = new URL(assets.socialCover.publicPath, metadataBase).toString();
  const alt = input.locale === "es" ? SOCIAL_COVER_ALT_ES : SOCIAL_COVER_ALT_EN;
  const openGraph = base.openGraph && typeof base.openGraph === "object" ? base.openGraph : {};
  const twitter = base.twitter && typeof base.twitter === "object" ? base.twitter : {};

  return {
    ...base,
    openGraph: {
      ...openGraph,
      title: input.title,
      description: input.description,
      ...(input.canonicalUrl ? { url: input.canonicalUrl } : {}),
      images: [{ url: imageUrl, width: 1200, height: 630, alt }],
    },
    twitter: {
      ...twitter,
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: [{ url: imageUrl, alt }],
    },
  };
}
