import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PostBody } from "../app/ui/PostBody";
import { PublishedPostList } from "../app/ui/PublishedPosts";
import {
  HOMEPAGE_PUBLISHED_QUERY,
  publicPostHref,
  toLinkablePosts,
} from "../lib/builder/published-posts";

describe("live published posts", () => {
  it("uses the bounded chronological homepage collection without pinning", () => {
    expect(HOMEPAGE_PUBLISHED_QUERY).toEqual({
      categoryKeys: [],
      tagKeys: [],
      entryIds: [],
      featuredOnly: false,
      pinnedFirst: false,
      limit: 3,
      orderBy: "displayDate",
      orderDirection: "desc",
    });
  });

  it("maps only database-approved published rows to canonical editor targets", () => {
    expect(toLinkablePosts([{
      entryId: "11111111-1111-4111-8111-111111111111",
      slug: "district-update",
      title: "District update",
      expiresAt: null
    }])).toEqual([{
      id: "11111111-1111-4111-8111-111111111111",
      title: "District update",
      href: "/news/district-update",
      status: "published",
      expiresAt: null
    }]);
    expect(publicPostHref("district-update")).toBe("/news/district-update");
    expect(() => publicPostHref("../draft")).toThrow(/slug/i);
  });

  it("renders validated structured post content without raw HTML injection", () => {
    const html = renderToStaticMarkup(<PostBody document={{
      version: 1,
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "Read the update",
          marks: [{ type: "link", attrs: { href: "https://example.gov/update", target: "_blank" } }]
        }]
      }]
    }} />);
    expect(html).toContain("Read the update");
    expect(html).toContain('href="https://example.gov/update"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("dangerouslySetInnerHTML");
    expect(() => renderToStaticMarkup(<PostBody document={{
      version: 1, type: "doc", content: [{ type: "html", value: "<script>bad()</script>" }]
    }} />)).toThrow(/unsupported/i);
  });

  it("renders real published post links and an honest zero-post state", () => {
    const html = renderToStaticMarkup(<PublishedPostList locale="es" posts={[{
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
      pinned: false
    }]} />);
    expect(html).toContain('href="/news/district-update"');
    expect(html).toContain("A live update from the district office.");
    expect(html).toContain("Leer novedad");

    const empty = renderToStaticMarkup(<PublishedPostList locale="es" posts={[]} />);
    expect(empty).toContain("A\u00fan no se han publicado novedades del distrito");
    expect(empty).not.toContain("placeholder");
  });
});
