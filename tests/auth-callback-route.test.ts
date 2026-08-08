import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRequestSupabaseClient: vi.fn(),
  verifyOtp: vi.fn()
}));

vi.mock("../lib/supabase/server", () => ({
  createRequestSupabaseClient: mocks.createRequestSupabaseClient
}));

import { GET } from "../app/auth/callback/route";

describe("staff auth callback", () => {
  beforeEach(() => {
    mocks.verifyOtp.mockReset();
    mocks.verifyOtp.mockResolvedValue({ error: null });
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
    expect(response.headers.get("location")).toBe(
      "https://www.assemblywomanmorales.com/admin/login" +
        "?returnTo=%2Fadmin%2Feditor%3Fworkspace%3Dwebsite.forms&complete=1"
    );
  });

  it("does not verify unsupported token types", async () => {
    const response = await GET(new Request(
      "https://www.assemblywomanmorales.com/auth/callback" +
        "?next=%2Fadmin%2Feditor&token_hash=secure-token-hash&type=recovery"
    ));

    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://www.assemblywomanmorales.com/admin/login"
    );
  });
});
