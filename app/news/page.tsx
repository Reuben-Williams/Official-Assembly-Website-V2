import type { Metadata } from "next";

import { listPublishedPosts } from "../../lib/builder/published-posts";
import { getBuilderAdminClient } from "../../lib/supabase/admin";
import { getPageBySlug, siteConfig } from "../data/site";
import { PageTemplate } from "../ui/PageTemplate";
import { PublishedPostList } from "../ui/PublishedPosts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "News",
  description: `Published legislative and district updates from ${siteConfig.officeName}.`
};

export default async function NewsPage() {
  const page = getPageBySlug("news");
  if (!page) throw new Error("The News page configuration is missing.");
  const client = getBuilderAdminClient();
  const posts = client ? await listPublishedPosts(client) : [];

  return (
    <>
      <PageTemplate page={page} />
      <section className="section news-feed" aria-labelledby="district-updates-title">
        <div className="container">
          <div className="section-heading">
            <div>
              <p className="eyebrow">District Office</p>
              <h2 id="district-updates-title">Published updates</h2>
            </div>
            <p>Posts published by authorized office staff appear here.</p>
          </div>
          <PublishedPostList posts={posts} />
        </div>
      </section>
    </>
  );
}
