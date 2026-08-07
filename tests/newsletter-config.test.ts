import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  readNewsletterConfiguration,
  readNewsletterProviderInventoryConfiguration
} from "../lib/newsletter/config";
import { toSafeNewsletterLog } from "../lib/newsletter/safe-log";

const productionEnvironment = {
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://www.assemblywomanmorales.com",
  NEWSLETTER_EMAIL_ENABLED: "true",
  RESEND_SEND_API_KEY: "re_send_secret_value",
  RESEND_MANAGEMENT_API_KEY: "re_management_secret_value",
  RESEND_WEBHOOK_SECRET: "whsec_webhook_secret_value",
  RESEND_NEWSLETTER_SEGMENT_ID: "78261eea-8f8b-4381-83c6-79fa7120f1cf",
  RESEND_NEWSLETTER_TOPIC_ID: "b134d33a-4d91-4b5f-a186-04e48cfe0048",
  NEWSLETTER_CONFIRMATION_KEYRING: JSON.stringify({
    "2026-08": Buffer.alloc(32, 7).toString("base64url"),
    "2026-07": Buffer.alloc(32, 3).toString("base64url")
  }),
  NEWSLETTER_CONFIRMATION_ACTIVE_KEY_ID: "2026-08",
  NEWSLETTER_TEST_RECIPIENTS: JSON.stringify([
    "editor.one@example.com",
    "editor.two@example.com"
  ])
} satisfies Record<string, string>;

const inventoryEnvironment = {
  ...productionEnvironment,
  NEWSLETTER_EMAIL_ENABLED: "false",
  RESEND_SEND_API_KEY_ID: "key_newsletter_send",
  RESEND_MANAGEMENT_API_KEY_ID: "key_newsletter_management",
  RESEND_AUTH_SMTP_KEY_ID: "key_site_auth_smtp"
} satisfies Record<string, string>;

describe("readNewsletterConfiguration", () => {
  it("defaults to a disabled state without requiring provider secrets", () => {
    expect(readNewsletterConfiguration({ VERCEL_ENV: "production" })).toEqual({
      status: "disabled",
      code: "newsletter_disabled",
      environment: "production"
    });
  });

  it.each([
    ["RESEND_SEND_API_KEY", "missing_send_api_key"],
    ["RESEND_MANAGEMENT_API_KEY", "missing_management_api_key"],
    ["RESEND_WEBHOOK_SECRET", "missing_webhook_secret"],
    ["RESEND_NEWSLETTER_SEGMENT_ID", "invalid_segment_id"],
    ["RESEND_NEWSLETTER_TOPIC_ID", "invalid_topic_id"],
    ["NEXT_PUBLIC_SITE_URL", "invalid_canonical_site_url"],
    ["NEWSLETTER_CONFIRMATION_KEYRING", "invalid_confirmation_keyring"],
    ["NEWSLETTER_CONFIRMATION_ACTIVE_KEY_ID", "invalid_confirmation_active_key"],
    ["NEWSLETTER_TEST_RECIPIENTS", "invalid_test_recipient_allowlist"]
  ])("fails closed when %s is missing", (name, code) => {
    const environment = { ...productionEnvironment };
    delete environment[name as keyof typeof environment];

    expect(readNewsletterConfiguration(environment)).toMatchObject({
      status: "unavailable",
      code,
      environment: "production"
    });
  });

  it("rejects malformed key material and a missing active key", () => {
    expect(
      readNewsletterConfiguration({
        ...productionEnvironment,
        NEWSLETTER_CONFIRMATION_KEYRING: JSON.stringify({
          short: Buffer.alloc(16, 1).toString("base64url")
        }),
        NEWSLETTER_CONFIRMATION_ACTIVE_KEY_ID: "short"
      })
    ).toMatchObject({
      status: "unavailable",
      code: "invalid_confirmation_keyring"
    });

    expect(
      readNewsletterConfiguration({
        ...productionEnvironment,
        NEWSLETTER_CONFIRMATION_ACTIVE_KEY_ID: "not-in-keyring"
      })
    ).toMatchObject({
      status: "unavailable",
      code: "invalid_confirmation_active_key"
    });
  });

  it("rejects a malformed or duplicate staff-test allowlist", () => {
    expect(
      readNewsletterConfiguration({
        ...productionEnvironment,
        NEWSLETTER_TEST_RECIPIENTS: '["not-an-email"]'
      })
    ).toMatchObject({
      status: "unavailable",
      code: "invalid_test_recipient_allowlist"
    });

    expect(
      readNewsletterConfiguration({
        ...productionEnvironment,
        NEWSLETTER_TEST_RECIPIENTS:
          '["Editor.One@example.com","editor.one@example.com"]'
      })
    ).toMatchObject({
      status: "unavailable",
      code: "invalid_test_recipient_allowlist"
    });
  });

  it("rejects provider credentials in Preview even while disabled", () => {
    expect(
      readNewsletterConfiguration({
        VERCEL_ENV: "preview",
        NEWSLETTER_EMAIL_ENABLED: "false",
        RESEND_SEND_API_KEY: productionEnvironment.RESEND_SEND_API_KEY
      })
    ).toEqual({
      status: "unavailable",
      code: "preview_provider_credentials_forbidden",
      environment: "preview"
    });
  });

  it("rejects the temporary legacy API key and malformed feature flags", () => {
    expect(
      readNewsletterConfiguration({
        ...productionEnvironment,
        RESEND_API_KEY: "re_legacy_secret_value"
      })
    ).toMatchObject({
      status: "unavailable",
      code: "unsafe_legacy_api_key"
    });

    expect(
      readNewsletterConfiguration({
        ...productionEnvironment,
        NEWSLETTER_EMAIL_ENABLED: "yes"
      })
    ).toMatchObject({
      status: "unavailable",
      code: "invalid_feature_flag"
    });
  });

  it("returns a bounded ready state without credentials or recipient addresses", () => {
    const result = readNewsletterConfiguration(productionEnvironment);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      status: "ready",
      environment: "production",
      canonicalSiteUrl: "https://www.assemblywomanmorales.com",
      segmentId: productionEnvironment.RESEND_NEWSLETTER_SEGMENT_ID,
      topicId: productionEnvironment.RESEND_NEWSLETTER_TOPIC_ID,
      activeKeyId: "2026-08",
      verificationKeyIds: ["2026-07", "2026-08"],
      testRecipientCount: 2
    });
    expect(serialized).not.toContain("re_send_secret_value");
    expect(serialized).not.toContain("re_management_secret_value");
    expect(serialized).not.toContain("whsec_webhook_secret_value");
    expect(serialized).not.toContain("editor.one@example.com");
    expect(serialized).not.toContain(Buffer.alloc(32, 7).toString("base64url"));
  });
});

describe("readNewsletterProviderInventoryConfiguration", () => {
  it("validates the full hidden provider configuration while sending remains disabled", () => {
    expect(readNewsletterProviderInventoryConfiguration(inventoryEnvironment)).toEqual({
      status: "ready",
      environment: "production",
      canonicalSiteUrl: "https://www.assemblywomanmorales.com",
      segmentId: inventoryEnvironment.RESEND_NEWSLETTER_SEGMENT_ID,
      topicId: inventoryEnvironment.RESEND_NEWSLETTER_TOPIC_ID,
      sendKeyId: "key_newsletter_send",
      managementKeyId: "key_newsletter_management",
      authSmtpKeyId: "key_site_auth_smtp",
      webhookUrl: "https://www.assemblywomanmorales.com/api/webhooks/resend"
    });
  });

  it.each([
    "RESEND_SEND_API_KEY",
    "RESEND_MANAGEMENT_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "RESEND_NEWSLETTER_SEGMENT_ID",
    "RESEND_NEWSLETTER_TOPIC_ID",
    "RESEND_SEND_API_KEY_ID",
    "RESEND_MANAGEMENT_API_KEY_ID",
    "RESEND_AUTH_SMTP_KEY_ID"
  ])("fails safely when disabled-stage inventory value %s is missing", (name) => {
    const environment = { ...inventoryEnvironment };
    delete environment[name as keyof typeof environment];
    const result = readNewsletterProviderInventoryConfiguration(environment);
    expect(result).toMatchObject({ status: "unavailable", environment: "production" });
    expect(JSON.stringify(result)).not.toContain("re_send_secret_value");
    expect(JSON.stringify(result)).not.toContain("re_management_secret_value");
  });
});

describe("toSafeNewsletterLog", () => {
  it("keeps approved operational fields and drops secret or personal fields", () => {
    const safe = toSafeNewsletterLog({
      event: "newsletter.job.failed",
      code: "provider_unavailable",
      siteId: "site_123",
      jobId: "job_456",
      providerStatus: "rate_limited",
      httpStatus: 429,
      retryable: true,
      email: "resident@example.com",
      token: "confirm-secret-token",
      requestBody: { email: "resident@example.com" },
      messageBody: "private content",
      webhookPayload: { data: "private webhook" },
      apiKey: "re_secret"
    });
    const serialized = JSON.stringify(safe);

    expect(safe).toEqual({
      event: "newsletter.job.failed",
      code: "provider_unavailable",
      siteId: "site_123",
      jobId: "job_456",
      providerStatus: "rate_limited",
      httpStatus: 429,
      retryable: true
    });
    expect(serialized).not.toContain("resident@example.com");
    expect(serialized).not.toContain("confirm-secret-token");
    expect(serialized).not.toContain("private content");
    expect(serialized).not.toContain("private webhook");
    expect(serialized).not.toContain("re_secret");
  });
});
