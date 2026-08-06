import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getPublishedPostBySlug, publicPostHref } from "../../../lib/builder/published-posts";
import { getBuilderAdminClient } from "../../../lib/supabase/admin";
import { siteConfig } from "../../data/site";
import { PostBody } from "../../ui/PostBody";

type PageProps = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function publishedPost(slug: string) {
  const client = getBuilderAdminClient();
  if (!client) return null;
  return getPublishedPostBySlug(client, slug);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await publishedPost(slug);
  if (!post) return {};
  const snapshot = post.snapshot;
  return {
    title: snapshot?.data.seo.title || post.title,
    description: snapshot?.data.seo.description || post.excerpt || siteConfig.tagline,
    alternates: { canonical: snapshot?.data.seo.canonicalUrl || publicPostHref(post.slug) },
    robots: snapshot?.data.seo.noIndex ? { index: false, follow: false } : undefined
  };
}

export default async function PublishedPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await publishedPost(slug);
  if (!post?.snapshot) notFound();
  const snapshot = post.snapshot;
  const date = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York"
  }).format(new Date(post.displayDate));

  return (
    <article className="published-post">
      <header className="published-post-header">
        <div className="container published-post-heading">
          <Link className="secondary-link" href="/news">Back to News</Link>
          <p className="eyebrow">District Update</p>
          <h1>{post.title}</h1>
          {post.excerpt ? <p className="lead">{post.excerpt}</p> : null}
          <p className="published-post-byline">{snapshot.data.author.name} · {date}</p>
        </div>
      </header>
      <div className="container published-post-content">
        <PostBody document={snapshot.data.body} />
      </div>
    </article>
  );
}
