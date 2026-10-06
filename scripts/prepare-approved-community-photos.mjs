import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const [originals, output] = process.argv.slice(2);
if (!originals || !output) throw new Error("Usage: node prepare-approved-community-photos.mjs <originals-directory> <output-directory>");
const selected = ["DSC02321", "DSC09911", "DSC02027", "DSC09776", "DSC02485"];
await mkdir(output, { recursive: true });
for (const name of selected) {
  // Faithful web-size derivative: no crop, generative edits, or upscaling.
  const { data, info } = await sharp(path.join(originals, `${name}.jpg`), { limitInputPixels: 60_000_000 })
    .rotate().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  await writeFile(path.join(output, `${name}.jpg`), data);
  console.log(JSON.stringify({ name, width: info.width, height: info.height, bytes: data.length }));
}
