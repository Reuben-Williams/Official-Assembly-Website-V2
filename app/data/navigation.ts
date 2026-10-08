import type { PublicLocale } from "../i18n/locale";

const groups: Record<string, readonly (readonly [string, string, string])[]> = {
  home: [["/", "Homepage", "Inicio"], ["/#representative", "Your representative", "Su representante"], ["/#guidance", "Constituent guidance", "Orientación para residentes"]],
  about: [["/about", "About Assemblywoman Morales", "Acerca de la asambleísta Morales"], ["/about#features", "Biography & service", "Biografía y servicio"], ["/community", "Around District 34", "En el Distrito 34"], ["/contact", "Contact the office", "Contactar a la oficina"]],
  resources: [["/resources", "Resident resources", "Recursos para residentes"], ["/resources#features", "State agency assistance", "Ayuda con agencias estatales"], ["/contact#form", "Request assistance", "Solicitar ayuda"], ["/privacy", "Privacy", "Privacidad"]],
  events: [["/events", "Community calendar", "Calendario comunitario"], ["/community", "Community & volunteering", "Comunidad y voluntariado"]],
  news: [["/news", "All News", "Todas las noticias"], ["/news/press-releases", "Press Releases", "Comunicados de prensa"], ["/news#features", "Legislative updates", "Actualizaciones legislativas"], ["/newsletter", "Newsletter signup", "Suscribirse al boletín"], ["/social", "Public information & media", "Información pública y medios"]],
  voting: [["/voting", "Voting information", "Información para votar"], ["/voting#features", "County elections & forms", "Elecciones y formularios del condado"], ["/voting#secondary", "State voting resources", "Recursos electorales estatales"]],
};

export function navigationChildren(slug: string, locale: PublicLocale) {
  return groups[slug]?.map(([href, en, es]) => ({ href, label: locale === "es" ? es : en }));
}
