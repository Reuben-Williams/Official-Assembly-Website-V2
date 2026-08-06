import "server-only";

import {
  digestNewsletterBroadcast,
  type NewsletterBroadcastSnapshot
} from "./broadcast-digest";
import { NEWSLETTER_CONFIRMATION_SENDER } from "./resend/client";

export interface NewsletterBroadcastReadProvider {
  get(id: string): Promise<NewsletterBroadcastSnapshot>;
}

export interface NewsletterBroadcastInventoryProvider {
  list(input: { readonly limit: 100; readonly after?: string }): Promise<{
    readonly broadcasts: readonly NewsletterBroadcastSnapshot[];
    readonly hasMore: boolean;
    readonly after?: string;
  }>;
}

function requiredContent(snapshot: NewsletterBroadcastSnapshot): boolean {
  const combined = `${snapshot.html}\n${snapshot.text}`;
  return combined.includes("152 Franklin Street, Belleville, NJ 07109") &&
    combined.includes("973-450-0484") &&
    combined.includes("https://www.assemblywomanmorales.com/contact") &&
    (combined.includes("RESEND_UNSUBSCRIBE_URL") || /unsubscribe/i.test(combined));
}

export async function inspectNewsletterBroadcast(
  provider: NewsletterBroadcastReadProvider,
  input: {
    readonly broadcastId: string;
    readonly segmentId: string;
    readonly topicId: string;
    readonly reconcile: () => Promise<{
      readonly readinessRevisionId: string;
      readonly audienceCount: number;
    }>;
  }
) {
  const snapshot = await provider.get(input.broadcastId);
  if (
    snapshot.id !== input.broadcastId ||
    snapshot.status !== "draft" || snapshot.scheduledAt !== null || snapshot.sentAt !== null ||
    snapshot.from !== NEWSLETTER_CONFIRMATION_SENDER ||
    snapshot.segmentId !== input.segmentId || snapshot.topicId !== input.topicId ||
    snapshot.replyTo.length !== 0 || !requiredContent(snapshot)
  ) {
    throw new Error("newsletter broadcast is not ready");
  }
  const readiness = await input.reconcile();
  return {
    state: "ready" as const,
    broadcastId: snapshot.id,
    digest: digestNewsletterBroadcast(snapshot),
    sender: snapshot.from,
    replyToState: "none" as const,
    audienceCount: readiness.audienceCount,
    readinessRevisionId: readiness.readinessRevisionId,
    snapshot
  };
}

export async function validateNewsletterBroadcast(
  provider: NewsletterBroadcastReadProvider,
  input: {
    readonly siteId: string;
    readonly commandId: string;
    readonly operatorId: string;
    readonly broadcastId: string;
    readonly segmentId: string;
    readonly topicId: string;
    readonly confirmedTestObservationId: string;
    readonly reconcile: () => Promise<{ readonly readinessRevisionId: string; readonly audienceCount: number }>;
    readonly createValidation: (input: Record<string, unknown>) => Promise<{
      readonly state: "valid";
      readonly validationId: string;
    }>;
  }
) {
  const inspected = await inspectNewsletterBroadcast(provider, input);
  return input.createValidation({
    siteId: input.siteId,
    commandId: input.commandId,
    operatorId: input.operatorId,
    providerBroadcastId: inspected.broadcastId,
    confirmedTestObservationId: input.confirmedTestObservationId,
    digest: inspected.digest,
    segmentId: input.segmentId,
    topicId: input.topicId,
    sender: inspected.sender,
    replyToState: inspected.replyToState,
    readinessRevisionId: inspected.readinessRevisionId,
    audienceCount: inspected.audienceCount
  });
}

export async function auditNewsletterBroadcastInventory(
  provider: NewsletterBroadcastInventoryProvider,
  input: {
    readonly after: string | null;
    readonly checkpoint: (input: {
      readonly hasMore: boolean;
      readonly after?: string;
      readonly pageCount: number;
      readonly broadcasts: readonly NewsletterBroadcastSnapshot[];
    }) => Promise<void>;
  }
) {
  let after = input.after ?? undefined;
  let pageCount = 0;
  let broadcastCount = 0;
  do {
    const page = await provider.list({ limit: 100, after });
    pageCount += 1;
    broadcastCount += page.broadcasts.length;
    await input.checkpoint({
      hasMore: page.hasMore,
      after: page.hasMore ? page.after : undefined,
      pageCount,
      broadcasts: page.broadcasts
    });
    if (!page.hasMore) break;
    if (!page.after) throw new Error("broadcast audit cursor unavailable");
    after = page.after;
  } while (pageCount < 10_000);
  return { complete: true as const, pageCount, broadcastCount };
}
