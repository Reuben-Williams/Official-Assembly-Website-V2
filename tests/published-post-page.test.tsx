import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublishedPost } from "@reuben-williams/content";

import { PublishedPostArticle } from "../app/ui/PublishedPostArticle";

const post: PublishedPost & { snapshot: NonNullable<PublishedPost["snapshot"]> } = {
  entryId: "11111111-1111-4111-8111-111111111111",
  versionId: "22222222-2222-4222-8222-222222222222",
  slug: "district-update",
  title: "District update",
  excerpt: "A live update from the district office.",
  categoryKeys: [],
  tagKeys: [],
  displayDate: "2026-08-05T20:00:00.000Z",
  versionPublishedAt: "2026-08-05T20:00:00.000Z",
  expiresAt: null,
  featured: false,
  pinned: false,
  snapshot: {
    slug: "district-update",
    data: {
      title: "District update",
      excerpt: "A live update from the district office.",
      body: { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Post body" }] }] },
      featuredImage: null,
      author: { key: null, name: "Office staff" },
      featured: false,
      pinned: false,
      seo: { title: "District update", description: "", canonicalUrl: null, socialImage: null, noIndex: false },
    },
    taxonomyKeys: { categories: [], tags: [] },
    taxonomySnapshot: {},
    displayDate: "2026-08-05T20:00:00.000Z",
    expiresAt: null,
  },
};

describe("published post detail", () => {
  it("localizes its Spanish shell while preserving the exact resolved post revision", () => {
    const html = renderToStaticMarkup(<PublishedPostArticle locale="es" post={post} />);

    expect(html).toContain("Volver a Noticias");
    expect(html).toContain("Novedad del distrito");
    expect(html).toContain("5 de agosto de 2026");
    expect(html).toContain("District update");
    expect(html).toContain("Post body");
    expect(html).not.toContain("Back to News");
    expect(html).not.toContain("Â·");
  });
});
