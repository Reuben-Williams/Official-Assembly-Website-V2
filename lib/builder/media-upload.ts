import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  MEDIA_FILE_MAX_BYTES,
  MEDIA_MAX_PIXELS,
  validateMediaClaim
} from "./media-constraints";
export * from "./media-constraints";

export type VerifiedMedia = {
  sha256: string;
  mimeType: "image/jpeg";
  byteSize: number;
  width: number;
  height: number;
};

export function createMediaObjectKey(input: {
  siteId: string;
  planId: string;
  nonce: string;
  sourceName: string;
}) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (![input.siteId, input.planId, input.nonce].every((value) => uuid.test(value))) {
    throw new TypeError("A valid site-scoped media key is required.");
  }
  if (!/\.jpe?g$/i.test(input.sourceName)) throw new TypeError("Only JPEG object keys are supported.");
  return `${input.siteId}/${input.planId}/${input.nonce}.jpg`;
}

export async function verifyTrustedJpeg(bytes: Buffer | Uint8Array): Promise<VerifiedMedia> {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.byteLength === 0 || buffer.byteLength > MEDIA_FILE_MAX_BYTES ||
      buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
    throw new TypeError("The stored object is not a valid JPEG image.");
  }

  try {
    const image = sharp(buffer, { failOn: "warning", limitInputPixels: MEDIA_MAX_PIXELS });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    validateMediaClaim({ name: "verified.jpg", mimeType: `image/${metadata.format}`, byteSize: buffer.byteLength, width, height });
    await image.clone().resize(1, 1, { fit: "fill" }).raw().toBuffer();
    return {
      sha256: createHash("sha256").update(buffer).digest("hex"),
      mimeType: "image/jpeg",
      byteSize: buffer.byteLength,
      width,
      height
    };
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("The stored object is not a decodable JPEG image.");
  }
}
