import { describe, expect, it } from "vitest";
import { communityPhotos } from "../app/data/community-photos";
import {
  createCarouselBaseline,
  validateCarouselDocument,
  effectiveCarouselSettings,
  replaceCarouselPhoto,
  resetCarouselAppearance,
  carouselDiff,
  canEditCarousel,
  canPublishCarousel,
} from "../lib/carousel/contract";

const refs = communityPhotos.map((_, index) => ({
  mediaId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  revisionId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
}));
const baseline = () => createCarouselBaseline(refs);
describe("carousel document", () => {
  it("accepts an optional boolean caption visibility setting without changing legacy revisions", () => {
    const legacy = baseline();
    expect(validateCarouselDocument(legacy)).toEqual(legacy);
    const visible = { ...legacy, defaults: { ...legacy.defaults, showCaptions: true } };
    expect(validateCarouselDocument(visible).defaults).toMatchObject({ showCaptions: true });
    expect(() => validateCarouselDocument({ ...legacy, defaults: { ...legacy.defaults, showCaptions: "yes" } })).toThrow();
    expect(carouselDiff(legacy, visible)).toEqual(expect.arrayContaining([expect.objectContaining({ category: "appearance" })]));
  });
  it("seeds exactly the approved eight images and original still/no-transition appearance", () => {
    const doc = validateCarouselDocument(baseline(), true);
    expect(doc.entries.map((entry) => entry.id)).toEqual(
      communityPhotos.map((photo) => photo.id),
    );
    expect(doc.defaults).toEqual({
      transition: "none",
      seconds: 7,
      speed: 700,
      blend: null,
    });
    expect(doc.entries[3].desktop.fit).toBe("contain");
    expect(doc.entries[0].captionSafeMobile).toBe(true);
    expect(doc.entries[2].desktop.y).toBe(20);
  });
  it.each([
    "extra",
    "length",
    "duplicate",
    "enum",
    "nonfinite",
    "bound",
    "url",
    "nestedExtra",
  ])("rejects invalid %s", (kind) => {
    const doc: any = baseline();
    if (kind === "extra") doc.extra = true;
    if (kind === "length") doc.entries.pop();
    if (kind === "duplicate") doc.entries[1].id = doc.entries[0].id;
    if (kind === "enum") doc.defaults.transition = "spin";
    if (kind === "nonfinite") doc.entries[0].desktop.x = NaN;
    if (kind === "bound") doc.entries[0].blend = { top: 76, bottom: 50 };
    if (kind === "url") doc.entries[0].media.src = "https://unknown.test/photo";
    if (kind === "nestedExtra") doc.entries[0].en.unknown = "text";
    expect(() => validateCarouselDocument(doc)).toThrow();
  });
  it("allows incomplete drafts but requires bilingual plain text for publication", () => {
    const doc = baseline();
    doc.entries[0].es.alt = "";
    expect(() => validateCarouselDocument(doc)).not.toThrow();
    expect(() => validateCarouselDocument(doc, true)).toThrow(/accessibility/i);
    doc.entries[0].es.alt = "Descripción";
    doc.entries[0].es.title = "";
    expect(() => validateCarouselDocument(doc, true)).toThrow(
      /both languages/i,
    );
    doc.entries[0].en.title = "<script>";
    expect(() => validateCarouselDocument(doc)).toThrow(/plain text/i);
  });
  it("resolves inheritance without modifying explicit overrides", () => {
    const doc = baseline();
    doc.defaults.seconds = 10;
    doc.entries[0].seconds = 5;
    expect(
      effectiveCarouselSettings(doc, doc.entries[0], "mobile", false).seconds,
    ).toBe(5);
    expect(
      effectiveCarouselSettings(doc, doc.entries[1], "mobile", false).seconds,
    ).toBe(10);
    doc.entries[0].mobile = { fit: "cover", x: 25, y: 35 };
    doc.entries[0].zoom = true;
    expect(
      effectiveCarouselSettings(doc, doc.entries[0], "mobile", true),
    ).toMatchObject({
      frame: { x: 25, y: 35 },
      zoom: false,
      transition: "none",
    });
  });
  it("clears old bilingual descriptions on replacement but preserves stable entry identity", () => {
    const entry = replaceCarouselPhoto(baseline().entries[0], refs[3]);
    expect(entry.id).toBe("parade-group");
    expect(entry.en).toEqual({ title: "", caption: "", alt: "" });
    expect(entry.es).toEqual(entry.en);
  });
  it("starts replacements centered and uncropped on desktop and inherited mobile without changing the prior entry", () => {
    const prior = baseline().entries[0];
    prior.mobile = { fit: "cover", x: 12, y: 20 };
    const snapshot = structuredClone(prior);
    const next = replaceCarouselPhoto(prior, refs[3]);
    expect(next.desktop).toEqual({ fit: "contain", x: 50, y: 50 });
    expect(next.mobile).toBeNull();
    expect(effectiveCarouselSettings(baseline(), next, "mobile", false).frame.fit).toBe("contain");
    expect(prior).toEqual(snapshot);
  });
  it("reset changes appearance only", () => {
    const entry = baseline().entries[0];
    entry.zoom = true;
    entry.seconds = 10;
    const reset = resetCarouselAppearance(entry);
    expect(reset.media).toEqual(entry.media);
    expect(reset.en).toEqual(entry.en);
    expect(reset.id).toBe(entry.id);
    expect(reset.zoom).toBe(false);
    expect(reset.seconds).toBe(null);
  });
  it("reports stable order, image, caption and appearance changes", () => {
    const before = baseline(),
      after = baseline();
    [after.entries[0], after.entries[1]] = [after.entries[1], after.entries[0]];
    after.entries[0].en.caption = "New description";
    after.entries[2].zoom = true;
    after.entries[3].media = refs[4];
    expect(
      carouselDiff(before, after).map((change) => change.category),
    ).toEqual(
      expect.arrayContaining(["order", "captions", "appearance", "image"]),
    );
  });
  it.each([
    ["owner", true, true],
    ["editor", true, true],
    ["contributor", true, false],
    ["viewer", false, false],
    ["unknown", false, false],
  ])("enforces %s permissions", (role, edit, publish) => {
    expect(canEditCarousel(String(role))).toBe(edit);
    expect(canPublishCarousel(String(role))).toBe(publish);
  });
});
