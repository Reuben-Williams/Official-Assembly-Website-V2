import "server-only";

import type { NewsletterClaimedJob } from "./worker";

export function createNewsletterBroadcastAuditHandler(input: {
  readonly audit: (job: NewsletterClaimedJob) => Promise<void>;
}) {
  return async (job: NewsletterClaimedJob) => {
    await input.audit(job);
    return { code: "audit_complete", alreadyCompleted: true };
  };
}
