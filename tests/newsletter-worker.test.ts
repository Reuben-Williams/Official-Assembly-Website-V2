import { describe, expect, it, vi } from "vitest";

import {
  NewsletterJobFailure,
  calculateNewsletterRetryAt,
  runNewsletterWorker
} from "../lib/newsletter/worker";

const confirmationJob = {
  subject: "subscription" as const,
  id: "job-confirmation",
  kind: "newsletter.confirmation.send" as const,
  fencingToken: 3
};
const contactAuditJob = {
  subject: "site" as const,
  id: "job-contact-audit",
  kind: "newsletter.contact.audit" as const,
  fencingToken: 4
};
const broadcastAuditJob = {
  subject: "broadcast" as const,
  id: "job-broadcast-audit",
  kind: "newsletter.broadcast.audit" as const,
  fencingToken: 5
};

describe("newsletter durable worker", () => {
  it("uses bounded claims, completes with fencing, and never executes outbound work while disabled", async () => {
    const complete = vi.fn(async () => undefined);
    const repository = {
      claim: vi.fn(async () => [confirmationJob, contactAuditJob, broadcastAuditJob]),
      complete,
      fail: vi.fn(async () => undefined)
    };
    const handlers = {
      confirmationSend: vi.fn(),
      contactSync: vi.fn(),
      contactAudit: vi.fn(async () => ({ code: "audit_complete" })),
      segmentReconcile: vi.fn(),
      broadcastAudit: vi.fn(async () => ({ code: "audit_complete" }))
    };

    const result = await runNewsletterWorker({
      repository,
      handlers,
      workerId: "worker-disabled",
      emailEnabled: false,
      limit: 500,
      now: () => new Date("2026-08-06T17:00:00.000Z"),
      random: () => 0.5
    });

    expect(repository.claim).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, emailEnabled: false }));
    expect(handlers.confirmationSend).not.toHaveBeenCalled();
    expect(handlers.contactAudit).toHaveBeenCalledOnce();
    expect(handlers.broadcastAudit).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ job: contactAuditJob, fencingToken: 4 }));
    expect(result).toEqual({ claimed: 3, completed: 2, failed: 0, blocked: 1 });
  });

  it("retries the same leased job with bounded exponential backoff and safe failure codes", async () => {
    const fail = vi.fn(async () => undefined);
    const repository = {
      claim: vi.fn(async () => [{ ...confirmationJob, attemptCount: 4 }]),
      complete: vi.fn(),
      fail
    };
    const handlers = {
      confirmationSend: vi.fn(async () => { throw new NewsletterJobFailure("provider_unavailable", false); }),
      contactSync: vi.fn(),
      contactAudit: vi.fn(),
      segmentReconcile: vi.fn(),
      broadcastAudit: vi.fn()
    };
    const now = new Date("2026-08-06T17:00:00.000Z");

    await runNewsletterWorker({
      repository,
      handlers,
      workerId: "worker-retry",
      emailEnabled: true,
      limit: 10,
      now: () => now,
      random: () => 0
    });

    expect(fail).toHaveBeenCalledWith(expect.objectContaining({
      job: expect.objectContaining({ id: confirmationJob.id }),
      fencingToken: 3,
      terminal: false,
      failureCode: "provider_unavailable",
      retryAt: calculateNewsletterRetryAt(now, 4, () => 0)
    }));
  });
});
