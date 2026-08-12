import { describe, expect, it, vi } from "vitest";

import { createNewsletterOwnerLoginReconciliationHandler } from "../lib/newsletter/owner-login-handler";

const job = {
  subject: "site" as const,
  id: "job-id",
  kind: "newsletter.auth_login.reconcile" as const,
  occurrenceId: "a3000000-0000-4000-8000-000000000001",
  operatorId: "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1",
  authLastSignInAt: "2026-08-11T21:24:29.356981Z",
  fencingToken: 3
};

function provider(overrides: Partial<{
  readonly id: string;
  readonly to: readonly string[];
}> = {}) {
  return {
    listEmails: vi.fn(async () => ({
      items: [{
        id: "message-1",
        status: "delivered",
        createdAt: "2026-08-11T21:24:21.547Z",
        from: "Office of Assemblywoman Carmen Morales <no-reply@updates.assemblywomanmorales.com>",
        to: ["owner@example.com"],
        subject: "Your sign-in link",
        ...overrides
      }],
      hasMore: false
    }))
  };
}

describe("newsletter owner-login reconciliation handler", () => {
  it("records one exact provider match through the durable evidence command", async () => {
    const recordEvidence = vi.fn(async () => ({ status: "recorded" as const }));
    const handler = createNewsletterOwnerLoginReconciliationHandler({
      siteId: "a3f57b25-df25-4d98-9ff6-a4a3f3a00a68",
      provider: provider(),
      data: {
        ownerEmail: vi.fn(async () => "owner@example.com"),
        excludedProviderMessageIds: vi.fn(async () => new Set<string>()),
        recordEvidence
      }
    });

    await expect(handler(job)).resolves.toEqual({
      code: "owner_login_evidence_recorded",
      alreadyCompleted: false
    });
    expect(recordEvidence).toHaveBeenCalledWith(expect.objectContaining({
      occurrenceId: job.occurrenceId,
      operatorId: job.operatorId,
      providerMessageId: "message-1",
      providerCreatedAt: "2026-08-11T21:24:21.547Z",
      authLastSignInAt: job.authLastSignInAt,
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
    }));
  });

  it("retries safely when the focused inventory is missing or ambiguous", async () => {
    const recordEvidence = vi.fn();
    const handler = createNewsletterOwnerLoginReconciliationHandler({
      siteId: "a3f57b25-df25-4d98-9ff6-a4a3f3a00a68",
      provider: provider({ to: ["other@example.com"] }),
      data: {
        ownerEmail: vi.fn(async () => "owner@example.com"),
        excludedProviderMessageIds: vi.fn(async () => new Set<string>()),
        recordEvidence
      }
    });

    await expect(handler(job)).rejects.toMatchObject({
      name: "NewsletterJobFailure",
      safeCode: "owner_login_evidence_pending",
      terminal: false
    });
    expect(recordEvidence).not.toHaveBeenCalled();
  });

  it("completes an idempotent database replay without another mutation", async () => {
    const handler = createNewsletterOwnerLoginReconciliationHandler({
      siteId: "a3f57b25-df25-4d98-9ff6-a4a3f3a00a68",
      provider: provider(),
      data: {
        ownerEmail: vi.fn(async () => "owner@example.com"),
        excludedProviderMessageIds: vi.fn(async () => new Set<string>()),
        recordEvidence: vi.fn(async () => ({ status: "already_recorded" as const }))
      }
    });

    await expect(handler(job)).resolves.toEqual({
      code: "owner_login_evidence_recorded",
      alreadyCompleted: false
    });
  });
});
