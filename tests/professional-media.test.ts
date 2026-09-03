import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import site from "../builder.config";
import { getImage } from "../app/data/site";

type MediaFile = {
  path: string;
  width: number;
  height: number;
};

type ApprovedMediaRecord = {
  id: string;
  sourceCollection: string;
  acquiredOn: string;
  source: MediaFile & { sha256: string };
  derivatives: {
    desktop: MediaFile;
    mobile: MediaFile;
  };
  placements: Array<{
    page: string;
    region: string;
  }>;
  alt: {
    en: string;
    es: string;
  };
  approvalState: "approved";
};

type ApprovedMediaManifest = {
  version: 2;
  assets: ApprovedMediaRecord[];
};

const workspaceRoot = process.cwd();
const manifestPath = path.join(workspaceRoot, "content", "approved-professional-media.json");
const expectedPlacements = {
  "media.professional.home-supporting": [["/", "home supporting"]],
  "media.professional.about-primary": [
    ["/about", "about primary"],
    ["/", "official profile portrait"],
  ],
  "media.professional.news-supporting": [["/news", "news supporting"]],
  "media.professional.community-primary": [["/community", "community primary"]],
  "media.professional.resources-supporting": [["/resources", "resources supporting"]],
} as const;

async function loadManifest() {
  return JSON.parse(await readFile(manifestPath, "utf8")) as ApprovedMediaManifest;
}

function localPath(publicOrRepoPath: string) {
  return publicOrRepoPath.startsWith("/")
    ? path.join(workspaceRoot, "public", publicOrRepoPath.slice(1))
    : path.join(workspaceRoot, publicOrRepoPath);
}

describe("approved professional media", () => {
  it("pins five approved bilingual assets and records both portrait consumers", async () => {
    const manifest = await loadManifest();

    expect(manifest.version).toBe(2);
    expect(Object.fromEntries(manifest.assets.map(({ id, placements }) => [
      id,
      placements.map(({ page, region }) => [page, region]),
    ]))).toEqual(expectedPlacements);
    expect(new Set(manifest.assets.map(({ source }) => source.path)).size).toBe(5);
    expect(new Set(manifest.assets.flatMap(({ derivatives }) => [
      derivatives.desktop.path,
      derivatives.mobile.path,
    ])).size).toBe(10);

    for (const asset of manifest.assets) {
      expect(asset.approvalState).toBe("approved");
      expect(asset.sourceCollection).toMatch(/State House|Puerto Rican Flag Raising/);
      expect(asset.acquiredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(asset.alt.en.trim().length).toBeGreaterThan(20);
      expect(asset.alt.es.trim().length).toBeGreaterThan(20);
      expect(asset.alt.es).not.toBe(asset.alt.en);
    }
  });

  it("keeps verified local sources and correctly sized responsive derivatives", async () => {
    const manifest = await loadManifest();

    for (const asset of manifest.assets) {
      const serialized = JSON.stringify(asset).toLowerCase();
      expect(serialized).not.toMatch(/google|photos\.app|lh3|key=|email|@gmail/);
      expect(path.isAbsolute(asset.source.path)).toBe(false);
      expect(asset.source.path).toMatch(/^content\/media-source\/professional\//);

      const sourceBuffer = await readFile(localPath(asset.source.path));
      expect(createHash("sha256").update(sourceBuffer).digest("hex")).toBe(asset.source.sha256);

      for (const mediaFile of [asset.source, asset.derivatives.desktop, asset.derivatives.mobile]) {
        const metadata = await sharp(localPath(mediaFile.path)).metadata();
        expect(metadata.width).toBe(mediaFile.width);
        expect(metadata.height).toBe(mediaFile.height);
      }

      expect(asset.derivatives.desktop.path).toMatch(/^\/images\/professional\/.*-desktop\.webp$/);
      expect(asset.derivatives.mobile.path).toMatch(/^\/images\/professional\/.*-mobile\.webp$/);
    }
  });

  it("registers every placement as a responsive editor-managed image", async () => {
    const manifest = await loadManifest();
    const configuredRegions = site.globalRegions.map((region) => region.id);

    for (const asset of manifest.assets) {
      expect(configuredRegions).toContain(asset.id);
      const siteAsset = getImage(asset.id.replace("media.professional.", "professional-"));
      expect(siteAsset.regionId).toBe(asset.id);
      expect(siteAsset.src).toBe(asset.derivatives.desktop.path);
      expect(siteAsset.mobileSrc).toBe(asset.derivatives.mobile.path);
      expect(siteAsset.alt).toBe(asset.alt.en);
    }

    const homePortrait = getImage("professional-home-official");
    expect(homePortrait).toMatchObject({
      regionId: "media.professional.home-official-portrait",
      src: "/images/professional/about-primary-desktop.webp",
      mobileSrc: "/images/professional/about-primary-mobile.webp",
    });
  });
});
