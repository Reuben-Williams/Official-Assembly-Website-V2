import { describe, expect, it, vi } from "vitest";

import { createInstallationCronHandler } from "../lib/control-plane/cron-handler";

describe("installation runtime cron boundary", () => {
  it("fails closed before constructing the runtime when authorization is absent", async () => {
    const runtimeFactory = vi.fn();
    const GET = createInstallationCronHandler({ secret: "cron-secret", runtimeFactory });

    const response = await GET(new Request("https://example.test/api/platform/installations/run"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it("runs one direct in-process invocation for the exact bearer secret", async () => {
    const runScheduled = vi.fn(async () => ({ pulled: 1, acknowledged: 1, healthReported: true }));
    const GET = createInstallationCronHandler({
      secret: "cron-secret",
      runtimeFactory: () => ({ runScheduled })
    });

    const response = await GET(new Request("https://example.test/api/platform/installations/run", {
      headers: { authorization: "Bearer cron-secret" }
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      pulled: 1,
      acknowledged: 1,
      healthReported: true
    });
    expect(runScheduled).toHaveBeenCalledTimes(1);
  });

  it("returns only a sanitized unavailable response on runtime failure", async () => {
    const GET = createInstallationCronHandler({
      secret: "cron-secret",
      runtimeFactory: () => ({ runScheduled: async () => { throw new Error("private detail"); } })
    });

    const response = await GET(new Request("https://example.test/api/platform/installations/run", {
      headers: { authorization: "Bearer cron-secret" }
    }));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private detail");
  });
});
