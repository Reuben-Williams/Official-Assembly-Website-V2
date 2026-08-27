import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

import { approvedBrandAssets } from "../lib/brand/approved-assets.ts";
import { verifyApprovedBrandAssetFiles } from "../lib/brand/file-verification.ts";

const MIME_BY_FORMAT = {
  avif: "image/avif",
  png: "image/png",
  webp: "image/webp",
};

if (!approvedBrandAssets) {
  process.stdout.write(`${JSON.stringify({ brandAssets: "inactive", reason: "clean_source_not_approved" })}\n`);
} else {
  const result = await verifyApprovedBrandAssetFiles(approvedBrandAssets, async (entry) => {
    const path = resolve(process.cwd(), "public", entry.publicPath.slice(1));
    const bytes = await readFile(path);
    const metadata = await sharp(bytes).metadata();
    const mimeType = MIME_BY_FORMAT[metadata.format];
    if (!mimeType || !metadata.width || !metadata.height) {
      throw new TypeError(`Approved brand asset ${entry.id} could not be decoded.`);
    }
    return { bytes, mimeType, width: metadata.width, height: metadata.height };
  });
  process.stdout.write(`${JSON.stringify({ brandAssets: "verified", ...result })}\n`);
}
