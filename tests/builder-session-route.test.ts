import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  requestRpc: vi.fn(),
  signOut: vi.fn(),
  requireBuilderMember: vi.fn(),
  assertRequestOrigin: vi.fn()
}));

vi.mock("@reuben-williams/next/auth", () => ({
  issuePreviewSession: vi.fn(),
  requireBuilderMember: mocks.requireBuilderMember
}));

vi.mock("../lib/builder/authorization", () => ({
  BUILDER_SITE_KEY: "official-assembly-website-v2",
  allowedBuilderOrigins: () => ["https://www.assemblywomanmorales.com"],
  assertRequestOrigin: mocks.assertRequestOrigin,
  lookupBuilderMembership: vi.fn()
}));

vi.mock("../lib/supabase/admin", () => ({
  getBuilderAdminClient: () => ({ rpc: mocks.adminRpc })
}));

vi.mock("../lib/supabase/server", () => ({
  createRequestSupabaseClient: async () => ({
    rpc: mocks.requestRpc,
    auth: { signOut: mocks.signOut }
  })
}));

import { DELETE } from "../app/api/builder/session/route";

describe("builder session route", () => {
  beforeEach(() => {
    mocks.adminRpc.mockReset();
    mocks.requestRpc.mockReset();
    mocks.signOut.mockReset();
    mocks.requireBuilderMember.mockReset();
    mocks.assertRequestOrigin.mockReset();
    mocks.requireBuilderMember.mockResolvedValue({
      userId: "34300000-0000-4000-8000-000000000001",
      siteId: "34000000-0000-4000-8000-000000000001",
      role: "owner",
      previewGeneration: 2
    });
    mocks.requestRpc.mockResolvedValue({ data: 3, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("revokes preview sessions as the signed-in user with the site key", async () => {
    const response = await DELETE(new Request(
      "https://www.assemblywomanmorales.com/api/builder/session",
      { method: "DELETE" }
    ));

    expect(mocks.requestRpc).toHaveBeenCalledWith(
      "builder_revoke_preview_sessions",
      { p_site_key: "official-assembly-website-v2" }
    );
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(response.status).toBe(204);
  });
});
