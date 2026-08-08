import Script from "next/script";
import Link from "next/link";
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

function Unavailable() {
  return (
    <div className="form-panel" data-builder-form-unavailable="true">
      <UnavailableFormFallback
        businessName="the District 34 office"
        phone={siteConfig.phoneE164}
      />
    </div>
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
  if (!client || !turnstileSiteKey) return <Unavailable />;

  const siteId = await resolveBuilderSiteId(client);
  if (!siteId) return <Unavailable />;
  if (type === "newsletter") {
    const configuration = readNewsletterConfiguration();
    if (configuration.status !== "ready") return <Unavailable />;
    const readiness = await readNewsletterPublicReadiness(client, siteId, configuration);
    if (readiness.status !== "ready") return <Unavailable />;
  }

  const repository = createSupabasePublishedFormRepository({
    client,
    siteId,
    businessName: siteConfig.officeName,
    turnstileSiteKey
  });
  const result = await loadManagedFormProjection(type, { repository, siteId });
  if (result.status !== "ready") return <Unavailable />;

  return (
    <div className="form-panel">
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
      />
    </div>
  );
}
