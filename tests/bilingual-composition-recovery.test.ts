import {
  runSiteCompositionRecoveryWorkerBatch,
} from "@reuben-williams/next/content/server";
import { createSiteCompositionDigestV1 } from "@reuben-williams/content";
import { describe, expect, it, vi } from "vitest";

import {
  createOfficialAssemblyCompositionRecoveryRuntime,
} from "../lib/builder/localization/recovery";

const compositionPayload = {
    schemaVersion: 1 as const,
    siteId: "11111111-1111-4111-8111-111111111111",
    compositionId: "22222222-2222-4222-8222-222222222222",
    baseCompositionId: "33333333-3333-4333-8333-333333333333",
    intendedDelta: {
      kind: "domain" as const,
      domain: "site" as const,
      stableId: "home.hero",
      fromPublicationId: null,
      toPublicationId: "44444444-4444-4444-8444-444444444444",
    },
    globalRegionRevisionId: "55555555-5555-4555-8555-555555555555",
    catalogRevision: "catalog-2026-08-12",
    catalogPublicDigest: "b".repeat(64),
    domainPublications: [{
      domain: "site" as const,
      stableId: "home.hero",
      publicationId: "44444444-4444-4444-8444-444444444444",
      digest: "c".repeat(64),
    }],
    createdAt: "2026-08-12T12:00:00.000Z",
};

describe("complete composition recovery", () => {
  it("materializes complete composition evidence and advances the database pointer", async () => {
    const composition = {
      ...compositionPayload,
      compositionDigest: await createSiteCompositionDigestV1(compositionPayload),
    };
    const claim = {
      schemaVersion: 1 as const,
      siteId: composition.siteId,
      publicationSequence: 7,
      compositionId: composition.compositionId,
      compositionDigest: composition.compositionDigest,
      predecessorCompositionId: composition.baseCompositionId,
      attemptCount: 1,
      workerId: "composition-worker",
      fenceToken: 1,
      leaseExpiresAt: "2026-08-12T12:01:00.000Z",
      composition,
    };
    const completeRecoveryJob = vi.fn(async ({ artifact }) => {
      expect(artifact).toMatchObject({
        siteId: claim.siteId,
        compositionId: claim.compositionId,
        compositionDigest: claim.compositionDigest,
        predecessorCompositionId: claim.predecessorCompositionId,
        publicationSequence: 7,
        composition: claim.composition,
        artifactDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      return { status: "completed" as const, publicationSequence: 7, pointerAdvanced: true };
    });
    const result = await runSiteCompositionRecoveryWorkerBatch({
      repository: {
        claimRecoveryJob: vi.fn().mockResolvedValueOnce(claim).mockResolvedValueOnce(null),
        completeRecoveryJob,
        failRecoveryJob: vi.fn(async () => ({ status: "retry" as const, attemptCount: 2 })),
      },
      workerId: "composition-worker",
      claimLimit: 2,
      leaseSeconds: 60,
      now: new Date("2026-08-12T12:00:00.000Z"),
    });

    expect(result).toEqual({ claimed: 1, completed: 1, retried: 0, deadLettered: 0, staleLeases: 0 });
    expect(completeRecoveryJob).toHaveBeenCalledOnce();
  });

  it("creates a bounded runtime around the package repository and worker", async () => {
    const runBatch = vi.fn(async (input) => ({
      claimed: input.claimLimit,
      completed: input.claimLimit,
      retried: 0,
      deadLettered: 0,
      staleLeases: 0,
    }));
    const runtime = createOfficialAssemblyCompositionRecoveryRuntime({
      repository: {
        claimRecoveryJob: vi.fn(async () => null),
        completeRecoveryJob: vi.fn(async () => ({ status: "stale_lease" as const })),
        failRecoveryJob: vi.fn(async () => ({ status: "stale_lease" as const })),
      },
      workerId: "composition-worker",
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      runBatch,
    });

    await expect(runtime.runOnce()).resolves.toMatchObject({ claimed: 10, completed: 10 });
    expect(runBatch).toHaveBeenCalledWith(expect.objectContaining({
      workerId: "composition-worker",
      claimLimit: 10,
      leaseSeconds: 60,
    }));
  });
});
