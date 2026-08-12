import type { EditablePostDraft } from "@reuben-williams/editor";

type PostSnapshot = {
  slug: string;
  displayTimeZone: string;
  data: {
    title: string;
    excerpt: string;
    body: EditablePostDraft["body"];
    featuredImage:
      | { kind: "managed"; mediaId: string; revisionId: string; alt: string }
      | { kind: "static"; src: string; alt: string }
      | null;
    author: { key: string | null; name: string };
    featured: boolean;
    pinned: boolean;
    seo: {
      title: string;
      description: string;
      canonicalUrl: string | null;
      socialImage: null;
      noIndex: boolean;
    };
  };
  taxonomyKeys: { categories: string[]; tags: string[] };
  taxonomySnapshot: Record<string, { label: string; slug: string }>;
  displayDate: string;
  expiresAt: string | null;
};

type PostEntryRow = {
  id: unknown;
  status: unknown;
  active_draft_version_id: unknown;
  active_published_version_id: unknown;
};

type PostVersionRow = { snapshot: unknown };

export type PostValidationStage = "draft" | "publish";
export type PostValidationField = "title" | "body" | "featuredImageAlt";
export type PostValidationError = { field: PostValidationField; message: string };
export type DefaultedPostDraft = EditablePostDraft & { displayTimeZone: string };

export const DEFAULT_POST_TIME_ZONE = "America/New_York";

function richTextValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(richTextValue).join(" ");
  if (!value || typeof value !== "object") return "";
  const node = value as Record<string, unknown>;
  return [node.text, node.content].map(richTextValue).join(" ");
}

function filenameOnly(value: string) {
  return /^[^/\\]+\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(value.trim());
}

export function validateEditablePostForStage(
  draft: EditablePostDraft,
  stage: PostValidationStage
): PostValidationError[] {
  const errors: PostValidationError[] = [];
  if (!draft.title.trim()) {
    errors.push({ field: "title", message: "Enter a post title before saving the draft." });
  }
  if (stage === "publish" && !richTextValue(draft.body).trim()) {
    errors.push({ field: "body", message: "Add post body text before publishing." });
  }
  if (stage === "publish" && draft.featuredImage) {
    const alt = draft.featuredImage.alt.trim();
    if (!alt) {
      errors.push({ field: "featuredImageAlt", message: "Add descriptive image alt text before publishing." });
    } else if (filenameOnly(alt)) {
      errors.push({ field: "featuredImageAlt", message: "Describe the image instead of using its filename." });
    }
  }
  return errors;
}

export function postSlugFromTitle(title: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "post";
}

export function applyPostDefaults(
  draft: EditablePostDraft,
  defaults: { authorName: string; now: string; timeZone?: string }
): DefaultedPostDraft {
  const errors = validateEditablePostForStage(draft, "draft");
  if (errors[0]) throw new TypeError(errors[0].message);
  const title = draft.title.trim();
  const slug = draft.slug.trim() || postSlugFromTitle(title);
  const authorName = draft.authorName.trim() || defaults.authorName.trim();
  const displayDate = draft.displayDate.trim() || defaults.now;
  if (!authorName) throw new TypeError("A post author could not be determined.");
  if (!Number.isFinite(Date.parse(displayDate))) throw new TypeError("The display date is invalid.");
  return {
    ...draft,
    title,
    slug,
    authorName,
    displayDate: new Date(displayDate).toISOString(),
    displayTimeZone: defaults.timeZone ?? DEFAULT_POST_TIME_ZONE
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid.`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return string(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} is invalid.`);
  return value;
}

export function parseEditablePostDraft(value: unknown): EditablePostDraft {
  const draft = object(value, "Post draft");
  const body = object(draft.body, "Post body") as EditablePostDraft["body"];
  const featuredImage = draft.featuredImage === null ? null : object(draft.featuredImage, "Featured image") as EditablePostDraft["featuredImage"];
  const status = draft.status;
  if (status !== undefined && !["draft", "scheduled", "published", "archived"].includes(String(status))) {
    throw new TypeError("Post status is invalid.");
  }
  return {
    entryId: nullableString(draft.entryId, "Entry ID"),
    draftVersionId: nullableString(draft.draftVersionId, "Draft version ID"),
    publishedVersionId: nullableString(draft.publishedVersionId, "Published version ID"),
    title: string(draft.title, "Title"),
    slug: string(draft.slug, "Slug"),
    excerpt: string(draft.excerpt, "Excerpt"),
    body,
    featuredImage,
    authorName: string(draft.authorName, "Author"),
    authorKey: nullableString(draft.authorKey, "Author key"),
    categoryKeys: strings(draft.categoryKeys, "Categories"),
    tagKeys: strings(draft.tagKeys, "Tags"),
    displayDate: string(draft.displayDate, "Display date"),
    expiresAt: nullableString(draft.expiresAt, "Expiry date"),
    featured: boolean(draft.featured, "Featured"),
    pinned: boolean(draft.pinned, "Pinned"),
    seoTitle: string(draft.seoTitle, "SEO title"),
    seoDescription: string(draft.seoDescription, "SEO description"),
    canonicalUrl: nullableString(draft.canonicalUrl, "Canonical URL"),
    noIndex: boolean(draft.noIndex, "Search visibility"),
    ...(status ? { status: status as EditablePostDraft["status"] } : {})
  };
}

function mediaReference(value: EditablePostDraft["featuredImage"]): PostSnapshot["data"]["featuredImage"] {
  if (!value) return null;
  if (value.kind === "managed") {
    return { kind: "managed", mediaId: value.mediaId, revisionId: value.revisionId, alt: value.alt };
  }
  return { kind: "static", src: value.src, alt: value.alt };
}

export function editablePostToSnapshot(
  draft: EditablePostDraft & { displayTimeZone?: string },
  taxonomySnapshot: PostSnapshot["taxonomySnapshot"] = {}
): PostSnapshot {
  const validation = validateEditablePostForStage(draft, "draft");
  if (validation[0]) throw new TypeError(validation[0].message);
  const title = draft.title.trim();
  const slug = draft.slug.trim();
  const authorName = draft.authorName.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new TypeError("The post slug must use lowercase letters, numbers, and hyphens.");
  }
  if (!authorName) throw new TypeError("A post author is required.");
  if (!Number.isFinite(Date.parse(draft.displayDate))) throw new TypeError("A valid display date is required.");
  if (draft.expiresAt && !Number.isFinite(Date.parse(draft.expiresAt))) throw new TypeError("The expiry date is invalid.");
  if (draft.canonicalUrl) new URL(draft.canonicalUrl);

  return {
    slug,
    displayTimeZone: draft.displayTimeZone ?? DEFAULT_POST_TIME_ZONE,
    data: {
      title,
      excerpt: draft.excerpt,
      body: draft.body,
      featuredImage: mediaReference(draft.featuredImage),
      author: { key: draft.authorKey, name: authorName },
      featured: draft.featured,
      pinned: draft.pinned,
      seo: {
        title: draft.seoTitle.trim() || title,
        description: draft.seoDescription,
        canonicalUrl: draft.canonicalUrl,
        socialImage: null,
        noIndex: draft.noIndex
      }
    },
    taxonomyKeys: {
      categories: [...draft.categoryKeys],
      tags: [...draft.tagKeys]
    },
    taxonomySnapshot,
    displayDate: new Date(draft.displayDate).toISOString(),
    expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null
  };
}

export function postRecordToEditableDraft(input: {
  entry: PostEntryRow;
  version: PostVersionRow;
}): EditablePostDraft {
  const snapshot = object(input.version.snapshot, "Post snapshot") as unknown as PostSnapshot;
  const data = object(snapshot.data, "Post data") as unknown as PostSnapshot["data"];
  const taxonomyKeys = object(snapshot.taxonomyKeys, "Post taxonomies") as unknown as PostSnapshot["taxonomyKeys"];
  return {
    entryId: String(input.entry.id),
    draftVersionId: input.entry.active_draft_version_id ? String(input.entry.active_draft_version_id) : null,
    publishedVersionId: input.entry.active_published_version_id ? String(input.entry.active_published_version_id) : null,
    title: String(data.title ?? ""),
    slug: String(snapshot.slug ?? ""),
    excerpt: String(data.excerpt ?? ""),
    body: data.body,
    featuredImage: data.featuredImage ?? null,
    authorName: String(data.author?.name ?? ""),
    authorKey: data.author?.key ?? null,
    categoryKeys: Array.isArray(taxonomyKeys.categories) ? taxonomyKeys.categories.map(String) : [],
    tagKeys: Array.isArray(taxonomyKeys.tags) ? taxonomyKeys.tags.map(String) : [],
    displayDate: String(snapshot.displayDate),
    expiresAt: snapshot.expiresAt ?? null,
    featured: Boolean(data.featured),
    pinned: Boolean(data.pinned),
    seoTitle: String(data.seo?.title ?? data.title ?? ""),
    seoDescription: String(data.seo?.description ?? ""),
    canonicalUrl: data.seo?.canonicalUrl ?? null,
    noIndex: Boolean(data.seo?.noIndex),
    status: input.entry.status as EditablePostDraft["status"]
  };
}
