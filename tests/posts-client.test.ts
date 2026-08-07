import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpPostsClient, listLinkablePosts } from "../lib/builder/posts-client";

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

  it("loads only linkable posts and refreshes them after a post transition", async () => {
    const linkable = [{
      id: "11111111-1111-4111-8111-111111111111",
      title: "District update",
      href: "/news/district-update",
      status: "published",
      expiresAt: null
    }];
    const post = {
      entryId: linkable[0].id,
      draftVersionId: "draft-1",
      publishedVersionId: "published-1",
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
      status: "published"
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => new Response(
      JSON.stringify(String(url).includes("scope=linkable") ? linkable : post),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);
    const onLinkablePostsChanged = vi.fn();
    const options = {
      baseUrl: "/api/builder/posts",
      getCsrfToken: () => "csrf-token",
      onLinkablePostsChanged
    };

    await expect(listLinkablePosts(options)).resolves.toEqual(linkable);
    await createHttpPostsClient(options).publishPost(linkable[0].id);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/builder/posts?scope=linkable",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" })
    );
    expect(onLinkablePostsChanged).toHaveBeenCalledWith(linkable);
  });

  it("keeps a successful post transition successful when the secondary linkable refresh fails", async () => {
    const post = {
      entryId: "11111111-1111-4111-8111-111111111111",
      draftVersionId: "draft-1",
      publishedVersionId: "published-1",
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
      status: "published"
    };
    const fetchMock = vi.fn(async () => fetchMock.mock.calls.length === 1
      ? new Response(JSON.stringify(post), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ error: { message: "Linkable posts could not be refreshed." } }), {
        status: 503,
        headers: { "content-type": "application/json" }
      }));
    vi.stubGlobal("fetch", fetchMock);
    const onLinkablePostsRefreshError = vi.fn();
    const client = createHttpPostsClient({
      baseUrl: "/api/builder/posts",
      getCsrfToken: () => "csrf-token",
      onLinkablePostsChanged: vi.fn(),
      onLinkablePostsRefreshError
    });

    await expect(client.publishPost(post.entryId)).resolves.toEqual(post);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onLinkablePostsRefreshError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Linkable posts could not be refreshed." })
    );
  });
});
