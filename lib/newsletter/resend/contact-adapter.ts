import "server-only";

import type { NewsletterContactProvider } from "./contracts";

export type NewsletterBlockingState = "complaint" | "bounce" | "suppressed" | "deleted";

export async function synchronizeConfirmedNewsletterContact(
  provider: NewsletterContactProvider,
  input: {
    readonly email: string;
    readonly firstName?: string;
    readonly providerContactId?: string;
    readonly segmentId: string;
    readonly topicId: string;
    readonly blockingState: NewsletterBlockingState | null;
  }
) {
  const contact = await provider.getContact({ id: input.providerContactId, email: input.email });
  const topics = await provider.listTopics({ contactId: contact?.id, email: input.email });
  const segments = await provider.listSegments({ contactId: contact?.id, email: input.email });

  if (input.blockingState) return { state: "blocked" as const, reason: input.blockingState };
  if (contact?.unsubscribed) return { state: "withdrawn_global" as const };
  const topic = topics.find((candidate) => candidate.id === input.topicId);
  if (topic?.subscription === "opt_out") return { state: "withdrawn_topic" as const };

  let contactId = contact?.id;
  if (!contactId) {
    contactId = (await provider.createContact({ email: input.email, firstName: input.firstName })).id;
  } else if (input.firstName) {
    await provider.updateContact({ id: contactId, firstName: input.firstName });
  }
  if (topic?.subscription !== "opt_in") {
    await provider.updateTopics({ id: contactId, topicId: input.topicId, subscription: "opt_in" });
  }
  if (!segments.some((segment) => segment.id === input.segmentId)) {
    await provider.addSegment({ id: contactId, segmentId: input.segmentId });
  }
  return { state: "verified" as const, providerContactId: contactId };
}
