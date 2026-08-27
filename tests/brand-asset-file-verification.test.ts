import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  verifyApprovedBrandAssetFiles,
  type LoadedBrandAssetFile,
} from "../lib/brand/file-verification";
import type {
  ApprovedBrandAssetManifestEntry,
  VerifiedApprovedBrandAssets,
} from "../lib/brand/assets";

function assetsFor(bytes: Uint8Array): VerifiedApprovedBrandAssets {
  const entry: ApprovedBrandAssetManifestEntry = {
    id: "verified-file",
    sourceSha256: "a".repeat(64),
    publicSha256: createHash("sha256").update(bytes).digest("hex"),
    publicPath: "/brand/verified.webp",
    mimeType: "image/webp",
    width: 1800,
    height: 560,
    purpose: "homepage_banner",
    variant: "banner_desktop_webp",
    approvedBy: "site-owner",
    approvedAt: "2026-08-27T17:00:00.000Z",
  };
  return { entries: [entry] } as unknown as VerifiedApprovedBrandAssets;
}

describe("brand derivative file verification", () => {
  it("accepts exact reviewed bytes, dimensions, and MIME type", async () => {
    const bytes = new TextEncoder().encode("reviewed brand derivative");
    const loader = async (): Promise<LoadedBrandAssetFile> => ({
      bytes,
      mimeType: "image/webp",
      width: 1800,
      height: 560,
    });
    await expect(verifyApprovedBrandAssetFiles(assetsFor(bytes), loader)).resolves.toEqual({ verified: 1 });
  });

  it("rejects changed derivative bytes before deployment", async () => {
    const reviewed = new TextEncoder().encode("reviewed brand derivative");
    const changed = new TextEncoder().encode("changed brand derivative");
    await expect(verifyApprovedBrandAssetFiles(assetsFor(reviewed), async () => ({
      bytes: changed,
      mimeType: "image/webp",
      width: 1800,
      height: 560,
    }))).rejects.toThrow(/digest/i);
  });

  it("runs the brand verifier before the production Next build", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.build).toContain("verify-brand-assets.mjs");
  });
});
