import "server-only";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../supabase/admin";
import { createOfficialAssemblyRecoveryRuntime } from "../builder/recovery/runtime";
import { carouselProjection } from "./service";
import { validateCarouselDocument } from "./contract";
import { resolvePublicCarousel } from "./public-contract";
import { cache } from "react";

// Read only published settings, without resolving/signing eight full-size media URLs.
// Captions are off for older documents. Recovery uses the verified published generation.
export const loadPublishedPhotoCaptionVisibility = cache(async (): Promise<boolean> => {
  try {
    const client = getBuilderAdminClient();
    if (!client) return false;
    const siteId = await resolveBuilderSiteId(client);
    if (!siteId) return false;
    const aggregate = await client.from("builder_carousels").select("published_revision_id").eq("site_id", siteId).maybeSingle();
    if (!aggregate.error && aggregate.data?.published_revision_id) {
      const revision = await client.from("builder_carousel_revisions").select("document").eq("site_id", siteId).eq("id", aggregate.data.published_revision_id).single();
      if (!revision.error && revision.data) return validateCarouselDocument(revision.data.document, true).defaults.showCaptions === true;
    }
    const recovered = await createOfficialAssemblyRecoveryRuntime().readContent("/");
    return recovered?.carousel?.document.defaults.showCaptions === true;
  } catch { return false; }
});
export async function loadPublishedCarousel(
  options: { imageRevisionId?: string } = {},
) {
  let confirmedUninitialized = false;
  const result = await resolvePublicCarousel(
    async () => {
      const client = getBuilderAdminClient();
      if (!client) return null;
      const siteId = await resolveBuilderSiteId(client);
      if (!siteId) return null;
      const aggregate = await client
        .from("builder_carousels")
        .select("published_revision_id")
        .eq("site_id", siteId)
        .maybeSingle();
      if (!aggregate.error && !aggregate.data) {
        const prior = await client
          .from("builder_site_generations")
          .select("generation_id")
          .eq("site_id", siteId)
          .not("carousel_revision_id", "is", null)
          .limit(1);
        confirmedUninitialized =
          !prior.error && Array.isArray(prior.data) && prior.data.length === 0;
      }
      if (aggregate.error || !aggregate.data) return null;
      const revision = await client
        .from("builder_carousel_revisions")
        .select("id,document,created_at")
        .eq("site_id", siteId)
        .eq("id", aggregate.data.published_revision_id)
        .single();
      if (revision.error || !revision.data) return null;
      return carouselProjection(
        client,
        siteId,
        {
          id: revision.data.id,
          document: validateCarouselDocument(revision.data.document, true),
          createdAt: revision.data.created_at,
        },
        true,
        options.imageRevisionId,
      );
    },
    async () => {
      const recovered =
        await createOfficialAssemblyRecoveryRuntime().readContent("/");
      return recovered?.carousel ?? null;
    },
  );
  // Rolling installation may retain the original renderer only after authoritative
  // reads prove this site has never activated a carousel-aware generation.
  // A missing aggregate after activation or an unavailable database never qualifies.
  return result.status === "unavailable" && confirmedUninitialized
    ? { status: "legacy-uninitialized" as const }
    : result;
}
