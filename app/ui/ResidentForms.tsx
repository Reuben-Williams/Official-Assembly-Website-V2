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

type ResidentFormsProps = {
  type: "contact" | "newsletter" | "survey";
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
  unavailable = false,
  children
}: {
  type: ActiveResidentFormType;
  unavailable?: boolean;
  children: ReactNode;
}) {
  const copy = PUBLIC_FORM_CARD_COPY[type];
  return (
    <div
      className={`form-panel public-form-card public-form-card-${type}`}
      data-builder-form-unavailable={unavailable ? "true" : undefined}
      data-public-form-type={type}
    >
      <header className="public-form-card-header">
        <p className="public-form-card-eyebrow">{copy.eyebrow}</p>
        <h3>{copy.heading}</h3>
        <p className="public-form-card-requirements">
          Fields marked * are required. All other fields are optional.
        </p>
      </header>
      <div className="public-form-card-body">{children}</div>
    </div>
  );
}

function Unavailable({ type }: { type: ActiveResidentFormType }) {
  return (
    <PublicFormCard type={type} unavailable>
      <UnavailableFormFallback
        businessName="the District 34 office"
        phone={siteConfig.phoneE164}
      />
    </PublicFormCard>
  );
}

export async function ResidentForm({ type }: ResidentFormsProps) {
  if (type === "survey" || !getManagedFormDefinition(type)) {
    return (
      <div className="form-panel" data-builder-form-unavailable="true">
        <p role="status">
          This survey is not accepting online responses. Call the district office or use the
          official legislative contact options to share a priority.
        </p>
        <a className="cta-link" href={`tel:${siteConfig.phoneE164}`}>
          Call {siteConfig.phoneDisplay}
        </a>
      </div>
    );
  }

  const client = getBuilderAdminClient();
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!client || !turnstileSiteKey) return <Unavailable type={type} />;

  const siteId = await resolveBuilderSiteId(client);
  if (!siteId) return <Unavailable type={type} />;
  if (type === "newsletter") {
    const configuration = readNewsletterConfiguration();
    if (configuration.status !== "ready") return <Unavailable type={type} />;
    const readiness = await readNewsletterPublicReadiness(client, siteId, configuration);
    if (readiness.status !== "ready") return <Unavailable type={type} />;
  }

  const repository = createSupabasePublishedFormRepository({
    client,
    siteId,
    businessName: siteConfig.officeName,
    turnstileSiteKey
  });
  const result = await loadManagedFormProjection(type, { repository, siteId });
  if (result.status !== "ready") return <Unavailable type={type} />;

  return (
    <PublicFormCard type={type}>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />
      {type === "newsletter" ? (
        <aside className="newsletter-consent-context" aria-label="Newsletter confirmation and privacy notice">
          <strong>Confirmation is required</strong>
          <p>
            Submitting this form creates a pending District Newsletter confirmation request.
            You are not subscribed until you confirm using the email sent to your inbox.
          </p>
          <p>
            Review how the office and Resend handle newsletter information in the <Link href="/privacy">privacy notice</Link>.
            Every District Newsletter includes an unsubscribe link.
          </p>
        </aside>
      ) : null}
      <TurnstileAwareBuilderForm
        className="builder-public-form"
        endpoint={`/api/forms/${result.projection.formKey}`}
        projection={result.projection}
        variant={type}
      />
    </PublicFormCard>
  );
}
