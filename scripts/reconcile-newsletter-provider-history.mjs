import { readNewsletterProviderInventoryConfiguration } from "../lib/newsletter/config.ts";
import {
  createNewsletterHistoryReconciliationDigest,
  planNewsletterHistoryReconciliation
} from "../lib/newsletter/history-reconciliation.ts";
import { createNewsletterProviderOperationsRepository } from "../lib/newsletter/provider-operations-repository.ts";
import {
  collectNewsletterProviderInventory,
  createProductionNewsletterInventoryReader
} from "../lib/newsletter/resend/inventory-adapter.ts";
import { getBuilderAdminClient } from "../lib/supabase/admin.ts";

const SITE_ID = "a3f57b25-df25-4d98-9ff6-a4a3f3a00a68";
const OPERATOR_ID = "98e9e1e7-1a8a-4f1f-b71c-31e682567dd1";
const COMMAND_ID = "59aa0e41-72ca-4fb7-9c24-d37a9c01db20";
const APPLY_APPROVAL = "history-reconciliation-v2-2026-08-07";

const apply = process.argv.includes("--apply");
const approval = process.argv.find((value) => value.startsWith("--approval="))?.slice(11) ?? "";
if (apply && approval !== APPLY_APPROVAL) {
  throw new Error("The exact production reconciliation approval is required.");
}

const configuration = readNewsletterProviderInventoryConfiguration();
if (configuration.status !== "ready") {
  throw new Error(`Newsletter provider configuration is unavailable: ${configuration.code}.`);
}
const client = getBuilderAdminClient();
if (!client) throw new Error("Newsletter provider history database is unavailable.");

const [authUser, proofs, receipts, snapshot] = await Promise.all([
  client.auth.admin.getUserById(OPERATOR_ID),
  client.from("builder_newsletter_auth_smtp_proofs")
    .select("provider_message_id")
    .eq("site_id", SITE_ID),
  client.from("builder_newsletter_webhook_receipts")
    .select("provider_message_id,event_type,provider_broadcast_id,disposition")
    .eq("site_id", SITE_ID),
  collectNewsletterProviderInventory(createProductionNewsletterInventoryReader({
    managementApiKey: process.env.RESEND_MANAGEMENT_API_KEY,
    sendApiKey: process.env.RESEND_SEND_API_KEY,
    segmentId: configuration.segmentId
  }))
]);

const ownerEmail = authUser.data.user?.email?.trim() ?? "";
if (authUser.error || !ownerEmail || proofs.error || receipts.error) {
  throw new Error("Newsletter provider history evidence is unavailable.");
}

const plan = planNewsletterHistoryReconciliation({
  ownerEmail,
  emails: snapshot.emails,
  receipts: (receipts.data ?? []).map((receipt) => ({
    providerMessageId: String(receipt.provider_message_id ?? ""),
    eventType: String(receipt.event_type ?? ""),
    providerBroadcastId: String(receipt.provider_broadcast_id ?? ""),
    disposition: String(receipt.disposition ?? "")
  })),
  existingAuthProofIds: new Set(
    (proofs.data ?? []).map((proof) => String(proof.provider_message_id ?? "")).filter(Boolean)
  )
});

const safeResult = {
  state: apply ? "reconciled" : "ready",
  mode: apply ? "apply" : "dry_run",
  providerHistoryCount: plan.providerHistoryCount,
  existingAuthProofCount: plan.existingAuthProofCount,
  reconciliationEntryCount: plan.entries.length,
  classifications: {
    authSmtpMagicLink: plan.entries.filter((entry) =>
      entry.classification === "auth_smtp_magic_link").length,
    unattributedFailedSetupTest: plan.entries.filter((entry) =>
      entry.classification === "unattributed_failed_setup_test").length
  },
  emailSent: false
};

if (apply) {
  const result = await createNewsletterProviderOperationsRepository(
    client,
    SITE_ID
  ).recordHistoryReconciliation({
    commandId: COMMAND_ID,
    operatorId: OPERATOR_ID,
    entries: plan.entries,
    safeEvidenceDigest: createNewsletterHistoryReconciliationDigest({
      siteId: SITE_ID,
      operatorId: OPERATOR_ID,
      entries: plan.entries
    })
  });
  if (result.status !== "recorded") throw new Error("History reconciliation was not recorded.");
  safeResult.replayed = result.replayed === true;
}

console.log(JSON.stringify(safeResult, null, 2));
