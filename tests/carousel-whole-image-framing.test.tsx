import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommunityCarousel } from "../app/ui/CommunityCarousel";
import { createCarouselBaseline } from "../lib/carousel/contract";
import { communityPhotos } from "../app/data/community-photos";
const refs = communityPhotos.map((_, index) => ({ mediaId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, revisionId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}` }));
describe("complete carousel framing", () => {
  it.each([["contain", "cover"], ["cover", "contain"]] as const)("marks desktop %s and mobile %s independently", (desktop, mobile) => {
    const document = createCarouselBaseline(refs);
    document.entries[0].desktop.fit = desktop; document.entries[0].mobile = { fit: mobile, x: 50, y: 50 };
    const images = refs.map((ref, index) => ({ ...ref, url: communityPhotos[index].src, width: communityPhotos[index].width, height: communityPhotos[index].height, ready: true }));
    const html = renderToStaticMarkup(<CommunityCarousel locale="en" projection={{ revisionId: "framing", document, images }} />);
    expect(html).toContain(`data-fit="${desktop}"`); expect(html).toContain(`data-mobile-fit="${mobile}"`);
  });
  it("keeps complete photos unmasked and unzoomed with fades behind them", () => {
    const css = readFileSync(new URL("../app/ui/CommunityHero.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.stage\[data-fit="contain"\] \.photo\s*\{[^}]*mask-image:\s*none/);
    expect(css).toMatch(/\.stage\[data-fit="contain"\] \.photo\s*\{[^}]*animation:\s*none/);
    expect(css).toMatch(/\.stage\[data-fit="contain"\] \.photoMotion\s*\{[^}]*z-index:\s*2/);
    expect(css).toMatch(/\.stage\[data-mobile-fit="contain"\] \.photo\s*\{[^}]*mask-image:\s*none/);
    expect(css).toMatch(/\.stage\[data-mobile-fit="contain"\] \.photo\s*\{[^}]*height:\s*100%[^}]*animation:\s*none/);
    expect(css).toContain("var(--carousel-footer-height");
    // Fill-mode movement remains available on mobile, including a desktop whole-image override.
    expect(css).toMatch(/\[data-mobile-fit="cover"\] \.photoMotion\[data-zoom="true"\] \.photo\s*\{[^}]*animation:\s*carouselZoom/);
  });
});
