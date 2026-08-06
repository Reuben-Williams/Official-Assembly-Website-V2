import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpPostsClient } from "../lib/builder/posts-client";

describe("live posts HTTP client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the authenticated posts API and sends CSRF protection on mutations", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      entryId: "post-1",
      draftVersionId: "draft-1",
      publishedVersionId: null,
      title: "District update",
      slug: "district-update",
      excerpt: "",
      body: { version: 1, type: "doc", content: [] },
      featuredImage: null,
      authorName: "Office staff",
      authorKey: null,
      categoryKeys: [],
      tagKeys: [],
      displayDate: "2026-08-05T20:00:00.000Z",
      expiresAt: null,
      featured: false,
      pinned: false,
      seoTitle: "District update",
      seoDescription: "",
      canonicalUrl: null,
      noIndex: false,
      status: "draft"
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHttpPostsClient({ baseUrl: "/api/builder/posts", getCsrfToken: () => "csrf-token" });

    await client.publishPost("post-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/builder/posts/post-1/publish",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-builder-csrf": "csrf-token"
        })
      })
    );
  });
});
