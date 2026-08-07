import { describe, expect, it, vi } from "vitest";

import { runRecoveryBootstrap, safeRecoveryLogEvent } from "../lib/builder/recovery";

describe("recovery bootstrap runner", () => {
  it("requires an exact environment/site confirmation before doing work", async () => {
    const runOnce = vi.fn();
    await expect(runRecoveryBootstrap({
      environment: "production",
      siteKey: "official-assembly-website-v2",
      confirmation: "wrong",
      runOnce,
      health: async () => ({ ready: true, generationId: 1, routeCount: 11, mediaCount: 0 })
    })).rejects.toThrow("confirmation");
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("drains due jobs and returns only safe readiness evidence", async () => {
    const runOnce = vi.fn()
      .mockResolvedValueOnce({ status: "completed", generationId: 4 })
      .mockResolvedValueOnce({ status: "idle" });
    const result = await runRecoveryBootstrap({
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      confirmation: "official-assembly-website-v2:preview",
      runOnce,
      health: async () => ({ ready: true, generationId: 4, routeCount: 11, mediaCount: 3 })
    });

    expect(result).toEqual({
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      generationId: 4,
      routeCount: 11,
      mediaCount: 3,
      jobsProcessed: 1,
      status: "ready"
    });
    expect(JSON.stringify(result)).not.toMatch(/token|secret|blob\.vercel|supabase/i);
  });

  it("exits non-ready when complete route and media health cannot be proved", async () => {
    await expect(runRecoveryBootstrap({
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      confirmation: "official-assembly-website-v2:preview",
      runOnce: async () => ({ status: "idle" }),
      health: async () => ({ ready: false, generationId: null, routeCount: 0, mediaCount: 0 })
    })).rejects.toThrow("not ready");
  });

  it("allowlists operational log fields and drops credentials or private URLs", () => {
    expect(safeRecoveryLogEvent({
      event: "worker.completed",
      status: "completed",
      generationId: 4,
      safeCode: "OK",
      token: "secret",
      privateUrl: "https://store.private.blob.vercel-storage.com/object"
    })).toEqual({
      event: "worker.completed",
      status: "completed",
      generationId: 4,
      safeCode: "OK"
    });
  });
});
