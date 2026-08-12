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
