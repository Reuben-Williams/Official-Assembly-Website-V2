import { loadPublishedCarousel } from "../../../../../lib/carousel/server";
import { CAROUSEL_UUID } from "../../../../../lib/carousel/contract";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Resolve access only when the image is requested, rather than embedding an expiring
// recovery grant in a page that the visitor might leave open for several hours.
export async function GET(
  request: Request,
  context: { params: Promise<{ revisionId: string }> },
) {
  const { revisionId } = await context.params;
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (!CAROUSEL_UUID.test(revisionId))
    return new Response(null, { status: 404, headers });
  const publication = await loadPublishedCarousel({
    imageRevisionId: revisionId,
  });
  if (publication.status !== "ready")
    return new Response(null, { status: 503, headers });
  const image = publication.projection.images.find(
    (candidate) => candidate.revisionId === revisionId,
  );
  if (!image) return new Response(null, { status: 404, headers });
  return new Response(null, {
    status: 307,
    headers: { ...headers, location: new URL(image.url, request.url).href },
  });
}
