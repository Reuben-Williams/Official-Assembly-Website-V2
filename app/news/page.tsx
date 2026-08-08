import type { Metadata } from "next";

import { listPublishedPosts } from "../../lib/builder/published-posts";
import { getBuilderAdminClient } from "../../lib/supabase/admin";
import { getPageBySlug, siteConfig } from "../data/site";
import { PageTemplate } from "../ui/PageTemplate";
import { NewsletterSignupSection } from "../ui/NewsletterSignupSection";
import { PublishedPostList } from "../ui/PublishedPosts";
import { builderText, loadBuilderServerContent } from "../../lib/builder/server-content";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const content = await loadBuilderServerContent("/news");
  return {
    title: builderText(content, "metadata.news.title", "News & Updates"),
    description: builderText(
      content,
      "metadata.news.description",
      `Published legislative and district updates from ${siteConfig.officeName}.`,
    ),
  };
}

export default async function NewsPage() {
  const page = getPageBySlug("news");
  if (!page) throw new Error("The News page configuration is missing.");
  const client = getBuilderAdminClient();
  const posts = client ? await listPublishedPosts(client) : [];
  const content = await loadBuilderServerContent("/news");
  const newsletterSignup = await NewsletterSignupSection({
    content,
    regions: {
      eyebrow: "news.newsletter.eyebrow",
      title: "news.newsletter.title",
      body: "news.newsletter.body",
      form: "news.newsletter.form"
    },
    fallback: {
      eyebrow: "Email Updates",
      title: "Get News & Updates by email",
      body: "Request the District Newsletter and confirm through the email sent to your inbox before the subscription becomes active."
    },
    showDedicatedPageLink: true
  });

  return (
    <>
      <PageTemplate content={content} page={page} />
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
      {newsletterSignup}
    </>
  );
}
