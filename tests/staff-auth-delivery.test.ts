import { describe, expect, it } from "vitest";
import {
  STAFF_DELIVERY_POLICY, STAFF_HISTORY_MANIFEST, digestRecipient, deliveryDigest,
  matchStaffDelivery, validateDeliveryReceipts, planStaffHistory, validateDeliveryEvidence, validateCurrentStaffMetadata,
  type StaffAuthRequest, type DeliveryReceipt, type StaffDeliveryEvidence
} from "../lib/newsletter/staff-auth-delivery";

const siteId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const recipientDigest = digestRecipient("Staff@example.com");
const request: StaffAuthRequest = {
  id: "33333333-3333-4333-8333-333333333333", siteId, targetUserId: userId,
  recipientDigest, reservedAt: "2026-10-06T12:00:00.000Z", acceptedAt: "2026-10-06T12:00:02.000Z",
  state: "accepted", policyVersion: STAFF_DELIVERY_POLICY
};
const email = { id: "44444444-4444-4444-8444-444444444444", status: "delivered",
  createdAt: "2026-10-06T12:00:01.000Z", from: "Office <no-reply@updates.assemblywomanmorales.com>",
  to: ["staff@example.com"], subject: "Your sign-in link" };
const receipts: DeliveryReceipt[] = ["email.sent", "email.delivered"].map((eventType, i) => ({
  id: `55555555-5555-4555-8555-55555555555${i}`, siteId, providerMessageId: email.id,
  providerScopeId: "resend-team-production", disposition: "matched", providerBroadcastId: null, eventType
}));
const match = (emails = [email], requests = [request], excluded = new Set<string>()) =>
  matchStaffDelivery({ request, requests, emails, excluded });
const evidence = (): StaffDeliveryEvidence => {
  const row: StaffDeliveryEvidence = { siteId, providerScopeId: "resend-team-production",
    policyVersion: STAFF_DELIVERY_POLICY, providerMessageId: email.id, targetUserId: userId,
    recipientDigest, purpose: "staff_sign_in", provenance: "tracked_request", requestId: request.id,
    providerCreatedAt: email.createdAt, sender: "no-reply@updates.assemblywomanmorales.com",
    subject: email.subject, sentReceiptId: receipts[0]!.id, deliveredReceiptId: receipts[1]!.id,
    metadataDigest: "", auditCorrelation: request.id };
  return { ...row, metadataDigest: deliveryDigest(row) };
};

describe("strict staff delivery evidence", () => {
  it("normalizes addresses and selects exactly one accepted delivery", () => {
    expect(digestRecipient(" STAFF@example.com ")).toBe(recipientDigest);
    expect(match()).toEqual(email);
  });
  it.each([
    { subject: "Confirm your email address" }, { to: ["other@example.com"] },
    { to: ["staff@example.com", "other@example.com"] }, { status: "bounced" },
    { from: "no-reply@other.example.com" }, { createdAt: "invalid" },
    { createdAt: "2026-10-06T11:59:54.999Z" }, { createdAt: "2026-10-06T12:00:07.001Z" }
  ])("rejects unrelated or unsafe metadata %j", (override) => expect(match([{ ...email, ...override }])).toBeNull());
  it("includes the clock-skew boundaries and rejects long acceptance windows", () => {
    expect(match([{ ...email, createdAt: "2026-10-06T11:59:55.000Z" }])).not.toBeNull();
    expect(match([{ ...email, createdAt: "2026-10-06T12:00:07.000Z" }])).not.toBeNull();
    expect(matchStaffDelivery({ request: { ...request, acceptedAt: "2026-10-06T12:00:20.001Z" }, requests: [], emails: [email], excluded: new Set() })).toBeNull();
  });
  it("rejects competing messages, already-accounted overlapping requests and exclusions", () => {
    expect(match([email, { ...email, id: "another" }])).toBeNull();
    expect(match([email], [request, { ...request, id: "another" }])).toBeNull();
    expect(match([email], [request], new Set([email.id]))).toBeNull();
  });
  it.each(["reserved", "uncertain"] as const)("blocks attribution with any unresolved %s request for recipient", (state) => {
    expect(match([email], [request, { ...request, id: "another", state, reservedAt: "2020-01-01T00:00:00Z", acceptedAt: null }])).toBeNull();
  });
  it("does not block on a definitively failed or different-recipient request", () => {
    expect(match([email], [request, { ...request, id: "other", state: "failed" }])).toEqual(email);
    expect(match([email], [request, { ...request, id: "other", recipientDigest: "different", state: "uncertain" }])).toEqual(email);
  });
  it("requires all receipts, exact required counts, identity and harmless events", () => {
    expect(validateDeliveryReceipts(receipts, siteId, email.id)).toEqual({ sentReceiptId: receipts[0]!.id, deliveredReceiptId: receipts[1]!.id });
    expect(validateDeliveryReceipts(receipts.slice(0, 1), siteId, email.id)).toBeNull();
    expect(validateDeliveryReceipts([...receipts, receipts[0]!], siteId, email.id)).toBeNull();
    for (const override of [{ disposition: "unmatched" }, { providerScopeId: "other" },
      { siteId: "other" }, { providerBroadcastId: "broadcast" }, { eventType: "email.bounced" },
      { eventType: "email.complained" }, { eventType: "email.failed" }, { eventType: "unknown" }]) {
      expect(validateDeliveryReceipts([...receipts, { ...receipts[0]!, id: "extra", ...override }], siteId, email.id)).toBeNull();
    }
  });
  it("validates immutable digest, request and late receipts each readiness read", () => {
    const row = evidence();
    expect(validateDeliveryEvidence({ evidence: row, receipts, requests: [request], excluded: new Set() })).toBe(true);
    expect(validateDeliveryEvidence({ evidence: { ...row, metadataDigest: "tampered" }, receipts, requests: [request], excluded: new Set() })).toBe(false);
    expect(validateDeliveryEvidence({ evidence: row, receipts: [...receipts, { ...receipts[0]!, eventType: "email.bounced" }], requests: [request], excluded: new Set() })).toBe(false);
    expect(validateDeliveryEvidence({ evidence: row, receipts, requests: [{ ...request, state: "uncertain" }], excluded: new Set() })).toBe(false);
    expect(deliveryDigest({ ...row, providerCreatedAt: "2026-10-06T12:00:01Z" })).toBe(row.metadataDigest);
  });
  it("rechecks current provider status and full metadata without changing historical digest", () => {
    const row = evidence();
    expect(validateCurrentStaffMetadata(row, [email])).toBe(true);
    expect(validateCurrentStaffMetadata(row, [{ ...email, status: "bounced" }])).toBe(false);
    expect(validateCurrentStaffMetadata(row, [{ ...email, to: ["wrong@example.com"] }])).toBe(false);
    expect(validateCurrentStaffMetadata(row, [email, email])).toBe(false);
    expect(validateCurrentStaffMetadata(row, [])).toBe(false);
  });
  it("binds the exact five historical messages to owner, metadata, receipts and digest", () => {
    const emails = STAFF_HISTORY_MANIFEST.map((entry, i) => ({ ...email, id: entry.id, to: [entry.email], subject: entry.subject,
      createdAt: `2026-10-02T12:00:0${i}.000Z` }));
    const allReceipts = emails.flatMap((message, i) => receipts.map((r, j) => ({ ...r, providerMessageId: message.id, id: `00000000-0000-4000-8000-0000000000${i}${j}` })));
    const accounts = new Map(STAFF_HISTORY_MANIFEST.map((entry) => [entry.email, userId]));
    const input = { siteId, ownerId: userId, emails, receipts: allReceipts, accounts };
    const plan = planStaffHistory(input);
    expect(plan.entries).toHaveLength(5);
    expect(plan.entries.every((e) => e.provenance === "owner_approved_history" && e.requestId === null)).toBe(true);
    expect(planStaffHistory(input)).toEqual(plan);
    expect(planStaffHistory({ ...input, ownerId: "different" }).digest).not.toBe(plan.digest);
    expect(() => planStaffHistory({ ...input, emails: emails.slice(1) })).toThrow();
    expect(() => planStaffHistory({ ...input, emails: [...emails, email] })).toThrow();
    expect(() => planStaffHistory({ ...input, receipts: [...allReceipts, { ...allReceipts[0]!, eventType: "email.failed" }] })).toThrow();
  });
});
