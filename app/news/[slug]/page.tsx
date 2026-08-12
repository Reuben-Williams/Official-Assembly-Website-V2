import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublishedPostBySlug, publicPostHref } from "../../../lib/builder/published-posts";
import { getBuilderAdminClient } from "../../../lib/supabase/admin";
import { siteConfig } from "../../data/site";
import { readPublicLocale } from "../../i18n/server";
import { PublishedPostArticle } from "../../ui/PublishedPostArticle";

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
    robots: snapshot?.data.seo.noIndex ? { index: false, follow: false } : undefined,
  };
}

export default async function PublishedPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await publishedPost(slug);
  if (!post?.snapshot) notFound();
  return <PublishedPostArticle locale={await readPublicLocale()} post={{ ...post, snapshot: post.snapshot }} />;
}
