import { readPublicLocale } from "../i18n/server";
import { SiteSearchForm } from "../ui/SiteSearchForm";
import { loadPublicSearchEntries } from "../../lib/public-search-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search | District 34", robots: { index: false, follow: true } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const [params, locale] = await Promise.all([searchParams, readPublicLocale()]);
  const query = (typeof params.q === "string" ? params.q : "").trim().slice(0, 120);
  const spanish = locale === "es";
  const index = query ? await loadPublicSearchEntries(locale) : undefined;
  return <section className="section"><div className="container">
    <p className="eyebrow">{spanish ? "Encuentre información" : "Find information"}</p>
    <h1>{spanish ? "Buscar en el sitio" : "Search the website"}</h1>
    <SiteSearchForm key={`${locale}-${query}`} locale={locale} query={query} id="results-search" initialIndex={index} fullResults />
  </div></section>;
}
