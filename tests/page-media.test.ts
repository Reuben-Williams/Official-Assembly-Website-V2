import type { EditableValue } from "@reuben-williams/core";
import { describe, expect, it, vi } from "vitest";
import { normalizePageMediaValue, pageMediaRevisionId, type PageMediaRepository } from "../lib/builder/page-media";

const mediaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const revisionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const origin = "https://rriebibkxymeqhafssvw.supabase.co";
const objectKey = "site/import-object-id/object-revision-id.jpg";
const canonical = `/api/builder/media/${revisionId}`;
const reference = { mediaId, revisionId, objectKey, mimeType: "image/jpeg", byteSize: 123, ready: true, archived: false };
function repository(overrides: Partial<PageMediaRepository> = {}): PageMediaRepository {
  return { byRevision: async id => id === revisionId ? reference : null,
    byObjectKey: async key => key === objectKey ? reference : null,
    isRetained: async () => false, ...overrides };
}
const image = (src: string): EditableValue => ({ type: "image", src, alt: "Morales with community residents", link: { href: "/news" } });

describe("permanent page media references", () => {
  it("replaces expired preview links with the exact canonical revision without reading a token", async () => {
    const repo = repository();
    const lookup = vi.spyOn(repo, "byObjectKey");
    expect(await normalizePageMediaValue(image(`${origin}/storage/v1/object/sign/builder-media/${objectKey}?token=expired-test-token`), repo, origin, "publish"))
      .toEqual({ ...image(canonical), mediaId });
    expect(lookup).toHaveBeenCalledWith(objectKey);
  });
  it("keeps static images and text unchanged", async () => {
    const text = { type: "text" as const, value: "District office" };
    expect(await normalizePageMediaValue(text, repository(), origin, "save")).toEqual(text);
    expect(await normalizePageMediaValue(image("/images/approved.webp"), repository(), origin, "save")).toEqual(image("/images/approved.webp"));
  });
  it("canonicalizes a private preview reference without persisting its delivery flag", async () => {
    expect(await normalizePageMediaValue(image(`${canonical}?preview=1`), repository(), origin, "save")).toMatchObject({ src: canonical, mediaId });
    expect(pageMediaRevisionId(canonical)).toBe(revisionId);
  });
  it("rejects cross-origin storage URLs, malformed routes, and unknown assets", async () => {
    for (const src of [`https://elsewhere.test/storage/v1/object/sign/builder-media/${objectKey}`, "/api/builder/media/nope", `/api/builder/media/cccccccc-cccc-4ccc-8ccc-cccccccccccc`]) {
      await expect(normalizePageMediaValue(image(src), repository(), origin, "save")).rejects.toMatchObject({ code: "PAGE_IMAGE_INVALID" });
    }
  });
  it("rejects a media/revision mismatch", async () => {
    await expect(normalizePageMediaValue({ ...image(canonical), mediaId: "wrong" } as EditableValue, repository(), origin, "save")).rejects.toMatchObject({ code: "PAGE_IMAGE_INVALID" });
  });
  it("allows a pending image to be saved but prevents publication until its backup is ready", async () => {
    const repo = repository({ byRevision: async () => ({ ...reference, ready: false }) });
    await expect(normalizePageMediaValue(image(canonical), repo, origin, "save")).resolves.toMatchObject({ src: canonical });
    await expect(normalizePageMediaValue(image(canonical), repo, origin, "publish")).rejects.toMatchObject({ code: "PAGE_IMAGE_NOT_READY" });
  });
  it("rejects a newly selected archived asset but permits a verified historical restore", async () => {
    const repo = repository({ byRevision: async () => ({ ...reference, archived: true }) });
    await expect(normalizePageMediaValue(image(canonical), repo, origin, "save")).rejects.toMatchObject({ code: "PAGE_IMAGE_INVALID" });
    await expect(normalizePageMediaValue(image(canonical), repo, origin, "restore")).resolves.toMatchObject({ src: canonical });
  });
  it("requires accessible alt text and an allowed raster MIME type", async () => {
    await expect(normalizePageMediaValue({ type: "image", src: canonical, alt: "" }, repository(), origin, "save")).rejects.toMatchObject({ code: "PAGE_IMAGE_ALT_REQUIRED" });
    await expect(normalizePageMediaValue(image(canonical), repository({ byRevision: async () => ({ ...reference, mimeType: "image/svg+xml" }) }), origin, "save")).rejects.toMatchObject({ code: "PAGE_IMAGE_INVALID" });
  });
});
