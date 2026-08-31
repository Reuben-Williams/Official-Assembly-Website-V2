import Script from "next/script";
import Link from "next/link";
import type { ReactNode } from "react";
import { UnavailableFormFallback } from "@reuben-williams/next/forms";

import { siteConfig } from "../data/site";
import {
  createSupabasePublishedFormRepository,
  getManagedFormDefinition,
  loadManagedFormProjection
} from "../../lib/builder/forms";
import { readNewsletterConfiguration } from "../../lib/newsletter/config";
import { readNewsletterPublicReadiness } from "../../lib/newsletter/readiness";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../../lib/supabase/admin";
import { TurnstileAwareBuilderForm } from "./TurnstileAwareBuilderForm";
import type { PublicLocale } from "../i18n/locale";
import { localizedBuilderText } from "../i18n/catalog.server";
import { localizedManagedFormProjection } from "../../lib/builder/forms";

type ResidentFormsProps = {
  type: "contact" | "newsletter" | "survey";
  locale?: PublicLocale;
  presentation?: "card" | "newsletter-page-first";
  labelledBy?: string;
};

type ActiveResidentFormType = Exclude<ResidentFormsProps["type"], "survey">;

const PUBLIC_FORM_CARD_COPY = Object.freeze({
  contact: Object.freeze({
    eyebrow: "District office service",
    heading: "Send a message to the District Office"
  }),
  newsletter: Object.freeze({
    eyebrow: "Email updates",
    heading: "Join the District Newsletter"
  })
});

function PublicFormCard({
  type,
  locale,
  unavailable = false,
  presentation = "card",
  labelledBy,
  children
}: {
  type: ActiveResidentFormType;
  locale: PublicLocale;
  unavailable?: boolean;
  presentation?: ResidentFormsProps["presentation"];
  labelledBy?: string;
  children: ReactNode;
}) {
  const copy = PUBLIC_FORM_CARD_COPY[type];
  const pageFirst = presentation === "newsletter-page-first";
  return (
    <div
      className={`form-panel public-form-card public-form-card-${type}${pageFirst ? " public-form-card-page-first" : ""}`}
      data-builder-form-unavailable={unavailable ? "true" : undefined}
      data-public-form-type={type}
      role={pageFirst ? unavailable ? "group" : "form" : undefined}
      aria-labelledby={pageFirst ? labelledBy : undefined}
    >
      {pageFirst ? null : (
        <header className="public-form-card-header">
          <p className="public-form-card-eyebrow">{localizedBuilderText(locale, `forms.${type}.eyebrow`, copy.eyebrow)}</p>
          <h3>{localizedBuilderText(locale, `forms.${type}.heading`, copy.heading)}</h3>
          <p className="public-form-card-requirements">
            {localizedBuilderText(locale, "forms.requirements", "Fields marked * are required. All other fields are optional.")}
          </p>
        </header>
      )}
      <div className="public-form-card-body">
        {pageFirst ? (
        <p className="public-form-card-requirements">
          {localizedBuilderText(locale, "forms.requirements", "Fields marked * are required. All other fields are optional.")}
        </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function Unavailable({ type, locale, presentation, labelledBy }: {
  type: ActiveResidentFormType;
  locale: PublicLocale;
  presentation?: ResidentFormsProps["presentation"];
  labelledBy?: string;
}) {
  return (
    <PublicFormCard type={type} locale={locale} unavailable presentation={presentation} labelledBy={labelledBy}>
      <UnavailableFormFallback
        businessName="the District 34 office"
        phone={siteConfig.phoneE164}
      />
    </PublicFormCard>
  );
}

export async function ResidentForm({ type, locale = "en", presentation = "card", labelledBy }: ResidentFormsProps) {
  if (type === "survey" || !getManagedFormDefinition(type)) {
    return (
      <div className="form-panel" data-builder-form-unavailable="true">
        <p role="status">
          {localizedBuilderText(locale, "forms.survey.unavailable", "This survey is not accepting online responses. Call the district office or use the official legislative contact options to share a priority.")}
        </p>
        <a className="cta-link" href={`tel:${siteConfig.phoneE164}`}>
          {localizedBuilderText(locale, "forms.call", "Call")} {siteConfig.phoneDisplay}
        </a>
      </div>
    );
  }

  const client = getBuilderAdminClient();
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!client || !turnstileSiteKey) return <Unavailable type={type} locale={locale} presentation={presentation} labelledBy={labelledBy} />;

  const siteId = await resolveBuilderSiteId(client);
  if (!siteId) return <Unavailable type={type} locale={locale} presentation={presentation} labelledBy={labelledBy} />;
  if (type === "newsletter") {
    const configuration = readNewsletterConfiguration();
    if (configuration.status !== "ready") return <Unavailable type={type} locale={locale} presentation={presentation} labelledBy={labelledBy} />;
    const readiness = await readNewsletterPublicReadiness(client, siteId, configuration);
    if (readiness.status !== "ready") return <Unavailable type={type} locale={locale} presentation={presentation} labelledBy={labelledBy} />;
  }

  const repository = createSupabasePublishedFormRepository({
    client,
    siteId,
    businessName: siteConfig.officeName,
    turnstileSiteKey
  });
  const result = await loadManagedFormProjection(type, { repository, siteId });
  if (result.status !== "ready") return <Unavailable type={type} locale={locale} presentation={presentation} labelledBy={labelledBy} />;
  const projection = localizedManagedFormProjection(type, result.projection, locale);

  return (
    <PublicFormCard type={type} locale={locale} presentation={presentation} labelledBy={labelledBy}>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />
      {type === "newsletter" ? (
        <aside className="newsletter-consent-context" aria-label={localizedBuilderText(locale, "forms.newsletter.context-label", "Newsletter confirmation and privacy notice")}>
          <strong>{localizedBuilderText(locale, "forms.newsletter.confirmation-required", "Confirmation is required")}</strong>
          <p>
            {localizedBuilderText(locale, "forms.newsletter.pending", "Submitting this form creates a pending District Newsletter confirmation request. You are not subscribed until you confirm using the email sent to your inbox.")}
          </p>
          <p>
            {localizedBuilderText(locale, "forms.newsletter.privacy-prefix", "Review how the office and Resend handle newsletter information in the")} <Link href="/privacy">{localizedBuilderText(locale, "forms.newsletter.privacy-link", "privacy notice")}</Link>.
            {" "}{localizedBuilderText(locale, "forms.newsletter.unsubscribe", "Every District Newsletter includes an unsubscribe link.")}
          </p>
        </aside>
      ) : null}
      <TurnstileAwareBuilderForm
        className="builder-public-form"
        endpoint={`/api/forms/${result.projection.formKey}`}
        projection={projection}
        variant={type}
        locale={locale}
      />
    </PublicFormCard>
  );
}
