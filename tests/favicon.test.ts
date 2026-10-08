import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

describe("site favicon", () => {
  it("uses the approved Morales portrait logo as the only file-based icon", async () => {
    const path = new URL("../app/icon.png", import.meta.url);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(new URL("../app/icon.svg", import.meta.url))).toBe(false);
    const icon = readFileSync(path);
    const metadata = await sharp(icon).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(192);
    expect(metadata.height).toBe(192);
    expect(metadata.hasAlpha).toBe(true);
    expect(icon.length).toBeLessThan(100_000);
  });

  it("preserves the supplied artwork with contain-only sizing, never cropping", async () => {
    const source = new URL("../docs/brand-assets/source/morales-official-portrait-logo.png", import.meta.url);
    expect(existsSync(source)).toBe(true);
    const bytes = readFileSync(source);
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("3fa8dbb8d2bc39e263790cdd9a09aeb85e40ab7518744d0b8531ca4966e86151");
    const expected = await sharp(bytes)
      .resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    expect(readFileSync(new URL("../app/icon.png", import.meta.url))).toEqual(expected);
  });
});
