import { describe, expect, it, vi } from "vitest";

import { createSupabaseRecoveryWorkerRepository } from "../lib/builder/recovery";

function thenable(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const name of ["update", "eq", "select", "maybeSingle"]) chain[name] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

describe("Supabase recovery worker repository", () => {
  it("claims and completes only through the fenced service RPCs", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{
          site_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          generation_id: 4,
          fence_token: 3,
          attempt_count: 2
        }],
        error: null
      })
      .mockResolvedValueOnce({ data: true, error: null });
    const repository = createSupabaseRecoveryWorkerRepository({ rpc, from: vi.fn() } as never);

    const claim = await repository.claim({ workerId: "worker-a", leaseSeconds: 60 });
    expect(claim).toEqual({
      siteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      generationId: 4,
      fenceToken: 3,
      attemptCount: 2
    });
    await expect(repository.complete({ ...claim!, workerId: "worker-a" })).resolves.toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(1, "builder_claim_content_recovery_job_v1", {
      p_worker: "worker-a",
      p_lease_seconds: 60
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "builder_complete_content_recovery_job_v1", {
      p_site_id: claim!.siteId,
      p_generation_id: 4,
      p_worker: "worker-a",
      p_fence_token: 3
    });
  });

  it("releases a fenced job for retry without retaining raw failure details", async () => {
    const chain = thenable({ data: { status: "retry" }, error: null });
    const from = vi.fn(() => chain);
    const repository = createSupabaseRecoveryWorkerRepository(
      { rpc: vi.fn(), from } as never,
      { now: () => new Date("2026-08-06T12:00:00.000Z") }
    );

    await expect(repository.retry({
      siteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      generationId: 4,
      fenceToken: 3,
      attemptCount: 2,
      workerId: "worker-a",
      safeCode: "RECOVERY_WRITE_FAILED"
    })).resolves.toBe("retry");

    expect(from).toHaveBeenCalledWith("builder_content_recovery_jobs");
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "retry",
      lease_owner: null,
      lease_expires_at: null,
      last_error: "RECOVERY_WRITE_FAILED"
    }));
    expect(chain.update).not.toHaveBeenCalledWith(expect.objectContaining({ raw_error: expect.anything() }));
  });
});
