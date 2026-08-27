import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublishedPostBySlug, publicPostHref } from "../../../lib/builder/published-posts";
import { getBuilderAdminClient } from "../../../lib/supabase/admin";
import { siteConfig } from "../../data/site";
import { readPublicLocale } from "../../i18n/server";
import { PublishedPostArticle } from "../../ui/PublishedPostArticle";
import { approvedBrandAssets } from "../../../lib/brand/approved-assets";
import { withBrandSocialMetadata } from "../../../lib/brand/metadata";

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
  const locale = await readPublicLocale();
  const title = snapshot?.data.seo.title || post.title;
  const description = snapshot?.data.seo.description || post.excerpt || siteConfig.tagline;
  const canonicalUrl = snapshot?.data.seo.canonicalUrl || publicPostHref(post.slug);
  return withBrandSocialMetadata({
    title,
    description,
    alternates: { canonical: canonicalUrl },
    robots: snapshot?.data.seo.noIndex ? { index: false, follow: false } : undefined,
  }, { title, description, locale, canonicalUrl }, approvedBrandAssets);
}

export default async function PublishedPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await publishedPost(slug);
  if (!post?.snapshot) notFound();
  return <PublishedPostArticle locale={await readPublicLocale()} post={{ ...post, snapshot: post.snapshot }} />;
}
