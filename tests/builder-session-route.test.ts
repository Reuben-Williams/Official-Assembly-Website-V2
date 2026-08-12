import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  requestRpc: vi.fn(),
  signOut: vi.fn(),
  issuePreviewSession: vi.fn(),
  consumeEditorLoginCompletion: vi.fn(),
  requireBuilderMember: vi.fn(),
  assertRequestOrigin: vi.fn()
}));

vi.mock("@reuben-williams/next/auth", () => ({
  issuePreviewSession: mocks.issuePreviewSession,
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

vi.mock("../lib/builder/login-completion", () => ({
  consumeEditorLoginCompletion: mocks.consumeEditorLoginCompletion,
  editorLoginCompletionCookie: "builder_login_completion"
}));

import { DELETE, POST } from "../app/api/builder/session/route";

describe("builder session route", () => {
  beforeEach(() => {
    process.env.BUILDER_PREVIEW_SECRET = "x".repeat(32);
    mocks.adminRpc.mockReset();
    mocks.requestRpc.mockReset();
    mocks.signOut.mockReset();
    mocks.issuePreviewSession.mockReset();
    mocks.consumeEditorLoginCompletion.mockReset();
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
    mocks.issuePreviewSession.mockResolvedValue("signed-editor-token");
    mocks.consumeEditorLoginCompletion.mockResolvedValue(false);
  });

  it("issues editor and CSRF cookies after consuming a fresh login proof", async () => {
    mocks.consumeEditorLoginCompletion.mockResolvedValueOnce(true);
    const response = await POST(new Request(
      "https://www.assemblywomanmorales.com/api/builder/session",
      {
        method: "POST",
        headers: {
          origin: "https://www.assemblywomanmorales.com",
          cookie: "builder_login_completion=fresh-proof"
        }
      }
    ));

    expect(mocks.consumeEditorLoginCompletion).toHaveBeenCalledWith(expect.objectContaining({
      token: "fresh-proof",
      userId: "34300000-0000-4000-8000-000000000001",
      sessionGeneration: 2
    }));
    expect(mocks.issuePreviewSession).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("builder_editor_session=signed-editor-token");
    expect(response.headers.get("set-cookie")).toContain("builder_csrf=");
  });

  it("does not issue an editor session from an old Supabase session alone", async () => {
    const response = await POST(new Request(
      "https://www.assemblywomanmorales.com/api/builder/session",
      {
        method: "POST",
        headers: {
          origin: "https://www.assemblywomanmorales.com",
          cookie: "sb-session=still-valid"
        }
      }
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LOGIN_COMPLETION_REQUIRED",
        message: "Complete a fresh staff sign-in before opening the editor."
      }
    });
    expect(mocks.issuePreviewSession).not.toHaveBeenCalled();
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
