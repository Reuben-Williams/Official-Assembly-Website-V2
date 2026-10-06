import "server-only";
import { createHash } from "node:crypto";
import type { NewsletterOwnerLoginEmail } from "./owner-login-evidence";

export const STAFF_DELIVERY_POLICY = "resend-staff-auth-delivery-v1";
export const STAFF_DELIVERY_SCOPE = "resend-team-production";
export const STAFF_DELIVERY_SENDER = "no-reply@updates.assemblywomanmorales.com";
export const STAFF_HISTORY_MANIFEST = [
  { id: "01a10f46-0578-7ea0-bb40-9b0a67302246", email: "damonyoung@dtvprods.com", subject: "Your sign-in link", purpose: "staff_sign_in" },
  { id: "01a10f42-92f2-7c6a-92d7-af4105f4f749", email: "damonyoung@dtvprods.com", subject: "Your sign-in link", purpose: "staff_sign_in" },
  { id: "01a10466-178c-721d-8b68-48cc14ca8238", email: "damonyoung@dtvprods.com", subject: "Your sign-in link", purpose: "staff_sign_in" },
  { id: "01a0fb38-5f40-755d-ada4-e820dd4fc50b", email: "damonyoung@dtvprods.com", subject: "Confirm your email address", purpose: "account_confirmation" },
  { id: "01a0fb38-b3bc-7d96-9065-8fe8ef2a7b9e", email: "anotherstory713@gmail.com", subject: "Your sign-in link", purpose: "staff_sign_in" }
] as const;
const goodStatus = new Set(["sent", "delivered", "opened", "clicked"]);
const goodEvent = new Set(["email.sent", "email.delivered", "email.opened", "email.clicked"]);
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const digestRecipient = (value: string) => hash(value.trim().toLowerCase());
export function senderMailbox(value: string) {
  const normalized = value.trim().toLowerCase();
  return (normalized.match(/<([^<>]+)>$/)?.[1] ?? normalized).trim();
}
export type StaffAuthRequest = {
  id: string; siteId: string; targetUserId: string; recipientDigest: string;
  policyVersion: string; reservedAt: string; acceptedAt: string | null;
  state: "reserved" | "accepted" | "failed" | "uncertain";
};
export type DeliveryReceipt = {
  id: string; siteId: string; providerMessageId: string; providerScopeId: string;
  providerBroadcastId: string | null; disposition: string; eventType: string;
};
export type StaffDeliveryEvidence = {
  siteId: string; providerScopeId: string; policyVersion: string; providerMessageId: string;
  targetUserId: string; recipientDigest: string; purpose: "staff_sign_in" | "account_confirmation";
  provenance: "tracked_request" | "owner_approved_history"; requestId: string | null;
  providerCreatedAt: string; sender: string; subject: string;
  sentReceiptId: string; deliveredReceiptId: string; metadataDigest: string; auditCorrelation: string;
};
export function deliveryCanonical(row: StaffDeliveryEvidence) {
  return [1, row.policyVersion, row.siteId, row.providerScopeId, row.providerMessageId,
    senderMailbox(row.sender), row.recipientDigest, row.subject, new Date(row.providerCreatedAt).toISOString(),
    row.targetUserId, row.purpose, row.provenance, row.requestId, row.sentReceiptId, row.deliveredReceiptId];
}
export const deliveryDigest = (row: StaffDeliveryEvidence) => hash(JSON.stringify(deliveryCanonical(row)));
export function validateCurrentStaffMetadata(row: StaffDeliveryEvidence, emails: readonly NewsletterOwnerLoginEmail[]) {
  const candidates = emails.filter((e) => e.id === row.providerMessageId);
  if (candidates.length !== 1) return false;
  const email = candidates[0]!;
  try {
    return goodStatus.has(email.status) && email.to.length === 1 && digestRecipient(email.to[0]!) === row.recipientDigest &&
      senderMailbox(email.from) === row.sender && email.subject === row.subject &&
      new Date(email.createdAt).toISOString() === new Date(row.providerCreatedAt).toISOString();
  } catch { return false; }
}

function matches(request: StaffAuthRequest, email: NewsletterOwnerLoginEmail) {
  const reserved = Date.parse(request.reservedAt);
  const accepted = Date.parse(request.acceptedAt ?? "");
  const created = Date.parse(email.createdAt);
  return request.state === "accepted" && request.policyVersion === STAFF_DELIVERY_POLICY &&
    Number.isFinite(reserved) && Number.isFinite(accepted) && accepted >= reserved && accepted - reserved <= 20_000 &&
    Number.isFinite(created) && created >= reserved - 5_000 && created <= accepted + 5_000 &&
    email.to.length === 1 && digestRecipient(email.to[0]!) === request.recipientDigest &&
    senderMailbox(email.from) === STAFF_DELIVERY_SENDER && email.subject === "Your sign-in link" &&
    goodStatus.has(email.status) && Boolean(email.id);
}
export function matchStaffDelivery(input: {
  request: StaffAuthRequest; requests: readonly StaffAuthRequest[];
  emails: readonly NewsletterOwnerLoginEmail[]; excluded: ReadonlySet<string>;
}): NewsletterOwnerLoginEmail | null {
  const relevant = input.requests.filter((r) => r.siteId === input.request.siteId && r.recipientDigest === input.request.recipientDigest);
  if (relevant.some((r) => r.state === "reserved" || r.state === "uncertain")) return null;
  const candidates = input.emails.filter((e) => !input.excluded.has(e.id) && matches(input.request, e));
  if (candidates.length !== 1) return null;
  const competing = relevant.filter((r) => matches(r, candidates[0]!));
  return competing.length === 1 && competing[0]!.id === input.request.id ? candidates[0]! : null;
}
export function validateDeliveryReceipts(receipts: readonly DeliveryReceipt[], siteId: string, messageId: string) {
  if (!receipts.length || receipts.some((r) => r.siteId !== siteId || r.providerMessageId !== messageId ||
    r.providerScopeId !== STAFF_DELIVERY_SCOPE || r.disposition !== "matched" || r.providerBroadcastId !== null ||
    !goodEvent.has(r.eventType) || !r.id)) return null;
  const sent = receipts.filter((r) => r.eventType === "email.sent");
  const delivered = receipts.filter((r) => r.eventType === "email.delivered");
  return sent.length === 1 && delivered.length === 1 && sent[0]!.id !== delivered[0]!.id
    ? { sentReceiptId: sent[0]!.id, deliveredReceiptId: delivered[0]!.id } : null;
}
export function validateDeliveryEvidence(input: {
  evidence: StaffDeliveryEvidence; receipts: readonly DeliveryReceipt[];
  requests: readonly StaffAuthRequest[]; excluded: ReadonlySet<string>;
}) {
  const row = input.evidence;
  try {
    if (row.policyVersion !== STAFF_DELIVERY_POLICY || row.providerScopeId !== STAFF_DELIVERY_SCOPE ||
      senderMailbox(row.sender) !== STAFF_DELIVERY_SENDER || !/^[a-f0-9]{64}$/.test(row.recipientDigest) ||
      input.excluded.has(row.providerMessageId) || deliveryDigest(row) !== row.metadataDigest) return false;
    const receipt = validateDeliveryReceipts(input.receipts, row.siteId, row.providerMessageId);
    if (!receipt || receipt.sentReceiptId !== row.sentReceiptId || receipt.deliveredReceiptId !== row.deliveredReceiptId) return false;
    if (row.provenance === "owner_approved_history") {
      const entry = STAFF_HISTORY_MANIFEST.find((m) => m.id === row.providerMessageId);
      return row.requestId === null && Boolean(entry && row.purpose === entry.purpose && row.subject === entry.subject &&
        row.recipientDigest === digestRecipient(entry.email));
    }
    const request = input.requests.find((r) => r.id === row.requestId && r.siteId === row.siteId);
    if (row.provenance !== "tracked_request" || row.purpose !== "staff_sign_in" || row.subject !== "Your sign-in link" ||
      !request || request.targetUserId !== row.targetUserId || request.recipientDigest !== row.recipientDigest) return false;
    // Readiness reconstructs only immutable metadata; current receipts independently prove delivery.
    const reserved = Date.parse(request.reservedAt), accepted = Date.parse(request.acceptedAt ?? ""), created = Date.parse(row.providerCreatedAt);
    if (request.state !== "accepted" || request.policyVersion !== STAFF_DELIVERY_POLICY || !Number.isFinite(accepted) ||
      accepted < reserved || accepted - reserved > 20_000 || created < reserved - 5_000 || created > accepted + 5_000) return false;
    const relevant = input.requests.filter((r) => r.siteId === row.siteId && r.recipientDigest === row.recipientDigest);
    return !relevant.some((r) => r.state === "reserved" || r.state === "uncertain") &&
      relevant.filter((r) => r.state === "accepted" && r.policyVersion === STAFF_DELIVERY_POLICY &&
        Date.parse(r.acceptedAt ?? "") >= Date.parse(r.reservedAt) &&
        Date.parse(r.acceptedAt ?? "") - Date.parse(r.reservedAt) <= 20_000 &&
        created >= Date.parse(r.reservedAt) - 5_000 && created <= Date.parse(r.acceptedAt ?? "") + 5_000).length === 1;
  } catch { return false; }
}
export function staffHistoryDigest(siteId: string, ownerId: string, entries: readonly StaffDeliveryEvidence[]) {
  return hash(JSON.stringify([1, STAFF_DELIVERY_POLICY, siteId, ownerId,
    STAFF_HISTORY_MANIFEST.map((m) => [m.id, digestRecipient(m.email), m.subject, m.purpose]),
    [...entries].sort((a, b) => a.providerMessageId.localeCompare(b.providerMessageId)).map(deliveryCanonical)]));
}
export function planStaffHistory(input: {
  siteId: string; ownerId: string; emails: readonly NewsletterOwnerLoginEmail[];
  receipts: readonly DeliveryReceipt[]; accounts: ReadonlyMap<string, string>;
}) {
  if (input.emails.length !== 5 || new Set(input.emails.map((e) => e.id)).size !== 5) throw new Error("history_boundary_mismatch");
  const entries = STAFF_HISTORY_MANIFEST.map((m): StaffDeliveryEvidence => {
    const email = input.emails.find((e) => e.id === m.id);
    const receipt = validateDeliveryReceipts(input.receipts.filter((r) => r.providerMessageId === m.id), input.siteId, m.id);
    const targetUserId = input.accounts.get(m.email);
    if (!email || !receipt || !targetUserId || email.to.length !== 1 || digestRecipient(email.to[0]!) !== digestRecipient(m.email) ||
      email.subject !== m.subject || senderMailbox(email.from) !== STAFF_DELIVERY_SENDER || !goodStatus.has(email.status) ||
      !Number.isFinite(Date.parse(email.createdAt))) throw new Error("history_evidence_mismatch");
    const row: StaffDeliveryEvidence = { siteId: input.siteId, providerScopeId: STAFF_DELIVERY_SCOPE,
      policyVersion: STAFF_DELIVERY_POLICY, providerMessageId: m.id, targetUserId, recipientDigest: digestRecipient(m.email),
      purpose: m.purpose, provenance: "owner_approved_history", requestId: null, providerCreatedAt: new Date(email.createdAt).toISOString(),
      sender: STAFF_DELIVERY_SENDER, subject: m.subject, ...receipt, metadataDigest: "", auditCorrelation: m.id };
    return { ...row, metadataDigest: deliveryDigest(row) };
  });
  return { entries, digest: staffHistoryDigest(input.siteId, input.ownerId, entries) };
}
