import { createHash } from "node:crypto";

import { renderConsentText } from "@reuben-williams/forms";
import {
  createTrustedBaseFormSubmissionCommand,
  type TrustedBaseFormSubmissionCommand
} from "@reuben-williams/core";
import type { FormTemplateDefinition, OwnerFormConfiguration, PublicFormProjection } from "@reuben-williams/forms";
import type { PublicLocale } from "../../app/i18n/locale";

export const APPROVED_NEWSLETTER_CONSENT_LABEL =
  "I agree to receive District Newsletter emails from the Office of Assemblywoman Carmen Morales. I understand that submitting this form is a confirmation request, that I am not subscribed until I confirm by email, and that I can unsubscribe at any time.";

export const APPROVED_NEWSLETTER_SUCCESS_COPY =
  "Check your inbox to continue. Your request is pending, and you are not subscribed unless you complete the confirmation step.";

export const APPROVED_NEWSLETTER_CONSENT_LABEL_ES =
  "Acepto recibir correos del BoletÃ­n del distrito de la Oficina de la AsambleÃ­sta Carmen Morales. Entiendo que enviar este formulario crea una solicitud de confirmaciÃ³n, que no estarÃ© suscrito hasta confirmar por correo electrÃ³nico y que puedo cancelar la suscripciÃ³n en cualquier momento.";

export const APPROVED_NEWSLETTER_SUCCESS_COPY_ES =
  "Revise su bandeja de entrada para continuar. Su solicitud estÃ¡ pendiente y no estarÃ¡ suscrito a menos que complete el paso de confirmaciÃ³n.";

export function approvedNewsletterConsentLabel(locale: PublicLocale) {
  return locale === "es" ? APPROVED_NEWSLETTER_CONSENT_LABEL_ES : APPROVED_NEWSLETTER_CONSENT_LABEL;
}

export const newsletterManagedFormConfiguration: OwnerFormConfiguration = {
  templateId: "local-business.newsletter-signup",
  templateVersion: "1.0.0",
  displayName: "District Newsletter",
  fields: [
    {
      key: "email",
      label: "Email address",
      helpText: "",
      placeholder: "you@example.com",
      visible: true,
      required: true
    },
    {
      key: "firstName",
      label: "First name",
      helpText: "",
      placeholder: "First name",
      visible: true,
      required: false
    },
    {
      key: "marketingConsent",
      label: APPROVED_NEWSLETTER_CONSENT_LABEL,
      helpText: "",
      placeholder: "",
      visible: true,
      required: true
    }
  ],
  qualification: { enabled: false, allowedZipCodes: [] },
  completion: {
    mode: "inline_success",
    successCopy: APPROVED_NEWSLETTER_SUCCESS_COPY
  },
  consentPolicyVersion: "marketing-v1"
};

export function newsletterPackageCompatibleConfiguration(
  configuration: OwnerFormConfiguration
): OwnerFormConfiguration {
  return {
    ...configuration,
    fields: configuration.fields.map((field) => ({
      ...field,
      label: field.key === "marketingConsent"
        ? "Marketing email consent"
        : field.label
    }))
  };
}

export function applyApprovedNewsletterConsentProjection(
  projection: PublicFormProjection
): PublicFormProjection {
  return Object.freeze({
    ...projection,
    fields: Object.freeze(projection.fields.map((field) => Object.freeze({
      ...field,
      label: field.key === projection.consent.fieldKey
        ? APPROVED_NEWSLETTER_CONSENT_LABEL
        : field.label
    }))),
    consent: Object.freeze({
      ...projection.consent,
      renderedText: APPROVED_NEWSLETTER_CONSENT_LABEL
    })
  });
}

export function approvedNewsletterConsentLanguageDigest() {
  return approvedNewsletterConsentLanguageDigestFor("en");
}

export function approvedNewsletterConsentLanguageDigestFor(locale: PublicLocale) {
  return createHash("sha256")
    .update(approvedNewsletterConsentLabel(locale).replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

export function withApprovedNewsletterConsentEvidence(
  command: TrustedBaseFormSubmissionCommand
) {
  const locale: PublicLocale = command.locale.toLowerCase().startsWith("es") ? "es" : "en";
  return createTrustedBaseFormSubmissionCommand({
    ...command,
    consentEvidence: {
      ...command.consentEvidence,
      languageDigest: approvedNewsletterConsentLanguageDigestFor(locale)
    }
  });
}

export async function createPackageCompatibleNewsletterSubmissionRequest(input: {
  readonly request: Request;
  readonly template: FormTemplateDefinition;
  readonly businessName: string;
  readonly locale?: PublicLocale;
}) {
  if ((input.request.headers.get("content-type") ?? "").split(";", 1)[0] !== "application/json") {
    throw new TypeError("A JSON newsletter submission is required.");
  }
  const bytes = new Uint8Array(await input.request.arrayBuffer());
  if (bytes.length < 1 || bytes.length > 65_536) {
    throw new TypeError("The newsletter submission is invalid.");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError("The newsletter submission is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("The newsletter submission is invalid.");
  }
  const body = value as Record<string, unknown>;
  if (body.renderedConsentText !== approvedNewsletterConsentLabel(input.locale ?? "en")) {
    throw new TypeError("The newsletter consent disclosure is invalid.");
  }
  const headers = new Headers(input.request.headers);
  headers.delete("content-length");
  return new Request(input.request.url, {
    method: input.request.method,
    headers,
    body: JSON.stringify({
      ...body,
      renderedConsentText: renderConsentText(input.template, input.businessName)
    })
  });
}
