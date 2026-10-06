import { mkdir, readFile, copyFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

const [originals] = process.argv.slice(2);
if (!originals) throw new Error("Usage: node prepare-october-editorial-photos.mjs <approved-originals-directory>");
const sourceDir = "content/media-source/october-editorial";
const outputDir = "public/images/october-editorial";
await mkdir(sourceDir, { recursive: true });
await mkdir(outputDir, { recursive: true });
for (const name of ["DSC01789", "DSC02321"]) {
  const original = path.join(originals, `${name}.jpg`);
  await copyFile(original, `${sourceDir}/${name}.jpg`);
  const bytes = await readFile(original);
  const info = await sharp(bytes).metadata();
  const metadata = { name, source: { path: `${sourceDir}/${name}.jpg`, sha256: createHash("sha256").update(bytes).digest("hex"), width: info.width, height: info.height }, derivatives: {} };
  for (const [size, maximum] of [["desktop", 2400], ["mobile", 1200]]) {
    // Preserve the authentic frame. No crop, generative change, or upscaling.
    const { data, info } = await sharp(bytes).rotate().resize({ width: maximum, height: maximum, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    const output = `${outputDir}/${name}-${size}.webp`;
    await writeFile(output, data);
    metadata.derivatives[size] = { path: `/${output.slice(7)}`, width: info.width, height: info.height, sha256: createHash("sha256").update(data).digest("hex"), bytes: data.length };
  }
  console.log(JSON.stringify(metadata));
}
