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
  "Office of Assemblywoman Carmen Theresa Morales": "Office of Assemblywoman Carmen Theresa Morales",
  "Constituent services, legislative information, voting resources, and district office access for New Jersey's 34th Legislative District.": "Servicios para residentes, información legislativa, recursos electorales y acceso a la oficina del distrito para el Distrito Legislativo 34 de Nueva Jersey.",
  "Services": "Servicios",
  "Help navigating New Jersey agencies": "Ayuda para orientarse entre las agencias de Nueva Jersey",
  "Updates": "Novedades",
  "Legislation and district information": "Legislación e información del distrito",
  "Access": "Acceso",
  "Office, voting, and contact resources": "Recursos de la oficina, electorales y de contacto",
  "Home": "Inicio",
  "District 34 Constituent Services and Community Updates": "Servicios para residentes y novedades comunitarias del Distrito 34",
  "New Jersey General Assembly - District 34": "Asamblea General de Nueva Jersey - Distrito 34",
  "Find district office contact information, official legislative resources, voting guidance, and ways to request help with a New Jersey state agency.": "Encuentre información de contacto de la oficina del distrito, recursos legislativos oficiales, orientación electoral y maneras de solicitar ayuda con una agencia estatal de Nueva Jersey.",
  "Contact the District Office": "Contactar a la oficina del distrito",
  "Call or send a message when you need help navigating a New Jersey state agency or want to share a legislative concern.": "Llame o envíe un mensaje cuando necesite ayuda con una agencia estatal de Nueva Jersey o quiera compartir una inquietud legislativa.",
  "Follow Legislative Activity": "Seguir la actividad legislativa",
  "Use official New Jersey Legislature sources for sponsored bills, votes, committee work, and current public information.": "Use las fuentes oficiales de la Legislatura de Nueva Jersey para consultar proyectos de ley patrocinados, votaciones, trabajo de comités e información pública vigente.",
  "Find Civic Resources": "Encontrar recursos cívicos",
  "Go directly to official voting, state service, district office, and newsletter resources.": "Acceda directamente a recursos oficiales sobre elecciones, servicios estatales, la oficina del distrito y el boletín.",
  "About": "Acerca de",
  "About Assemblywoman Carmen Theresa Morales": "Acerca de la asambleísta Carmen Theresa Morales",
  "Deputy Whip - District 34": "Subjefa de disciplina - Distrito 34",
  "Assemblywoman Morales has served in the New Jersey General Assembly since 2024 and represents District 34 in Essex County.": "La asambleísta Morales forma parte de la Asamblea General de Nueva Jersey desde 2024 y representa al Distrito 34 del condado de Essex.",
  "District 34": "Distrito 34",
  "The district includes Belleville, Bloomfield, East Orange, Glen Ridge, Nutley, and Orange.": "El distrito incluye Belleville, Bloomfield, East Orange, Glen Ridge, Nutley y Orange.",
  "Committee Service": "Servicio en comités",
  "The official legislative roster lists Higher Education, Appropriations, Science, Innovation and Technology, and the Joint Committee on the Public Schools.": "El registro legislativo oficial incluye Educación Superior, Asignaciones, Ciencia, Innovación y Tecnología, y el Comité Conjunto de Escuelas Públicas.",
  "Public Service": "Servicio público",
  "Her official biography lists a career in education and service as an Essex County College trustee from 2017 through 2023.": "Su biografía oficial describe una carrera en educación y su servicio como miembro de la junta de Essex County College entre 2017 y 2023.",
  "Official biography and legislative record": "Biografía oficial y expediente legislativo",
  "Review the New Jersey Legislature profile for the current biography, committee assignments, sponsored bills, and member votes.": "Consulte el perfil de la Legislatura de Nueva Jersey para ver la biografía vigente, las asignaciones de comités, los proyectos de ley patrocinados y las votaciones de la integrante.",
  "Resources": "Recursos",
  "District and State Resources": "Recursos del distrito y del estado",
  "Constituent Support": "Apoyo a residentes",
  "Start with official state information, then contact the district office if you need help identifying the appropriate New Jersey agency.": "Comience con la información oficial del estado y luego comuníquese con la oficina del distrito si necesita ayuda para identificar la agencia de Nueva Jersey correspondiente.",
  "State Agency Assistance": "Asistencia con agencias estatales",
  "Contact the district office about an existing matter involving a New Jersey state agency.": "Comuníquese con la oficina del distrito sobre un asunto existente relacionado con una agencia estatal de Nueva Jersey.",
  "Public Service Events": "Eventos de servicio público",
  "Watch district notices for verified office hours, clinics, and community events.": "Consulte los avisos del distrito para conocer horarios de atención, clínicas y eventos comunitarios verificados.",
  "Official New Jersey Services": "Servicios oficiales de Nueva Jersey",
  "Browse the State of New Jersey department and service directory for direct government resources.": "Consulte el directorio de departamentos y servicios del Estado de Nueva Jersey para acceder a recursos gubernamentales directos.",
  "Legislative and District Updates": "Novedades legislativas y del distrito",
  "Official Sources": "Fuentes oficiales",
  "Read published district office updates and use the New Jersey Legislature record for current bills, votes, committees, and public proceedings.": "Lea las novedades publicadas por la oficina del distrito y use el registro de la Legislatura de Nueva Jersey para consultar proyectos de ley, votaciones, comités y procedimientos públicos vigentes.",
  "Sponsored Bills and Votes": "Proyectos de ley patrocinados y votaciones",
  "Review the Assemblywoman's official roster page for current sponsored bills and member votes.": "Consulte la página oficial de la asambleísta para ver los proyectos de ley patrocinados y sus votaciones vigentes.",
  "Legislature": "Legislatura",
  "Committee Work": "Trabajo de comités",
  "Check current committee assignments and schedules through the New Jersey Legislature.": "Consulte las asignaciones y los calendarios actuales de los comités en la Legislatura de Nueva Jersey.",
  "Committees": "Comités",
  "District Notices": "Avisos del distrito",
  "For current office hours and district event information, call the district office.": "Para conocer los horarios de atención y los eventos actuales del distrito, llame a la oficina del distrito.",
  "District": "Distrito",
  "Community": "Comunidad",
  "Around District 34": "En el Distrito 34",
  "District 34 includes Belleville, Bloomfield, East Orange, Glen Ridge, Nutley, and Orange in Essex County.": "El Distrito 34 incluye Belleville, Bloomfield, East Orange, Glen Ridge, Nutley y Orange en el condado de Essex.",
  "Small Business Conversations": "Conversaciones con pequeños negocios",
  "District conversations can help residents and business owners identify state resources and share policy concerns.": "Las conversaciones del distrito pueden ayudar a residentes y propietarios de negocios a identificar recursos estatales y compartir inquietudes sobre políticas públicas.",
  "Schools and Youth": "Escuelas y juventud",
  "The official roster lists Assemblywoman Morales as Chair of the Assembly Higher Education Committee.": "El registro oficial identifica a la asambleísta Morales como presidenta del Comité de Educación Superior de la Asamblea.",
  "Constituent Conversations": "Conversaciones con residentes",
  "Contact the district office to share a concern, ask a question, or request help with a state matter.": "Comuníquese con la oficina del distrito para compartir una inquietud, hacer una pregunta o solicitar ayuda con un asunto estatal.",
  "Voting": "Elecciones",
  "Official New Jersey Voting Information": "Información electoral oficial de Nueva Jersey",
  "Civic Access": "Acceso cívico",
  "Use official New Jersey election resources for registration, vote-by-mail, early voting, polling locations, and election dates.": "Use los recursos electorales oficiales de Nueva Jersey para consultar el registro, el voto por correo, la votación anticipada, los centros de votación y las fechas electorales.",
  "Register or Update Your Record": "Registrarse o actualizar su registro",
  "Visit the New Jersey Division of Elections for registration and voter information.": "Visite la División de Elecciones de Nueva Jersey para obtener información sobre el registro y los votantes.",
  "Find Polling Information": "Encontrar información sobre centros de votación",
  "Use the state's voter information portal for polling places and election resources.": "Use el portal estatal de información para votantes para encontrar centros de votación y recursos electorales.",
  "Voting Questions": "Preguntas electorales",
  "For authoritative election guidance, use the Division of Elections contact and help resources.": "Para obtener orientación electoral autorizada, use los recursos de contacto y ayuda de la División de Elecciones.",
  "Contact": "Contacto",
  "Office Access": "Acceso a la oficina",
  "152 Franklin Street, Belleville, NJ 07109. Call (973) 450-0484 for district office assistance.": "152 Franklin Street, Belleville, NJ 07109. Llame al (973) 450-0484 para recibir asistencia de la oficina del distrito.",
  "Call the Office": "Llamar a la oficina",
  "Speak with the district office at (973) 450-0484.": "Hable con la oficina del distrito llamando al (973) 450-0484.",
  "District Office": "Oficina del distrito",
  "Legislative Contact Form": "Formulario de contacto legislativo",
  "You can also use the official New Jersey Legislature contact form for the Assemblywoman.": "También puede usar el formulario de contacto oficial de la Legislatura de Nueva Jersey para comunicarse con la asambleísta.",
  "Newsletter": "Boletín",
  "District Newsletter": "Boletín del distrito",
  "Stay Informed": "Manténgase informado",
  "District Newsletter emails share legislative information, public services, and district events. The live form uses an explicit confirmation request before any subscription becomes active.": "Los correos del Boletín del distrito comparten información legislativa, servicios públicos y eventos del distrito. El formulario en vivo requiere una confirmación explícita antes de activar cualquier suscripción.",
  "District Updates": "Novedades del distrito",
  "District Newsletter emails cover legislative information, public services, and district events.": "Los correos del Boletín del distrito incluyen información legislativa, servicios públicos y eventos del distrito.",
  "Consent and Preferences": "Consentimiento y preferencias",
  "Submitting the form creates a confirmation request, not an active subscription. Every newsletter includes an unsubscribe link.": "Enviar el formulario crea una solicitud de confirmación, no una suscripción activa. Cada boletín incluye un enlace para cancelar la suscripción.",
  "Survey": "Encuesta",
  "Share a District Priority": "Comparta una prioridad del distrito",
  "Resident Voice": "Voz de los residentes",
  "The online survey is not accepting responses. Residents can share priorities directly with the district office by phone or through the official contact form.": "La encuesta en línea no acepta respuestas. Los residentes pueden compartir sus prioridades directamente con la oficina del distrito por teléfono o mediante el formulario de contacto oficial.",
  "Legislative Priorities": "Prioridades legislativas",
  "Share an issue or legislative concern through the district office contact options.": "Comparta un problema o una inquietud legislativa mediante las opciones de contacto de la oficina del distrito.",
  "Local Context": "Contexto local",
  "Include your municipality and the state matter involved when asking the office for assistance.": "Incluya su municipio y el asunto estatal correspondiente cuando solicite ayuda a la oficina.",
  "Social": "Redes sociales",
  "Public Information and Media": "Información pública y medios",
  "Official Updates": "Novedades oficiales",
  "Site-managed social posts are not yet available. Use the official legislative profile for current public records and contact information.": "Las publicaciones sociales administradas por el sitio aún no están disponibles. Use el perfil legislativo oficial para consultar registros públicos e información de contacto vigentes.",
  "Official Legislative Profile": "Perfil legislativo oficial",
  "Find sponsored bills, votes, committee assignments, biography, and contact information.": "Encuentre proyectos de ley patrocinados, votaciones, asignaciones de comités, biografía e información de contacto.",
  "District Media": "Medios del distrito",
  "This site uses the local image collection supplied with the website; no image is presented as proof of a specific service outcome.": "Este sitio usa la colección local de imágenes proporcionada con el sitio web; ninguna imagen se presenta como prueba del resultado de un servicio específico.",
  "Page Features": "Funciones de la página",
  "Assemblywoman Carmen Morales with legislative colleagues at the State House": "La asambleísta Carmen Morales con colegas legisladores en la Casa de Gobierno",
  "Assemblywoman Carmen Morales meeting with legislative colleagues": "La asambleísta Carmen Morales reunida con colegas legisladores",
  "A graduate at a district graduation ceremony": "Una persona graduada en una ceremonia de graduación del distrito",
  "New Jersey General Assembly electronic vote board": "Tablero electrónico de votación de la Asamblea General de Nueva Jersey",
  "Fresh Start expungement clinic event flyer": "Volante de un evento de la clínica de eliminación de antecedentes Fresh Start",
  "Community health clinic event flyer": "Volante de un evento de una clínica de salud comunitaria",
  "Community members gathered at a district event": "Miembros de la comunidad reunidos en un evento del distrito",
  "Assemblywoman Carmen Morales visiting constituents outdoors": "La asambleísta Carmen Morales visitando a residentes al aire libre",
  "Small business roundtable with constituents at a local restaurant": "Mesa redonda de pequeños negocios con residentes en un restaurante local",
  "Constituent meeting in a community space": "Reunión con residentes en un espacio comunitario",
  "District outreach event with community members": "Evento de alcance del distrito con miembros de la comunidad",
  "Constituents and officials during a capitol visit": "Residentes y funcionarios durante una visita al capitolio",
  "Page Resources": "Recursos de la página",
  "Verified paths for District 34 residents": "Recursos verificados para residentes del Distrito 34",
  "Use these links for current public information or contact the district office at (973) 450-0484.": "Use estos enlaces para consultar información pública vigente o comuníquese con la oficina del distrito al (973) 450-0484.",
  "Official sources first": "Fuentes oficiales primero",
  "State services, voting details, and legislative records link to current government sources.": "Los servicios estatales, los detalles electorales y los registros legislativos enlazan a fuentes gubernamentales vigentes.",
  "District office access": "Acceso a la oficina del distrito",
  "Residents can call (973) 450-0484 when online intake is unavailable.": "Los residentes pueden llamar al (973) 450-0484 cuando la recepción en línea no esté disponible.",
  "District office media": "Material visual de la oficina del distrito",
  "Additional district media": "Material visual adicional del distrito",
  "Community and small business engagement": "Participación comunitaria y de pequeños negocios",
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

Object.assign(spanishTranslations, {
  "Page not found": "P\u00e1gina no encontrada",
  "We couldn't find that page.": "No pudimos encontrar esa p\u00e1gina.",
  "The page may have moved, or the address may be incorrect. Use one of the links below to continue.": "Es posible que la p\u00e1gina se haya movido o que la direcci\u00f3n sea incorrecta. Use uno de los enlaces a continuaci\u00f3n para seguir navegando.",
  "Return home": "Volver al inicio",
  "View resources": "Ver recursos",
  "District office service": "Servicio de la oficina del distrito",
  "Send a message to the District Office": "Env\u00ede un mensaje a la oficina del distrito",
  "Email updates": "Novedades por correo electr\u00f3nico",
  "Join the District Newsletter": "Suscr\u00edbase al Bolet\u00edn del distrito",
  "Fields marked * are required. All other fields are optional.": "Los campos marcados con * son obligatorios. Todos los dem\u00e1s campos son opcionales.",
  "Newsletter confirmation and privacy notice": "Confirmaci\u00f3n del bolet\u00edn y aviso de privacidad",
  "Confirmation is required": "Se requiere confirmaci\u00f3n",
  "Submitting this form creates a pending District Newsletter confirmation request. You are not subscribed until you confirm using the email sent to your inbox.": "Enviar este formulario crea una solicitud pendiente de confirmaci\u00f3n del Bolet\u00edn del distrito. No estar\u00e1 suscrito hasta que confirme mediante el correo enviado a su bandeja de entrada.",
  "Review how the office and Resend handle newsletter information in the": "Consulte c\u00f3mo la oficina y Resend manejan la informaci\u00f3n del bolet\u00edn en el",
  "privacy notice": "aviso de privacidad",
  "Every District Newsletter includes an unsubscribe link.": "Cada Bolet\u00edn del distrito incluye un enlace para cancelar la suscripci\u00f3n.",
  "News & Updates": "Noticias y novedades",
  "Published legislative and district updates from Office of Assemblywoman Carmen Theresa Morales.": "Novedades legislativas y del distrito publicadas por la Oficina de la Asamble\u00edsta Carmen Theresa Morales.",
  "Email Updates": "Actualizaciones por correo electr\u00f3nico",
  "Get News & Updates by email": "Reciba noticias y novedades por correo electr\u00f3nico",
  "District Office": "Oficina del distrito",
  "Published updates": "Novedades publicadas",
  "Posts published by authorized office staff appear here.": "Las publicaciones del personal autorizado de la oficina aparecen aqu\u00ed.",
});

export function translateText(text: string, language: LanguageCode): string {
  if (language === "en") return text;
  const leading = text.match(/^\s*/)?.[0] ?? "";
  const trailing = text.match(/\s*$/)?.[0] ?? "";
  const normalized = text.trim().replace(/\s+/g, " ");
  const translation = spanishTranslations[normalized];
  return translation === undefined ? text : `${leading}${translation}${trailing}`;
}
