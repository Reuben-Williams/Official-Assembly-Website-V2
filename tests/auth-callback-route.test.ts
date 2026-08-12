import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRequestSupabaseClient: vi.fn(),
  verifyOtp: vi.fn(),
  recordOwnerLoginOccurrence: vi.fn(),
  lookupBuilderMembership: vi.fn(),
  issueEditorLoginCompletion: vi.fn()
}));

vi.mock("../lib/supabase/server", () => ({
  createRequestSupabaseClient: mocks.createRequestSupabaseClient
}));

vi.mock("../lib/newsletter/owner-login-occurrence", () => ({
  recordNewsletterOwnerLoginOccurrence: mocks.recordOwnerLoginOccurrence
}));

vi.mock("../lib/builder/authorization", () => ({
  BUILDER_SITE_KEY: "official-assembly-website-v2",
  isSafeReturnPath: (value: string) => value.startsWith("/") && !value.startsWith("//"),
  lookupBuilderMembership: mocks.lookupBuilderMembership
}));

vi.mock("../lib/builder/login-completion", () => ({
  editorLoginCompletionCookie: "builder_login_completion",
  editorLoginCompletionTtlSeconds: 300,
  issueEditorLoginCompletion: mocks.issueEditorLoginCompletion
}));

vi.mock("../lib/supabase/admin", () => ({
  getBuilderAdminClient: () => ({ rpc: vi.fn() })
}));

import { GET } from "../app/auth/callback/route";

describe("staff auth callback", () => {
  beforeEach(() => {
    mocks.verifyOtp.mockReset();
    mocks.verifyOtp.mockResolvedValue({
      data: {
        user: {
          id: "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1",
          last_sign_in_at: "2026-08-11T21:24:29.356981Z"
        }
      },
      error: null
    });
    mocks.recordOwnerLoginOccurrence.mockReset();
    mocks.recordOwnerLoginOccurrence.mockResolvedValue({ state: "queued" });
    mocks.lookupBuilderMembership.mockReset();
    mocks.lookupBuilderMembership.mockResolvedValue({
      siteId: "34000000-0000-4000-8000-000000000001",
      userId: "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1",
      role: "owner",
      previewGeneration: 3
    });
    mocks.issueEditorLoginCompletion.mockReset();
    mocks.issueEditorLoginCompletion.mockResolvedValue("fresh-login-proof");
    mocks.createRequestSupabaseClient.mockReset();
    mocks.createRequestSupabaseClient.mockResolvedValue({
      auth: { verifyOtp: mocks.verifyOtp }
    });
  });

  it("verifies a magic-link token hash and completes the requested staff sign-in", async () => {
    const response = await GET(new Request(
      "https://www.assemblywomanmorales.com/auth/callback" +
        "?next=%2Fadmin%2Feditor%3Fworkspace%3Dwebsite.forms" +
        "&token_hash=secure-token-hash&type=email"
    ));

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "secure-token-hash",
      type: "email"
    });
    expect(mocks.recordOwnerLoginOccurrence).toHaveBeenCalledWith({
      operatorId: "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1",
      authLastSignInAt: "2026-08-11T21:24:29.356981Z"
    });
    expect(response.headers.get("location")).toBe(
      "https://www.assemblywomanmorales.com/admin/login" +
        "?returnTo=%2Fadmin%2Feditor%3Fworkspace%3Dwebsite.forms&complete=1"
    );
    expect(response.headers.get("set-cookie")).toContain("builder_login_completion=fresh-login-proof");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=strict");
  });

  it("does not verify unsupported token types", async () => {
    const response = await GET(new Request(
      "https://www.assemblywomanmorales.com/auth/callback" +
        "?next=%2Fadmin%2Feditor&token_hash=secure-token-hash&type=recovery"
    ));

    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.recordOwnerLoginOccurrence).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://www.assemblywomanmorales.com/admin/login"
    );
  });

  it("keeps the successful redirect when durable occurrence recording is unavailable", async () => {
    mocks.recordOwnerLoginOccurrence.mockRejectedValueOnce(new Error("database detail"));

    const response = await GET(new Request(
      "https://www.assemblywomanmorales.com/auth/callback" +
        "?next=%2Fadmin%2Feditor&token_hash=secure-token-hash&type=email"
    ));

    expect(response.headers.get("location")).toBe(
      "https://www.assemblywomanmorales.com/admin/login" +
        "?returnTo=%2Fadmin%2Feditor&complete=1"
    );
  });
});
