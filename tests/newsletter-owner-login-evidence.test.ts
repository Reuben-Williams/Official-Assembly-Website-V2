import { describe, expect, it, vi } from "vitest";

import {
  collectNewsletterOwnerLoginEmails,
  createNewsletterAuthLoginCommandId,
  createNewsletterAuthLoginEvidenceCommandId,
  createNewsletterAuthLoginEvidenceDigest,
  selectNewsletterOwnerLoginMessage,
  type NewsletterOwnerLoginEmailReader
} from "../lib/newsletter/owner-login-evidence";

const siteId = "a3f57b25-df25-4d98-9ff6-a4a3f3a00a68";
const operatorId = "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1";
const occurredAt = "2026-08-11T21:24:29.356981Z";

function email(overrides: Partial<{
  id: string;
  status: string;
  createdAt: string;
  from: string;
  to: readonly string[];
  subject: string;
}> = {}) {
  return {
    id: "message-1",
    status: "clicked",
    createdAt: "2026-08-11T21:24:21.547Z",
    from: "Office of Assemblywoman Carmen Morales <no-reply@updates.assemblywomanmorales.com>",
    to: ["OWNER@example.com"],
    subject: "Your sign-in link",
    ...overrides
  };
}

describe("newsletter owner-login evidence", () => {
  it("derives a stable UUID command from the immutable login occurrence", () => {
    const first = createNewsletterAuthLoginCommandId({ siteId, operatorId, occurredAt });
    const replay = createNewsletterAuthLoginCommandId({ siteId, operatorId, occurredAt });
    const later = createNewsletterAuthLoginCommandId({
      siteId,
      operatorId,
      occurredAt: "2026-08-11T22:24:29.356981Z"
    });

    expect(first).toBe(replay);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(later).not.toBe(first);
  });

  it("derives a distinct stable UUID command for the evidence write", () => {
    const first = createNewsletterAuthLoginEvidenceCommandId({
      siteId,
      occurrenceId: "a3000000-0000-4000-8000-000000000001",
      providerMessageId: "message-1"
    });
    const replay = createNewsletterAuthLoginEvidenceCommandId({
      siteId,
      occurrenceId: "a3000000-0000-4000-8000-000000000001",
      providerMessageId: "message-1"
    });
    const other = createNewsletterAuthLoginEvidenceCommandId({
      siteId,
      occurrenceId: "a3000000-0000-4000-8000-000000000001",
      providerMessageId: "message-2"
    });

    expect(first).toBe(replay);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(other).not.toBe(first);
  });

  it("selects exactly one owner magic-link message with an allowed post-delivery state", () => {
    expect(selectNewsletterOwnerLoginMessage([email()], {
      ownerEmail: "owner@example.com",
      occurredAt,
      excludedProviderMessageIds: new Set()
    })?.id).toBe("message-1");
  });

  it("fails closed on recipient aliases, wrong metadata, and ambiguous matches", () => {
    const input = {
      ownerEmail: "owner@example.com",
      occurredAt,
      excludedProviderMessageIds: new Set<string>()
    };

    expect(selectNewsletterOwnerLoginMessage([
      email({ to: ["owner@example.com", "other@example.com"] })
    ], input)).toBeNull();
    expect(selectNewsletterOwnerLoginMessage([
      email({ subject: "Password reset" })
    ], input)).toBeNull();
    expect(selectNewsletterOwnerLoginMessage([
      email(),
      email({ id: "message-2", createdAt: "2026-08-11T21:24:22.547Z" })
    ], input)).toBeNull();
  });

  it("excludes previously evidenced messages and rejects stale or future candidates", () => {
    const input = {
      ownerEmail: "owner@example.com",
      occurredAt,
      excludedProviderMessageIds: new Set(["message-1"])
    };

    expect(selectNewsletterOwnerLoginMessage([email()], input)).toBeNull();
    expect(selectNewsletterOwnerLoginMessage([
      email({ id: "stale", createdAt: "2026-08-11T20:24:28.000Z" }),
      email({ id: "future", createdAt: "2026-08-11T21:24:30.000Z" })
    ], { ...input, excludedProviderMessageIds: new Set() })).toBeNull();
  });

  it("derives secret-safe evidence without retaining owner content", () => {
    const digest = createNewsletterAuthLoginEvidenceDigest({
      siteId,
      operatorId,
      occurrenceId: "a3000000-0000-4000-8000-000000000001",
      providerMessageId: "message-1",
      providerCreatedAt: "2026-08-11T21:24:21.547Z",
      authLastSignInAt: occurredAt
    });

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("owner@example.com");
    expect(digest).not.toContain("Your sign-in link");
  });
});

describe("newsletter owner-login email reader", () => {
  it("reads only email pages and stops after crossing the one-hour boundary", async () => {
    const calls: { limit: number; after?: string }[] = [];
    const reader: NewsletterOwnerLoginEmailReader = {
      listEmails: vi.fn(async (page) => {
        calls.push(page);
        if (!page.after) {
          return {
            items: [email({ id: "newest" })],
            hasMore: true,
            after: "newest"
          };
        }
        return {
          items: [email({ id: "old", createdAt: "2026-08-11T20:24:28.000Z" })],
          hasMore: true,
          after: "old"
        };
      })
    };

    const result = await collectNewsletterOwnerLoginEmails(reader, {
      occurredAt: new Date(occurredAt),
      now: () => 0
    });

    expect(calls).toEqual([
      { limit: 100, after: undefined },
      { limit: 100, after: "newest" }
    ]);
    expect(result.map((item) => item.id)).toEqual(["newest"]);
  });

  it("fails closed on page, cursor, and wall-clock bounds", async () => {
    const endless: NewsletterOwnerLoginEmailReader = {
      listEmails: async ({ after }) => ({
        items: [email({ id: `message-${after ?? "0"}` })],
        hasMore: true,
        after: after === "one" ? "two" : "one"
      })
    };
    await expect(collectNewsletterOwnerLoginEmails(endless, {
      occurredAt: new Date(occurredAt),
      maximumPages: 1,
      now: () => 0
    })).rejects.toThrow("owner_login_email_inventory_unavailable");

    const stalled: NewsletterOwnerLoginEmailReader = {
      listEmails: async () => ({ items: [email()], hasMore: true })
    };
    await expect(collectNewsletterOwnerLoginEmails(stalled, {
      occurredAt: new Date(occurredAt),
      now: () => 0
    })).rejects.toThrow("owner_login_email_inventory_unavailable");

    let clock = 0;
    const slow: NewsletterOwnerLoginEmailReader = {
      listEmails: async () => ({ items: [email()], hasMore: true, after: "next" })
    };
    await expect(collectNewsletterOwnerLoginEmails(slow, {
      occurredAt: new Date(occurredAt),
      maximumDurationMs: 5,
      now: () => (clock += 10)
    })).rejects.toThrow("owner_login_email_inventory_unavailable");
  });
});
