import {
  readLatestAlertRecovery,
  runAlertRecoveryWorkerBatch,
} from "@reuben-williams/next/alerts/server";
import { describe, expect, it, vi } from "vitest";

import {
  createCombinedRecoveryRunOnce,
} from "../lib/builder/alerts";
import {
  alertRecoveryDigest,
  createAlertRecoveryStore,
} from "../lib/builder/recovery/alert-store";
import {
  RecoveryStoreError,
  type RecoveryObjectStore,
  type RecoveryObjectValue,
} from "../lib/builder/recovery";

function memoryObjects() {
  const values = new Map<string, RecoveryObjectValue>();
  let generation = 0;
  const objects: RecoveryObjectStore = {
    async get(path) {
      return values.get(path) ?? null;
    },
    async put(path, bytes, options) {
      const current = values.get(path);
      if ((!options.allowOverwrite && current) ||
          (options.ifMatch !== undefined && current?.etag !== options.ifMatch)) {
        throw new RecoveryStoreError("PRECONDITION_FAILED");
      }
      const etag = `etag-${++generation}`;
      values.set(path, { bytes: bytes.slice(), etag, contentType: options.contentType });
      return { etag };
    },
  };
  return { objects, values };
}

describe("official Assembly alert recovery", () => {
  it("runs alert recovery after the existing content worker is idle", async () => {
    const runAlertsOnce = vi.fn(async () => ({
      claimed: 1,
      completed: 1,
      retried: 0,
      deadLettered: 0,
      staleLeases: 0,
    }));
    const runOnce = createCombinedRecoveryRunOnce({
      runContentOnce: async () => ({ status: "idle" }),
      runAlertsOnce,
    });

    await expect(runOnce()).resolves.toEqual({
      status: "alerts_processed",
      claimed: 1,
      completed: 1,
      retried: 0,
      deadLettered: 0,
      staleLeases: 0,
    });
    expect(runAlertsOnce).toHaveBeenCalledOnce();
  });

  it("writes and verifies the site- and environment-bound immutable alert artifact", async () => {
    const memory = memoryObjects();
    const store = createAlertRecoveryStore(memory.objects);
    const claim = {
      siteId: "10000000-0000-4000-8000-000000000001",
      siteKey: "official-assembly-website-v2",
      revisionId: "20000000-0000-4000-8000-000000000001",
      publicationNumber: 1,
      status: "claimed" as const,
      attemptCount: 1,
      workerId: "alerts-worker",
      fenceToken: 1,
      leaseExpiresAt: "2026-08-08T12:01:00.000Z",
      revision: {
        schemaVersion: 1 as const,
        revisionId: "20000000-0000-4000-8000-000000000001",
        collectionId: "alerts" as const,
        parentRevisionId: null,
        createdBy: "30000000-0000-4000-8000-000000000001",
        createdAt: "2026-08-08T12:00:00.000Z",
        items: [{
          id: "district-update",
          category: "general" as const,
          message: "District update",
          link: "/news",
          lifecycle: "active" as const,
          enabled: true,
          startsAt: null,
          endsAt: null,
        }],
      },
    };
    const completeRecoveryJob = vi.fn(async () => true);
    const result = await runAlertRecoveryWorkerBatch({
      repository: {
        claimRecoveryJob: vi.fn()
          .mockResolvedValueOnce(claim)
          .mockResolvedValueOnce(null),
        completeRecoveryJob,
        failRecoveryJob: vi.fn(async () => ({ status: "retry" as const, attemptCount: 2 })),
      },
      store,
      digest: alertRecoveryDigest,
      environment: "production",
      workerId: "alerts-worker",
      claimLimit: 2,
      leaseSeconds: 60,
      now: new Date("2026-08-08T12:00:00.000Z"),
    });

    expect(result).toMatchObject({ claimed: 1, completed: 1, retried: 0 });
    expect([...memory.values.keys()]).toEqual(expect.arrayContaining([
      expect.stringMatching(/^production\/official-assembly-website-v2\/alerts\/revisions\/1-[a-f0-9]{64}\.json$/),
      "production/official-assembly-website-v2/alerts/latest.json",
    ]));
    expect(completeRecoveryJob).toHaveBeenCalledWith(expect.objectContaining({
      claim,
      environment: "production",
      artifactPath: expect.stringContaining("production/official-assembly-website-v2/alerts/revisions/1-"),
      contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));

    await expect(readLatestAlertRecovery({
      store,
      digest: alertRecoveryDigest,
      environment: "production",
      siteKey: "official-assembly-website-v2",
      evaluatedAt: new Date("2026-08-08T12:00:30.000Z"),
    })).resolves.toMatchObject({
      activeAlerts: [{ id: "district-update", message: "District update" }],
    });
    await expect(readLatestAlertRecovery({
      store,
      digest: alertRecoveryDigest,
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      evaluatedAt: new Date("2026-08-08T12:00:30.000Z"),
    })).resolves.toBeNull();
    await expect(readLatestAlertRecovery({
      store,
      digest: alertRecoveryDigest,
      environment: "production",
      siteKey: "another-site",
      evaluatedAt: new Date("2026-08-08T12:00:30.000Z"),
    })).resolves.toBeNull();
  });
});
