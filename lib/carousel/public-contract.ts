import type { CarouselProjection } from "./contract";
export function publicCarouselImageUrls(
  projection: CarouselProjection,
): CarouselProjection {
  return {
    ...projection,
    images: projection.images.map((image) => ({
      ...image,
      url: `/api/carousel/media/${encodeURIComponent(image.revisionId)}`,
    })),
  };
}
export type PublicCarouselLoad =
  | {
      status: "ready";
      projection: CarouselProjection;
      source: "primary" | "recovery";
    }
  | { status: "unavailable" }
  | { status: "legacy-uninitialized" };
export async function resolvePublicCarousel(
  primary: () => Promise<CarouselProjection | null>,
  recovery: () => Promise<CarouselProjection | null>,
): Promise<PublicCarouselLoad> {
  try {
    const projection = await primary();
    if (projection) return { status: "ready", projection, source: "primary" };
  } catch {
    /* Try the verified published generation, never a draft or static baseline. */
  }
  try {
    const projection = await recovery();
    if (projection) return { status: "ready", projection, source: "recovery" };
  } catch {
    /* The rest of the homepage remains available. */
  }
  return { status: "unavailable" };
}
