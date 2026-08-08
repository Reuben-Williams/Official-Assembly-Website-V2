import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPageBySlug, pages, siteConfig } from "../data/site";
import { PageTemplate } from "../ui/PageTemplate";
import { builderText, loadBuilderServerContent } from "../../lib/builder/server-content";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return pages
    .filter((page) => page.slug)
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

  const content = await loadBuilderServerContent(page.href);

  return {
    title: builderText(content, `metadata.${slug}.title`, page.navLabel),
    description: builderText(
      content,
      `metadata.${slug}.description`,
      `${page.description} | ${siteConfig.officeName}`,
    ),
  };
}

export default async function DynamicPage({ params }: PageProps) {
  const { slug } = await params;
  const page = getPageBySlug(slug);

  if (!page) {
    notFound();
  }

  const content = await loadBuilderServerContent(page.href);
  return <PageTemplate content={content} page={page} />;
}
