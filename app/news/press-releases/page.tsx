import type { Metadata } from "next";
import Link from "next/link";
import { listPublishedPressReleases } from "../../../lib/builder/published-posts";
import { getBuilderAdminClient } from "../../../lib/supabase/admin";
import { readPublicLocale } from "../../i18n/server";
import { PublishedPostList } from "../../ui/PublishedPosts";
import { approvedBrandAssets } from "../../../lib/brand/approved-assets";
import { withBrandSocialMetadata } from "../../../lib/brand/metadata";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await readPublicLocale();
  const title = locale === "es" ? "Comunicados de prensa" : "Press Releases";
  const description = locale === "es" ? "Comunicados publicados por la oficina de la asambleísta Carmen Theresa Morales." : "Press releases published by the Office of Assemblywoman Carmen Theresa Morales.";
  const canonicalUrl = new URL("/news/press-releases", process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").toString();
  return withBrandSocialMetadata({ title, description, alternates: { canonical: canonicalUrl } }, { title, description, locale,
    canonicalUrl,
  }, approvedBrandAssets);
}

export default async function PressReleasesPage() {
  const locale = await readPublicLocale();
  const es = locale === "es";
  const client = getBuilderAdminClient();
  const result = client ? await listPublishedPressReleases(client).then(posts => ({ posts, available: true }), () => ({ posts: [], available: false })) : { posts: [], available: false };
  return <>
    <section className="section press-releases-intro">
      <div className="container">
        <Link href="/news" className="text-link">{es ? "← Todas las noticias" : "← All News"}</Link>
        <p className="eyebrow">{es ? "Oficina del Distrito 34" : "District 34 Office"}</p>
        <h1>{es ? "Comunicados de prensa" : "Press Releases"}</h1>
        <p className="lead">{es ? "Comunicados oficiales publicados por el personal autorizado de la oficina." : "Official releases published by authorized office staff."}</p>
      </div>
    </section>
    <section className="section news-feed" aria-label={es ? "Comunicados publicados" : "Published releases"}>
      <div className="container">
        {!result.available ? <div className="news-empty"><h2>{es ? "Los comunicados no están disponibles temporalmente" : "Press releases are temporarily unavailable"}</h2><p>{es ? "Intente de nuevo más tarde o comuníquese con la oficina." : "Please try again later or contact the office."}</p><Link href="/contact">{es ? "Contactar a la oficina" : "Contact the Office"}</Link></div>
          : result.posts.length ? <PublishedPostList posts={result.posts} locale={locale} />
            : <div className="news-empty"><h2>{es ? "Todavía no hay comunicados publicados" : "No press releases have been published yet"}</h2><p>{es ? "Los comunicados aprobados aparecerán aquí cuando se publiquen." : "Approved releases will appear here when they are published."}</p></div>}
      </div>
    </section>
  </>;
}
