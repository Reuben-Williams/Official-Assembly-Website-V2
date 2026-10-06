import "server-only";
import type { NewsletterOwnerLoginEmail, NewsletterOwnerLoginEmailReader } from "./owner-login-evidence";
import { STAFF_DELIVERY_POLICY, STAFF_DELIVERY_SCOPE, STAFF_DELIVERY_SENDER, deliveryDigest, matchStaffDelivery,
  validateDeliveryReceipts, type StaffAuthRequest, type DeliveryReceipt, type StaffDeliveryEvidence } from "./staff-auth-delivery";

export type StaffAccountingClaim = { requestId: string; fencingToken: number; workerId: string };
export type StaffAccountingRepository = {
  claim(workerId: string): Promise<readonly { requestId: string; fencingToken: number }[]>;
  context(requestId: string): Promise<{ request: StaffAuthRequest; requests: readonly StaffAuthRequest[];
    receipts: readonly DeliveryReceipt[]; excluded: ReadonlySet<string> }>;
  record(claim: StaffAccountingClaim, evidence: StaffDeliveryEvidence): Promise<void>;
  fail(claim: StaffAccountingClaim, code: string): Promise<void>;
};
export async function collectStaffDeliveryEmails(reader: NewsletterOwnerLoginEmailReader, reservedAt: string,
  options: { maximumDurationMs?: number; now?: () => number } = {}) {
  const maximum = Math.min(options.maximumDurationMs ?? 5000, 5000);
  const now = options.now ?? Date.now; const start = now(); const boundary = Date.parse(reservedAt) - 5000;
  if (!Number.isFinite(boundary) || maximum < 1) throw new Error("metadata_unavailable");
  let after: string | undefined; let lastDate = Infinity;
  const cursors = new Set<string>(), ids = new Set<string>(); const emails: NewsletterOwnerLoginEmail[] = [];
  for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
    const remaining = maximum - (now() - start);
    if (remaining <= 0) throw new Error("metadata_unavailable");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const page = await Promise.race([reader.listEmails({ limit: 100, after }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("metadata_unavailable")), remaining); })
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (now() - start >= maximum || page.items.length > 100) throw new Error("metadata_unavailable");
    let crossed = false;
    for (const email of page.items) {
      const date = Date.parse(email.createdAt);
      if (!Number.isFinite(date) || date > lastDate || !email.id || ids.has(email.id)) throw new Error("metadata_unavailable");
      lastDate = date; ids.add(email.id);
      if (date < boundary) crossed = true; else emails.push(email);
    }
    if (crossed || !page.hasMore) return emails;
    if (!page.after || cursors.has(page.after)) throw new Error("metadata_unavailable");
    cursors.add(page.after); after = page.after;
  }
  throw new Error("metadata_unavailable");
}
export async function runStaffDeliveryAccounting(input: {
  repository: StaffAccountingRepository; provider: NewsletterOwnerLoginEmailReader; workerId: string;
  maximumDurationMs?: number; now?: () => number;
}) {
  const now = input.now ?? Date.now, started = now(); const maximum = Math.min(input.maximumDurationMs ?? 15000, 15000);
  const result = { claimed: 0, completed: 0, failed: 0, blocked: 0 };
  if (maximum < 7000) return result;
  const jobs = await input.repository.claim(input.workerId); result.claimed = jobs.length;
  for (const job of jobs.slice(0, 2)) {
    const claim = { ...job, workerId: input.workerId };
    // Leave a lease to expire rather than assert completion without evidence.
    if (maximum - (now() - started) < 7000) { result.blocked++; continue; }
    let code = "database_unavailable";
    try {
      const context = await input.repository.context(job.requestId);
      if (maximum - (now() - started) < 6000) { result.blocked++; continue; }
      code = "metadata_unavailable";
      const emails = await collectStaffDeliveryEmails(input.provider, context.request.reservedAt);
      code = "ambiguous_delivery";
      const email = matchStaffDelivery({ ...context, emails });
      if (!email) throw new Error(code);
      code = "missing_receipts";
      const receipt = validateDeliveryReceipts(context.receipts.filter((r) => r.providerMessageId === email.id), context.request.siteId, email.id);
      if (!receipt) throw new Error(code);
      const evidence: StaffDeliveryEvidence = { siteId: context.request.siteId, providerScopeId: STAFF_DELIVERY_SCOPE,
        policyVersion: STAFF_DELIVERY_POLICY, providerMessageId: email.id, targetUserId: context.request.targetUserId,
        recipientDigest: context.request.recipientDigest, purpose: "staff_sign_in", provenance: "tracked_request",
        requestId: context.request.id, providerCreatedAt: new Date(email.createdAt).toISOString(), sender: STAFF_DELIVERY_SENDER,
        subject: email.subject, ...receipt, metadataDigest: "", auditCorrelation: context.request.id };
      if (maximum - (now() - started) < 1000) { result.blocked++; continue; }
      code = "database_unavailable";
      await input.repository.record(claim, { ...evidence, metadataDigest: deliveryDigest(evidence) });
      result.completed++;
    } catch {
      result.failed++;
      if (maximum - (now() - started) > 1000) {
        try { await input.repository.fail(claim, code); } catch { /* Lease/fencing protects a replaced worker. */ }
      }
    }
  }
  return result;
}
