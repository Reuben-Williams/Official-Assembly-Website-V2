import type { AlertServerRepository } from "@reuben-williams/next/alerts/server";
import { describe, expect, it, vi } from "vitest";

import { createOfficialAssemblyAlertHandlers } from "../lib/builder/alerts";

function repository(value: Awaited<ReturnType<AlertServerRepository["readPublishedAlerts"]>>): AlertServerRepository {
  return {
    readCollection: vi.fn(async () => null),
    initializeCollection: vi.fn(),
    executeCommand: vi.fn(),
    readPublishedAlerts: vi.fn(async () => value),
    claimRecoveryJob: vi.fn(async () => null),
    completeRecoveryJob: vi.fn(async () => true),
    failRecoveryJob: vi.fn(async () => ({ status: "retry" as const, attemptCount: 1 })),
  };
}

describe("public alerts API", () => {
  it("returns an empty no-store 204 when no collection has been published", async () => {
    const response = await createOfficialAssemblyAlertHandlers({
      repository: repository(null),
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    }).publicRead(new Request("https://www.assemblywomanmorales.com/api/public/alerts"));

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("rejects non-GET methods without exposing provider details", async () => {
    const response = await createOfficialAssemblyAlertHandlers({
      repository: repository(null),
    }).publicRead(new Request("https://www.assemblywomanmorales.com/api/public/alerts", { method: "POST" }));

    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "METHOD_NOT_ALLOWED" } });
  });
});
