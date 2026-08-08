import {
  APPROVED_FORM_TEMPLATES,
  FormConfigurationError,
  classifyTemplateCompatibility,
  createPublicFormProjection
} from "@reuben-williams/forms";
import type { PublicBuilderFormProjection } from "@reuben-williams/next/forms";
import type {
  PublishedFormRecord,
  PublishedFormRepository
} from "@reuben-williams/next/forms/server";

import {
  applyApprovedNewsletterConsentProjection,
  newsletterPackageCompatibleConfiguration
} from "../newsletter/managed-form-revision";

type ManagedFormType = "contact" | "newsletter" | "survey";

export const managedFormDefinitions = Object.freeze({
  contact: Object.freeze({
    formKey: "contact",
    templateId: "local-business.contact",
    templateVersion: "1.0.0",
    action: "contact",
    requiresMarketingConsent: false
  }),
  newsletter: Object.freeze({
    formKey: "newsletter-signup",
    templateId: "local-business.newsletter-signup",
    templateVersion: "1.0.0",
    action: "newsletter",
    requiresMarketingConsent: true
  })
});

export function getManagedFormDefinition(type: ManagedFormType) {
  if (type === "survey") return null;
  return managedFormDefinitions[type];
}

export function isManagedPublicFormKey(value: string): boolean {
  return Object.values(managedFormDefinitions).some((definition) => definition.formKey === value);
}

export async function loadManagedFormProjection(
  type: ManagedFormType,
  input: { repository: PublishedFormRepository; siteId?: string }
) {
  const definition = getManagedFormDefinition(type);
  if (!definition) return { status: "unsupported" as const, reason: "UNAPPROVED_TEMPLATE" as const };
  try {
    const siteId = input.siteId ?? "official-assembly-website-v2";
    const record = await input.repository.getPublishedForm(siteId, definition.formKey);
    if (!record || record.siteId !== siteId || record.formKey !== definition.formKey) {
      return { status: "unavailable" as const, reason: "FORM_NOT_FOUND" as const };
    }
    if (record.status === "archived") {
      return { status: "unavailable" as const, reason: "FORM_ARCHIVED" as const };
    }
    if (record.status !== "active") {
      return { status: "unavailable" as const, reason: "FORM_INACTIVE" as const };
    }
    const revision = record.publishedRevision;
    const compatibility = classifyTemplateCompatibility({
      templateId: revision.templateId,
      templateVersion: revision.templateVersion,
      contractDigest: revision.contractDigest,
      formsPackageVersion: revision.formsPackageVersion,
      schemaVersion: revision.schemaVersion,
      runtimeContractVersion: revision.runtimeContractVersion
    }, APPROVED_FORM_TEMPLATES);
    const template = APPROVED_FORM_TEMPLATES.find((candidate) =>
      candidate.id === revision.templateId && candidate.version === revision.templateVersion);
    if (!template || compatibility.status !== "compatible") {
      return { status: "unavailable" as const, reason: "FORM_INCOMPATIBLE" as const };
    }
    const packageProjection = createPublicFormProjection(
      template,
      revision.configuration,
      record.manifest
    );
    const publicProjection = type === "newsletter"
      ? applyApprovedNewsletterConsentProjection(packageProjection)
      : packageProjection;
    const projection: PublicBuilderFormProjection = Object.freeze({
      formKey: record.formKey,
      revisionId: revision.id,
      displayName: publicProjection.displayName,
      fields: publicProjection.fields,
      consent: publicProjection.consent,
      completion: Object.freeze({ mode: publicProjection.completion.mode }),
      turnstile: Object.freeze({ ...record.turnstile })
    });
    return { status: "ready" as const, projection };
  } catch (error) {
    if (error instanceof FormConfigurationError) {
      return { status: "unavailable" as const, reason: "FORM_INCOMPATIBLE" as const };
    }
    return { status: "unavailable" as const, reason: "FORM_DATA_UNAVAILABLE" as const };
  }
}

type FormsRpcClient = {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

type PublishedFormRow = {
  formId: string;
  formKey: string;
  revisionId: string;
  templateId: string;
  templateVersion: string;
  contractDigest: string;
  configuration: PublishedFormRecord["publishedRevision"]["configuration"];
};

function publishedFormRow(value: unknown): PublishedFormRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const key of ["formId", "formKey", "revisionId", "templateId", "templateVersion", "contractDigest"]) {
    if (typeof row[key] !== "string" || !row[key]) return null;
  }
  if (!row.configuration || typeof row.configuration !== "object" || Array.isArray(row.configuration)) return null;
  return row as unknown as PublishedFormRow;
}

export function createSupabasePublishedFormRepository(input: {
  client: FormsRpcClient;
  siteId: string;
  businessName: string;
  turnstileSiteKey: string;
}): PublishedFormRepository {
  return {
    async getPublishedForm(siteId, formKey) {
      if (siteId !== input.siteId) return null;
      const definition = Object.values(managedFormDefinitions).find((candidate) => candidate.formKey === formKey);
      if (!definition) return null;
      const result = await input.client.rpc("builder_get_published_form_v1", {
        p_site_id: input.siteId,
        p_form_key: formKey
      });
      if (result.error) throw new Error("Published form query failed.");
      const row = publishedFormRow(result.data);
      if (!row || row.formKey !== formKey || row.templateId !== definition.templateId ||
          row.templateVersion !== definition.templateVersion) return null;
      const template = APPROVED_FORM_TEMPLATES.find((candidate) =>
        candidate.id === row.templateId && candidate.version === row.templateVersion);
      if (!template || template.contractDigest !== row.contractDigest) return null;

      return {
        siteId: input.siteId,
        formId: row.formId,
        formKey: row.formKey,
        status: "active",
        publishedRevision: {
          id: row.revisionId,
          templateId: row.templateId,
          templateVersion: row.templateVersion,
          contractDigest: row.contractDigest,
          formsPackageVersion: "0.2.1",
          schemaVersion: "20260805205128",
          runtimeContractVersion: 1,
          configuration: row.templateId === "local-business.newsletter-signup"
            ? newsletterPackageCompatibleConfiguration(row.configuration)
            : row.configuration
        },
        manifest: {
          businessName: input.businessName,
          optionSources: {},
          approvedRedirectPaths: ["/contact", "/newsletter"]
        },
        turnstile: { siteKey: input.turnstileSiteKey, action: definition.action }
      };
    }
  };
}
