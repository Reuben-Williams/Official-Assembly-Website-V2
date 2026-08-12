import type { PublicLocale } from "../i18n/locale";
import { siteConfig } from "./site";

type PrivacyNotice = Readonly<{
  title: string;
  updated: string;
  introduction: string;
  sections: readonly Readonly<{
    title: string;
    paragraphs: readonly string[];
  }>[];
}>;

const englishPrivacyNotice: PrivacyNotice = Object.freeze({
  title: "Privacy notice",
  updated: "August 6, 2026",
  introduction:
    `This notice explains how ${siteConfig.officeName} handles information submitted through this website, including District Newsletter requests.`,
  sections: Object.freeze([
    Object.freeze({
      title: "Information we collect",
      paragraphs: Object.freeze([
        "The newsletter form collects your email address, an optional first name, and the required marketing-email consent selection.",
        "We also keep limited confirmation, delivery, unsubscribe, suppression, security, and audit records needed to operate the newsletter and honor your choices. We do not retain raw Resend webhook bodies."
      ])
    }),
    Object.freeze({
      title: "How newsletter information is used",
      paragraphs: Object.freeze([
        "We use newsletter information to request confirmation, deliver District Newsletter email after confirmation, manage subscriber preferences, protect the signup process, and investigate delivery or consent issues.",
        "Submitting the form creates a pending confirmation request. It does not create an active subscription."
      ])
    }),
    Object.freeze({
      title: "Email delivery through Resend",
      paragraphs: Object.freeze([
        "Resend processes contact and delivery data for confirmation emails and District Newsletter delivery. This may include your email address, optional first name, provider contact identifiers, and delivery-event information.",
        "Resend also applies unsubscribe and suppression controls during delivery."
      ])
    }),
    Object.freeze({
      title: "Confirmation and unsubscribe choices",
      paragraphs: Object.freeze([
        "You are not subscribed until you deliberately complete the confirmation step sent to your inbox.",
        "Each District Newsletter includes an unsubscribe link. Using it stops future District Newsletter marketing email. You may also contact the district office for help with a subscription choice."
      ])
    }),
    Object.freeze({
      title: "Access, correction, and deletion requests",
      paragraphs: Object.freeze([
        `To ask to access, correct, or delete newsletter information, use the contact page or call ${siteConfig.phoneDisplay}. The office reviews requests against the applicable records, consent, suppression, and retention requirements.`,
        "Approved deletion removes or irreversibly redacts direct personal information where the operating policy permits, while preserving the minimum non-message evidence needed to honor an unsubscribe or suppression."
      ])
    }),
    Object.freeze({
      title: "Retention approach",
      paragraphs: Object.freeze([
        "Pending newsletter requests expire after 30 days. Personal information is otherwise kept while a subscription is active or while it is needed to operate, secure, and audit the newsletter.",
        "Withdrawal stops future marketing use. Minimum non-message consent, unsubscribe, suppression, and audit evidence may be retained so the office can continue honoring the choice and protect the system."
      ])
    })
  ])
});

const spanishPrivacyNotice: PrivacyNotice = Object.freeze({
  title: "Aviso de privacidad",
  updated: "6 de agosto de 2026",
  introduction:
    `Este aviso explica cómo ${siteConfig.officeName} maneja la información enviada mediante este sitio web, incluidas las solicitudes del Boletín del distrito.`,
  sections: Object.freeze([
    Object.freeze({
      title: "Información que recopilamos",
      paragraphs: Object.freeze([
        "El formulario del boletín recopila su dirección de correo electrónico, un nombre opcional y la selección obligatoria de consentimiento para recibir correos de mercadeo.",
        "También conservamos registros limitados de confirmación, entrega, cancelación de suscripción, supresión, seguridad y auditoría necesarios para operar el boletín y respetar sus decisiones. No conservamos el contenido sin procesar de los webhooks de Resend."
      ])
    }),
    Object.freeze({
      title: "Cómo se utiliza la información del boletín",
      paragraphs: Object.freeze([
        "Utilizamos la información del boletín para solicitar confirmación, entregar correos del Boletín del distrito después de la confirmación, administrar las preferencias de los suscriptores, proteger el proceso de inscripción e investigar problemas de entrega o consentimiento.",
        "Enviar el formulario crea una solicitud de confirmación pendiente. No crea una suscripción activa."
      ])
    }),
    Object.freeze({
      title: "Entrega de correo electrónico mediante Resend",
      paragraphs: Object.freeze([
        "Resend procesa datos de contacto y entrega para los correos de confirmación y la entrega del Boletín del distrito. Esto puede incluir su dirección de correo electrónico, nombre opcional, identificadores de contacto del proveedor e información de eventos de entrega.",
        "Resend también aplica controles de cancelación de suscripción y supresión durante la entrega."
      ])
    }),
    Object.freeze({
      title: "Opciones de confirmación y cancelación de suscripción",
      paragraphs: Object.freeze([
        "No estará suscrito hasta que complete deliberadamente el paso de confirmación enviado a su bandeja de entrada.",
        "Cada Boletín del distrito incluye un enlace para cancelar la suscripción. Usarlo detiene futuros correos de mercadeo del Boletín del distrito. También puede comunicarse con la oficina del distrito para obtener ayuda con una decisión de suscripción."
      ])
    }),
    Object.freeze({
      title: "Solicitudes de acceso, corrección y eliminación",
      paragraphs: Object.freeze([
        `Para solicitar acceso, corrección o eliminación de información del boletín, use la página de contacto o llame al ${siteConfig.phoneDisplay}. La oficina revisa las solicitudes conforme a los requisitos aplicables de registros, consentimiento, supresión y conservación.`,
        "La eliminación aprobada elimina o redacta de manera irreversible la información personal directa cuando la política operativa lo permite, mientras conserva la evidencia mínima sin contenido de mensajes necesaria para respetar una cancelación de suscripción o supresión."
      ])
    }),
    Object.freeze({
      title: "Enfoque de conservación",
      paragraphs: Object.freeze([
        "Las solicitudes pendientes del boletín vencen después de 30 días. De otro modo, la información personal se conserva mientras una suscripción esté activa o mientras sea necesaria para operar, proteger y auditar el boletín.",
        "Retirar el consentimiento detiene el uso futuro para mercadeo. Puede conservarse la evidencia mínima sin contenido de mensajes sobre consentimiento, cancelación de suscripción, supresión y auditoría para que la oficina continúe respetando la decisión y proteja el sistema."
      ])
    })
  ])
});

export const privacyNotice = englishPrivacyNotice;

export function privacyNoticeFor(locale: PublicLocale) {
  return locale === "es" ? spanishPrivacyNotice : englishPrivacyNotice;
}
