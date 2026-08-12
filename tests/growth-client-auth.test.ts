import { afterEach, describe, expect, it, vi } from "vitest";

import { createLiveGrowthClient } from "../lib/growth/client";

afterEach(() => vi.unstubAllGlobals());

describe("live growth client authorization", () => {
  it("preserves a 401 category and requests fresh sign-in without retrying", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { code: "AUTH_REQUIRED", message: "A verified member session is required." }
    }), {
      status: 401,
      headers: { "content-type": "application/json" }
    }));
    const onAuthenticationRequired = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createLiveGrowthClient("34000000-0000-4000-8000-000000000001", {
      getCsrfToken: () => "csrf-token",
      onAuthenticationRequired
    });

    await expect(client.dashboard()).rejects.toMatchObject({
      name: "GrowthClientError",
      code: "AUTH_REQUIRED",
      status: 401
    });
    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/growth/queries/dashboard",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("requests fresh sign-in for every protected-endpoint 401 category", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { code: "SESSION_EXPIRED", message: "The editor session has expired." }
    }), {
      status: 401,
      headers: { "content-type": "application/json" }
    })));
    const onAuthenticationRequired = vi.fn();
    const client = createLiveGrowthClient("34000000-0000-4000-8000-000000000001", {
      onAuthenticationRequired
    });

    await expect(client.dashboard()).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
      status: 401
    });
    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
  });

  it("requests fresh sign-in once when concurrent reads receive 401 responses", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { code: "AUTH_REQUIRED", message: "A verified member session is required." }
    }), {
      status: 401,
      headers: { "content-type": "application/json" }
    }));
    const onAuthenticationRequired = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createLiveGrowthClient("34000000-0000-4000-8000-000000000001", {
      onAuthenticationRequired
    });

    const results = await Promise.allSettled([
      client.dashboard(),
      client.leadsApi.list({ limit: 25 }),
      client.customersApi.list({})
    ]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("preserves non-authentication failures without redirecting", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { code: "QUERY_DENIED", message: "The current role cannot read this workspace." }
    }), {
      status: 403,
      headers: { "content-type": "application/json" }
    }));
    const onAuthenticationRequired = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createLiveGrowthClient("34000000-0000-4000-8000-000000000001", {
      onAuthenticationRequired
    });

    await expect(client.dashboard()).rejects.toMatchObject({
      code: "QUERY_DENIED",
      status: 403
    });
    expect(onAuthenticationRequired).not.toHaveBeenCalled();
  });

  it("sends the current editor CSRF token on growth mutations", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      result: "applied",
      resource: { type: "lead", id: "34100000-0000-4000-8000-000000000001" },
      version: 2
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "34200000-0000-4000-8000-000000000001") });
    const client = createLiveGrowthClient("34000000-0000-4000-8000-000000000001", {
      getCsrfToken: () => "current-csrf-token",
      onAuthenticationRequired: vi.fn()
    });

    await client.leadsApi.changeStatus({
      leadId: "34100000-0000-4000-8000-000000000001",
      expectedVersion: 1,
      status: "contacted"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/growth/operations/leads/34100000-0000-4000-8000-000000000001/status",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-builder-csrf": "current-csrf-token",
          "x-idempotency-key": "34200000-0000-4000-8000-000000000001"
        })
      })
    );
  });
});
