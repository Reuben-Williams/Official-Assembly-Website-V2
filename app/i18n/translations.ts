import { pages, siteConfig, stats } from "../data/site";

export type LanguageCode = "en" | "es";

type StableTranslation = Readonly<{ en: string; es: string }>;

export const spanishTranslationsByKey: Readonly<Record<string, StableTranslation>> =
  Object.freeze({
    "global.skip": {
      en: "Skip to content",
      es: "Saltar al contenido"
    },
    "global.contact": {
      en: "Contact Office",
      es: "Contactar a la oficina"
    },
    "home.hero.eyebrow": {
      en: "New Jersey General Assembly - District 34",
      es: "Asamblea General de Nueva Jersey - Distrito 34"
    },
    "home.hero.title": {
      en: "District 34 Constituent Services and Community Updates",
      es: "Servicios para residentes y novedades comunitarias del Distrito 34"
    },
    "home.hero.body": {
      en: "Find district office contact information, official legislative resources, voting guidance, and ways to request help with a New Jersey state agency.",
      es: "Encuentre información de contacto de la oficina del distrito, recursos legislativos oficiales, orientación electoral y maneras de solicitar ayuda con una agencia estatal de Nueva Jersey."
    },
    "home.portal.eyebrow": {
      en: "Constituent Portal",
      es: "Portal para residentes"
    },
    "home.portal.title": {
      en: "Core public workflows",
      es: "Servicios públicos principales"
    },
    "home.workflow.eyebrow": {
      en: "Office Workflow",
      es: "Proceso de la oficina"
    },
    "home.workflow.title": {
      en: "Built for clear constituent service",
      es: "Diseñado para un servicio claro a residentes"
    }
  });

export function translateStableText(
  key: string,
  source: string,
  language: LanguageCode
): string {
  if (language === "en") return source;
  const translation = spanishTranslationsByKey[key];
  return translation && translation.en === source ? translation.es : source;
}

const fixedUiStrings = [
  "Skip to content", "Contact Office", "Request Assistance", "View Services", "Open",
  "Office Workflow", "Public Information", "Service Requests", "Community Updates",
  "Contact the Office", "Get Updates", "Page Features", "Resident Form", "Site Sections",
  "Full name", "Email address", "Phone number", "Topic", "Message", "Submit Message",
  "Join Newsletter", "Submit Feedback", "Email Updates", "Get News & Updates by email",
  "Request the District Newsletter and confirm through the email sent to your inbox before the subscription becomes active.",
  "Review newsletter signup details"
];

const visibleDataStrings = [
  siteConfig.officeName,
  siteConfig.representativeName,
  siteConfig.tagline,
  ...stats.flatMap((stat) => [stat.value, stat.label]),
  ...pages.flatMap((page) => [
    page.navLabel,
    page.title,
    page.eyebrow,
    page.description,
    ...page.cards.flatMap((card) => [card.title, card.text, card.tag]),
    ...(page.secondaryCards ?? []).flatMap((card) => [card.title, card.text, card.tag])
  ]),
  ...fixedUiStrings
].filter((value): value is string => Boolean(value));

export const spanishTranslations: Record<string, string> = Object.fromEntries(
  visibleDataStrings.map((value) => [value, value])
);

Object.assign(spanishTranslations, {
  "Skip to content": "Saltar al contenido",
  "Contact Office": "Contactar Oficina",
  "Request Assistance": "Solicitar ayuda",
  "View Services": "Ver servicios",
  "Open": "Abrir",
  "Office Workflow": "Proceso de la oficina",
  "Public Information": "Información pública",
  "Service Requests": "Solicitudes de servicio",
  "Community Updates": "Actualizaciones comunitarias",
  "Contact the Office": "Contactar a la oficina",
  "Get Updates": "Recibir actualizaciones",
  "Resident Form": "Formulario para residentes",
  "Site Sections": "Secciones del sitio",
  "Full name": "Nombre completo",
  "Email address": "Correo electrónico",
  "Phone number": "Número de teléfono",
  "Topic": "Tema",
  "Message": "Mensaje",
  "Submit Message": "Enviar mensaje",
  "Join Newsletter": "Suscribirse al boletín",
  "Submit Feedback": "Enviar comentarios",
  "News & Updates": "Noticias y novedades",
  "Email Updates": "Actualizaciones por correo electrónico",
  "Get News & Updates by email": "Reciba noticias y novedades por correo electrónico",
  "Request the District Newsletter and confirm through the email sent to your inbox before the subscription becomes active.": "Solicite el boletín del distrito y confirme mediante el correo enviado a su bandeja de entrada antes de que se active la suscripción.",
  "Review newsletter signup details": "Consulte los detalles de suscripción al boletín"
});

export function translateText(text: string, language: LanguageCode): string {
  if (language === "en") return text;
  const leading = text.match(/^\s*/)?.[0] ?? "";
  const trailing = text.match(/\s*$/)?.[0] ?? "";
  const normalized = text.trim().replace(/\s+/g, " ");
  const translation = spanishTranslations[normalized];
  return translation === undefined ? text : `${leading}${translation}${trailing}`;
}
