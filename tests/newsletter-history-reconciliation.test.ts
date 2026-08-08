import { describe, expect, it } from "vitest";

import {
  APPROVED_NEWSLETTER_HISTORY_AUTH_MESSAGE_IDS,
  APPROVED_NEWSLETTER_HISTORY_FAILED_MESSAGE_ID,
  NewsletterHistoryReconciliationError,
  createNewsletterHistoryReconciliationDigest,
  planNewsletterHistoryReconciliation
} from "../lib/newsletter/history-reconciliation";
import type { NewsletterProviderInventorySnapshot } from "../lib/newsletter/provider-inventory";
import { collectAllowedNewsletterProviderMessageIds } from "../lib/newsletter/provider-inventory-repository";

const proofIds = new Set([
  "6d01e63a-4fea-471c-937e-4d869a3760d1",
  "8c2096bb-0eaf-4e72-a899-6afdff68b7aa"
]);

function input(overrides: {
  readonly emails?: NewsletterProviderInventorySnapshot["emails"];
  readonly receipts?: readonly {
    readonly providerMessageId: string;
    readonly eventType: string;
    readonly providerBroadcastId: string;
    readonly disposition: string;
  }[];
} = {}) {
  const authIds = [...APPROVED_NEWSLETTER_HISTORY_AUTH_MESSAGE_IDS, ...proofIds];
  const emails: NewsletterProviderInventorySnapshot["emails"] = [
    ...authIds.map((id, index) => ({
      id,
      status: "delivered",
      createdAt: `2026-08-07T${String(17 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}:00.000Z`,
      from: "Office of Assemblywoman Carmen Morales <auth@updates.assemblywomanmorales.com>",
      to: ["OWNER@example.com"],
      subject: "Your sign-in link"
    })),
    {
      id: APPROVED_NEWSLETTER_HISTORY_FAILED_MESSAGE_ID,
      status: "failed",
      createdAt: "2026-08-06T14:00:00.000Z",
      from: "onboarding@resend.dev",
      to: ["owner@example.com"],
      subject: "Hello World"
    }
  ];
  const receipts = authIds.flatMap((providerMessageId) => [
    {
      providerMessageId,
      eventType: "email.sent",
      providerBroadcastId: "",
      disposition: "matched"
    },
    {
      providerMessageId,
      eventType: "email.delivered",
      providerBroadcastId: "",
      disposition: "matched"
    }
  ]);

  return {
    ownerEmail: "owner@example.com",
    emails: overrides.emails ?? emails,
    receipts: overrides.receipts ?? receipts,
    existingAuthProofIds: proofIds
  };
}

describe("newsletter provider history reconciliation", () => {
  it("creates an exact eight-entry plan while preserving the two existing Auth proofs", () => {
    const result = planNewsletterHistoryReconciliation(input());

    expect(result).toMatchObject({
      state: "ready",
      providerHistoryCount: 10,
      existingAuthProofCount: 2,
      entries: expect.arrayContaining([
        expect.objectContaining({
          providerMessageId: APPROVED_NEWSLETTER_HISTORY_FAILED_MESSAGE_ID,
          classification: "unattributed_failed_setup_test",
          providerStatus: "failed"
        })
      ])
    });
    expect(result.entries).toHaveLength(8);
    expect(result.entries.filter((entry) => entry.classification === "auth_smtp_magic_link"))
      .toHaveLength(7);
  });

  it("fails closed on any provider message outside the approved ten-record history", () => {
    const baseline = input();
    expect(() => planNewsletterHistoryReconciliation({
      ...baseline,
      emails: [...baseline.emails, {
        id: "unexpected-message",
        status: "delivered",
        createdAt: "2026-08-08T01:00:00.000Z",
        from: "newsletter@updates.assemblywomanmorales.com",
        to: ["resident@example.com"],
        subject: "Unreviewed mail"
      }]
    })).toThrowError(expect.objectContaining<Partial<NewsletterHistoryReconciliationError>>({
      code: "unexpected_provider_history"
    }));
  });

  it("requires exact Auth metadata plus matched sent and delivered webhook evidence", () => {
    const baseline = input();
    const target = APPROVED_NEWSLETTER_HISTORY_AUTH_MESSAGE_IDS[0];
    expect(() => planNewsletterHistoryReconciliation({
      ...baseline,
      receipts: baseline.receipts.filter((receipt) =>
        receipt.providerMessageId !== target || receipt.eventType !== "email.delivered"
      )
    })).toThrowError(expect.objectContaining<Partial<NewsletterHistoryReconciliationError>>({
      code: "unverified_auth_history"
    }));

    expect(() => planNewsletterHistoryReconciliation({
      ...baseline,
      emails: baseline.emails.map((email) => email.id === target
        ? { ...email, subject: "District update" }
        : email)
    })).toThrowError(expect.objectContaining<Partial<NewsletterHistoryReconciliationError>>({
      code: "unverified_auth_history"
    }));
  });

  it("accepts the failed setup artifact only when it never emitted a webhook receipt", () => {
    const baseline = input();
    expect(() => planNewsletterHistoryReconciliation({
      ...baseline,
      receipts: [...baseline.receipts, {
        providerMessageId: APPROVED_NEWSLETTER_HISTORY_FAILED_MESSAGE_ID,
        eventType: "email.sent",
        providerBroadcastId: "",
        disposition: "matched"
      }]
    })).toThrowError(expect.objectContaining<Partial<NewsletterHistoryReconciliationError>>({
      code: "invalid_failed_setup_history"
    }));
  });

  it("derives deterministic secret-safe batch evidence", () => {
    const plan = planNewsletterHistoryReconciliation(input());
    const first = createNewsletterHistoryReconciliationDigest({
      siteId: "34000000-0000-4000-8000-000000000001",
      operatorId: "34300000-0000-4000-8000-000000000001",
      entries: plan.entries
    });
    const second = createNewsletterHistoryReconciliationDigest({
      siteId: "34000000-0000-4000-8000-000000000001",
      operatorId: "34300000-0000-4000-8000-000000000001",
      entries: plan.entries
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("example.com");
  });

  it("adds reconciled history to allowed inventory evidence without weakening broadcasts", () => {
    const ids = collectAllowedNewsletterProviderMessageIds({
      confirmationJobs: [{ provider_message_id: "confirmation-1" }],
      staffTests: [{ provider_message_id: "staff-test-1" }],
      authSmtpProofs: [{ provider_message_id: "auth-proof-1" }],
      historyReconciliations: [{ provider_message_id: "history-1" }],
      receipts: [
        { provider_message_id: "broadcast-message-1", provider_broadcast_id: "broadcast-1" },
        { provider_message_id: "unmapped-message", provider_broadcast_id: "broadcast-unmapped" }
      ],
      allowedSentBroadcastIds: new Set(["broadcast-1"])
    });

    expect([...ids].sort()).toEqual([
      "auth-proof-1",
      "broadcast-message-1",
      "confirmation-1",
      "history-1",
      "staff-test-1"
    ]);
  });
});
