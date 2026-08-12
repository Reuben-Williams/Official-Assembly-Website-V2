import { describe, expect, it, vi } from "vitest";
import type { LocalizedDomainV1 } from "@reuben-williams/content";

import {
  createBilingualEditorHandlers,
  type BilingualEditorRepository,
} from "../lib/builder/localization/server";
import type { ActiveBuilderIdentity } from "../lib/builder/authorization";

const origin = "http://localhost:3000";
const siteId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function identity(role: ActiveBuilderIdentity["role"]): ActiveBuilderIdentity {
  return {
    userId,
    role,
    siteKey: "official-assembly-website-v2",
    siteId,
    sessionGeneration: 3,
    tokenGeneration: 3,
    csrfToken: "csrf-token",
  };
}

function repository(): BilingualEditorRepository {
  return {
    readWorkspace: vi.fn(async () => ({
      revisions: [],
      published: null,
      publications: [],
      candidates: [],
      publicationState: null,
      recoveryPointer: null,
      blockers: [],
    })),
    readRevisionDomain: vi.fn(async (): Promise<LocalizedDomainV1> => "site"),
    readCompositionDeltaDomain: vi.fn(async (): Promise<LocalizedDomainV1> => "site"),
    mutateTranslation: vi.fn(async (input) => ({ operation: input.operation })),
    stage: vi.fn(async (input) => ({ operation: "stage", actorId: input.actorId })),
    publish: vi.fn(async (input) => ({ operation: "publish", actorId: input.actorId })),
    restore: vi.fn(async (input) => ({ operation: "restore", actorId: input.actorId })),
    activate: vi.fn(async (input) => ({ operation: "activate", actorId: input.actorId })),
  };
}

function mutation(operation: string, body: Record<string, unknown> = {}) {
  return new Request(`${origin}/api/builder/localization`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
      "x-builder-csrf": "csrf-token",
      "x-idempotency-key": `localization:${operation}:33333333-3333-4333-8333-333333333333`,
    },
    body: JSON.stringify({ operation, ...body }),
  });
}

describe("bilingual editor handlers", () => {
  it("allows every active member to inspect readiness without exposing another site", async () => {
    const data = repository();
    const handlers = createBilingualEditorHandlers({
      repository: data,
      authenticate: async () => identity("viewer"),
      allowedOrigins: [origin],
    });
    const response = await handlers.GET(new Request(`${origin}/api/builder/localization`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data.readWorkspace).toHaveBeenCalledWith(siteId);
  });

  it("filters readiness records for domains the viewer cannot inspect", async () => {
    const data = repository();
    vi.mocked(data.readWorkspace).mockResolvedValue({
      revisions: [
        { domain: "site", stable_id: "home.hero" },
        { domain: "media", stable_id: "media.hero" },
      ],
      blockers: [
        { domain: "site", stableId: "home.hero", fieldId: "title" },
        { domain: "media", stableId: "media.hero", fieldId: "alt" },
      ],
      published: null,
      publications: [],
      candidates: [
        { composition_id: "site", intended_delta: { kind: "domain", domain: "site" } },
        { composition_id: "media", intended_delta: { kind: "domain", domain: "media" } },
        { composition_id: "restore", intended_delta: { kind: "restore" } },
      ],
      publicationState: null,
      recoveryPointer: null,
    });
    const handlers = createBilingualEditorHandlers({
      repository: data,
      authenticate: async () => identity("viewer"),
      allowedOrigins: [origin],
    });
    const response = await handlers.GET(new Request(`${origin}/api/builder/localization`));
    const body = await response.json() as { revisions: unknown[]; blockers: unknown[]; candidates: unknown[] };

    expect(body.revisions).toEqual([{ domain: "site", stable_id: "home.hero" }]);
    expect(body.blockers).toEqual([{ domain: "site", stableId: "home.hero", fieldId: "title" }]);
    expect(body.candidates).toEqual([
      { composition_id: "site", intended_delta: { kind: "domain", domain: "site" } },
    ]);
  });

  it("lets an editor approve Spanish while deriving site and actor identity", async () => {
    const data = repository();
    const handlers = createBilingualEditorHandlers({
      repository: data,
      authenticate: async () => identity("editor"),
      allowedOrigins: [origin],
    });
    const response = await handlers.POST(mutation("approve", {
      domain: "site",
      stableId: "home.hero",
      fieldId: "home.hero.title",
    }));

    expect(response.status).toBe(200);
    expect(data.mutateTranslation).toHaveBeenCalledWith(expect.objectContaining({
      siteId,
      actorId: userId,
      operation: "approve",
      domain: "site",
      stableId: "home.hero",
      fieldId: "home.hero.title",
    }));
  });

  it("rejects contributor approval and editor activation before repository calls", async () => {
    const contributorData = repository();
    const contributor = createBilingualEditorHandlers({
      repository: contributorData,
      authenticate: async () => identity("contributor"),
      allowedOrigins: [origin],
    });
    expect((await contributor.POST(mutation("approve"))).status).toBe(403);
    expect(contributorData.mutateTranslation).not.toHaveBeenCalled();

    const editorData = repository();
    const editor = createBilingualEditorHandlers({
      repository: editorData,
      authenticate: async () => identity("editor"),
      allowedOrigins: [origin],
    });
    expect((await editor.POST(mutation("activate"))).status).toBe(403);
    expect(editorData.activate).not.toHaveBeenCalled();
  });

  it("rejects a wrong-site session and a missing CSRF proof before mutations", async () => {
    const foreignData = repository();
    const foreign = createBilingualEditorHandlers({
      repository: foreignData,
      authenticate: async () => ({ ...identity("owner"), siteKey: "another-site" }),
      allowedOrigins: [origin],
    });
    expect((await foreign.GET(new Request(`${origin}/api/builder/localization`))).status).toBe(403);
    expect(foreignData.readWorkspace).not.toHaveBeenCalled();

    const csrfData = repository();
    const csrf = createBilingualEditorHandlers({
      repository: csrfData,
      authenticate: async () => identity("owner"),
      allowedOrigins: [origin],
    });
    const request = mutation("approve");
    request.headers.delete("x-builder-csrf");
    expect((await csrf.POST(request)).status).toBe(403);
    expect(csrfData.mutateTranslation).not.toHaveBeenCalled();
  });

  it("keeps activation owner-only and forwards the evidence without browser identity", async () => {
    const data = repository();
    const handlers = createBilingualEditorHandlers({
      repository: data,
      authenticate: async () => identity("owner"),
      allowedOrigins: [origin],
    });
    const response = await handlers.POST(mutation("activate", {
      expectedLockVersion: 4,
      expectedCompositionDigest: "a".repeat(64),
      expectedCatalogPublicDigest: "b".repeat(64),
      inventoryDigest: "c".repeat(64),
      applicationRelease: "official-assembly-website-v2@0.1.0",
      packageVersions: { "@reuben-williams/core": "0.3.0" },
      migrationSet: ["20260812035711_complete_bilingual_publishing.sql"],
    }));

    expect(response.status).toBe(200);
    expect(data.activate).toHaveBeenCalledWith(expect.objectContaining({
      siteId,
      actorId: userId,
      expectedLockVersion: 4,
      inventoryDigest: "c".repeat(64),
    }));
  });
});
