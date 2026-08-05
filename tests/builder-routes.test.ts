import type { BuilderContentAdapter, BuilderSiteConfig } from "@reuben-williams/core";
import { createInMemoryAdapter } from "@reuben-williams/core";
import { describe, expect, it, vi } from "vitest";

import { BuilderAuthorizationError } from "../lib/builder/authorization";
import { createSecuredBuilderHandlers } from "../lib/builder/repositories";

const site: BuilderSiteConfig = {
  siteId: "site-1",
  adapter: "supabase",
  editor: { path: "/admin/editor", protected: true },
  pages: [{ path: "/", label: "Home", regions: [{ id: "home.hero.title", kind: "text" }] }],
  sections: {}
};

describe("secured builder route handlers", () => {
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
});
