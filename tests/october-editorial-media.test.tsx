// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("../app/ui/ResidentForms", () => ({ ResidentForm: async () => <form /> }));
import manifest from "../content/approved-october-editorial-media.json";
import { HomePageView } from "../app/ui/HomePageView";
import { getImage } from "../app/data/site";

describe("approved October portrait and guidance photos", () => {
  it("verifies authentic source and derivative hashes, resolution, and preserved aspect ratio", async () => {
    for (const asset of manifest.assets) {
      for (const file of [asset.source, asset.derivatives.desktop, asset.derivatives.mobile]) {
        const bytes = await readFile(file.path.startsWith("/") ? `public${file.path}` : file.path);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
        const metadata = await sharp(bytes).metadata();
        expect([metadata.width, metadata.height]).toEqual([file.width, file.height]);
        expect(file.width / file.height).toBeCloseTo(asset.source.width / asset.source.height, 3);
      }
    }
  });
  it("replaces the Constituent guidance photograph but preserves the volunteer photo and link", async () => {
    const html = renderToStaticMarkup(await HomePageView({ content: { regions: {} }, posts: [], calendar: { status: "ready", events: [] } }));
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector<HTMLImageElement>('[data-home-section="guidance"] img')?.src).toContain("DSC02321");
    expect(doc.querySelector<HTMLImageElement>('[data-builder-region="media.editorial.home-volunteer"] img')?.src).toContain("office-group");
    expect(doc.querySelector('[data-home-section="guidance"] .image-caption')).toBeNull();
    expect(getImage("professional-home-supporting").retiredSources).toContain("/images/professional/home-supporting-desktop.webp");
  });
});
