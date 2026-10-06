import { communityPhotos } from "../../app/data/community-photos";

export type CarouselTransition = "none" | "fade" | "slide";
export type CarouselSeconds = 5 | 7 | 10;
export type CarouselFrame = { fit: "cover" | "contain"; x: number; y: number };
export type CarouselBlend = { top: number; bottom: number };
export type CarouselText = { title: string; caption: string; alt: string };
export type CarouselMedia = { mediaId: string; revisionId: string };
export type CarouselEntry = {
  id: string;
  media: CarouselMedia;
  en: CarouselText;
  es: CarouselText;
  desktop: CarouselFrame;
  mobile: CarouselFrame | null;
  captionSafeMobile: boolean;
  transition: CarouselTransition | null;
  seconds: CarouselSeconds | null;
  blend: CarouselBlend | null;
  zoom: boolean;
};
export type CarouselDocumentV1 = {
  schemaVersion: 1;
  key: "home-community";
  defaults: {
    transition: CarouselTransition;
    seconds: CarouselSeconds;
    speed: 350 | 700 | 1100;
    blend: CarouselBlend | null;
    /** Omitted in older immutable revisions: photo captions are hidden. */
    showCaptions?: boolean;
  };
  entries: CarouselEntry[];
};
export type CarouselImage = CarouselMedia & {
  url: string;
  width: number;
  height: number;
  ready: boolean;
  label?: string;
};
export type CarouselProjection = {
  revisionId: string;
  document: CarouselDocumentV1;
  images: CarouselImage[];
};
export const CAROUSEL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  )
    throw new TypeError("Carousel fields are invalid.");
}
function bounded(value: unknown, min: number, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new TypeError("Carousel value is outside its permitted range.");
}
function choice(value: unknown, values: readonly unknown[]) {
  if (!values.includes(value))
    throw new TypeError("Carousel setting is invalid.");
}
function frame(value: unknown) {
  record(value, ["fit", "x", "y"]);
  choice(value.fit, ["cover", "contain"]);
  bounded(value.x, 0, 100);
  bounded(value.y, 0, 100);
}
function blend(value: unknown) {
  if (value === null) return;
  record(value, ["top", "bottom"]);
  bounded(value.top, 0, 75);
  bounded(value.bottom, 30, 85);
}
function text(value: unknown) {
  record(value, ["title", "caption", "alt"]);
  for (const key of ["title", "caption", "alt"]) {
    const field = value[key];
    if (
      typeof field !== "string" ||
      field.length > (key === "title" ? 100 : 300) ||
      /[<>\u0000-\u001f\u007f]/.test(field)
    )
      throw new TypeError("Use bounded plain text for carousel descriptions.");
  }
}
export function validateCarouselDocument(
  value: unknown,
  publication = false,
): CarouselDocumentV1 {
  record(value, ["schemaVersion", "key", "defaults", "entries"]);
  choice(value.schemaVersion, [1]);
  choice(value.key, ["home-community"]);
  const defaults = value.defaults;
  const defaultKeys = ["transition", "seconds", "speed", "blend"];
  if (defaults && typeof defaults === "object" && "showCaptions" in defaults) defaultKeys.push("showCaptions");
  record(defaults, defaultKeys);
  if ("showCaptions" in defaults) choice(defaults.showCaptions, [false, true]);
  choice(defaults.transition, ["none", "fade", "slide"]);
  choice(defaults.seconds, [5, 7, 10]);
  choice(defaults.speed, [350, 700, 1100]);
  blend(defaults.blend);
  if (!Array.isArray(value.entries) || value.entries.length !== 8)
    throw new TypeError("Keep exactly eight carousel photos.");
  const ids = new Set<string>();
  for (const entry of value.entries) {
    record(entry, [
      "id",
      "media",
      "en",
      "es",
      "desktop",
      "mobile",
      "captionSafeMobile",
      "transition",
      "seconds",
      "blend",
      "zoom",
    ]);
    if (
      typeof entry.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) ||
      ids.has(entry.id)
    )
      throw new TypeError("Photo identities must be unique.");
    ids.add(entry.id);
    record(entry.media, ["mediaId", "revisionId"]);
    for (const id of Object.values(entry.media))
      if (typeof id !== "string" || !CAROUSEL_UUID.test(id))
        throw new TypeError("Select an approved media revision.");
    frame(entry.desktop);
    if (entry.mobile !== null) frame(entry.mobile);
    choice(entry.transition, [null, "none", "fade", "slide"]);
    choice(entry.seconds, [null, 5, 7, 10]);
    blend(entry.blend);
    choice(entry.zoom, [false, true]);
    choice(entry.captionSafeMobile, [false, true]);
    text(entry.en);
    text(entry.es);
    if (publication) {
      const en = entry.en as CarouselText,
        es = entry.es as CarouselText;
      if (!en.alt.trim() || !es.alt.trim())
        throw new TypeError(
          "Accessibility descriptions are required in English and Spanish.",
        );
      for (const key of ["title", "caption"] as const)
        if (Boolean(en[key].trim()) !== Boolean(es[key].trim()))
          throw new TypeError(
            "Provide optional captions in both languages, or omit both.",
          );
    }
  }
  return structuredClone(value) as CarouselDocumentV1;
}
export function createCarouselBaseline(
  media: readonly CarouselMedia[],
): CarouselDocumentV1 {
  if (media.length !== 8)
    throw new TypeError("Eight approved media revisions are required.");
  return validateCarouselDocument(
    {
      schemaVersion: 1,
      key: "home-community",
      defaults: { transition: "none", seconds: 7, speed: 700, blend: null },
      entries: communityPhotos.map((photo, index) => ({
        id: photo.id,
        media: media[index],
        en: { ...photo.en, alt: photo.en.caption },
        es: { ...photo.es, alt: photo.es.caption },
        desktop: {
          fit: photo.height > photo.width ? "contain" : "cover",
          x: 50,
          y: photo.position.includes("33%")
            ? 33
            : photo.position.includes("20%")
              ? 20
              : 50,
        },
        mobile: null,
        captionSafeMobile: "mobileFraming" in photo,
        transition: null,
        seconds: null,
        blend: null,
        zoom: false,
      })),
    },
    true,
  );
}
export function effectiveCarouselSettings(
  doc: CarouselDocumentV1,
  entry: CarouselEntry,
  device: "desktop" | "mobile",
  reduced: boolean,
) {
  return {
    frame:
      device === "mobile" ? (entry.mobile ?? entry.desktop) : entry.desktop,
    transition: reduced
      ? "none"
      : (entry.transition ?? doc.defaults.transition),
    seconds: entry.seconds ?? doc.defaults.seconds,
    speed: reduced ? 0 : doc.defaults.speed,
    blend: entry.blend ?? doc.defaults.blend,
    zoom: entry.zoom && !reduced,
  };
}
export function resetCarouselAppearance(entry: CarouselEntry): CarouselEntry {
  return {
    ...entry,
    desktop: { fit: "cover", x: 50, y: 50 },
    mobile: null,
    captionSafeMobile: false,
    transition: null,
    seconds: null,
    blend: null,
    zoom: false,
  };
}
export function replaceCarouselPhoto(
  entry: CarouselEntry,
  media: CarouselMedia,
): CarouselEntry {
  return {
    ...resetCarouselAppearance(entry),
    media: { ...media },
    en: { title: "", caption: "", alt: "" },
    es: { title: "", caption: "", alt: "" },
  };
}
export type CarouselChange = {
  category: "image" | "captions" | "order" | "appearance";
  label: string;
  before: string;
  after: string;
};
export function carouselDiff(
  before: CarouselDocumentV1,
  after: CarouselDocumentV1,
): CarouselChange[] {
  const changes: CarouselChange[] = [];
  const add = (
    category: CarouselChange["category"],
    label: string,
    left: unknown,
    right: unknown,
  ) => {
    if (JSON.stringify(left) !== JSON.stringify(right))
      changes.push({
        category,
        label,
        before: JSON.stringify(left),
        after: JSON.stringify(right),
      });
  };
  add(
    "order",
    "Photo order",
    before.entries.map((e) => e.id),
    after.entries.map((e) => e.id),
  );
  add("appearance", "Whole carousel", before.defaults, after.defaults);
  for (const entry of after.entries) {
    const prior = before.entries.find((e) => e.id === entry.id);
    if (!prior) throw new TypeError("Photo identity changed.");
    add("image", entry.id, prior.media, entry.media);
    add(
      "captions",
      entry.id,
      { en: prior.en, es: prior.es },
      { en: entry.en, es: entry.es },
    );
    const appearance = ({
      desktop,
      mobile,
      transition,
      seconds,
      blend,
      zoom,
      captionSafeMobile,
    }: CarouselEntry) => ({
      desktop,
      mobile,
      transition,
      seconds,
      blend,
      zoom,
      captionSafeMobile,
    });
    add("appearance", entry.id, appearance(prior), appearance(entry));
  }
  return changes;
}
export const canEditCarousel = (role: string) =>
  ["owner", "editor", "contributor"].includes(role);
export const canPublishCarousel = (role: string) =>
  ["owner", "editor"].includes(role);
