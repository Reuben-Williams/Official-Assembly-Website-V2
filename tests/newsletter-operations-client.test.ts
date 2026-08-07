import { afterEach, describe, expect, it, vi } from "vitest";

import { createNewsletterOperationsClient } from "../lib/newsletter/operations-client";

afterEach(() => vi.unstubAllGlobals());

describe("newsletter operations client", () => {
  it("reuses the same command while command-bound reconciliation is pending", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "pending" }), {
        status: 202,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "ready" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "34000000-0000-4000-8000-000000000001") });
    const client = createNewsletterOperationsClient(() => "csrf-token");

    await expect(client.activationCheck("broadcast-1")).resolves.toMatchObject({ state: "pending" });
    await expect(client.activationCheck("broadcast-1")).resolves.toMatchObject({ state: "ready" });

    const first = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(first.commandId).toBe("34000000-0000-4000-8000-000000000001");
    expect(second.commandId).toBe(first.commandId);
    expect(first.broadcastId).toBe("broadcast-1");
  });
});
