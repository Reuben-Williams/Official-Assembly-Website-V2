import "server-only";

import { Buffer } from "node:buffer";

import { NEWSLETTER_ERROR_CODES } from "./errors";
import type {
  NewsletterConfigurationState,
  NewsletterEnvironment,
  NewsletterEnvironmentInput
} from "./types";

const PRODUCTION_SITE_URL = "https://www.assemblywomanmorales.com";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVIDER_SECRET_NAMES = [
  "RESEND_SEND_API_KEY",
  "RESEND_MANAGEMENT_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "RESEND_API_KEY"
] as const;

function normalizeEnvironment(value: string | undefined): NewsletterEnvironment {
  if (value === "production" || value === "preview") {
    return value;
  }
  return "development";
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unavailable(
  environment: NewsletterEnvironment,
  code: Exclude<
    NewsletterConfigurationState,
    { status: "disabled" } | { status: "ready" }
  >["code"]
): NewsletterConfigurationState {
  return { status: "unavailable", code, environment };
}

function parseKeyring(value: string | undefined): string[] | null {
  if (!hasValue(value)) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0 || entries.length > 16) return null;

    for (const [keyId, material] of entries) {
      if (!KEY_ID_PATTERN.test(keyId) || typeof material !== "string") return null;
      if (!BASE64URL_PATTERN.test(material)) return null;

      const decoded = Buffer.from(material, "base64url");
      if (decoded.length < 32 || decoded.toString("base64url") !== material) return null;
    }

    return entries.map(([keyId]) => keyId).sort();
  } catch {
    return null;
  }
}

function parseTestRecipientCount(value: string | undefined): number | null {
  if (!hasValue(value)) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 25) return null;

    const canonical = new Set<string>();
    for (const candidate of parsed) {
      if (typeof candidate !== "string") return null;
      const normalized = candidate.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(normalized) || canonical.has(normalized)) return null;
      canonical.add(normalized);
    }

    return canonical.size;
  } catch {
    return null;
  }
}

export function readNewsletterConfiguration(
  input: NewsletterEnvironmentInput = process.env
): NewsletterConfigurationState {
  const environment = normalizeEnvironment(input.VERCEL_ENV);
  const providerCredentialPresent = PROVIDER_SECRET_NAMES.some((name) =>
    hasValue(input[name])
  );

  if (environment === "preview" && providerCredentialPresent) {
    return unavailable(
      environment,
      NEWSLETTER_ERROR_CODES.previewCredentialsForbidden
    );
  }

  if (hasValue(input.RESEND_API_KEY)) {
    return unavailable(environment, NEWSLETTER_ERROR_CODES.legacyApiKey);
  }

  const enabledValue = input.NEWSLETTER_EMAIL_ENABLED?.trim() ?? "false";
  if (enabledValue !== "true" && enabledValue !== "false") {
    return unavailable(environment, NEWSLETTER_ERROR_CODES.invalidFeatureFlag);
  }

  if (enabledValue === "false") {
    return {
      status: "disabled",
      code: NEWSLETTER_ERROR_CODES.disabled,
      environment
    };
  }

  if (environment !== "production") {
    return unavailable(environment, NEWSLETTER_ERROR_CODES.environmentNotProduction);
  }

  if (!hasValue(input.RESEND_SEND_API_KEY)) {
    return unavailable(environment, NEWSLETTER_ERROR_CODES.missingSendApiKey);
  }
  if (!hasValue(input.RESEND_MANAGEMENT_API_KEY)) {
    return unavailable(environment, NEWSLETTER_ERROR_CODES.missingManagementApiKey);
  }
  if (!hasValue(input.RESEND_WEBHOOK_SECRET)) {
    return unavailable(environment, NEWSLETTER_ERROR_CODES.missingWebhookSecret);
  }
  if (!hasValue(input.RESEND_NEWSLETTER_SEGMENT_ID) || !UUID_PATTERN.test(input.RESEND_NEWSLETTER_SEGMENT_ID)) {
    return unavailable(environment, NEWSLETTER_ERROR_CODES.invalidSegmentId);
  }
  if (!hasValue(input.RESEND_NEWSLETTER_TOPIC_ID) || !UUID_PATTERN.test(input.RESEND_NEWSLETTER_TOPIC_ID)) {
    return unavailable(environment, NEWSLETTER_ERROR_CODES.invalidTopicId);
  }
  if (input.NEXT_PUBLIC_SITE_URL !== PRODUCTION_SITE_URL) {
    return unavailable(environment, NEWSLETTER_ERROR_CODES.invalidCanonicalSiteUrl);
  }

  const verificationKeyIds = parseKeyring(input.NEWSLETTER_CONFIRMATION_KEYRING);
  if (!verificationKeyIds) {
    return unavailable(environment, NEWSLETTER_ERROR_CODES.invalidConfirmationKeyring);
  }

  const activeKeyId = input.NEWSLETTER_CONFIRMATION_ACTIVE_KEY_ID?.trim() ?? "";
  if (!KEY_ID_PATTERN.test(activeKeyId) || !verificationKeyIds.includes(activeKeyId)) {
    return unavailable(
      environment,
      NEWSLETTER_ERROR_CODES.invalidConfirmationActiveKey
    );
  }

  const testRecipientCount = parseTestRecipientCount(
    input.NEWSLETTER_TEST_RECIPIENTS
  );
  if (testRecipientCount === null) {
    return unavailable(
      environment,
      NEWSLETTER_ERROR_CODES.invalidTestRecipientAllowlist
    );
  }

  return {
    status: "ready",
    environment: "production",
    canonicalSiteUrl: PRODUCTION_SITE_URL,
    segmentId: input.RESEND_NEWSLETTER_SEGMENT_ID,
    topicId: input.RESEND_NEWSLETTER_TOPIC_ID,
    activeKeyId,
    verificationKeyIds,
    testRecipientCount
  };
}
