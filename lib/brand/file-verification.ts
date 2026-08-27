import { createHash } from "node:crypto";

import type {
  ApprovedBrandAssetManifestEntry,
  VerifiedApprovedBrandAssets,
} from "./assets";

export type LoadedBrandAssetFile = Readonly<{
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}>;

export type BrandAssetFileLoader = (
  entry: ApprovedBrandAssetManifestEntry,
) => Promise<LoadedBrandAssetFile>;

export async function verifyApprovedBrandAssetFiles(
  assets: VerifiedApprovedBrandAssets,
  load: BrandAssetFileLoader,
): Promise<{ verified: number }> {
  for (const entry of assets.entries) {
    const file = await load(entry);
    const digest = createHash("sha256").update(Buffer.from(file.bytes)).digest("hex");
    if (digest !== entry.publicSha256) {
      throw new TypeError(`Approved brand asset ${entry.id} has a digest mismatch.`);
    }
    if (file.mimeType !== entry.mimeType) {
      throw new TypeError(`Approved brand asset ${entry.id} has a MIME type mismatch.`);
    }
    if (file.width !== entry.width || file.height !== entry.height) {
      throw new TypeError(`Approved brand asset ${entry.id} has a dimension mismatch.`);
    }
  }
  return { verified: assets.entries.length };
}
