import { describe, expect, it, vi } from "vitest";

import { handleResendNewsletterWebhook } from "../lib/newsletter/webhook";

const url = "https://www.assemblywomanmorales.com/api/webhooks/resend";
const rawBody = JSON.stringify({
  type: "email.delivered",
  created_at: "2026-08-06T17:00:00.000Z",
  data: {
    email_id: "email_1",
    broadcast_id: "broadcast_1"
  }
});

function request(body = rawBody, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      "svix-id": "msg_1",
      "svix-timestamp": "1786035600",
      "svix-signature": "v1,signature",
      ...headers
    },
    body
  });
}

describe("verified Resend newsletter webhooks", () => {
  it("verifies the exact raw body before parsing and persists only bounded normalized evidence", async () => {
    const order: string[] = [];
    const verify = vi.fn((input: { payload: string }) => {
      order.push("verified");
      expect(input.payload).toBe(rawBody);
      return JSON.parse(input.payload);
    });
    const reconcile = vi.fn(async (input) => {
      order.push("reconciled");
      expect(input).not.toHaveProperty("rawBody");
      expect(input).not.toHaveProperty("payload");
      expect(JSON.stringify(input)).not.toContain("signature");
      return { disposition: "matched" as const, replayed: false };
    });

    const response = await handleResendNewsletterWebhook(request(), {
      siteId: "33000000-0000-4000-8000-000000000001",
      providerScopeId: "resend-team-production",
      verify,
      classify: async () => ({
        disposition: "matched" as const,
        providerBroadcastId: "broadcast_1",
        digest: "a".repeat(64)
      }),
      reconcile
    });

    expect(response.status).toBe(200);
    expect(order).toEqual(["verified", "reconciled"]);
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      svixId: "msg_1",
      eventType: "email.delivered",
      providerMessageId: "email_1",
      providerBroadcastId: "broadcast_1",
      disposition: "matched",
      digest: "a".repeat(64)
    }));
  });

  it("rejects missing or invalid Svix evidence without classification or mutation", async () => {
    const classify = vi.fn();
    const reconcile = vi.fn();
    for (const candidate of [
      request(rawBody, { "svix-signature": "" }),
      request("not-json")
    ]) {
      const response = await handleResendNewsletterWebhook(candidate, {
        siteId: "33000000-0000-4000-8000-000000000001",
        providerScopeId: "resend-team-production",
        verify: () => { throw new Error("invalid signature"); },
        classify,
        reconcile
      });
      expect(response.status).toBe(400);
    }
    expect(classify).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("returns retryable before receipt insertion when required provider reads fail", async () => {
    const reconcile = vi.fn();
    const response = await handleResendNewsletterWebhook(request(), {
      siteId: "33000000-0000-4000-8000-000000000001",
      providerScopeId: "resend-team-production",
      verify: ({ payload }) => JSON.parse(payload),
      classify: async () => { throw new Error("provider read unavailable"); },
      reconcile
    });

    expect(response.status).toBe(503);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("records approved unknown events as bounded ignored receipts", async () => {
    const unknown = JSON.stringify({
      type: "domain.updated",
      created_at: "2026-08-06T17:00:00.000Z",
      data: { private: "not-retained" }
    });
    const reconcile = vi.fn(async () => ({ disposition: "ignored" as const, replayed: false }));
    const response = await handleResendNewsletterWebhook(request(unknown), {
      siteId: "33000000-0000-4000-8000-000000000001",
      providerScopeId: "resend-team-production",
      verify: ({ payload }) => JSON.parse(payload),
      classify: vi.fn(),
      reconcile
    });

    expect(response.status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "domain.updated",
      disposition: "ignored"
    }));
    expect(JSON.stringify(reconcile.mock.calls)).not.toContain("not-retained");
  });
});
