import type { AlertServerRepository } from "@reuben-williams/next/alerts/server";
import { describe, expect, it, vi } from "vitest";

import { createOfficialAssemblyAlertHandlers } from "../lib/builder/alerts";
import type { ActiveBuilderIdentity } from "../lib/builder/authorization";

const origin = "http://localhost:3000";
const siteKey = "official-assembly-website-v2";
const userId = "11111111-1111-4111-8111-111111111111";
const draftRevisionId = "22222222-2222-4222-8222-222222222222";
const publishedRevisionId = "33333333-3333-4333-8333-333333333333";

function identity(overrides: Partial<ActiveBuilderIdentity> = {}): ActiveBuilderIdentity {
  return {
    userId,
    role: "owner",
    siteKey,
    siteId: "44444444-4444-4444-8444-444444444444",
    sessionGeneration: 2,
    tokenGeneration: 2,
    csrfToken: "csrf-token",
    ...overrides,
  };
}

function repository(): AlertServerRepository {
  return {
    readCollection: vi.fn(async () => null),
    initializeCollection: vi.fn(async () => ({
      schemaVersion: 1 as const,
      collectionId: "alerts" as const,
      draftRevisionId,
      publishedRevisionId,
      lockVersion: 0,
      items: [],
      updatedAt: "2026-08-08T12:00:00.000Z",
    })),
    executeCommand: vi.fn(async (command) => ({
      schemaVersion: 1 as const,
      commandId: command.commandId,
      operation: command.operation,
      collectionId: "alerts" as const,
      draftRevisionId: "55555555-5555-4555-8555-555555555555",
      publishedRevisionId,
      resultRevisionId: "55555555-5555-4555-8555-555555555555",
      lockVersion: 1,
    })),
    readPublishedAlerts: vi.fn(async () => ({
      schemaVersion: 1 as const,
      revisionId: publishedRevisionId,
      activeAlerts: [{ id: "district-update", category: "general" as const, message: "District update" }],
      evaluatedAt: "2026-08-08T12:00:00.000Z",
      nextTransitionAt: null,
    })),
    claimRecoveryJob: vi.fn(async () => null),
    completeRecoveryJob: vi.fn(async () => true),
    failRecoveryJob: vi.fn(async () => ({ status: "retry" as const, attemptCount: 1 })),
  };
}

describe("official Assembly alert routes", () => {
  it("rejects anonymous and wrong-site management reads", async () => {
    const anonymous = createOfficialAssemblyAlertHandlers({
      repository: repository(),
      authenticate: async () => null,
      allowedOrigins: [origin],
    });
    const anonymousResponse = await anonymous.read(new Request(`${origin}/api/builder/alerts`));
    expect(anonymousResponse.status).toBe(401);
    expect(anonymousResponse.headers.get("cache-control")).toBe("no-store");

    const foreign = createOfficialAssemblyAlertHandlers({
      repository: repository(),
      authenticate: async () => identity({ siteKey: "another-site" }),
      allowedOrigins: [origin],
    });
    const foreignResponse = await foreign.read(new Request(`${origin}/api/builder/alerts`));
    expect(foreignResponse.status).toBe(403);
  });

  it("rejects a viewer command before calling the repository", async () => {
    const data = repository();
    const handlers = createOfficialAssemblyAlertHandlers({
      repository: data,
      authenticate: async () => identity({ role: "viewer" }),
      allowedOrigins: [origin],
    });
    const response = await handlers.command(commandRequest());

    expect(response.status).toBe(403);
    expect(data.executeCommand).not.toHaveBeenCalled();
  });

  it("derives site and actor identity while preserving concurrency and idempotency", async () => {
    const data = repository();
    const handlers = createOfficialAssemblyAlertHandlers({
      repository: data,
      authenticate: async () => identity({ role: "contributor" }),
      allowedOrigins: [origin],
      createCommandId: () => "66666666-6666-4666-8666-666666666666",
    });
    const response = await handlers.command(commandRequest());

    expect(response.status).toBe(200);
    expect(data.executeCommand).toHaveBeenCalledWith(expect.objectContaining({
      siteId: siteKey,
      actorId: userId,
      commandId: "66666666-6666-4666-8666-666666666666",
      idempotencyKey: "alerts:create:browser-request",
      expectedLockVersion: 0,
      expectedDraftRevisionId: draftRevisionId,
      operation: "create",
      payloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("returns only the bounded public projection with no-store caching", async () => {
    const data = repository();
    const handlers = createOfficialAssemblyAlertHandlers({
      repository: data,
      authenticate: async () => null,
      allowedOrigins: [origin],
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    });
    const response = await handlers.publicRead(new Request(`${origin}/api/public/alerts`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      revisionId: publishedRevisionId,
      activeAlerts: [{ id: "district-update", category: "general", message: "District update" }],
      evaluatedAt: "2026-08-08T12:00:00.000Z",
      nextTransitionAt: null,
    });
    expect(data.readPublishedAlerts).toHaveBeenCalledWith(siteKey, "2026-08-08T12:00:00.000Z");
  });
});

function commandRequest() {
  return new Request(`${origin}/api/builder/alerts/command`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
      "x-builder-csrf": "csrf-token",
      "x-idempotency-key": "alerts:create:browser-request",
    },
    body: JSON.stringify({
      operation: "create",
      expectedLockVersion: 0,
      expectedDraftRevisionId: draftRevisionId,
      item: {
        id: "district-update",
        category: "general",
        message: "District update",
        link: null,
        lifecycle: "active",
        enabled: true,
        startsAt: null,
        endsAt: null,
      },
    }),
  });
}
