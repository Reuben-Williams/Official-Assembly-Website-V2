import { describe, expect, it, vi } from "vitest";
import { collectStaffDeliveryEmails, runStaffDeliveryAccounting } from "../lib/newsletter/staff-auth-worker";
import { digestRecipient, STAFF_DELIVERY_POLICY, type StaffAuthRequest } from "../lib/newsletter/staff-auth-delivery";
const request: StaffAuthRequest = { id: "request", siteId: "site", targetUserId: "user", recipientDigest: digestRecipient("staff@example.com"),
  policyVersion: STAFF_DELIVERY_POLICY, state: "accepted", reservedAt: "2026-10-06T12:00:00Z", acceptedAt: "2026-10-06T12:00:01Z" };
const email = { id: "message", status: "delivered", createdAt: "2026-10-06T12:00:00Z", from: "no-reply@updates.assemblywomanmorales.com", to: ["staff@example.com"], subject: "Your sign-in link" };
const provider = () => ({ listEmails: vi.fn(async () => ({ items: [email], hasMore: false })) });
function data() {
  return { claim: vi.fn(async () => [{ requestId: request.id, fencingToken: 2 }]),
    context: vi.fn(async () => ({ request, requests: [request], excluded: new Set<string>(), receipts: ["email.sent", "email.delivered"].map((eventType) => ({ id: eventType, eventType, siteId: "site", providerMessageId: "message", providerScopeId: "resend-team-production", disposition: "matched", providerBroadcastId: null })) })),
    record: vi.fn(async () => undefined), fail: vi.fn(async () => undefined) };
}
describe("metadata-only staff accounting", () => {
  it("accounts without any provider mutation and carries active fencing into write", async () => {
    const repository = data(); const result = await runStaffDeliveryAccounting({ repository, provider: provider(), workerId: "worker" });
    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0, blocked: 0 });
    expect(repository.record).toHaveBeenCalledWith(expect.objectContaining({ requestId: "request", fencingToken: 2, workerId: "worker" }), expect.objectContaining({ provenance: "tracked_request" }));
    expect(repository.fail).not.toHaveBeenCalled();
  });
  it("leaves missing or ambiguous evidence unrecognized and never sends again", async () => {
    const repository = data(); repository.context.mockResolvedValueOnce({ ...(await repository.context()), receipts: [] });
    const result = await runStaffDeliveryAccounting({ repository, provider: provider(), workerId: "worker" });
    expect(result.completed).toBe(0); expect(repository.record).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({ fencingToken: 2 }), "missing_receipts");
  });
  it("fails closed on invalid dates, duplicate cursors, page exhaustion and hard read timeout", async () => {
    await expect(collectStaffDeliveryEmails({ listEmails: async () => ({ items: [{ ...email, createdAt: "invalid" }], hasMore: false }) }, request.reservedAt)).rejects.toThrow();
    await expect(collectStaffDeliveryEmails({ listEmails: async () => ({ items: [], hasMore: true, after: "same" }) }, request.reservedAt)).rejects.toThrow();
    await expect(collectStaffDeliveryEmails({ listEmails: async () => new Promise(() => {}) }, request.reservedAt, { maximumDurationMs: 10 })).rejects.toThrow();
    let n = 0;
    await expect(collectStaffDeliveryEmails({ listEmails: async () => ({ items: [], hasMore: true, after: `${++n}` }) }, request.reservedAt)).rejects.toThrow();
    expect(n).toBe(20);
  });
  it("does not claim when there is insufficient total batch budget", async () => {
    const repository = data();
    const result = await runStaffDeliveryAccounting({ repository, provider: provider(), workerId: "worker", maximumDurationMs: 1 });
    expect(result.claimed).toBe(0); expect(repository.claim).not.toHaveBeenCalled();
  });
});
