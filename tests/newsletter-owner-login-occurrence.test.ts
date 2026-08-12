import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderAdminClient: vi.fn(),
  resolveBuilderSiteId: vi.fn(),
  rpc: vi.fn()
}));

vi.mock("../lib/supabase/admin", () => ({
  getBuilderAdminClient: mocks.getBuilderAdminClient,
  resolveBuilderSiteId: mocks.resolveBuilderSiteId
}));

import { recordNewsletterOwnerLoginOccurrence } from "../lib/newsletter/owner-login-occurrence";

describe("newsletter owner-login occurrence repository", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({
      data: { version: 1, status: "queued", replayed: false },
      error: null
    });
    mocks.getBuilderAdminClient.mockReset();
    mocks.getBuilderAdminClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.resolveBuilderSiteId.mockReset();
    mocks.resolveBuilderSiteId.mockResolvedValue("a3f57b25-df25-4d98-9ff6-a4a3f3a00a68");
  });

  it("records only the server-derived deterministic occurrence request", async () => {
    const first = await recordNewsletterOwnerLoginOccurrence({
      operatorId: "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1",
      authLastSignInAt: "2026-08-11T21:24:29.356981Z"
    });
    const replay = await recordNewsletterOwnerLoginOccurrence({
      operatorId: "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1",
      authLastSignInAt: "2026-08-11T21:24:29.356981Z"
    });

    expect(first.commandId).toBe(replay.commandId);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "builder_record_newsletter_auth_login_occurrence_v1",
      { p_request: {
        version: 1,
        siteId: "a3f57b25-df25-4d98-9ff6-a4a3f3a00a68",
        operatorId: "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1",
        commandId: first.commandId,
        authLastSignInAt: "2026-08-11T21:24:29.356Z"
      } }
    );
  });

  it("fails closed when the RPC returns an unrecognized success payload", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: {}, error: null });

    await expect(recordNewsletterOwnerLoginOccurrence({
      operatorId: "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1",
      authLastSignInAt: "2026-08-11T21:24:29.356981Z"
    })).rejects.toThrow("owner_login_occurrence_unavailable");
  });
});
