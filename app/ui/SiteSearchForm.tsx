import { Search } from "lucide-react";
import type { PublicLocale } from "../i18n/locale";

export function SiteSearchForm({ locale = "en", query = "", id = "site-search" }: { locale?: PublicLocale; query?: string; id?: string }) {
  const spanish = locale === "es";
  return <form action="/search" method="get" role="search" className="site-search-form">
    <label htmlFor={id}>{spanish ? "Buscar en el sitio" : "Search the website"}</label>
    <div><input id={id} name="q" type="search" defaultValue={query} maxLength={120} placeholder={spanish ? "Páginas, servicios, noticias…" : "Pages, services, news…"} />
      <button type="submit"><Search size={20} aria-hidden="true" /><span>{spanish ? "Buscar" : "Search"}</span></button></div>
  </form>;
}
