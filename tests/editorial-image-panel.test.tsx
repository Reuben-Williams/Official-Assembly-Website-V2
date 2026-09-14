// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImagePanel } from "../app/ui/ImagePanel";
import type { BuilderServerContent } from "../lib/builder/server-content";

const asset = {
  key: "office-group", regionId: "media.editorial.home-volunteer",
  src: "/images/community-editorial/office-group-desktop.webp",
  mobileSrc: "/images/community-editorial/office-group-mobile.webp",
  alt: "Morales with four people in an office", altEs: "Morales con cuatro personas en una oficina",
  caption: "Together at the office", captionEs: "Juntos en la oficina",
  width: 1440, height: 1331, fullFrame: true,
  legacyRegionIds: ["media.professional.community-primary"],
  retiredSources: ["/images/professional/community-primary-desktop.webp"],
};
function doc(content: BuilderServerContent = { regions: {} }, locale: "en" | "es" = "en") {
  return new DOMParser().parseFromString(renderToStaticMarkup(<ImagePanel asset={asset} caption={asset.caption} content={content} locale={locale} />), "text/html");
}

describe("approved full-frame editorial photographs", () => {
  it("uses full-frame sizing and keeps a caption below rather than over faces", () => {
    const view = doc();
    expect(view.querySelector('[data-editorial-full-frame="true"]')).not.toBeNull();
    expect(view.querySelector("img")?.getAttribute("width")).toBe("1440");
    expect(view.querySelector("img")?.getAttribute("height")).toBe("1331");
    expect(view.querySelector("img")?.getAttribute("style")).not.toContain("position:absolute");
  });
  it("renders approved Spanish alt and caption text for the default photo", () => {
    const view = doc(undefined, "es");
    expect(view.querySelector("img")?.alt).toBe(asset.altEs);
    expect(view.querySelector(".image-caption")?.textContent).toBe(asset.captionEs);
  });
  it("replaces only an exact retired default from the old shared region", () => {
    const view = doc({ regions: { "media.professional.community-primary": { type: "image", src: asset.retiredSources[0], alt: "Old flags caption" } } });
    expect(view.querySelector("img")?.getAttribute("src")).toContain("office-group-desktop");
    expect(view.querySelector("img")?.alt).toBe(asset.alt);
  });
  it("replaces an exact retired default saved under the current region", () => {
    const view = doc({ regions: { [asset.regionId]: { type: "image", src: asset.retiredSources[0], alt: "Old flags caption" } } });
    expect(view.querySelector("img")?.getAttribute("src")).toContain("office-group-desktop");
    expect(view.querySelector("img")?.alt).toBe(asset.alt);
  });
  it("preserves a custom photo from a legacy region and drops the default caption", () => {
    const view = doc({ regions: { "media.professional.community-primary": { type: "image", src: "/images/custom-office.webp", alt: "Office-published photograph" } } });
    expect(view.querySelector("img")?.getAttribute("src")).toContain("custom-office.webp");
    expect(view.querySelector("img")?.alt).toBe("Office-published photograph");
    expect(view.querySelector("source")).toBeNull();
    expect(view.querySelector(".image-caption")?.textContent).not.toContain(asset.caption);
  });
  it("gives the dedicated region precedence over legacy values", () => {
    const view = doc({ regions: {
      [asset.regionId]: { type: "image", src: "/images/new-office.webp", alt: "Newest photograph" },
      "media.professional.community-primary": { type: "image", src: "/images/older-office.webp", alt: "Earlier photograph" },
    } });
    expect(view.querySelector("img")?.getAttribute("src")).toContain("new-office.webp");
  });
  it("never attaches the default scene description to a custom photo without alt text", () => {
    const view = doc({ regions: { [asset.regionId]: { type: "image", src: "/images/custom.webp", alt: "" } } }, "es");
    expect(view.querySelector("img")?.alt).toBe("Material visual de la oficina del distrito");
  });
  it("does not discard a similarly named custom URL", () => {
    const view = doc({ regions: { [asset.regionId]: { type: "image", src: `${asset.retiredSources[0]}?office-edited=1`, alt: "Office revision" } } });
    expect(view.querySelector("img")?.getAttribute("src")).toContain("office-edited");
    expect(view.querySelector("img")?.alt).toBe("Office revision");
  });
});
