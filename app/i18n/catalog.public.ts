import type { PublicLocale } from "./locale";

const source = Object.freeze({
  "global.skip": "Skip to content",
  "global.navigation.home": "Home",
  "global.navigation.about": "About",
  "global.navigation.resources": "Resources",
  "global.navigation.news": "News & Updates",
  "global.navigation.community": "Community",
  "global.navigation.voting": "Voting",
  "global.navigation.contact": "Contact",
  "global.navigation.newsletter": "Newsletter",
  "global.navigation.survey": "Survey",
  "global.navigation.social": "Social",
  "global.header.contact": "Contact Office",
  "global.header.primary-navigation": "Primary navigation",
  "global.header.mobile-navigation": "Mobile navigation",
  "global.header.open-menu": "Open menu",
  "global.language.change-to-es": "View site in Spanish",
  "global.language.change-to-en": "View site in English",
  "global.language.spanish": "Spanish",
  "global.language.english": "English",
  "global.footer.sections-title": "Site Sections",
  "global.footer.access-title": "Office Access",
  "global.footer.communication-body": "Call {phone} for district office assistance.",
  "global.footer.privacy": "Privacy",
  "global.footer.staff-portal": "Staff Portal",
  "global.office.tagline": "Constituent services, legislative information, voting resources, and district office access for New Jersey's 34th Legislative District.",
  "metadata.home.description": "Constituent services, legislative information, voting resources, and district office access for New Jersey's 34th Legislative District.",
  "alerts.site-label": "Site alerts",
  "alerts.previous": "Previous alert",
  "alerts.next": "Next alert",
  "alerts.pause": "Pause",
  "alerts.resume": "Resume",
  "alerts.latest-unavailable": "Latest alerts could not be refreshed.",
  "news.read-update": "Read update",
  "news.empty-title": "No district posts have been published yet",
  "news.empty-body": "Published district office updates will appear here.",
  "post.back-to-news": "Back to News",
  "post.district-update": "District Update",
} as const);

const spanish: { readonly [K in keyof typeof source]: string } = Object.freeze({
  "global.skip": "Saltar al contenido",
  "global.navigation.home": "Inicio",
  "global.navigation.about": "Acerca de",
  "global.navigation.resources": "Recursos",
  "global.navigation.news": "Noticias y novedades",
  "global.navigation.community": "Comunidad",
  "global.navigation.voting": "Votaci\u00f3n",
  "global.navigation.contact": "Contacto",
  "global.navigation.newsletter": "Bolet\u00edn",
  "global.navigation.survey": "Encuesta",
  "global.navigation.social": "Redes sociales",
  "global.header.contact": "Contactar a la oficina",
  "global.header.primary-navigation": "Navegaci\u00f3n principal",
  "global.header.mobile-navigation": "Navegaci\u00f3n m\u00f3vil",
  "global.header.open-menu": "Abrir men\u00fa",
  "global.language.change-to-es": "Ver el sitio en espa\u00f1ol",
  "global.language.change-to-en": "View site in English",
  "global.language.spanish": "Espa\u00f1ol",
  "global.language.english": "English",
  "global.footer.sections-title": "Secciones del sitio",
  "global.footer.access-title": "Acceso a la oficina",
  "global.footer.communication-body": "Llame al {phone} para recibir asistencia de la oficina del distrito.",
  "global.footer.privacy": "Privacidad",
  "global.footer.staff-portal": "Portal del personal",
  "global.office.tagline": "Servicios para residentes, informaci\u00f3n legislativa, recursos electorales y acceso a la oficina del distrito para el Distrito Legislativo 34 de Nueva Jersey.",
  "metadata.home.description": "Servicios para residentes, informaci\u00f3n legislativa, recursos electorales y acceso a la oficina del distrito para el Distrito Legislativo 34 de Nueva Jersey.",
  "alerts.site-label": "Alertas del sitio",
  "alerts.previous": "Alerta anterior",
  "alerts.next": "Alerta siguiente",
  "alerts.pause": "Pausar",
  "alerts.resume": "Reanudar",
  "alerts.latest-unavailable": "No se pudieron actualizar las alertas m\u00e1s recientes.",
  "news.read-update": "Leer novedad",
  "news.empty-title": "A\u00fan no se han publicado novedades del distrito",
  "news.empty-body": "Las novedades publicadas por la oficina del distrito aparecer\u00e1n aqu\u00ed.",
  "post.back-to-news": "Volver a Noticias",
  "post.district-update": "Novedad del distrito",
});

export type PublicCatalogKey = keyof typeof source;

export const publicCatalogValues: Readonly<Record<PublicCatalogKey, Readonly<{ en: string; es: string }>>> =
  Object.freeze(Object.fromEntries(Object.keys(source).map((key) => [
    key,
    Object.freeze({ en: source[key as PublicCatalogKey], es: spanish[key as PublicCatalogKey] }),
  ])) as Record<PublicCatalogKey, Readonly<{ en: string; es: string }>>);

export function publicCopy(
  locale: PublicLocale,
  key: PublicCatalogKey,
  english: string,
  replacements: Readonly<Record<string, string>> = {},
) {
  const expectedEnglish = publicCatalogValues[key].en;
  const renderedExpectedEnglish = Object.entries(replacements).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, replacement),
    expectedEnglish,
  );
  const template = locale === "es" && english === renderedExpectedEnglish
    ? publicCatalogValues[key].es
    : english;
  return Object.entries(replacements).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, replacement),
    template,
  );
}

export function localizedNavigationLabel(locale: PublicLocale, slug: string, english: string) {
  const key = `global.navigation.${slug}` as PublicCatalogKey;
  return key in publicCatalogValues ? publicCopy(locale, key, english) : english;
}
