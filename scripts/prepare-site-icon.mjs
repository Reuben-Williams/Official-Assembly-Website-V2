import sharp from "sharp";
import { fileURLToPath } from "node:url";

// Web-icon export only: preserve all of the supplied artwork, with transparent
// padding to satisfy the square favicon format. Never crop or retouch the logo.
await sharp(fileURLToPath(new URL("../docs/brand-assets/source/morales-official-portrait-logo.png", import.meta.url)))
  .resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(fileURLToPath(new URL("../app/icon.png", import.meta.url)));
