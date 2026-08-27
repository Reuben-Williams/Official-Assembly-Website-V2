import type { BuilderContentAdapter, BuilderSiteConfig, EditableValue } from "@reuben-williams/core";
import { createInMemoryAdapter } from "@reuben-williams/core";
import { describe, expect, it, vi } from "vitest";

import { BuilderAuthorizationError } from "../lib/builder/authorization";
import {
  createHistoryResponseV1,
  createHistoryEventId,
  type HistoryEventV1,
  type HistorySource,
  type HistorySourceReaderV1,
} from "../lib/builder/history";
import {
  BuilderContentCommandError,
  createSecuredBuilderHandlers
} from "../lib/builder/repositories";

const site: BuilderSiteConfig = {
  siteId: "site-1",
  adapter: "supabase",
  editor: { path: "/admin/editor", protected: true },
  pages: [{ path: "/", label: "Home", regions: [{ id: "home.hero.title", kind: "text" }] }],
  sections: {}
};

function historyReaders(values: Partial<Record<HistorySource, readonly HistoryEventV1[]>>): Record<HistorySource, HistorySourceReaderV1> {
  return {
    page: async () => values.page ?? [],
    media: async () => values.media ?? [],
    post: async () => values.post ?? [],
    form: async () => values.form ?? [],
  };
}

describe("secured builder route handlers", () => {
  it("normalizes protected values before saving a V2 draft snapshot", async () => {
    const base = createInMemoryAdapter();
    const normalizeEditableValue = vi.fn(async (input: { value: EditableValue }) => ({
      ...input.value,
      ...(input.value.type === "image" ? { alt: "Canonical brand alt" } : {}),
    } as EditableValue));
    const execute = vi.fn(async (_siteKey: string, command: Record<string, unknown>) => ({
      commandId: String(command.commandId), operation: "save" as const, scopes: [], siteGenerationId: null,
    }));
    const handlers = createSecuredBuilderHandlers({
      site,
      adapter: {
        ...base,
        getDraftContent: async () => ({ path: "/", regions: {}, versionId: "draft" }),
        getPublishedContent: async () => ({ path: "/", regions: {}, versionId: "published" }),
      },
      authorize: async () => undefined,
      getUserId: async () => "user-1",
      contentCommands: { execute },
      normalizeEditableValue,
    });

    const response = await handlers.POST(new Request("http://localhost:3000/api/builder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pagePath: "/",
        regionId: "media.home-brand-banner",
        value: { type: "image", src: "/brand/banner.webp", alt: "Untrusted alt" },
      }),
    }));

    expect(response.status).toBe(200);
    expect(normalizeEditableValue).toHaveBeenCalledWith(expect.objectContaining({
      operation: "save",
      pagePath: "/",
      regionId: "media.home-brand-banner",
    }));
    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      scopes: [{ values: {
        "media.home-brand-banner": {
          type: "image", src: "/brand/banner.webp", alt: "Canonical brand alt",
        },
      } }],
    });
  });

  it("validates protected draft snapshots before publish and source versions before restore", async () => {
    const base = createInMemoryAdapter();
    const validateContentSnapshot = vi.fn(async () => undefined);
    const validateRestoreVersion = vi.fn(async () => {
      throw new TypeError("Obsolete brand banner");
    });
    const execute = vi.fn(async (_siteKey: string, command: Record<string, unknown>) => ({
      commandId: String(command.commandId), operation: String(command.operation) as "publish", scopes: [], siteGenerationId: 1,
    }));
    const handlers = createSecuredBuilderHandlers({
      site,
      adapter: {
        ...base,
        getDraftContent: async () => ({
          path: "/",
          regions: { "media.home-brand-banner": { type: "image", src: "/brand/banner.webp", alt: "Brand" } },
          versionId: "draft",
        }),
        getPublishedContent: async () => ({ path: "/", regions: {}, versionId: "published" }),
      },
      authorize: async () => undefined,
      getUserId: async () => "user-1",
      contentCommands: { execute },
      validateContentSnapshot,
      validateRestoreVersion,
    });

    const publish = await handlers.PUT(new Request("http://localhost:3000/api/builder", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pagePath: "/" }),
    }));
    expect(publish.status).toBe(200);
    expect(validateContentSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      operation: "publish",
      pagePath: "/",
      regions: expect.objectContaining({ "media.home-brand-banner": expect.any(Object) }),
    }));

    const restore = await handlers.PATCH(new Request("http://localhost:3000/api/builder", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pagePath: "/", versionId: "source-version" }),
    }));
    expect(restore.status).toBe(400);
    expect(validateRestoreVersion).toHaveBeenCalledWith({ pagePath: "/", versionId: "source-version" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns a no-store unified site history response with bounded query filters", async () => {
    const sourceEventId = "post-event-1";
    const item: HistoryEventV1 = {
      schemaVersion: 1,
      eventId: createHistoryEventId("site-1", "post", sourceEventId),
      siteId: "site-1",
      source: "post",
      sourceEventId,
      category: "posts",
      action: "post.published",
      workspace: "website.posts",
      targetId: "post-1",
      targetLabel: "District update",
      actorId: "user-1",
      actorLabel: "Editor",
      createdAt: "2026-08-07T04:00:00.000Z",
      versions: { parentVersionId: null, sourceVersionId: null, resultVersionId: null },
      change: { before: null, after: null, changedFieldCount: 1 },
      provenance: { legacy: false, limited: false, redactedFields: [] },
      restore: { allowed: false, operation: null, reason: "not evaluated" },
    };
    const response = await createHistoryResponseV1({
      request: new Request("http://localhost:3000/api/builder?resource=history&source=post&limit=25"),
      readers: historyReaders({ post: [item] }),
      role: "viewer",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      items: [{ source: "post", targetLabel: "District update" }],
      partial: false,
    });
  });

  it("turns authorization failures into no-store 401 responses", async () => {
    const handlers = createSecuredBuilderHandlers({
      site,
      adapter: createInMemoryAdapter(),
      authorize: async () => {
        throw new BuilderAuthorizationError("AUTH_REQUIRED", 401, "Sign in required.");
      },
      getUserId: async () => "unreachable"
    });

    const response = await handlers.GET(
      new Request("http://localhost:3000/api/builder?mode=draft")
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: { code: "AUTH_REQUIRED", message: "Sign in required." }
    });
  });

  it("returns 409 before overwriting a stale draft", async () => {
    const base = createInMemoryAdapter();
    const getDraftContent = vi.fn(async () => ({
      path: "/",
      regions: {},
      versionId: "current-version"
    }));
    const saveDraft = vi.fn(base.saveDraft.bind(base));
    const adapter: BuilderContentAdapter = { ...base, getDraftContent, saveDraft };
    const handlers = createSecuredBuilderHandlers({
      site,
      adapter,
      authorize: async () => undefined,
      getUserId: async () => "user-1"
    });

    const response = await handlers.POST(
      new Request("http://localhost:3000/api/builder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pagePath: "/",
          regionId: "home.hero.title",
          value: { type: "text", value: "Updated" },
          expectedVersionId: "older-version"
        })
      })
    );

    expect(response.status).toBe(409);
    expect(saveDraft).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STALE_REVISION" },
      currentVersionId: "current-version"
    });
  });

  it("revalidates a linked post immediately before saving the page draft", async () => {
    const base = createInMemoryAdapter();
    const saveDraft = vi.fn(base.saveDraft.bind(base));
    const validateLinkedPost = vi.fn(async () => false);
    const handlers = createSecuredBuilderHandlers({
      site,
      adapter: { ...base, saveDraft },
      authorize: async () => undefined,
      getUserId: async () => "user-1",
      validateLinkedPost
    });
    const response = await handlers.POST(new Request("http://localhost:3000/api/builder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pagePath: "/",
        regionId: "home.hero.title",
        value: {
          type: "text",
          value: "District update",
          link: { href: "/news/district-update", postEntryId: "11111111-1111-4111-8111-111111111111" }
        }
      })
    }));
    expect(response.status).toBe(409);
    expect(validateLinkedPost).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("saves a full page snapshot through one V2 command with server-owned identity", async () => {
    const base = createInMemoryAdapter();
    const getDraftContent = vi.fn(async () => ({
      path: "/",
      regions: { "home.existing": { type: "text" as const, value: "Existing" } },
      versionId: "11111111-1111-4111-8111-111111111111"
    }));
    const getPublishedContent = vi.fn(async () => ({
      path: "/",
      regions: {},
      versionId: "22222222-2222-4222-8222-222222222222"
    }));
    const execute = vi.fn(async (_siteKey: string, command: Record<string, unknown>) => ({
      commandId: String(command.commandId),
      operation: "save" as const,
      scopes: [{ path: "/", kind: "page" as const, resultVersionId: "33333333-3333-4333-8333-333333333333" }],
      siteGenerationId: null
    }));
    const handlers = createSecuredBuilderHandlers({
      site,
      adapter: { ...base, getDraftContent, getPublishedContent },
      authorize: async () => undefined,
      getUserId: async () => "44444444-4444-4444-8444-444444444444",
      contentCommands: { execute }
    });

    const response = await handlers.POST(new Request("http://localhost:3000/api/builder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pagePath: "/",
        regionId: "home.hero.title",
        value: { type: "text", value: "Updated" }
      })
    }));

    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith("site-1", expect.objectContaining({
      schemaVersion: 2,
      siteId: "site-1",
      actorId: "44444444-4444-4444-8444-444444444444",
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      idempotencyKey: expect.stringMatching(/^save:/),
      payloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      operation: "save",
      scopes: [{
        scope: { kind: "page", path: "/" },
        expectedDraftVersionId: "11111111-1111-4111-8111-111111111111",
        expectedPublishedVersionId: "22222222-2222-4222-8222-222222222222",
        values: {
          "home.existing": { type: "text", value: "Existing" },
          "home.hero.title": { type: "text", value: "Updated" }
        }
      }]
    }));
  });

  it("publishes global and page drafts in one atomic V2 command", async () => {
    const compositeSite: BuilderSiteConfig = {
      ...site,
      globalRegions: [{ id: "global.brand", kind: "text" }]
    };
    const base = createInMemoryAdapter();
    const getDraftContent = vi.fn(async (_siteId: string, path: string) => ({
      path,
      regions: (path === "/__builder/global"
        ? { "global.brand": { type: "text" as const, value: "Office" } }
        : { "home.hero.title": { type: "text" as const, value: "Home" } }) as Record<string, EditableValue>,
      versionId: path === "/__builder/global"
        ? "55555555-5555-4555-8555-555555555555"
        : "66666666-6666-4666-8666-666666666666"
    }));
    const getPublishedContent = vi.fn(async (_siteId: string, path: string) => ({
      path,
      regions: {},
      versionId: path === "/__builder/global"
        ? "77777777-7777-4777-8777-777777777777"
        : "88888888-8888-4888-8888-888888888888"
    }));
    const execute = vi.fn(async (_siteKey: string, command: Record<string, unknown>) => ({
      commandId: String(command.commandId),
      operation: "publish" as const,
      scopes: [],
      siteGenerationId: 3
    }));
    const handlers = createSecuredBuilderHandlers({
      site: compositeSite,
      adapter: { ...base, getDraftContent, getPublishedContent },
      authorize: async () => undefined,
      getUserId: async () => "44444444-4444-4444-8444-444444444444",
      contentCommands: { execute }
    });

    const response = await handlers.PUT(new Request("http://localhost:3000/api/builder", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pagePath: "/" })
    }));

    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ operation: "publish" });
    expect((execute.mock.calls[0]?.[1] as { scopes: unknown[] }).scopes).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: { kind: "global", path: "/__builder/global" } }),
      expect.objectContaining({ scope: { kind: "page", path: "/" } })
    ]));
  });

  it("maps a stale command without exposing database details", async () => {
    const base = createInMemoryAdapter();
    const handlers = createSecuredBuilderHandlers({
      site,
      adapter: {
        ...base,
        getDraftContent: async () => ({ path: "/", regions: {}, versionId: "draft" }),
        getPublishedContent: async () => ({ path: "/", regions: {}, versionId: "published" })
      },
      authorize: async () => undefined,
      getUserId: async () => "44444444-4444-4444-8444-444444444444",
      contentCommands: {
        execute: async () => {
          throw new BuilderContentCommandError("STALE_REVISION", 409);
        }
      }
    });

    const response = await handlers.PUT(new Request("http://localhost:3000/api/builder", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pagePath: "/" })
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "STALE_REVISION", message: "The content changed. Refresh and try again." }
    });
  });
});
