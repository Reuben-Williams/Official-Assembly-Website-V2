import { describe, expect, it } from "vitest";

import { imageAssets, pages, siteConfig } from "../app/data/site";

describe("site data", () => {
  it("defines the assembly office demo metadata", () => {
    expect(siteConfig.officeName).toContain("Assemblywoman");
    expect(siteConfig.githubPagesRepo).toBe("Official-Assembly-Website-V2");
  });

  it("ports the Stitch page concepts into Next routes", () => {
    expect(pages.map((page) => page.href)).toEqual([
      "/",
      "/about",
      "/resources",
      "/news",
      "/community",
      "/voting",
      "/contact",
      "/newsletter",
      "/survey",
      "/social"
    ]);
  });

  it("uses local project images instead of generated placeholder URLs", () => {
    for (const asset of imageAssets) {
      expect(asset.src).toMatch(/^\/images\//);
      expect(asset.src).not.toContain("lh3.googleusercontent.com");
      expect(asset.alt.toLowerCase()).not.toContain("placeholder");
    }
  });
});
