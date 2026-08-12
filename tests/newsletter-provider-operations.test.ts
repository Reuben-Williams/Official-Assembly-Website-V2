import { describe, expect, it, vi } from "vitest";

import {
  createNewsletterAuthSmtpProofDigest,
  createNewsletterHistoryReconciliationDigest,
  createNewsletterProviderAttestationDigest,
  createNewsletterProviderOperationsRepository,
  NEWSLETTER_PROVIDER_ATTESTATION_CATEGORIES
} from "../lib/newsletter/provider-operations-repository";

const siteId = "34000000-0000-4000-8000-000000000001";
const operatorId = "34300000-0000-4000-8000-000000000001";

describe("newsletter provider operations repository", () => {
  it("derives bounded evidence from fixed categories and a UTC day", () => {
    const first = createNewsletterProviderAttestationDigest({
      siteId,
      operatorId,
      observedAt: new Date("2026-08-07T14:00:00.000Z")
    });
    const sameDay = createNewsletterProviderAttestationDigest({
      siteId,
      operatorId,
      observedAt: new Date("2026-08-07T23:59:59.000Z")
    });
    const nextDay = createNewsletterProviderAttestationDigest({
      siteId,
      operatorId,
      observedAt: new Date("2026-08-08T00:00:00.000Z")
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(sameDay).toBe(first);
    expect(nextDay).not.toBe(first);
    expect(NEWSLETTER_PROVIDER_ATTESTATION_CATEGORIES).toEqual([
      "billing_ownership",
      "oauth_application_view",
      "team_membership"
    ]);
  });

  it("keeps provider identifiers and zero-boundary evidence server-owned", async () => {
    const rpc = vi.fn(async () => ({
      data: { version: 1, status: "active", replayed: false },
      error: null
    }));
    const repository = createNewsletterProviderOperationsRepository({ rpc } as never, siteId);

    await repository.recordAttestation({
      commandId: "34000000-0000-4000-8000-000000000011",
      operatorId,
      safeEvidenceDigest: "a".repeat(64)
    });
    await repository.activate({
      commandId: "34000000-0000-4000-8000-000000000012",
      operatorId,
      resourceIdentityDigest: "b".repeat(64)
    });
    await repository.recordAuthSmtpProof({
      commandId: "34000000-0000-4000-8000-000000000013",
      operatorId,
      proofKind: "replacement_login",
      providerMessageId: "auth-message-1",
      providerCreatedAt: "2026-08-07T18:00:00.000Z",
      authLastSignInAt: "2026-08-07T18:01:00.000Z",
      safeEvidenceDigest: "c".repeat(64)
    });
    await repository.recordHistoryReconciliation({
      commandId: "34000000-0000-4000-8000-000000000014",
      operatorId,
      safeEvidenceDigest: "d".repeat(64),
      entries: [{
        providerMessageId: "history-message-1",
        classification: "auth_smtp_magic_link",
        providerStatus: "delivered",
        providerCreatedAt: "2026-08-07T17:00:00.000Z"
      }]
    });

    expect(rpc).toHaveBeenNthCalledWith(1,
      "builder_record_newsletter_inventory_attestation_v1",
      { p_request: expect.objectContaining({
        siteId,
        operatorId,
        categories: NEWSLETTER_PROVIDER_ATTESTATION_CATEGORIES
      }) }
    );
    expect(rpc).toHaveBeenNthCalledWith(2,
      "builder_record_newsletter_provider_activation_v1",
      { p_request: expect.objectContaining({
        siteId,
        operatorId,
        providerContactCount: 0,
        localEligibleCount: 0,
        historicalSendCount: 0
      }) }
    );
    expect(rpc).toHaveBeenNthCalledWith(3,
      "builder_record_newsletter_auth_smtp_proof_v1",
      { p_request: expect.objectContaining({
        siteId,
        operatorId,
        proofKind: "replacement_login",
        providerMessageId: "auth-message-1"
      }) }
    );
    expect(rpc).toHaveBeenNthCalledWith(4,
      "builder_record_newsletter_history_reconciliation_v2",
      { p_request: expect.objectContaining({
        siteId,
        operatorId,
        version: 2,
        policyVersion: "resend-initial-history-v2",
        safeEvidenceDigest: "d".repeat(64),
        entries: [expect.objectContaining({
          providerMessageId: "history-message-1",
          classification: "auth_smtp_magic_link"
        })]
      }) }
    );
  });

  it("derives secret-safe Auth SMTP evidence without an address or message body", () => {
    const input = {
      siteId,
      operatorId,
      proofKind: "replacement_login" as const,
      providerMessageId: "auth-message-1",
      providerCreatedAt: "2026-08-07T18:00:00.000Z",
      authLastSignInAt: "2026-08-07T18:01:00.000Z"
    };
    const first = createNewsletterAuthSmtpProofDigest(input);
    const second = createNewsletterAuthSmtpProofDigest(input);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("example.com");
  });

  it("derives immutable history evidence from metadata only", () => {
    const first = createNewsletterHistoryReconciliationDigest({
      siteId,
      operatorId,
      entries: [{
        providerMessageId: "history-message-1",
        classification: "unattributed_failed_setup_test",
        providerStatus: "failed",
        providerCreatedAt: "2026-08-06T14:00:00.000Z"
      }]
    });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("example.com");
  });
});
