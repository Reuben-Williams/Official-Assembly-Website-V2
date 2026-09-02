import { describe, expect, it, vi } from "vitest";

import { createCalendarRouteHandlers } from "../lib/calendar/repository";
import type { ActiveBuilderIdentity } from "../lib/builder/authorization";
import type { CalendarRepository } from "../lib/calendar/repository";

const origin = "http://localhost:3000";
const siteId = "182c3a48-a024-452b-bc88-44e795c55b95";
const siteKey = "official-assembly-website-v2";
const userId = "24cdb58e-8cb4-4638-972f-649a01196e42";
const eventId = "0bb3a51c-3c88-4d4e-a5b1-4a8d2192f34b";

function identity(overrides: Partial<ActiveBuilderIdentity> = {}): ActiveBuilderIdentity {
  return {
    userId,
    role: "owner",
    siteKey,
    siteId,
    sessionGeneration: 2,
    tokenGeneration: 2,
    csrfToken: "csrf-token",
    ...overrides
  };
}

function repository(): CalendarRepository {
  return {
    listManagement: vi.fn(async () => ({ schemaVersion: 1 as const, events: [] })),
    readPublic: vi.fn(async () => []),
    executeCommand: vi.fn(async (input) => ({
      schemaVersion: 1 as const,
      command: input.command,
      event: { id: input.eventId ?? eventId, commandVersion: input.expectedVersion + 1 }
    }))
  } as unknown as CalendarRepository;
}

function mutation(command: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/builder/calendar/${command}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
      "x-builder-csrf": "csrf-token",
      "x-idempotency-key": `calendar:${command}:request-1`,
      ...headers
    },
    body: JSON.stringify(body)
  });
}

describe("calendar management API", () => {
  it("requires an active same-site session for reads", async () => {
    const anonymous = createCalendarRouteHandlers({ repository: repository(), authenticate: async () => null });
    expect((await anonymous.list(new Request(`${origin}/api/builder/calendar`))).status).toBe(401);

    const foreign = createCalendarRouteHandlers({
      repository: repository(),
      authenticate: async () => identity({ siteKey: "another-site" })
    });
    expect((await foreign.list(new Request(`${origin}/api/builder/calendar`))).status).toBe(403);
  });

  it("returns a no-store bounded list for viewers", async () => {
    const data = repository();
    const handlers = createCalendarRouteHandlers({
      repository: data,
      authenticate: async () => identity({ role: "viewer" })
    });
    const response = await handlers.list(new Request(`${origin}/api/builder/calendar`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data.listManagement).toHaveBeenCalledWith(expect.objectContaining({ siteId, userId, role: "viewer" }));
  });

  it("rejects viewer mutations, contributor publishing, invalid origin, and bad CSRF", async () => {
    for (const [role, command] of [["viewer", "create_draft"], ["contributor", "publish"]] as const) {
      const data = repository();
      const handlers = createCalendarRouteHandlers({ repository: data, authenticate: async () => identity({ role }) });
      const response = await handlers.command(mutation(command, {
        eventId,
        expectedVersion: 1,
        ...(command === "create_draft" ? { draft: completeDraft() } : {})
      }), command);
      expect(response.status).toBe(403);
      expect(data.executeCommand).not.toHaveBeenCalled();
    }

    const handlers = createCalendarRouteHandlers({ repository: repository(), authenticate: async () => identity() });
    expect((await handlers.command(mutation("publish", { eventId, expectedVersion: 1 }, { origin: "https://evil.example" }), "publish")).status)
      .toBe(403);
    expect((await handlers.command(mutation("publish", { eventId, expectedVersion: 1 }, { "x-builder-csrf": "wrong" }), "publish")).status)
      .toBe(403);
  });

  it("requires JSON, bounded bodies, exact commands, idempotency, and valid versions", async () => {
    const handlers = createCalendarRouteHandlers({ repository: repository(), authenticate: async () => identity() });
    expect((await handlers.command(mutation("delete", { eventId, expectedVersion: 1 }), "delete")).status).toBe(404);
    expect((await handlers.command(mutation("publish", { eventId, expectedVersion: 1 }, { "content-type": "text/plain" }), "publish")).status).toBe(415);
    expect((await handlers.command(mutation("publish", { eventId, expectedVersion: 1 }, { "x-idempotency-key": "" }), "publish")).status).toBe(400);
    expect((await handlers.command(mutation("publish", { eventId, expectedVersion: -1 }), "publish")).status).toBe(400);

    const oversized = mutation("create_draft", { draft: { titleEn: "x".repeat(70_000) }, expectedVersion: 0 });
    expect((await handlers.command(oversized, "create_draft")).status).toBe(413);
  });

  it("normalizes drafts and derives actor/site scope before executing", async () => {
    const data = repository();
    const handlers = createCalendarRouteHandlers({ repository: data, authenticate: async () => identity({ role: "contributor" }) });
    const response = await handlers.command(mutation("create_draft", {
      expectedVersion: 0,
      draft: completeDraft()
    }), "create_draft");

    expect(response.status).toBe(201);
    expect(data.executeCommand).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ siteId, siteKey, userId, role: "contributor" }),
      command: "create_draft",
      eventId: null,
      expectedVersion: 0,
      idempotencyKey: "calendar:create_draft:request-1",
      draft: expect.objectContaining({
        titleEn: "District meeting",
        titleEs: "Reunión del distrito",
        displayTimeZone: "America/New_York"
      })
    }));
  });

  it("maps conflicts and never exposes repository details", async () => {
    const data = repository();
    data.executeCommand = vi.fn(async () => {
      const { CalendarRepositoryError } = await import("../lib/calendar/repository");
      throw new CalendarRepositoryError("STALE_VERSION", 409, "private database details");
    });
    const handlers = createCalendarRouteHandlers({ repository: data, authenticate: async () => identity() });
    const response = await handlers.command(mutation("publish", { eventId, expectedVersion: 1 }), "publish");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "STALE_VERSION", message: "The event changed. Refresh and try again." }
    });
  });
});

function completeDraft() {
  return {
    titleEn: " District meeting ",
    titleEs: " Reunión del distrito ",
    descriptionEn: " Meet with the district office. ",
    descriptionEs: " Reúnase con la oficina del distrito. ",
    startAt: "2026-09-20T14:00:00-04:00",
    endAt: null,
    locationName: " District Office ",
    locationAddress: " 152 Franklin Street, Belleville, NJ 07109 ",
    actionUrl: null,
    actionLabelEn: "",
    actionLabelEs: "",
    mediaAssetId: null,
    publicApproved: false,
    hostedByOffice: false
  };
}
