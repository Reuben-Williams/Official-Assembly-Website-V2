import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  createMediaObjectKey,
  validateMediaClaim,
  verifyTrustedJpeg
} from "../lib/builder/media-upload";

describe("private media upload contracts", () => {
  it("enforces JPEG and every approved planning bound", () => {
    expect(validateMediaClaim({
      name: "community.jpg",
      mimeType: "image/jpeg",
      byteSize: 1024,
      width: 1200,
      height: 800
    })).toEqual(expect.objectContaining({ mimeType: "image/jpeg" }));

    expect(() => validateMediaClaim({
      name: "community.png",
      mimeType: "image/png",
      byteSize: 1024,
      width: 1200,
      height: 800
    })).toThrow(/jpeg/i);
    expect(() => validateMediaClaim({
      name: "large.jpg",
      mimeType: "image/jpeg",
      byteSize: 10 * 1024 * 1024 + 1,
      width: 1200,
      height: 800
    })).toThrow(/10 mib/i);
    expect(() => validateMediaClaim({
      name: "pixels.jpg",
      mimeType: "image/jpeg",
      byteSize: 1024,
      width: 8000,
      height: 6000
    })).toThrow(/40 megapixels/i);
  });

  it("creates immutable site/plan scoped object keys without source path traversal", () => {
    const key = createMediaObjectKey({
      siteId: "11111111-1111-4111-8111-111111111111",
      planId: "22222222-2222-4222-8222-222222222222",
      nonce: "33333333-3333-4333-8333-333333333333",
      sourceName: "../Campaign Photo.JPG"
    });
    expect(key).toBe(
      "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.jpg"
    );
    expect(key).not.toContain("..");
    expect(key).not.toContain("Campaign");
  });

  it("decodes trusted bytes and returns server-computed JPEG facts", async () => {
    const onePixelJpeg = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "#ffffff" }
    }).jpeg().toBuffer();
    const verified = await verifyTrustedJpeg(onePixelJpeg);
    expect(verified).toMatchObject({ mimeType: "image/jpeg", width: 1, height: 1 });
    expect(verified.byteSize).toBe(onePixelJpeg.byteLength);
    expect(verified.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(verifyTrustedJpeg(Buffer.from("not an image"))).rejects.toThrow(/jpeg/i);
  });
});
