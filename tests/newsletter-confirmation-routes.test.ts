import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  CONFIRMATION_COOKIE,
  handleNewsletterConfirmationRequest,
  handleNewsletterConfirmationSessionRequest
} from "../lib/newsletter/confirmation-session";

const origin = "https://www.assemblywomanmorales.com";
const headers = {
  origin,
  "sec-fetch-site": "same-origin",
  "content-type": "application/json"
};
const payload = {
  v: 1 as const,
  site: "31000000-0000-4000-8000-000000000001",
  sub: "32500000-0000-4000-8000-000000000001",
  gen: 1,
  nonce: "n".repeat(48),
  iat: 1786035600,
  exp: 1786208400,
  kid: "2026-08"
};

describe("newsletter confirmation routes", () => {
  it("exchanges a fragment token for only a ten-minute host-only read session", async () => {
    const exchange = vi.fn(async () => ({ status: "ready" as const }));
    const response = await handleNewsletterConfirmationSessionRequest(
      new Request(`${origin}/api/newsletter/confirmation-session`, {
        method: "POST",
        headers,
        body: JSON.stringify({ token: "fragment-token" })
      }),
      {
        verifyToken: () => payload,
        exchange,
        createSessionSecret: () => "s".repeat(43),
        now: () => new Date("2026-08-06T17:00:00.000Z")
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${CONFIRMATION_COOKIE}=${"s".repeat(43)}`);
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
    expect(exchange).toHaveBeenCalledWith(expect.objectContaining({
      siteId: payload.site,
      subscriptionId: payload.sub,
      generation: payload.gen,
      nonce: payload.nonce,
      keyId: payload.kid,
      sessionDigest: createHash("sha256").update("s".repeat(43)).digest("hex")
    }));
  });

  it("requires same-origin Fetch Metadata and never establishes a session on invalid input", async () => {
    const exchange = vi.fn();
    for (const request of [
      new Request(`${origin}/api/newsletter/confirmation-session`, {
        method: "POST", headers: { ...headers, origin: "https://attacker.example" }, body: '{"token":"x"}'
      }),
      new Request(`${origin}/api/newsletter/confirmation-session`, {
        method: "POST", headers: { ...headers, "sec-fetch-site": "cross-site" }, body: '{"token":"x"}'
      }),
      new Request(`${origin}/api/newsletter/confirmation-session`, {
        method: "POST", headers, body: "{}"
      })
    ]) {
      const response = await handleNewsletterConfirmationSessionRequest(request, {
        verifyToken: () => { throw new Error("invalid"); },
        exchange,
        createSessionSecret: () => "s".repeat(43),
        now: () => new Date()
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(exchange).not.toHaveBeenCalled();
  });

  it("confirms only through explicit POST, deletes the cookie, and treats replay harmlessly", async () => {
    const confirm = vi.fn(async (): Promise<{
      status: "confirmed_pending_provider" | "already_confirmed";
    }> => ({ status: "confirmed_pending_provider" }));
    const secret = "s".repeat(43);
    const response = await handleNewsletterConfirmationRequest(
      new Request(`${origin}/api/newsletter/confirm`, {
        method: "POST",
        headers: { ...headers, cookie: `${CONFIRMATION_COOKIE}=${secret}` }
      }),
      { confirm }
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "activation_pending" });
    expect(confirm).toHaveBeenCalledWith({
      sessionDigest: createHash("sha256").update(secret).digest("hex")
    });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");

    confirm.mockResolvedValueOnce({ status: "already_confirmed" });
    const replay = await handleNewsletterConfirmationRequest(
      new Request(`${origin}/api/newsletter/confirm`, {
        method: "POST", headers: { ...headers, cookie: `${CONFIRMATION_COOKIE}=${secret}` }
      }),
      { confirm }
    );
    expect(await replay.json()).toEqual({ status: "already_confirmed" });
  });
});
