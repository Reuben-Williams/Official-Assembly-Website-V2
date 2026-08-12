import { describe, expect, it, vi } from "vitest";
import type { TrustedBaseFormSubmissionCommand } from "@reuben-williams/core";
import { PublicFormIngestionError } from "@reuben-williams/next/forms/server";

import {
  createManagedPublicFormIngestionService,
  createNewsletterPublicFormIngestionService
} from "../lib/newsletter/ingestion";
import { readNewsletterPublicReadiness } from "../lib/newsletter/readiness";
import { approvedNewsletterConsentLanguageDigest } from "../lib/newsletter/managed-form-revision";

const command = {
  version: 2,
  siteId: "31000000-0000-4000-8000-000000000001",
  formId: "31300000-0000-4000-8000-000000000001",
  formKey: "newsletter-signup",
  formRevisionId: "31400000-0000-4000-8000-000000000001",
  templateId: "local-business.newsletter-signup",
  templateVersion: "1.0.0",
  sourcePage: "/newsletter",
  idempotencyKey: "31500000-0000-4000-8000-000000000001",
  requestFingerprint: "1".repeat(64),
  submittedAt: "2026-08-06T17:00:00.000Z",
  locale: "en-US",
  qualificationResult: "not_configured",
  payload: { email: "reader@example.test" },
  payloadByteLength: 31,
  fieldCount: 1,
  consentEvidence: {
    policyVersion: "marketing-v1",
    purpose: "marketing_email",
    languageDigest: "2".repeat(64),
    source: "public_form",
    capturedAt: "2026-08-06T17:00:00.000Z"
  },
  securityReceiptId: "31600000-0000-4000-8000-000000000001",
  rateLimits: [
    {
      kind: "network",
      bucketKeyHmac: "3".repeat(64),
      windowStartedAt: "2026-08-06T17:00:00.000Z",
      windowEndsAt: "2026-08-06T18:00:00.000Z",
      limit: 10
    },
    {
      kind: "identity",
      bucketKeyHmac: "4".repeat(64),
      windowStartedAt: "2026-08-06T17:00:00.000Z",
      windowEndsAt: "2026-08-06T17:15:00.000Z",
      limit: 5
    }
  ]
} satisfies TrustedBaseFormSubmissionCommand;

describe("newsletter public ingestion", () => {
  it("leaves contact intake on strict v3 and routes newsletter intake only through the atomic RPC", async () => {
    const rpc = vi.fn(async (name: string, _parameters: unknown) => ({
      data: name === "builder_ingest_official_assembly_newsletter_v1"
        ? {
            version: 2,
            accepted: true,
            receiptId: command.securityReceiptId,
            result: "accepted",
            subscriptionId: "not-exposed",
            deliveryQueued: true
          }
        : {
            version: 2,
            accepted: true,
            receiptId: command.securityReceiptId,
            result: "accepted"
          },
      error: null
    }));

    const contact = createManagedPublicFormIngestionService({
      type: "contact",
      client: { rpc },
      confirmationKeyId: "2026-08"
    });
    const newsletter = createManagedPublicFormIngestionService({
      type: "newsletter",
      client: { rpc },
      confirmationKeyId: "2026-08"
    });

    await contact.ingest({ ...command, formKey: "contact", templateId: "local-business.contact" });
    const accepted = await newsletter.ingest(command);

    expect(rpc.mock.calls[0]?.[0]).toBe("builder_ingest_form_submission_strict_v3");
    expect(rpc.mock.calls[1]?.[0]).toBe("builder_ingest_official_assembly_newsletter_v1");
    expect(rpc.mock.calls[1]?.[1]).toEqual({
      p_request: {
        version: 1,
        confirmationKeyId: "2026-08",
        addressFingerprint: "4".repeat(64),
        ingestion: {
          ...command,
          consentEvidence: {
            ...command.consentEvidence,
            languageDigest: approvedNewsletterConsentLanguageDigest()
          }
        }
      }
    });
    expect(accepted).toEqual({
      version: 2,
      accepted: true,
      receiptId: command.securityReceiptId,
      result: "accepted"
    });
    expect(accepted).not.toHaveProperty("subscriptionId");
    expect(accepted).not.toHaveProperty("deliveryQueued");
  });

  it("fails closed without identity evidence and preserves bounded package error mappings", async () => {
    const noIdentity = {
      ...command,
      rateLimits: command.rateLimits.filter((entry) => entry.kind !== "identity")
    } as TrustedBaseFormSubmissionCommand;
    const service = createNewsletterPublicFormIngestionService(
      { rpc: vi.fn() },
      { confirmationKeyId: "2026-08" }
    );

    await expect(service.ingest(noIdentity)).rejects.toMatchObject({
      safeCode: "INGESTION_UNAVAILABLE"
    });

    for (const [databaseCode, safeCode] of [
      ["P2F29", "RATE_LIMITED"],
      ["P2F09", "REPLAY_CONFLICT"],
      ["P2N01", "REPLAY_CONFLICT"]
    ] as const) {
      const failing = createNewsletterPublicFormIngestionService(
        { rpc: vi.fn(async () => ({ data: null, error: { code: databaseCode } })) },
        { confirmationKeyId: "2026-08" }
      );
      await expect(failing.ingest(command)).rejects.toEqual(
        expect.objectContaining<Partial<PublicFormIngestionError>>({ safeCode })
      );
    }
  });

  it("requires both ready configuration and the non-mutating database projection", async () => {
    const rpc = vi.fn(async () => ({ data: { version: 1, ready: true }, error: null }));
    const readyConfiguration = {
      status: "ready" as const,
      environment: "production" as const,
      canonicalSiteUrl: "https://www.assemblywomanmorales.com",
      segmentId: "78261eea-8f8b-4381-83c6-79fa7120f1cf",
      topicId: "b134d33a-4d91-4b5f-a186-04e48cfe0048",
      activeKeyId: "2026-08",
      verificationKeyIds: ["2026-08"],
      testRecipientCount: 2
    };

    await expect(readNewsletterPublicReadiness({ rpc }, command.siteId, readyConfiguration)).resolves.toEqual({
      status: "ready"
    });
    expect(rpc).toHaveBeenCalledWith("builder_get_newsletter_public_readiness_v1", {
      p_site_id: command.siteId
    });

    rpc.mockClear();
    await expect(readNewsletterPublicReadiness(
      { rpc },
      command.siteId,
      { status: "disabled", code: "newsletter_disabled", environment: "production" }
    )).resolves.toEqual({ status: "unavailable", reason: "newsletter_disabled" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
