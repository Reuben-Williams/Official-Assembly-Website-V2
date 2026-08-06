import {
  createSupabaseContentRepository
} from "@reuben-williams/core";
import type { PublishedPost } from "@reuben-williams/content";
import type { LinkablePost } from "@reuben-williams/editor";
import type { SupabaseClient } from "@supabase/supabase-js";

import { BUILDER_SITE_KEY } from "./authorization";

const publishedQuery = {
  categoryKeys: [],
  tagKeys: [],
  entryIds: [],
  featuredOnly: false,
  pinnedFirst: true,
  limit: 100,
  orderBy: "displayDate" as const,
  orderDirection: "desc" as const
};

export function publicPostHref(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new TypeError("A valid post slug is required.");
  return `/news/${slug}`;
}

export function toLinkablePosts(
  posts: readonly Pick<PublishedPost, "entryId" | "slug" | "title" | "expiresAt">[]
): LinkablePost[] {
  return posts.map((post) => ({
    id: post.entryId,
    title: post.title,
    href: publicPostHref(post.slug),
    status: "published",
    expiresAt: post.expiresAt
  }));
}

export async function listPublishedPosts(client: SupabaseClient): Promise<PublishedPost[]> {
  return createSupabaseContentRepository(client).listPublishedPosts(BUILDER_SITE_KEY, publishedQuery);
}

export async function getPublishedPostBySlug(client: SupabaseClient, slug: string): Promise<PublishedPost | null> {
  publicPostHref(slug);
  return createSupabaseContentRepository(client).getPublishedPostBySlug(BUILDER_SITE_KEY, slug);
}
