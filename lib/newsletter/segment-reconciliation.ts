import "server-only";

import type { NewsletterClaimedJob } from "./worker";

export function createNewsletterSegmentReconciliationHandler(input: {
  readonly reconcile: (job: NewsletterClaimedJob) => Promise<unknown>;
}) {
  return async (job: NewsletterClaimedJob) => {
    await input.reconcile(job);
    return { code: "segment_reconciled" };
  };
}
