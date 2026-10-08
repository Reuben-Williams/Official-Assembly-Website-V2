import Link from "next/link";
import { readPublicLocale } from "../i18n/server";
import { SiteSearchForm } from "../ui/SiteSearchForm";
import { searchPublicEntries } from "../../lib/public-search";
import { loadPublicSearchEntries } from "../../lib/public-search-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search | District 34", robots: { index: false, follow: true } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const [params, locale] = await Promise.all([searchParams, readPublicLocale()]);
  const query = (typeof params.q === "string" ? params.q : "").trim().slice(0, 120);
  const spanish = locale === "es";
  const index = query ? await loadPublicSearchEntries(locale) : { entries: [], partial: false };
  const results = searchPublicEntries(index.entries, query);
  return <section className="section"><div className="container">
    <p className="eyebrow">{spanish ? "Encuentre información" : "Find information"}</p>
    <h1>{spanish ? "Buscar en el sitio" : "Search the website"}</h1>
    <SiteSearchForm locale={locale} query={query} id="results-search" />
    <p role="status">{query ? `${results.length} ${spanish ? "resultados para" : "results for"} “${query}”` : spanish ? "Busque páginas, servicios, eventos o noticias." : "Search for pages, services, events, or news."}</p>
    {index.partial && <p role="status">{spanish ? "Algunas fuentes no están disponibles. Inténtelo de nuevo más tarde." : "Some content is temporarily unavailable. Results may be incomplete; please try again shortly."}</p>}
    {query && !results.length && <p>{spanish ? "Pruebe con menos palabras o visite Recursos." : "Try fewer words, or browse Resources for assistance."} <Link href="/resources">{spanish ? "Recursos" : "Resources"}</Link></p>}
    <ol className="search-results">{results.map((result, index) => <li key={`${result.href}-${index}`}>
      <small>{result.page} › {result.section}</small><h2><Link href={result.href}>{result.title}</Link></h2><p>{result.snippet}</p>
    </li>)}</ol>
  </div></section>;
}
