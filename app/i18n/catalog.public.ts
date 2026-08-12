import type { PublicLocale } from "./locale";

const spanish = Object.freeze({
  "global.skip": "Saltar al contenido",
  "global.navigation.home": "Inicio",
  "global.navigation.about": "Acerca de",
  "global.navigation.resources": "Recursos",
  "global.navigation.news": "Noticias",
  "global.navigation.community": "Comunidad",
  "global.navigation.voting": "Votación",
  "global.navigation.contact": "Contacto",
  "global.navigation.newsletter": "Boletín",
  "global.navigation.survey": "Encuesta",
  "global.navigation.social": "Redes sociales",
  "global.header.contact": "Contactar a la oficina",
  "global.header.primary-navigation": "Navegación principal",
  "global.header.mobile-navigation": "Navegación móvil",
  "global.header.open-menu": "Abrir menú",
  "global.language.change-to-es": "Ver el sitio en español",
  "global.language.change-to-en": "View site in English",
  "global.language.spanish": "Español",
  "global.language.english": "English",
  "global.footer.sections-title": "Secciones del sitio",
  "global.footer.access-title": "Acceso a la oficina",
  "global.footer.communication-body": "Llame al {phone} para recibir asistencia de la oficina del distrito.",
  "global.footer.privacy": "Privacidad",
  "global.footer.staff-portal": "Portal del personal",
  "global.office.tagline": "Servicios para residentes, información legislativa, recursos electorales y acceso a la oficina del distrito para el Distrito Legislativo 34 de Nueva Jersey.",
  "metadata.home.description": "Servicios para residentes, información legislativa, recursos electorales y acceso a la oficina del distrito para el Distrito Legislativo 34 de Nueva Jersey.",
  "alerts.site-label": "Alertas del sitio",
  "alerts.previous": "Alerta anterior",
  "alerts.next": "Alerta siguiente",
  "alerts.pause": "Pausar",
  "alerts.resume": "Reanudar",
  "alerts.latest-unavailable": "No se pudieron actualizar las alertas m\u00e1s recientes.",
  "news.read-update": "Leer novedad",
  "news.empty-title": "A\u00fan no se han publicado novedades del distrito",
  "news.empty-body": "Las novedades publicadas por la oficina del distrito aparecer\u00e1n aqu\u00ed.",
} as const);

export type PublicCatalogKey = keyof typeof spanish;

export function publicCopy(
  locale: PublicLocale,
  key: PublicCatalogKey,
  english: string,
  replacements: Readonly<Record<string, string>> = {},
) {
  const template = locale === "es" ? spanish[key] : english;
  return Object.entries(replacements).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, replacement),
    template,
  );
}

export function localizedNavigationLabel(locale: PublicLocale, slug: string, english: string) {
  const key = `global.navigation.${slug}` as PublicCatalogKey;
  return key in spanish ? publicCopy(locale, key, english) : english;
}
