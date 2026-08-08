import { describe, expect, it, vi } from "vitest";

import { createNewsletterCronHandler } from "../lib/newsletter/cron-handler";

describe("newsletter cron boundary", () => {
  it("constructs no worker for missing or mismatched bearer authorization", async () => {
    const workerFactory = vi.fn();
    for (const request of [
      new Request("https://example.test/api/newsletter/jobs/run"),
      new Request("https://example.test/api/newsletter/jobs/run", {
        headers: { authorization: "Bearer wrong-secret" }
      })
    ]) {
      const response = await createNewsletterCronHandler({
        secret: "cron-secret",
        workerFactory
      })(request);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("runs one independent bounded invocation for the exact secret", async () => {
    const run = vi.fn(async () => ({ claimed: 2, completed: 2, failed: 0, blocked: 0 }));
    const workerFactory = vi.fn(async () => ({ run }));
    const response = await createNewsletterCronHandler({
      secret: "cron-secret",
      workerFactory
    })(new Request("https://example.test/api/newsletter/jobs/run", {
      headers: { authorization: "Bearer cron-secret" }
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok", claimed: 2, completed: 2, failed: 0, blocked: 0
    });
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });
});
