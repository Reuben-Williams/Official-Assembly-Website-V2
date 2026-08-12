import "server-only";

import { renderNewsletterConfirmationEmail } from "./email/render-confirmation";
import {
  signNewsletterConfirmationToken,
  type NewsletterConfirmationKeyring
} from "./confirmation-token";
import type { NewsletterClaimedJob } from "./worker";
import { NewsletterJobFailure } from "./worker";
import { synchronizeConfirmedNewsletterContact, type NewsletterBlockingState } from "./resend/contact-adapter";
import type { NewsletterContactProvider } from "./resend/contracts";

export function createNewsletterConfirmationJobHandler(input: {
  readonly data: {
    loadConfirmation(jobId: string): Promise<{
      readonly siteId: string;
      readonly subscriptionId: string;
      readonly generation: number;
      readonly deliveryOrdinal: number;
      readonly providerMessageId?: string;
      readonly firstAttemptAt: Date;
      readonly ambiguous: boolean;
      readonly recipient: string;
      readonly nonce: string;
      readonly keyId: string;
      readonly issuedAt: Date;
      readonly expiresAt: Date;
      readonly pending: boolean;
      readonly locale: "en" | "es";
    }>;
    recordConfirmationAttempt(jobId: string, evidence: {
      readonly firstAttemptAt: Date;
      readonly providerMessageId?: string;
      readonly ambiguous: boolean;
    }): Promise<void>;
  };
  readonly sender: {
    sendConfirmation(input: {
      readonly siteId: string;
      readonly subscriptionId: string;
      readonly generation: number;
      readonly deliveryOrdinal: number;
      readonly recipient: string;
      readonly subject: string;
      readonly html: string;
      readonly text: string;
      readonly firstAttemptAt: Date;
      readonly now: Date;
      readonly ambiguous: boolean;
      readonly providerMessageId?: string;
    }): Promise<
      | { readonly state: "sent"; readonly providerMessageId: string }
      | { readonly state: "retryable"; readonly code: string }
      | { readonly state: "terminal_ambiguous" }
    >;
  };
  readonly keyring: NewsletterConfirmationKeyring;
  readonly canonicalSiteUrl: string;
  readonly now: () => Date;
}) {
  return async (job: NewsletterClaimedJob) => {
    const delivery = await input.data.loadConfirmation(job.id);
    if (!delivery.pending) throw new NewsletterJobFailure("confirmation_not_pending", true);
    const token = signNewsletterConfirmationToken({
      v: 1,
      site: delivery.siteId,
      sub: delivery.subscriptionId,
      gen: delivery.generation,
      nonce: delivery.nonce,
      iat: Math.floor(delivery.issuedAt.getTime() / 1_000),
      exp: Math.floor(delivery.expiresAt.getTime() / 1_000),
      kid: delivery.keyId
    }, input.keyring);
    const confirmationUrl = `${input.canonicalSiteUrl}/newsletter/confirm#token=${token}`;
    const rendered = await renderNewsletterConfirmationEmail({
      confirmationUrl,
      locale: delivery.locale,
    });
    const result = await input.sender.sendConfirmation({
      siteId: delivery.siteId,
      subscriptionId: delivery.subscriptionId,
      generation: delivery.generation,
      deliveryOrdinal: delivery.deliveryOrdinal,
      recipient: delivery.recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      firstAttemptAt: delivery.firstAttemptAt,
      now: input.now(),
      ambiguous: delivery.ambiguous,
      providerMessageId: delivery.providerMessageId
    });
    if (result.state === "terminal_ambiguous") {
      throw new NewsletterJobFailure("terminal_ambiguous", true);
    }
    if (result.state === "retryable") {
      await input.data.recordConfirmationAttempt(job.id, {
        firstAttemptAt: delivery.firstAttemptAt,
        ambiguous: true
      });
      throw new NewsletterJobFailure(result.code, false);
    }
    await input.data.recordConfirmationAttempt(job.id, {
      firstAttemptAt: delivery.firstAttemptAt,
      providerMessageId: result.providerMessageId,
      ambiguous: false
    });
    return { code: "confirmation_sent" };
  };
}

export function createNewsletterContactSyncJobHandler(input: {
  readonly data: {
    loadContactSync(jobId: string): Promise<{
      readonly subscriptionId: string;
      readonly status: string;
      readonly providerContactId?: string;
      readonly email: string;
      readonly firstName?: string;
    }>;
    recordContactSync(subscriptionId: string, result:
      | { readonly state: "verified"; readonly providerContactId: string }
      | { readonly state: "withdrawn_topic" | "withdrawn_global" }
      | { readonly state: "blocked" }
    ): Promise<void>;
  };
  readonly provider: NewsletterContactProvider;
  readonly segmentId: string;
  readonly topicId: string;
}) {
  return async (job: NewsletterClaimedJob) => {
    const contact = await input.data.loadContactSync(job.id);
    if (contact.status !== "confirmed_pending_provider") {
      throw new NewsletterJobFailure("contact_not_pending", true);
    }
    const blockingState: NewsletterBlockingState | null = null;
    const result = await synchronizeConfirmedNewsletterContact(input.provider, {
      email: contact.email,
      firstName: contact.firstName,
      providerContactId: contact.providerContactId,
      segmentId: input.segmentId,
      topicId: input.topicId,
      blockingState
    });
    await input.data.recordContactSync(contact.subscriptionId,
      result.state === "verified"
        ? result
        : result.state === "blocked"
          ? { state: "blocked" }
          : { state: result.state }
    );
    return { code: result.state === "verified" ? "contact_verified" : result.state };
  };
}
