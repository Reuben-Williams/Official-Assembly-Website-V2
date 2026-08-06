import { describe, expect, it, vi } from "vitest";

import { createNewsletterResendSendAdapter } from "../lib/newsletter/resend/client";
import { synchronizeConfirmedNewsletterContact } from "../lib/newsletter/resend/contact-adapter";

describe("Resend newsletter adapters", () => {
  it("uses a fixed sender, identical payload, and deterministic key for confirmation retries", async () => {
    const send = vi.fn(async () => ({ data: { id: "email_123" }, error: null }));
    const adapter = createNewsletterResendSendAdapter({ emails: { send } });
    const input = {
      siteId: "31000000-0000-4000-8000-000000000001",
      subscriptionId: "32500000-0000-4000-8000-000000000001",
      generation: 1,
      deliveryOrdinal: 2,
      recipient: "reader@example.test",
      html: "<p>Confirm</p>",
      text: "Confirm",
      firstAttemptAt: new Date("2026-08-06T17:00:00.000Z"),
      now: new Date("2026-08-06T18:00:00.000Z"),
      ambiguous: false
    };

    await adapter.sendConfirmation(input);
    await adapter.sendConfirmation({ ...input, ambiguous: true });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Office of Assemblywoman Carmen Morales <newsletter@updates.assemblywomanmorales.com>",
        to: "reader@example.test",
        subject: "Confirm your District Newsletter subscription",
        html: input.html,
        text: input.text
      }),
      {
        idempotencyKey:
          "newsletter-confirmation/31000000-0000-4000-8000-000000000001/32500000-0000-4000-8000-000000000001/1/2"
      }
    );
  });

  it("stops an ambiguous send after Resend's 24-hour idempotency window", async () => {
    const send = vi.fn();
    const adapter = createNewsletterResendSendAdapter({ emails: { send } });
    await expect(adapter.sendConfirmation({
      siteId: "31000000-0000-4000-8000-000000000001",
      subscriptionId: "32500000-0000-4000-8000-000000000001",
      generation: 1,
      deliveryOrdinal: 1,
      recipient: "reader@example.test",
      html: "<p>Confirm</p>",
      text: "Confirm",
      firstAttemptAt: new Date("2026-08-05T16:59:59.000Z"),
      now: new Date("2026-08-06T17:00:00.000Z"),
      ambiguous: true
    })).resolves.toEqual({ state: "terminal_ambiguous" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["withdrawn_topic", "withdrawn_global", "complaint", "bounce", "suppressed", "deleted"] as const)(
    "reads provider state but never automatically reverses %s",
    async (blockingState) => {
      const calls: string[] = [];
      const provider = {
        getContact: vi.fn(async () => {
          calls.push("contact.read");
          return { id: "contact_1", unsubscribed: blockingState === "withdrawn_global" };
        }),
        listTopics: vi.fn(async () => {
          calls.push("topics.read");
          return blockingState === "withdrawn_topic"
            ? [{ id: "topic_1", subscription: "opt_out" as const }]
            : [{ id: "topic_1", subscription: "opt_in" as const }];
        }),
        listSegments: vi.fn(async () => {
          calls.push("segments.read");
          return [{ id: "segment_1" }];
        }),
        createContact: vi.fn(),
        updateContact: vi.fn(),
        updateTopics: vi.fn(),
        addSegment: vi.fn()
      };

      const result = await synchronizeConfirmedNewsletterContact(provider, {
        email: "reader@example.test",
        firstName: "Reader",
        segmentId: "segment_1",
        topicId: "topic_1",
        blockingState: blockingState === "withdrawn_topic" || blockingState === "withdrawn_global"
          ? null
          : blockingState
      });

      expect(calls).toEqual(["contact.read", "topics.read", "segments.read"]);
      expect(result.state).toMatch(/blocked|withdrawn/);
      expect(provider.createContact).not.toHaveBeenCalled();
      expect(provider.updateContact).not.toHaveBeenCalled();
      expect(provider.updateTopics).not.toHaveBeenCalled();
      expect(provider.addSegment).not.toHaveBeenCalled();
    }
  );
});
