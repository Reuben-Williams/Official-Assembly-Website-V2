import { describe, expect, it, vi } from "vitest";

import { createSupabaseNewsletterOwnerLoginData } from "../lib/newsletter/owner-login-repository";

describe("newsletter owner-login data repository", () => {
  it("loads the exact auth user and records evidence through the versioned RPC", async () => {
    const getUserById = vi.fn(async () => ({
      data: { user: { email: "Owner@Example.com" } },
      error: null
    }));
    const rpc = vi.fn(async () => ({
      data: { version: 1, status: "recorded", evidenceId: "evidence-id", replayed: false },
      error: null
    }));
    const data = createSupabaseNewsletterOwnerLoginData({
      auth: { admin: { getUserById } },
      rpc
    } as never, "site-id");

    await expect(data.ownerEmail("operator-id")).resolves.toBe("owner@example.com");
    await expect(data.recordEvidence({
      commandId: "command-id",
      occurrenceId: "occurrence-id",
      operatorId: "operator-id",
      providerMessageId: "message-id",
      providerCreatedAt: "2026-08-11T21:24:21.547Z",
      authLastSignInAt: "2026-08-11T21:24:29.356981Z",
      evidenceDigest: "a".repeat(64)
    })).resolves.toEqual({ status: "recorded" });
    expect(rpc).toHaveBeenCalledWith("builder_record_newsletter_auth_login_evidence_v1", {
      p_request: {
        version: 1,
        policyVersion: "resend-owner-login-v1",
        siteId: "site-id",
        commandId: "command-id",
        occurrenceId: "occurrence-id",
        operatorId: "operator-id",
        providerMessageId: "message-id",
        providerCreatedAt: "2026-08-11T21:24:21.547Z",
        authLastSignInAt: "2026-08-11T21:24:29.356981Z",
        safeEvidenceDigest: "a".repeat(64)
      }
    });
  });

  it("fails closed on malformed auth and RPC results", async () => {
    const data = createSupabaseNewsletterOwnerLoginData({
      auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: {} }, error: null })) } },
      rpc: vi.fn(async () => ({ data: { status: "recorded" }, error: null }))
    } as never, "site-id");

    await expect(data.ownerEmail("operator-id")).rejects.toThrow("owner login evidence unavailable");
    await expect(data.recordEvidence({
      commandId: "command-id",
      occurrenceId: "occurrence-id",
      operatorId: "operator-id",
      providerMessageId: "message-id",
      providerCreatedAt: "2026-08-11T21:24:21.547Z",
      authLastSignInAt: "2026-08-11T21:24:29.356981Z",
      evidenceDigest: "a".repeat(64)
    })).rejects.toThrow("owner login evidence unavailable");
  });
});
