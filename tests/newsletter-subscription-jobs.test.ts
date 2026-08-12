import { describe, expect, it, vi } from "vitest";

import { createNewsletterConfirmationJobHandler } from "../lib/newsletter/subscription-jobs";

describe("newsletter confirmation jobs", () => {
  it("renders and sends the confirmation in the persisted signup locale", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const handler = createNewsletterConfirmationJobHandler({
      data: {
        loadConfirmation: vi.fn(async () => ({
          siteId: "182c3a48-a024-452b-bc88-44e795c55b95",
          subscriptionId: "a9f7db38-7f02-4afb-bd83-5a7d2e97da11",
          generation: 1,
          deliveryOrdinal: 1,
          firstAttemptAt: new Date("2026-08-12T04:00:00.000Z"),
          ambiguous: false,
          recipient: "resident@example.com",
          nonce: "newsletter_confirmation_nonce_value_123456789",
          keyId: "current",
          issuedAt: new Date("2026-08-12T04:00:00.000Z"),
          expiresAt: new Date("2026-08-14T04:00:00.000Z"),
          pending: true,
          locale: "es" as const,
        })),
        recordConfirmationAttempt: vi.fn(async () => undefined),
      },
      sender: {
        sendConfirmation: vi.fn(async (input) => {
          sent.push(input);
          return { state: "sent" as const, providerMessageId: "email-id" };
        }),
      },
      keyring: new Map([
        ["current", new TextEncoder().encode("newsletter-confirmation-test-secret-that-is-long-enough")],
      ]),
      canonicalSiteUrl: "https://www.assemblywomanmorales.com",
      now: () => new Date("2026-08-12T04:01:00.000Z"),
    });

    await handler({
      subject: "subscription",
      id: "job-id",
      kind: "newsletter.confirmation.send",
      fencingToken: 1,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("Confirme su suscripción al Boletín del distrito");
    expect(sent[0]?.text).toContain("Confirme su suscripción");
    expect(sent[0]?.text).not.toContain("One more step");
  });
});
