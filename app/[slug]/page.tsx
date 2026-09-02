import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPageBySlug, pages, siteConfig } from "../data/site";
import { PageTemplate } from "../ui/PageTemplate";
import { builderText, loadBuilderServerContent } from "../../lib/builder/server-content";
import { localizedBuilderText } from "../i18n/catalog.server";
import { readPublicLocale } from "../i18n/server";
import { approvedBrandAssets } from "../../lib/brand/approved-assets";
import { withBrandSocialMetadata } from "../../lib/brand/metadata";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return pages
    .filter((page) => page.slug && page.slug !== "events")
    .map((page) => ({
      slug: page.slug
    }));
}

export async function generateMetadata({
  params
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getPageBySlug(slug);

  if (!page) {
    return {};
  }

  const [content, locale] = await Promise.all([loadBuilderServerContent(page.href), readPublicLocale()]);

  const title = localizedBuilderText(locale, `metadata.${slug}.title`, builderText(content, `metadata.${slug}.title`, page.navLabel));
  const description = localizedBuilderText(locale, `metadata.${slug}.description`, builderText(
    content, `metadata.${slug}.description`, `${page.description} | ${siteConfig.officeName}`,
  ));
  return withBrandSocialMetadata({ title, description }, {
    title,
    description,
    locale,
    canonicalUrl: new URL(page.href, process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").toString(),
  }, approvedBrandAssets);
}

export default async function DynamicPage({ params }: PageProps) {
  const { slug } = await params;
  const page = getPageBySlug(slug);

  if (!page) {
    notFound();
  }

  const [content, locale] = await Promise.all([loadBuilderServerContent(page.href), readPublicLocale()]);
  return <PageTemplate content={content} locale={locale} page={page} />;
}
