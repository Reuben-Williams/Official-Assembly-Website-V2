import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("../lib/builder/authorization", () => ({
  BuilderAuthorizationError: class BuilderAuthorizationError extends Error {
    constructor(readonly code: string, readonly status: number, message: string) { super(message); }
  },
  allowedBuilderOrigins: () => ["http://localhost:3000"],
  authorizeBuilderRequest: async () => ({
    userId: "11111111-1111-4111-8111-111111111111",
    role: "owner",
    siteKey: "official-assembly-website-v2",
    siteId: "22222222-2222-4222-8222-222222222222",
    sessionGeneration: 1,
    tokenGeneration: 1,
    csrfToken: "csrf-token"
  })
}));
vi.mock("../lib/builder/request-auth", () => ({ authenticateBuilderRequest: vi.fn() }));
vi.mock("../lib/supabase/server", () => ({ createRequestSupabaseClient: async () => state.client }));

import { POST } from "../app/api/builder/posts/[[...segments]]/route";

const entry = {
  id: "33333333-3333-4333-8333-333333333333",
  status: "draft",
  active_draft_version_id: "44444444-4444-4444-8444-444444444444",
  active_published_version_id: null,
  updated_at: "2026-08-07T04:00:00.000Z"
};

function postClient(bodyContent: unknown[]) {
  const snapshot = {
    slug: "district-update",
    displayTimeZone: "America/New_York",
    data: {
      title: "District update",
      excerpt: "",
      body: { version: 1, type: "doc", content: bodyContent },
      featuredImage: null,
      author: { key: null, name: "Office staff" },
      featured: false,
      pinned: false,
      seo: { title: "District update", description: "", canonicalUrl: null, socialImage: null, noIndex: false }
    },
    taxonomyKeys: { categories: [], tags: [] },
    taxonomySnapshot: {},
    displayDate: "2026-08-07T04:00:00.000Z",
    expiresAt: null
  };
  const rpc = vi.fn(async () => ({ data: {}, error: null }));
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { user_metadata: { full_name: "Editor Name" } } } })) },
    rpc,
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => table === "builder_entries"
          ? { data: entry, error: null }
          : { data: { id: entry.active_draft_version_id, snapshot }, error: null }
      };
      return chain;
    }
  };
}

describe("posts route stage validation", () => {
  beforeEach(() => { state.client = postClient([]); });

  it("rejects an empty post body before invoking the publish transaction", async () => {
    const client = state.client as ReturnType<typeof postClient>;
    const response = await POST(
      new Request(`http://localhost:3000/api/builder/posts/${entry.id}/publish`, {
        method: "POST",
        headers: { origin: "http://localhost:3000", "x-idempotency-key": "publish:empty-body" }
      }),
      { params: Promise.resolve({ segments: [entry.id, "publish"] }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_POST", message: "Add post body text before publishing." }
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
