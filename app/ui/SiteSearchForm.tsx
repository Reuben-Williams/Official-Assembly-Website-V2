"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import Link from "next/link";
import type { PublicLocale } from "../i18n/locale";
import { searchPublicEntries, type PublicSearchEntry } from "../../lib/public-search";

type SearchIndex = { entries: PublicSearchEntry[]; partial: boolean };

export function SiteSearchForm({ locale = "en", query = "", id = "site-search", initialIndex, fullResults = false }: {
  locale?: PublicLocale; query?: string; id?: string; initialIndex?: SearchIndex; fullResults?: boolean;
}) {
  const spanish = locale === "es";
  const [value, setValue] = useState(query);
  const [active, setActive] = useState(Boolean(query));
  const [index, setIndex] = useState(initialIndex);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!active || initialIndex) return;
    const controller = new AbortController();
    fetch(`/api/public/search?locale=${locale}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Search unavailable");
        const data: SearchIndex = await response.json();
        if (!Array.isArray(data.entries)) throw new Error("Invalid search index");
        if (!controller.signal.aborted) { setIndex(data); setFailed(false); }
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [active, initialIndex, locale, retry]);

  const trimmed = value.trim();
  const results = index ? searchPublicEntries(index.entries, trimmed) : [];
  const visible = fullResults ? results : results.slice(0, 6);
  const showResults = Boolean(trimmed);
  return <div className={`site-search${fullResults ? " site-search-full" : " site-search-compact"}`}>
    <form action="/search" method="get" role="search" className="site-search-form">
      <label htmlFor={id}>{spanish ? "Buscar en el sitio" : "Search the website"}</label>
      <div><input id={id} name="q" type="search" value={value} maxLength={120} autoComplete="off"
        onFocus={() => setActive(true)} onChange={event => { setValue(event.target.value); setActive(true); }}
        aria-controls={`${id}-results`} aria-describedby={`${id}-status`}
        placeholder={spanish ? "Páginas, servicios, noticias…" : "Pages, services, news…"} />
        <button type="submit" aria-label={spanish ? "Buscar" : "Search"}><Search size={20} aria-hidden="true" /><span>{spanish ? "Buscar" : "Search"}</span></button></div>
    </form>
    <div className="site-search-feedback">
      <p id={`${id}-status`} role="status" aria-live="polite">
        {!showResults ? (spanish ? "Escriba para ver resultados." : "Start typing to see results.")
          : failed ? (spanish ? "La búsqueda no está disponible temporalmente." : "Search is temporarily unavailable.")
          : !index ? (spanish ? "Buscando…" : "Searching…")
          : `${results.length} ${spanish ? "resultados para" : "results for"} “${trimmed}”`}
      </p>
      {showResults && failed && <button type="button" onClick={() => { setFailed(false); setRetry(count => count + 1); }}>{spanish ? "Reintentar" : "Try again"}</button>}
      {showResults && index?.partial && <p>{spanish ? "Algunas fuentes no están disponibles. Los resultados pueden estar incompletos." : "Some content is temporarily unavailable. Results may be incomplete."}</p>}
      {showResults && index && !failed && !results.length && <p>{spanish ? "Pruebe con menos palabras o visite " : "Try fewer words, or browse "}<Link href="/resources">{spanish ? "Recursos" : "Resources"}</Link>.</p>}
    </div>
    <ol id={`${id}-results`} className="search-results" aria-label={spanish ? "Resultados de búsqueda" : "Search results"}>
      {showResults && !failed && visible.map((result, position) => <li key={`${result.href}-${position}`}>
        <small>{result.page} › {result.section}</small>
        <h2><a href={result.href}>{result.title}</a></h2><p>{result.snippet}</p>
      </li>)}
    </ol>
    {!fullResults && showResults && results.length > 6 && <a className="search-all-results" href={`/search?q=${encodeURIComponent(trimmed)}`}>{spanish ? "Ver todos los resultados" : "View all results"} ({results.length})</a>}
  </div>;
}
