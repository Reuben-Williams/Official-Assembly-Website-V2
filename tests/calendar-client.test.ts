import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpCalendarClient } from "../lib/calendar/client";

afterEach(() => vi.unstubAllGlobals());

describe("calendar browser client", () => {
  it("reads with no-store same-origin credentials", async () => {
    const fetchMock = vi.fn(async () => Response.json({ schemaVersion: 1, events: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHttpCalendarClient({ getCsrfToken: () => "csrf-token" });

    await expect(client.list()).resolves.toEqual({ schemaVersion: 1, events: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/builder/calendar", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" }
    });
  });

  it("sends bounded command data with CSRF and idempotency headers and no credentials", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      schemaVersion: 1,
      command: "publish",
      event: {}
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHttpCalendarClient({ getCsrfToken: () => "csrf-token" });

    await client.command({
      command: "publish",
      eventId: "0bb3a51c-3c88-4d4e-a5b1-4a8d2192f34b",
      expectedVersion: 3,
      idempotencyKey: "calendar:publish:request-1"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/builder/calendar/publish",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-builder-csrf": "csrf-token",
          "x-idempotency-key": "calendar:publish:request-1"
        }
      })
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/service.role|supabase.*key|bearer/i);
  });

  it("refuses to mutate without the readable session CSRF token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createHttpCalendarClient({ getCsrfToken: () => null });

    await expect(client.command({
      command: "archive",
      eventId: "0bb3a51c-3c88-4d4e-a5b1-4a8d2192f34b",
      expectedVersion: 3,
      idempotencyKey: "calendar:archive:request-1"
    })).rejects.toThrow(/session/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
