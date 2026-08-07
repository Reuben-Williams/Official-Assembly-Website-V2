import { describe, expect, it, vi } from "vitest";

import { createNewsletterSegmentReconciliationHandler } from "../lib/newsletter/segment-reconciliation";
import type { NewsletterClaimedJob } from "../lib/newsletter/worker";

const baseJob: NewsletterClaimedJob = {
  subject: "site",
  id: "job-1",
  kind: "newsletter.segment.reconcile",
  fencingToken: 4,
  runId: "run-1",
  phase: "provider_segment",
  expectedEligibilityEpoch: 2,
  providerAfterCursor: null,
  providerComplete: false,
  localAfterId: null,
  localComplete: false
};

function provider(overrides: Record<string, unknown> = {}) {
  return {
    listSegmentContacts: vi.fn(async () => ({
      contacts: [{ id: "provider-1", email: "unknown@example.test" }],
      hasMore: false,
      after: undefined
    })),
    getContact: vi.fn(async () => ({ id: "provider-1", unsubscribed: false })),
    listTopics: vi.fn(async () => [{ id: "topic-1", subscription: "opt_in" as const }]),
    listSegments: vi.fn(async () => [{ id: "segment-1" }]),
    removeSegment: vi.fn(async () => undefined),
    createContact: vi.fn(),
    updateContact: vi.fn(),
    updateTopics: vi.fn(),
    addSegment: vi.fn(),
    ...overrides
  };
}

function data(overrides: Record<string, unknown> = {}) {
  return {
    findLocalByProviderContactId: vi.fn(async () => null),
    listLocalEligible: vi.fn(async () => ({ rows: [], hasMore: false, afterId: undefined })),
    checkpoint: vi.fn(async () => ({ status: "queued" as const })),
    finalize: vi.fn(async () => ({ readinessRevisionId: "ready-1", audienceCount: 0 })),
    ...overrides
  };
}

describe("durable newsletter Segment reconciliation", () => {
  it("removes a provider-only Segment member and yields to the local walk", async () => {
    const providerAdapter = provider();
    const reconciliationData = data();
    const handler = createNewsletterSegmentReconciliationHandler({
      provider: providerAdapter,
      data: reconciliationData,
      segmentId: "segment-1",
      topicId: "topic-1"
    });

    await expect(handler(baseJob)).resolves.toEqual({
      code: "reconciliation_page_yielded",
      alreadyCompleted: true
    });
    expect(providerAdapter.removeSegment).toHaveBeenCalledWith({
      id: "provider-1",
      segmentId: "segment-1"
    });
    expect(reconciliationData.checkpoint).toHaveBeenCalledWith(
      baseJob,
      expect.objectContaining({
        phase: "local_eligible",
        providerComplete: true,
        moreWork: true,
        members: [expect.objectContaining({
          providerContactId: "provider-1",
          seenProvider: true,
          seenLocal: false,
          eligible: false,
          disposition: "removed"
        })]
      })
    );
    expect(reconciliationData.finalize).not.toHaveBeenCalled();
  });

  it("keeps an explicitly opted-in mapped provider member and preserves pagination", async () => {
    const providerAdapter = provider({
      listSegmentContacts: vi.fn(async () => ({
        contacts: [{ id: "provider-1", email: "reader@example.test" }],
        hasMore: true,
        after: "provider-1"
      }))
    });
    const reconciliationData = data({
      findLocalByProviderContactId: vi.fn(async () => ({
        id: "subscription-1",
        providerContactId: "provider-1",
        contactGeneration: 3,
        email: "reader@example.test"
      }))
    });
    const handler = createNewsletterSegmentReconciliationHandler({
      provider: providerAdapter,
      data: reconciliationData,
      segmentId: "segment-1",
      topicId: "topic-1"
    });

    await handler(baseJob);

    expect(providerAdapter.removeSegment).not.toHaveBeenCalled();
    expect(reconciliationData.checkpoint).toHaveBeenCalledWith(
      baseJob,
      expect.objectContaining({
        phase: "provider_segment",
        providerAfterCursor: "provider-1",
        providerComplete: false,
        moreWork: true,
        members: [expect.objectContaining({
          subscriptionId: "subscription-1",
          seenProvider: true,
          seenLocal: true,
          eligible: true,
          disposition: "eligible"
        })]
      })
    );
  });

  it("finishes only after the local page proves provider state and the database finalizes", async () => {
    const localJob = { ...baseJob, phase: "local_eligible", providerComplete: true };
    const providerAdapter = provider();
    const reconciliationData = data({
      listLocalEligible: vi.fn(async () => ({
        rows: [{
          id: "subscription-1",
          providerContactId: "provider-1",
          contactGeneration: 3,
          email: "reader@example.test"
        }],
        hasMore: false,
        afterId: "subscription-1"
      })),
      checkpoint: vi.fn(async () => ({ status: "checkpointed" as const })),
      finalize: vi.fn(async () => ({ readinessRevisionId: "ready-1", audienceCount: 1 }))
    });
    const handler = createNewsletterSegmentReconciliationHandler({
      provider: providerAdapter,
      data: reconciliationData,
      segmentId: "segment-1",
      topicId: "topic-1"
    });

    await expect(handler(localJob)).resolves.toEqual({
      code: "segment_reconciled",
      alreadyCompleted: true
    });
    expect(reconciliationData.checkpoint).toHaveBeenCalledWith(
      localJob,
      expect.objectContaining({
        phase: "finalize",
        localComplete: true,
        moreWork: false,
        members: [expect.objectContaining({
          providerContactId: "provider-1",
          subscriptionId: "subscription-1",
          eligible: true
        })]
      })
    );
    expect(reconciliationData.finalize).toHaveBeenCalledWith(localJob);
  });

  it.each([
    { contact: null, topics: [{ id: "topic-1", subscription: "opt_in" as const }], segments: [{ id: "segment-1" }] },
    { contact: { id: "provider-1", unsubscribed: true }, topics: [{ id: "topic-1", subscription: "opt_in" as const }], segments: [{ id: "segment-1" }] },
    { contact: { id: "provider-1", unsubscribed: false }, topics: [], segments: [{ id: "segment-1" }] },
    { contact: { id: "provider-1", unsubscribed: false }, topics: [{ id: "topic-1", subscription: "opt_out" as const }], segments: [{ id: "segment-1" }] },
    { contact: { id: "provider-1", unsubscribed: false }, topics: [{ id: "topic-1", subscription: "opt_in" as const }], segments: [] }
  ])("fails closed when a local eligible record is not provider eligible", async ({ contact, topics, segments }) => {
    const localJob = { ...baseJob, phase: "local_eligible", providerComplete: true };
    const providerAdapter = provider({
      getContact: vi.fn(async () => contact),
      listTopics: vi.fn(async () => topics),
      listSegments: vi.fn(async () => segments)
    });
    const reconciliationData = data({
      listLocalEligible: vi.fn(async () => ({
        rows: [{
          id: "subscription-1",
          providerContactId: "provider-1",
          contactGeneration: 1,
          email: "reader@example.test"
        }],
        hasMore: false,
        afterId: "subscription-1"
      }))
    });
    const handler = createNewsletterSegmentReconciliationHandler({
      provider: providerAdapter,
      data: reconciliationData,
      segmentId: "segment-1",
      topicId: "topic-1"
    });

    await expect(handler(localJob)).rejects.toMatchObject({ safeCode: "audience_not_ready" });
    expect(reconciliationData.finalize).not.toHaveBeenCalled();
  });
});
