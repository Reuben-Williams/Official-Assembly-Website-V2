import Script from "next/script";
import { BuilderForm, UnavailableFormFallback } from "@reuben-williams/next/forms";

import { siteConfig } from "../data/site";
import {
  createSupabasePublishedFormRepository,
  getManagedFormDefinition,
  loadManagedFormProjection
} from "../../lib/builder/forms";
import { readNewsletterConfiguration } from "../../lib/newsletter/config";
import { readNewsletterPublicReadiness } from "../../lib/newsletter/readiness";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../../lib/supabase/admin";

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
      <BuilderForm
        className="builder-public-form"
        endpoint={`/api/forms/${result.projection.formKey}`}
        projection={result.projection}
      />
    </div>
  );
}
