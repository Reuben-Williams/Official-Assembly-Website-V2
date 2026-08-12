import "server-only";

import {
  createSupabaseSiteCompositionRecoveryRepository,
  runSiteCompositionRecoveryWorkerBatch,
  type SiteCompositionRecoveryRepository,
} from "@reuben-williams/next/content/server";

import { getBuilderAdminClient } from "../../supabase/admin";

type CompositionBatchRunner = typeof runSiteCompositionRecoveryWorkerBatch;

export function createOfficialAssemblyCompositionRecoveryRuntime(input: {
  readonly repository?: SiteCompositionRecoveryRepository;
  readonly workerId?: string;
  readonly now?: () => Date;
  readonly runBatch?: CompositionBatchRunner;
} = {}) {
  const client = input.repository ? null : getBuilderAdminClient();
  if (!input.repository && !client) throw new Error("Composition recovery database is unavailable.");
  const repository = input.repository ?? createSupabaseSiteCompositionRecoveryRepository(client!);
  const workerId = input.workerId ?? crypto.randomUUID();
  const now = input.now ?? (() => new Date());
  const runBatch = input.runBatch ?? runSiteCompositionRecoveryWorkerBatch;
  return Object.freeze({
    repository,
    runOnce: () => runBatch({
      repository,
      workerId,
      claimLimit: 10,
      leaseSeconds: 60,
      now: now(),
    }),
  });
}
