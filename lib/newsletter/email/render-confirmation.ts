import "server-only";

import { render } from "react-email";
import { createElement } from "react";

import { NewsletterConfirmationEmail } from "./confirmation-email";

export const NEWSLETTER_CONFIRMATION_SUBJECT = "Confirm your District Newsletter subscription";

export async function renderNewsletterConfirmationEmail(input: {
  readonly confirmationUrl: string;
}) {
  const component = createElement(NewsletterConfirmationEmail, input);
  const html = await render(component);
  const text = [
    "Confirm your subscription / Confirme su suscripción",
    "",
    "One more step to receive updates from the Office of Assemblywoman Carmen Morales.",
    "",
    "Confirm subscription / Confirmar suscripción:",
    input.confirmationUrl,
    "",
    "This confirmation link expires in 48 hours.",
    "If you did not request this subscription, no action is required.",
    "This sending address is not monitored.",
    "Contact the district office: https://www.assemblywomanmorales.com/contact or 973-414-3658."
  ].join("\n");
  return { subject: NEWSLETTER_CONFIRMATION_SUBJECT, html, text };
}
