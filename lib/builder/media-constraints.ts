export const MEDIA_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_SIDE_MAX_PIXELS = 8192;
export const MEDIA_MAX_PIXELS = 40_000_000;
export const MEDIA_BATCH_MAX_FILES = 250;
export const MEDIA_BATCH_MAX_BYTES = 250 * 1024 * 1024;

export type MediaClaim = {
  name: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
};

function positiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateMediaClaim(claim: MediaClaim): MediaClaim {
  if (!/\.jpe?g$/i.test(claim.name) || claim.mimeType.toLowerCase() !== "image/jpeg") {
    throw new TypeError("Only JPEG images are accepted for this import.");
  }
  if (!positiveInteger(claim.byteSize) || claim.byteSize > MEDIA_FILE_MAX_BYTES) {
    throw new TypeError("Each image must be no larger than 10 MiB.");
  }
  if (!positiveInteger(claim.width) || !positiveInteger(claim.height) ||
      claim.width > MEDIA_SIDE_MAX_PIXELS || claim.height > MEDIA_SIDE_MAX_PIXELS) {
    throw new TypeError("Image width and height must each be between 1 and 8,192 pixels.");
  }
  if (claim.width * claim.height > MEDIA_MAX_PIXELS) {
    throw new TypeError("Each image must be no larger than 40 megapixels.");
  }
  return { ...claim, mimeType: "image/jpeg" };
}
