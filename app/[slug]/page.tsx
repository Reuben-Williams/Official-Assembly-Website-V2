import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPageBySlug, pages, siteConfig } from "../data/site";
import { PageTemplate } from "../ui/PageTemplate";

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

  return {
    title: page.navLabel,
    description: `${page.description} | ${siteConfig.officeName}`
  };
}

export default async function DynamicPage({ params }: PageProps) {
  const { slug } = await params;
  const page = getPageBySlug(slug);

  if (!page) {
    notFound();
  }

  return <PageTemplate page={page} />;
}
