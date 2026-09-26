import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

type MediaFile = { path: string; sha256: string; bytes: number; width: number; height: number };
type Asset = {
  key: string;
  id: string;
  sourceCollection: string;
  sourceUrl: string;
  source: MediaFile & { originalFilename: string };
  archivalOriginal?: Omit<MediaFile, "width" | "height"> & { format: string };
  derivatives: { desktop: MediaFile; mobile: MediaFile };
  alt: { en: string; es: string };
  caption: { en: string; es: string };
  placements: { page: string; region: string }[];
  approvalState: string;
  approvedOn: string;
};
type Manifest = {
  version: number;
  processing: { desktopMaxLongEdge: number; mobileMaxLongEdge: number; quality: number; withoutEnlargement: boolean; preserveAspectRatio: boolean };
  assets: Asset[];
};

const manifestPath = path.join(process.cwd(), "content/approved-community-editorial-media.json");
const approvedHashes = {
  "office-group": "177f6b608ad0854ddf625c74ece7238b877dc115a030c1409bb55fb65567b0dc",
  "chamber-group": "920c7ef0f89b15144aeffeef4f61523e694597b352bd6530e0f31f9b64aa7b6c",
  "community-greeting": "bcb4ca965d7dd7781112a415f62a6283fddf34c8a14b0b9a73958066e701e172",
  "student-recognition": "1040716b818d484dd12c3493e76448c17b9547a67ed9a2b45a2f1128979195c0",
  "state-house-recognition": "5bfadecd45f8b7aa35bbdd9818a46d14572f1c8b299fc4822876bb4bc911b7f5",
  "outreach-table": "69070b77ec1158cba206305dcaf896bdda5a1f7a8e2a3ccc01a2ed396cdfdce6",
  "community-selfie": "9bdd0782aa069c129777ed21039c6ff212e030af91d6383f6f3578e3381b86dd",
  "hallway-portrait": "f0f58e516472b73015033083540c8bed16eba6e9ad53ae454b1210c27b4832a8",
  "bill-signing-group": "cbde8a262278b3cd31b28b1f19f437c968cf92145b0f6e1bf9319a82a2c0158e",
  "parade-group": "504c5cd03686a61159d2561f3469d9c3c19be931688fe5dedf93c41d07d85c73",
  "parade-walk": "560b2113b51a7c1434bd48b2021cb11fe5a3fb679a765bef78da546562a2ff84",
  "parade-wave": "ea1516582f2d0bdb7e63ba51e41bed32bfa42bc835ad8f03410c2e94077d9408",
  "parade-selfie": "42fa0e13ad09c9df4eb786ef419830b99986246e7c931e695b2a2a929f1eba84",
  "parade-smiles": "c2a89532fed515cf250f3db2fec81efce7627d84f97318f544f1a55ff1ffa0f0",
};

async function loadManifest(): Promise<Manifest> {
  expect(existsSync(manifestPath), "approved community editorial manifest exists").toBe(true);
  return JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
}

function localPath(filePath: string) {
  return path.join(process.cwd(), filePath.startsWith("/") ? `public${filePath}` : filePath);
}

describe("approved community editorial photographs", () => {
  it("retains the nine earlier photographs and adds exactly five approved originals", async () => {
    const manifest = await loadManifest();
    expect(manifest.version).toBe(1);
    expect(manifest.assets.map(({ key }) => key).sort()).toEqual(Object.keys(approvedHashes).sort());
    expect(manifest.processing).toEqual({ desktopMaxLongEdge: 1600, mobileMaxLongEdge: 800, quality: 88, withoutEnlargement: true, preserveAspectRatio: true });
    expect(new Set(manifest.assets.map(({ id }) => id)).size).toBe(14);
    for (const asset of manifest.assets) {
      expect(asset.id).toBe(`media.community-editorial.${asset.key}`);
      expect(asset.approvalState).toBe("approved");
      expect(asset.source.sha256).toBe(approvedHashes[asset.key as keyof typeof approvedHashes]);
      expect(asset.sourceUrl).toMatch(/^https:\/\/(www\.instagram\.com|drive\.google\.com|www\.assemblywomanmorales\.com)\//);
      expect(asset.sourceCollection.length).toBeGreaterThan(10);
      expect(asset.source.originalFilename.length).toBeGreaterThan(4);
      expect(asset.approvedOn).toBe(asset.key.startsWith("parade-") ? "2026-09-26" : "2026-09-14");
      if (!["student-recognition", "community-selfie"].includes(asset.key)) expect(asset.placements.length).toBeGreaterThan(0);
      for (const localized of [asset.alt, asset.caption]) {
        expect(localized.en.length).toBeGreaterThan(12);
        expect(localized.es.length).toBeGreaterThan(12);
        expect(localized.es).not.toBe(localized.en);
      }
    }
  });

  it("keeps originals unchanged and delivers uncropped derivatives without enlargement", async () => {
    const manifest = await loadManifest();
    for (const asset of manifest.assets) {
      expect(asset.source.path).toMatch(/^content\/media-source\/community-editorial\/[a-z-]+\.jpg$/);
      for (const file of [asset.source, asset.derivatives.desktop, asset.derivatives.mobile]) {
        const buffer = await readFile(localPath(file.path));
        expect(createHash("sha256").update(buffer).digest("hex")).toBe(file.sha256);
        expect(buffer.byteLength).toBe(file.bytes);
        const metadata = await sharp(buffer).metadata();
        expect(metadata.width).toBe(file.width);
        expect(metadata.height).toBe(file.height);
      }
      for (const [variant, longEdge] of [["desktop", 1600], ["mobile", 800]] as const) {
        const file = asset.derivatives[variant];
        expect(file.path).toBe(`/images/community-editorial/${asset.key}-${variant}.webp`);
        expect(Math.max(file.width, file.height)).toBeLessThanOrEqual(longEdge);
        expect(file.width).toBeLessThanOrEqual(asset.source.width);
        expect(file.height).toBeLessThanOrEqual(asset.source.height);
        expect(Math.abs(file.width - asset.source.width * file.height / asset.source.height)).toBeLessThanOrEqual(1);
        expect((await sharp(localPath(file.path)).metadata()).format).toBe("webp");
      }
    }
  });

  it("preserves the bill-signing archival HEIF alongside its verified portable input", async () => {
    const manifest = await loadManifest();
    const asset = manifest.assets.find(({ key }) => key === "bill-signing-group")!;
    expect(asset.archivalOriginal).toMatchObject({
      path: "content/media-source/community-editorial/bill-signing-group.heif",
      sha256: "631ff308f940b80c928e4e706361e4dcfd708390dbefcc64756bd9204ce5aca6",
      format: "heif",
    });
    const original = await readFile(localPath(asset.archivalOriginal!.path));
    expect(original.byteLength).toBe(asset.archivalOriginal!.bytes);
    expect(createHash("sha256").update(original).digest("hex")).toBe(asset.archivalOriginal!.sha256);
  });

  it("keeps the school group outside the carousel and records deliberate page-specific placements", async () => {
    const manifest = await loadManifest();
    const placements = Object.fromEntries(manifest.assets.map(({ key, placements }) => [key, placements]));
    expect(placements["student-recognition"]).toEqual([]);
    expect(placements["community-selfie"]).toEqual([]);
    expect(placements["parade-group"]).toEqual([{ page: "/", region: "hero slide 1" }]);
    expect(placements["parade-walk"]).toEqual([{ page: "/", region: "hero slide 7" }]);
    expect(placements["parade-wave"]).toEqual([{ page: "/community", region: "community primary" }]);
    expect(placements["parade-selfie"]).toEqual([{ page: "/community", region: "community supporting" }]);
    expect(placements["parade-smiles"]).toEqual([{ page: "/social", region: "social primary" }]);
    expect(placements["outreach-table"]).toEqual([{ page: "/survey", region: "survey primary" }]);
    expect(placements["community-greeting"]).not.toContainEqual({ page: "/community", region: "community primary" });
    expect(placements["community-greeting"]).toContainEqual({ page: "/", region: "hero slide 5" });
    expect(placements["office-group"]).toEqual([
      { page: "/", region: "home volunteer invitation" },
      { page: "/contact", region: "contact supporting" },
    ]);
    expect(manifest.assets.flatMap(({ placements }) => placements).some(({ page }) => page === "/newsletter")).toBe(false);
  });
});
