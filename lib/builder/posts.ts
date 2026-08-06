import type { EditablePostDraft } from "@reuben-williams/editor";

type PostSnapshot = {
  slug: string;
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
  draft: EditablePostDraft,
  taxonomySnapshot: PostSnapshot["taxonomySnapshot"] = {}
): PostSnapshot {
  const title = draft.title.trim();
  const slug = draft.slug.trim();
  const authorName = draft.authorName.trim();
  if (!title) throw new TypeError("A post title is required.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new TypeError("The post slug must use lowercase letters, numbers, and hyphens.");
  }
  if (!authorName) throw new TypeError("A post author is required.");
  if (!Number.isFinite(Date.parse(draft.displayDate))) throw new TypeError("A valid display date is required.");
  if (draft.expiresAt && !Number.isFinite(Date.parse(draft.expiresAt))) throw new TypeError("The expiry date is invalid.");
  if (draft.canonicalUrl) new URL(draft.canonicalUrl);

  return {
    slug,
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
