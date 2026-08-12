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

  it("sends bounded owner commands without accepting provider identity or counts", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ state: "recorded" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetch);
    const client = createNewsletterOperationsClient(() => "csrf-token");

    await client.recordProviderAttestation("34000000-0000-4000-8000-000000000011");
    await client.recordAuthSmtpProof(
      "34000000-0000-4000-8000-000000000012",
      "replacement_login"
    );
    await client.activateProvider("34000000-0000-4000-8000-000000000013");
    await client.recoverReconciliation(
      "34000000-0000-4000-8000-000000000014",
      "Provider incident reviewed by the site owner."
    );
    await client.reconcileProviderHistory("34000000-0000-4000-8000-000000000015");
    await client.reconcilePendingOwnerLogins("34000000-0000-4000-8000-000000000016");

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/newsletter/operations/provider-attestation",
      "/api/newsletter/operations/auth-smtp-proof",
      "/api/newsletter/operations/provider-activation",
      "/api/newsletter/operations/recovery",
      "/api/newsletter/operations/history-reconciliation",
      "/api/newsletter/operations/history-reconciliation",
      "/api/newsletter/operations/owner-login-recovery"
    ]);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      commandId: "34000000-0000-4000-8000-000000000011",
      confirmed: true
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      commandId: "34000000-0000-4000-8000-000000000012",
      phase: "replacement_login"
    });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
      commandId: "34000000-0000-4000-8000-000000000013"
    });
    expect(JSON.parse(String(fetch.mock.calls[3]?.[1]?.body))).toEqual({
      commandId: "34000000-0000-4000-8000-000000000014",
      reason: "Provider incident reviewed by the site owner."
    });
    expect(JSON.parse(String(fetch.mock.calls[4]?.[1]?.body))).toEqual({
      commandId: "34000000-0000-4000-8000-000000000015",
      mode: "dry_run"
    });
    expect(JSON.parse(String(fetch.mock.calls[5]?.[1]?.body))).toEqual({
      commandId: "34000000-0000-4000-8000-000000000015",
      mode: "apply"
    });
    expect(JSON.parse(String(fetch.mock.calls[6]?.[1]?.body))).toEqual({
      commandId: "34000000-0000-4000-8000-000000000016"
    });
  });
});
