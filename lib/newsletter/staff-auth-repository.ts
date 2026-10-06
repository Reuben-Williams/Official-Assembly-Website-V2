import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffAccountingRepository } from "./staff-auth-worker";
import type { StaffAuthRequest, DeliveryReceipt, StaffDeliveryEvidence } from "./staff-auth-delivery";

const text = (v: unknown) => typeof v === "string" ? v : "";
export function staffRequestRow(r: Record<string, unknown>): StaffAuthRequest {
  return { id: text(r.id), siteId: text(r.site_id), targetUserId: text(r.target_user_id), recipientDigest: text(r.recipient_digest),
    policyVersion: text(r.policy_version), state: text(r.state) as StaffAuthRequest["state"], reservedAt: text(r.reserved_at),
    acceptedAt: r.accepted_at === null ? null : text(r.accepted_at) };
}
export function staffReceiptRow(r: Record<string, unknown>): DeliveryReceipt {
  return { id: text(r.id), siteId: text(r.site_id), providerMessageId: text(r.provider_message_id), providerScopeId: text(r.provider_scope_id),
    providerBroadcastId: r.provider_broadcast_id === null ? null : text(r.provider_broadcast_id), disposition: text(r.disposition), eventType: text(r.event_type) };
}
export function staffEvidenceRow(r: Record<string, unknown>): StaffDeliveryEvidence {
  return { siteId: text(r.site_id), providerScopeId: text(r.provider_scope_id), policyVersion: text(r.policy_version),
    providerMessageId: text(r.provider_message_id), targetUserId: text(r.target_user_id), recipientDigest: text(r.recipient_digest),
    purpose: text(r.purpose) as StaffDeliveryEvidence["purpose"], provenance: text(r.provenance) as StaffDeliveryEvidence["provenance"],
    requestId: r.request_id === null ? null : text(r.request_id), providerCreatedAt: text(r.provider_created_at), sender: text(r.sender), subject: text(r.subject),
    sentReceiptId: text(r.sent_receipt_id), deliveredReceiptId: text(r.delivered_receipt_id), metadataDigest: text(r.metadata_digest), auditCorrelation: text(r.audit_correlation) };
}
export function createStaffAccountingRepository(client: SupabaseClient, siteId: string): StaffAccountingRepository {
  const deadline = Date.now() + 15000;
  const signal = () => AbortSignal.timeout(Math.max(1, Math.min(2000, deadline - Date.now())));
  async function rows(table: string, column?: string, value?: string) {
    const result: Record<string, unknown>[] = [];
    for (let from = 0; from < 100_000; from += 1000) {
      if (Date.now() >= deadline) throw new Error("budget_exhausted");
      let query = client.from(table).select("*").eq("site_id", siteId);
      if (column && value) query = query.eq(column, value);
      const page = await query.order("id", { ascending: true }).range(from, from + 999).abortSignal(signal());
      if (page.error || !Array.isArray(page.data)) throw new Error("database_unavailable");
      result.push(...page.data);
      if (page.data.length < 1000) return result;
    }
    throw new Error("database_unavailable");
  }
  return {
    async claim(workerId) {
      const result = await client.rpc("builder_staff_auth_claim", { p_site_id: siteId, p_worker_id: workerId, p_limit: 2 }).abortSignal(signal());
      if (result.error || !Array.isArray(result.data)) throw new Error("database_unavailable");
      return result.data.map((r: { request_id: string; fencing_token: number }) => ({ requestId: r.request_id, fencingToken: r.fencing_token }));
    },
    async context(requestId) {
      const current = await rows("builder_staff_auth_requests", "id", requestId);
      if (current.length !== 1) throw new Error("database_unavailable");
      const request = staffRequestRow(current[0]!);
      const exclusionTables = ["builder_newsletter_jobs", "builder_newsletter_staff_test_observations", "builder_newsletter_auth_smtp_proofs", "builder_newsletter_provider_history_reconciliations"];
      const [requestRows, receiptRows, historyRows, ...exclusionRows] = await Promise.all([
        rows("builder_staff_auth_requests", "recipient_digest", request.recipientDigest), rows("builder_newsletter_webhook_receipts"),
        rows("builder_staff_auth_delivery_evidence", "provenance", "owner_approved_history"), ...exclusionTables.map((table) => rows(table))
      ]);
      const requests = requestRows.map(staffRequestRow);
      const receipts = receiptRows.map(staffReceiptRow);
      const excluded = new Set<string>();
      // Owner-login evidence is intentionally NOT an exclusion: redemption and delivery are distinct claims.
      for (const row of exclusionRows.flat()) if (text(row.provider_message_id)) excluded.add(text(row.provider_message_id));
      for (const row of historyRows) excluded.add(text(row.provider_message_id));
      for (const row of receipts) if (row.providerBroadcastId !== null) excluded.add(row.providerMessageId);
      return { request, requests, receipts, excluded };
    },
    async record(claim, evidence) {
      const result = await client.rpc("builder_staff_auth_record", { p_request_id: claim.requestId, p_worker_id: claim.workerId,
        p_fencing_token: claim.fencingToken, p_row: evidence }).abortSignal(signal());
      if (result.error || !["recorded", "already_recorded"].includes(result.data)) throw new Error("database_unavailable");
    },
    async fail(claim, code) {
      const result = await client.rpc("builder_staff_auth_fail", { p_request_id: claim.requestId, p_worker_id: claim.workerId,
        p_fencing_token: claim.fencingToken, p_code: code }).abortSignal(signal());
      if (result.error) throw new Error("database_unavailable");
    }
  };
}
