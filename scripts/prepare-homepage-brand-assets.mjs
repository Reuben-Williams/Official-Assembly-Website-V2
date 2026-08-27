import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import sharp from "sharp";

const root = process.cwd();
const referencePath = resolve(
  root,
  "docs/brand-assets/source/morales-ld34-banner-pasted-reference.png",
);
const restorationMaskPath = resolve(
  root,
  "docs/brand-assets/source/morales-ld34-banner-restoration-s-mask.png",
);
const restoredMasterPath = resolve(
  root,
  "docs/brand-assets/source/morales-ld34-banner-restored-master.png",
);
const publicDir = resolve(root, "public/brand");

const expectedReferenceSha256 =
  "dd8ccb4d76b9c60e0a5f961534cc9d35bab16c448f6392023ad62ba261792633";
const sourceCrop = { left: 0, top: 132, width: 1290, height: 402 };
const obscuredControl = {
  outerLeft: 1133,
  outerTop: 251,
  outerRight: 1270,
  outerBottom: 391,
  feather: 8,
};
const restoredLetter = { left: 1083, top: 168, width: 127, height: 116 };

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function blend(from, to, amount) {
  return Math.round(from + (to - from) * amount);
}

async function restoreMaster(referenceBytes) {
  const { data: crop, info } = await sharp(referenceBytes)
    .extract(sourceCrop)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data: letterMask, info: maskInfo } = await sharp(restorationMaskPath)
    .resize(restoredLetter.width, restoredLetter.height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rowBackground = Array.from({ length: info.height }, (_, y) => {
    const sum = [0, 0, 0];
    let samples = 0;
    for (let x = 1274; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      sum[0] += crop[offset];
      sum[1] += crop[offset + 1];
      sum[2] += crop[offset + 2];
      samples += 1;
    }
    return sum.map((value) => Math.round(value / samples));
  });

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (
        x < obscuredControl.outerLeft ||
        x > obscuredControl.outerRight ||
        y < obscuredControl.outerTop ||
        y > obscuredControl.outerBottom
      ) continue;
      const patchAmount = Math.max(
        0,
        Math.min(
          1,
          (x - obscuredControl.outerLeft) / obscuredControl.feather,
          (obscuredControl.outerRight - x) / obscuredControl.feather,
          (y - obscuredControl.outerTop) / obscuredControl.feather,
          (obscuredControl.outerBottom - y) / obscuredControl.feather,
        ),
      );
      const offset = (y * info.width + x) * info.channels;
      const background = rowBackground[y];
      let red = background[0];
      let green = background[1];
      let blue = background[2];

      const maskX = x - restoredLetter.left;
      const maskY = y - restoredLetter.top;
      if (
        maskX >= 0 &&
        maskY >= 0 &&
        maskX < maskInfo.width &&
        maskY < maskInfo.height
      ) {
        const maskOffset = (maskY * maskInfo.width + maskX) * maskInfo.channels;
        const letterAlpha = letterMask[maskOffset + 3] / 255;
        red = blend(red, 249, letterAlpha);
        green = blend(green, 249, letterAlpha);
        blue = blend(blue, 248, letterAlpha);
      }

      crop[offset] = blend(crop[offset], red, patchAmount);
      crop[offset + 1] = blend(crop[offset + 1], green, patchAmount);
      crop[offset + 2] = blend(crop[offset + 2], blue, patchAmount);
    }
  }

  return sharp(crop, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function save(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  const metadata = await sharp(bytes).metadata();
  return {
    path: path.slice(root.length + 1).replaceAll("\\", "/"),
    sha256: sha256(bytes),
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
  };
}

const referenceBytes = await readFile(referencePath);
if (sha256(referenceBytes) !== expectedReferenceSha256) {
  throw new TypeError("The approved pasted reference does not match its reviewed digest.");
}

const restoredMaster = await restoreMaster(referenceBytes);
const masterMetadata = await sharp(restoredMaster).metadata();
if (masterMetadata.width !== 1290 || masterMetadata.height !== 402) {
  throw new TypeError("The restored banner master has unexpected dimensions.");
}

await mkdir(publicDir, { recursive: true });
const master = await save(restoredMasterPath, restoredMaster);
const desktopAvif = await sharp(restoredMaster)
  .avif({ quality: 90, effort: 8 })
  .toBuffer();
const desktopWebp = await sharp(restoredMaster)
  .webp({ quality: 92, effort: 6, smartSubsample: true })
  .toBuffer();
const mobileBase = await sharp(restoredMaster)
  .resize({ width: 960, withoutEnlargement: true })
  .toBuffer();
const mobileAvif = await sharp(mobileBase)
  .avif({ quality: 88, effort: 8 })
  .toBuffer();
const mobileWebp = await sharp(mobileBase)
  .webp({ quality: 91, effort: 6, smartSubsample: true })
  .toBuffer();

const socialBanner = await sharp(restoredMaster)
  .resize({ width: 1200, withoutEnlargement: true })
  .toBuffer();
const socialMetadata = await sharp(socialBanner).metadata();
const socialCover = await sharp({
  create: {
    width: 1200,
    height: 630,
    channels: 3,
    background: rowBackgroundFallback(restoredMaster),
  },
})
  .composite([
    {
      input: socialBanner,
      left: Math.round((1200 - socialMetadata.width) / 2),
      top: Math.round((630 - socialMetadata.height) / 2),
    },
  ])
  .png({ compressionLevel: 9 })
  .toBuffer();

function rowBackgroundFallback() {
  return { r: 31, g: 57, b: 91 };
}

const outputs = [
  master,
  await save(resolve(publicDir, "morales-ld34-banner-desktop.avif"), desktopAvif),
  await save(resolve(publicDir, "morales-ld34-banner-desktop.webp"), desktopWebp),
  await save(resolve(publicDir, "morales-ld34-banner-mobile.avif"), mobileAvif),
  await save(resolve(publicDir, "morales-ld34-banner-mobile.webp"), mobileWebp),
  await save(resolve(publicDir, "morales-ld34-social-1200x630.png"), socialCover),
];

process.stdout.write(`${JSON.stringify({ referenceSha256: expectedReferenceSha256, outputs }, null, 2)}\n`);
