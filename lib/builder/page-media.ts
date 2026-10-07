import type { EditableValue } from "@reuben-williams/core";
import { BuilderContentValidationError } from "./content-errors";
export type PageMediaReference = Readonly<{ mediaId: string; revisionId: string; objectKey: string; mimeType: string; byteSize: number; ready: boolean; archived: boolean }>;
export interface PageMediaRepository {
  byRevision(id: string): Promise<PageMediaReference | null>;
  byObjectKey(key: string): Promise<PageMediaReference | null>;
  isRetained(reference: PageMediaReference): Promise<boolean>;
}
export const PAGE_MEDIA_PREFIX = "/api/builder/media/";
export const PAGE_MEDIA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PAGE_MEDIA_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
export function pageMediaRevisionId(src: string): string | null {
  const match = /^\/api\/builder\/media\/([0-9a-f-]{36})(?:\?preview=1)?$/i.exec(src);
  return match && PAGE_MEDIA_UUID.test(match[1]) ? match[1].toLowerCase() : null;
}
function invalid(): never {
  throw new BuilderContentValidationError("PAGE_IMAGE_INVALID", "The selected photo is unavailable. Choose it again from the media gallery.");
}
export async function normalizePageMediaValue(value: EditableValue, repo: PageMediaRepository, origin: string,
  operation: "save" | "publish" | "restore" | "read"): Promise<EditableValue> {
  if (value.type !== "image") return value;
  const revisionId = pageMediaRevisionId(value.src);
  let reference: PageMediaReference | null;
  if (revisionId) reference = await repo.byRevision(revisionId);
  else if (value.src.startsWith(PAGE_MEDIA_PREFIX)) return invalid();
  else if (value.src.includes("/storage/v1/object/")) {
    let url: URL;
    try { url = new URL(value.src); } catch { return invalid(); }
    const prefix = "/storage/v1/object/sign/builder-media/";
    if (!origin || url.origin !== new URL(origin).origin || url.username || url.password || !url.pathname.startsWith(prefix)) return invalid();
    let key: string;
    try { key = decodeURIComponent(url.pathname.slice(prefix.length)); } catch { return invalid(); }
    if (!key || key.split("/").some(part => !part || part === "." || part === "..") || /[\\\x00-\x1f]/.test(key)) return invalid();
    reference = await repo.byObjectKey(key);
  } else return value;
  if (!reference || !PAGE_MEDIA_MIMES.has(reference.mimeType) ||
      (value.mediaId && value.mediaId !== reference.mediaId)) return invalid();
  if (reference.archived && operation !== "read" && operation !== "restore" &&
      !(revisionId && await repo.isRetained(reference))) return invalid();
  if (operation === "publish" && !reference.ready) {
    throw new BuilderContentValidationError("PAGE_IMAGE_NOT_READY", "This photo is still being backed up. Wait a moment, then publish again.", 409);
  }
  if (!value.alt?.trim() || value.alt.length > 500) {
    throw new BuilderContentValidationError("PAGE_IMAGE_ALT_REQUIRED", "Add a short alternative description for the photo before saving.");
  }
  return { ...value, mediaId: reference.mediaId, src: `${PAGE_MEDIA_PREFIX}${reference.revisionId}` };
}
export async function normalizePageMediaRegions(regions: Readonly<Record<string, EditableValue>>, repo: PageMediaRepository,
  origin: string, operation: "save" | "publish" | "restore" | "read") {
  const entries = await Promise.all(Object.entries(regions).map(async ([key, value]) =>
    [key, await normalizePageMediaValue(value, repo, origin, operation)] as const));
  return Object.fromEntries(entries);
}
export function privatePageMediaPreview(regions: Readonly<Record<string, EditableValue>>) {
  return Object.fromEntries(Object.entries(regions).map(([key, value]) => [key,
    value.type === "image" && pageMediaRevisionId(value.src) ? { ...value, src: `${PAGE_MEDIA_PREFIX}${pageMediaRevisionId(value.src)}?preview=1` } : value]));
}
