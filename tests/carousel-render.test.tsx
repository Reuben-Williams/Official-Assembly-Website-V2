import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CommunityCarousel } from "../app/ui/CommunityCarousel";
import { createCarouselBaseline } from "../lib/carousel/contract";
import { communityPhotos } from "../app/data/community-photos";
it("renders the supplied publication in the initial HTML without original captions", () => {
  const refs = communityPhotos.map((_, i) => ({
    mediaId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    revisionId: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
  }));
  const document = createCarouselBaseline(refs);
  document.entries[0].en = {
    title: "Published title",
    caption: "Published caption",
    alt: "Published description",
  };
  const images = refs.map((ref, i) => ({
    ...ref,
    url: communityPhotos[i].src,
    width: communityPhotos[i].width,
    height: communityPhotos[i].height,
    ready: true,
  }));
  const html = renderToStaticMarkup(
    <CommunityCarousel
      locale="en"
      projection={{ revisionId: "published-revision", document, images }}
    />,
  );
  expect(html).toContain("Published title");
  expect(html).toContain("Published description");
  expect(html).toContain('data-carousel-revision="published-revision"');
  expect(html).not.toContain("Together along the parade route");
});
