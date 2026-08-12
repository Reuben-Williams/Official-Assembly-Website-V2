import "server-only";

import { render } from "react-email";
import { createElement } from "react";

import { NewsletterConfirmationEmail } from "./confirmation-email";

export const NEWSLETTER_CONFIRMATION_SUBJECT = "Confirm your District Newsletter subscription";
export const NEWSLETTER_CONFIRMATION_SUBJECT_ES = "Confirme su suscripci\u00f3n al Bolet\u00edn del distrito";

export async function renderNewsletterConfirmationEmail(input: {
  readonly confirmationUrl: string;
  readonly locale?: "en" | "es";
}) {
  const spanish = input.locale === "es";
  const component = createElement(NewsletterConfirmationEmail, input);
  const html = await render(component);
  const text = spanish ? [
    "Confirme su suscripci\u00f3n",
    "",
    "Un paso m\u00e1s para recibir novedades de la Oficina de la Asamble\u00edsta Carmen Morales.",
    "",
    "Confirmar suscripci\u00f3n:",
    input.confirmationUrl,
    "",
    "Este enlace de confirmaci\u00f3n vence en 48 horas.",
    "Si no solicit\u00f3 esta suscripci\u00f3n, no se requiere ninguna acci\u00f3n.",
    "Esta direcci\u00f3n de env\u00edo no se supervisa.",
    "Comun\u00edquese con la oficina del distrito: https://www.assemblywomanmorales.com/contact o 973-450-0484.",
  ].join("\n") : [
    "Confirm your subscription",
    "",
    "One more step to receive updates from the Office of Assemblywoman Carmen Morales.",
    "",
    "Confirm subscription:",
    input.confirmationUrl,
    "",
    "This confirmation link expires in 48 hours.",
    "If you did not request this subscription, no action is required.",
    "This sending address is not monitored.",
    "Contact the district office: https://www.assemblywomanmorales.com/contact or 973-450-0484.",
  ].join("\n");
  return {
    subject: spanish ? NEWSLETTER_CONFIRMATION_SUBJECT_ES : NEWSLETTER_CONFIRMATION_SUBJECT,
    html,
    text,
  };
}
