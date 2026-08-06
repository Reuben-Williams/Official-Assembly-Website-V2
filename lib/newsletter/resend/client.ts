import "server-only";

import { Resend } from "resend";

import { NEWSLETTER_CONFIRMATION_SUBJECT } from "../email/render-confirmation";
import type { NewsletterContactProvider, NewsletterEmailProvider } from "./contracts";

export const NEWSLETTER_CONFIRMATION_SENDER =
  "Office of Assemblywoman Carmen Morales <newsletter@updates.assemblywomanmorales.com>";

type SendInput = {
  readonly siteId: string;
  readonly subscriptionId: string;
  readonly generation: number;
  readonly deliveryOrdinal: number;
  readonly recipient: string;
  readonly html: string;
  readonly text: string;
  readonly firstAttemptAt: Date;
  readonly now: Date;
  readonly ambiguous: boolean;
  readonly providerMessageId?: string;
};

export function createNewsletterResendSendAdapter(provider: { readonly emails: NewsletterEmailProvider }) {
  return {
    async sendConfirmation(input: SendInput) {
      if (input.providerMessageId) {
        return { state: "sent" as const, providerMessageId: input.providerMessageId };
      }
      if (
        input.ambiguous &&
        input.now.getTime() - input.firstAttemptAt.getTime() > 24 * 60 * 60 * 1_000
      ) {
        return { state: "terminal_ambiguous" as const };
      }
      const idempotencyKey = [
        "newsletter-confirmation",
        input.siteId,
        input.subscriptionId,
        input.generation,
        input.deliveryOrdinal
      ].join("/");
      const result = await provider.emails.send(
        {
          from: NEWSLETTER_CONFIRMATION_SENDER,
          to: input.recipient,
          subject: NEWSLETTER_CONFIRMATION_SUBJECT,
          html: input.html,
          text: input.text
        },
        { idempotencyKey }
      );
      if (result.error || !result.data?.id) {
        return { state: "retryable" as const, code: "provider_unavailable" as const };
      }
      return { state: "sent" as const, providerMessageId: result.data.id };
    }
  };
}

export function createProductionNewsletterSendAdapter(apiKey: string) {
  const resend = new Resend(apiKey);
  return createNewsletterResendSendAdapter({ emails: resend.emails });
}

export function createProductionNewsletterContactProvider(apiKey: string): NewsletterContactProvider {
  const resend = new Resend(apiKey);
  return {
    async getContact(input) {
      const result = await resend.contacts.get(input.id ?? input.email);
      if (result.error || !result.data) return null;
      return { id: result.data.id, unsubscribed: result.data.unsubscribed };
    },
    async listTopics(input) {
      const result = await resend.contacts.topics.list(input.contactId
        ? { id: input.contactId }
        : { email: input.email });
      if (result.error || !result.data) throw new Error("provider read unavailable");
      return result.data.data;
    },
    async listSegments(input) {
      const result = await resend.contacts.segments.list(input.contactId
        ? { contactId: input.contactId }
        : { email: input.email });
      if (result.error || !result.data) throw new Error("provider read unavailable");
      return result.data.data;
    },
    async createContact(input) {
      const result = await resend.contacts.create({ email: input.email, firstName: input.firstName });
      if (result.error || !result.data?.id) throw new Error("provider mutation unavailable");
      return { id: result.data.id };
    },
    async updateContact(input) {
      const result = await resend.contacts.update({ id: input.id, firstName: input.firstName ?? null });
      if (result.error) throw new Error("provider mutation unavailable");
    },
    async updateTopics(input) {
      const result = await resend.contacts.topics.update({
        id: input.id,
        topics: [{ id: input.topicId, subscription: input.subscription }]
      });
      if (result.error) throw new Error("provider mutation unavailable");
    },
    async addSegment(input) {
      const result = await resend.contacts.segments.add({ contactId: input.id, segmentId: input.segmentId });
      if (result.error) throw new Error("provider mutation unavailable");
    }
  };
}
