import { describe, expect, it, vi } from "vitest";

import { createSupabaseNewsletterJobRepository } from "../lib/newsletter/job-repository";

describe("newsletter job repository", () => {
  it("claims owner-login evidence before the outbound-capable queue and preserves the total bound", async () => {
    const rpc = vi.fn(async (name: string, input: { p_request: Record<string, unknown> }) => {
      if (name === "builder_claim_newsletter_auth_login_jobs_v1") {
        return {
          data: {
            jobs: [{
              subject: "site",
              id: "owner-job",
              kind: "newsletter.auth_login.reconcile",
              occurrenceId: "occurrence-id",
              operatorId: "owner-id",
              authLastSignInAt: "2026-08-11T21:24:29.356981Z",
              fencingToken: 8,
              attemptCount: 2
            }]
          },
          error: null
        };
      }
      expect(name).toBe("builder_claim_newsletter_jobs_v1");
      return {
        data: {
          jobs: [{
            subject: "subscription",
            id: "confirmation-job",
            kind: "newsletter.confirmation.send",
            fencingToken: 9
          }]
        },
        error: null
      };
    });
    const maybeSingle = vi.fn(async () => ({ data: { attempt_count: 3 }, error: null }));
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const from = vi.fn(() => query);

    const repository = createSupabaseNewsletterJobRepository({ rpc, from } as never, "site-id");
    const jobs = await repository.claim({
      workerId: "worker-id",
      limit: 2,
      leaseSeconds: 120,
      emailEnabled: false
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "builder_claim_newsletter_auth_login_jobs_v1", {
      p_request: {
        version: 1,
        siteId: "site-id",
        workerId: "worker-id",
        limit: 2,
        leaseSeconds: 120
      }
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "builder_claim_newsletter_jobs_v1", {
      p_request: {
        version: 1,
        siteId: "site-id",
        workerId: "worker-id",
        limit: 1,
        leaseSeconds: 120,
        emailEnabled: false
      }
    });
    expect(jobs.map((job) => [job.id, job.attemptCount])).toEqual([
      ["owner-job", 2],
      ["confirmation-job", 3]
    ]);
    expect(from).toHaveBeenCalledOnce();
  });
});
