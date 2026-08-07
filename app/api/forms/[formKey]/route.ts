import {
  createPublicFormSubmissionRoute
} from "@reuben-williams/next/forms/server";
import {
  createCloudflareTurnstileVerifier,
  createHmacFingerprintService,
  createVercelTrustedNetworkAdapter
} from "@reuben-williams/next/ingestion/server";

import { siteConfig } from "../../../data/site";
import {
  createSupabasePublishedFormRepository,
  getManagedFormDefinition,
  isManagedPublicFormKey
} from "../../../../lib/builder/forms";
import { allowedBuilderOrigins } from "../../../../lib/builder/authorization";
import { readNewsletterConfiguration } from "../../../../lib/newsletter/config";
import { createManagedPublicFormIngestionService } from "../../../../lib/newsletter/ingestion";
import { createPackageCompatibleNewsletterSubmissionRequest } from "../../../../lib/newsletter/managed-form-revision";
import { readNewsletterPublicReadiness } from "../../../../lib/newsletter/readiness";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../../../../lib/supabase/admin";
import { APPROVED_FORM_TEMPLATES } from "@reuben-williams/forms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable(status = 503, code = "FORM_UNAVAILABLE") {
  return Response.json(
    { error: { code, message: "Online submission is unavailable. Please contact the district office." } },
    { status, headers: { "cache-control": "no-store" } }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ formKey: string }> }
) {
  const { formKey } = await params;
  if (!isManagedPublicFormKey(formKey)) return unavailable(404, "FORM_NOT_FOUND");
  const type = formKey === "contact" ? "contact" : "newsletter";
  const definition = getManagedFormDefinition(type);
  const admin = getBuilderAdminClient();
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  const fingerprintSecret = process.env.FORM_FINGERPRINT_SECRET;
  if (!definition || !admin || !turnstileSiteKey || !turnstileSecret || !fingerprintSecret ||
      fingerprintSecret.length < 32) return unavailable();

  const siteId = await resolveBuilderSiteId(admin);
  if (!siteId) return unavailable();
  const newsletterConfiguration = readNewsletterConfiguration();
  if (type === "newsletter") {
    if (newsletterConfiguration.status !== "ready") return unavailable();
    const readiness = await readNewsletterPublicReadiness(
      admin,
      siteId,
      newsletterConfiguration
    );
    if (readiness.status !== "ready") return unavailable();
  }
  const hostname = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? request.url).hostname;
  const repository = createSupabasePublishedFormRepository({
    client: admin,
    siteId,
    businessName: siteConfig.officeName,
    turnstileSiteKey
  });
  const route = createPublicFormSubmissionRoute({
    siteId,
    locale: "en-US",
    allowedOrigins: allowedBuilderOrigins(new URL(request.url).origin),
    repository,
    network: createVercelTrustedNetworkAdapter(),
    fingerprints: createHmacFingerprintService({
      keyId: "official-assembly-forms-v1",
      secret: fingerprintSecret
    }),
    turnstile: createCloudflareTurnstileVerifier({
      secret: turnstileSecret,
      expectedHostname: hostname,
      expectedAction: definition.action
    }),
    ingestion: createManagedPublicFormIngestionService({
      type,
      client: admin,
      confirmationKeyId:
        newsletterConfiguration.status === "ready"
          ? newsletterConfiguration.activeKeyId
          : "contact-only"
    }),
    rateLimits: {
      network: { limit: 10, windowMs: 3_600_000 },
      identity: { limit: 5, windowMs: 3_600_000 }
    },
    now: () => new Date(),
    uuid: () => crypto.randomUUID()
  });
  let submissionRequest = request;
  if (type === "newsletter") {
    const template = APPROVED_FORM_TEMPLATES.find((candidate) =>
      candidate.id === definition.templateId && candidate.version === definition.templateVersion
    );
    if (!template) return unavailable();
    try {
      submissionRequest = await createPackageCompatibleNewsletterSubmissionRequest({
        request,
        template,
        businessName: siteConfig.officeName
      });
    } catch {
      return unavailable(400, "INVALID_SUBMISSION");
    }
  }
  return route.handle(submissionRequest, { formKey });
}
