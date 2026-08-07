import "server-only";

import type { NewsletterReconciliationProvider } from "./resend/contracts";
import type { NewsletterClaimedJob } from "./worker";
import { NewsletterJobFailure } from "./worker";

export type NewsletterLocalEligible = {
  readonly id: string;
  readonly providerContactId: string;
  readonly contactGeneration: number;
  readonly email: string;
};

export type NewsletterReconciliationMember = {
  readonly providerContactId: string;
  readonly subscriptionId?: string;
  readonly contactGeneration?: number;
  readonly seenProvider: boolean;
  readonly seenLocal: boolean;
  readonly eligible: boolean;
  readonly disposition: "eligible" | "removed";
  readonly actionState: "none" | "completed";
};

export interface NewsletterReconciliationData {
  findLocalByProviderContactId(providerContactId: string): Promise<NewsletterLocalEligible | null>;
  listLocalEligible(input: {
    readonly afterId?: string;
    readonly limit: 100;
  }): Promise<{
    readonly rows: readonly NewsletterLocalEligible[];
    readonly hasMore: boolean;
    readonly afterId?: string;
  }>;
  checkpoint(job: NewsletterClaimedJob, input: {
    readonly phase: "provider_segment" | "local_eligible" | "finalize";
    readonly providerAfterCursor?: string;
    readonly providerComplete?: boolean;
    readonly providerPages?: number;
    readonly localAfterId?: string;
    readonly localComplete?: boolean;
    readonly localPages?: number;
    readonly moreWork: boolean;
    readonly members: readonly NewsletterReconciliationMember[];
  }): Promise<{ readonly status: "queued" | "checkpointed" }>;
  finalize(job: NewsletterClaimedJob): Promise<{
    readonly readinessRevisionId: string;
    readonly audienceCount: number;
  }>;
}

async function snapshotIsEligible(
  provider: NewsletterReconciliationProvider,
  input: {
    readonly providerContactId: string;
    readonly email: string;
    readonly topicId: string;
    readonly segmentId: string;
  }
) {
  const [contact, topics, segments] = await Promise.all([
    provider.getContact({ id: input.providerContactId, email: input.email }),
    provider.listTopics({ contactId: input.providerContactId, email: input.email }),
    provider.listSegments({ contactId: input.providerContactId, email: input.email })
  ]);
  return Boolean(
    contact &&
    !contact.unsubscribed &&
    topics.some((topic) => topic.id === input.topicId && topic.subscription === "opt_in") &&
    segments.some((segment) => segment.id === input.segmentId)
  );
}

export function createNewsletterSegmentReconciliationHandler(input: {
  readonly provider: NewsletterReconciliationProvider;
  readonly data: NewsletterReconciliationData;
  readonly topicId: string;
  readonly segmentId: string;
}) {
  return async (job: NewsletterClaimedJob) => {
    if (job.kind !== "newsletter.segment.reconcile") {
      throw new NewsletterJobFailure("invalid_job", true);
    }

    if (job.phase !== "local_eligible") {
      const page = await input.provider.listSegmentContacts({
        segmentId: input.segmentId,
        limit: 100,
        after: typeof job.providerAfterCursor === "string" ? job.providerAfterCursor : undefined
      });
      const members: NewsletterReconciliationMember[] = [];
      for (const providerContact of page.contacts) {
        const local = await input.data.findLocalByProviderContactId(providerContact.id);
        const eligible = Boolean(local) && await snapshotIsEligible(input.provider, {
          providerContactId: providerContact.id,
          email: providerContact.email,
          topicId: input.topicId,
          segmentId: input.segmentId
        });
        if (!eligible) {
          await input.provider.removeSegment({ id: providerContact.id, segmentId: input.segmentId });
        }
        members.push({
          providerContactId: providerContact.id,
          subscriptionId: local?.id,
          contactGeneration: local?.contactGeneration,
          seenProvider: true,
          seenLocal: Boolean(local),
          eligible,
          disposition: eligible ? "eligible" : "removed",
          actionState: eligible ? "none" : "completed"
        });
      }
      await input.data.checkpoint(job, {
        phase: page.hasMore ? "provider_segment" : "local_eligible",
        providerAfterCursor: page.after,
        providerComplete: !page.hasMore,
        providerPages: 1,
        moreWork: true,
        members
      });
      return { code: "reconciliation_page_yielded", alreadyCompleted: true };
    }

    const page = await input.data.listLocalEligible({
      afterId: typeof job.localAfterId === "string" ? job.localAfterId : undefined,
      limit: 100
    });
    const members: NewsletterReconciliationMember[] = [];
    for (const local of page.rows) {
      const eligible = await snapshotIsEligible(input.provider, {
        providerContactId: local.providerContactId,
        email: local.email,
        topicId: input.topicId,
        segmentId: input.segmentId
      });
      if (!eligible) throw new NewsletterJobFailure("audience_not_ready", false);
      members.push({
        providerContactId: local.providerContactId,
        subscriptionId: local.id,
        contactGeneration: local.contactGeneration,
        seenProvider: true,
        seenLocal: true,
        eligible: true,
        disposition: "eligible",
        actionState: "none"
      });
    }
    await input.data.checkpoint(job, {
      phase: page.hasMore ? "local_eligible" : "finalize",
      localAfterId: page.afterId,
      localComplete: !page.hasMore,
      localPages: 1,
      moreWork: page.hasMore,
      members
    });
    if (page.hasMore) return { code: "reconciliation_page_yielded", alreadyCompleted: true };
    await input.data.finalize(job);
    return { code: "segment_reconciled", alreadyCompleted: true };
  };
}
