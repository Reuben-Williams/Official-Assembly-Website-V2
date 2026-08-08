import { readNewsletterProviderInventoryConfiguration } from "../../../../../lib/newsletter/config";
import {
  createNewsletterHistoryReconciliationDigest,
  planNewsletterHistoryReconciliation
} from "../../../../../lib/newsletter/history-reconciliation";
import {
  authorizeNewsletterOperation,
  newsletterOperationBody,
  newsletterOperationCommandId,
  newsletterOperationError
} from "../../../../../lib/newsletter/operations-route";
import { createNewsletterProviderOperationsRepository } from "../../../../../lib/newsletter/provider-operations-repository";
import {
  collectNewsletterProviderInventory,
  createProductionNewsletterInventoryReader
} from "../../../../../lib/newsletter/resend/inventory-adapter";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function reconciliationMode(value: unknown) {
  if (value === "dry_run" || value === "apply") return value;
  throw new TypeError("The newsletter reconciliation mode is invalid.");
}

export async function POST(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, true, true);
    const body = await newsletterOperationBody(request, ["commandId", "mode"]);
    const commandId = newsletterOperationCommandId(body.commandId);
    const mode = reconciliationMode(body.mode);
    const configuration = readNewsletterProviderInventoryConfiguration();
    if (configuration.status !== "ready") {
      throw new Error("newsletter provider history unavailable");
    }

    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter provider history database unavailable");

    const [authUser, proofs, receipts, snapshot] = await Promise.all([
      client.auth.admin.getUserById(identity.userId),
      client.from("builder_newsletter_auth_smtp_proofs")
        .select("provider_message_id")
        .eq("site_id", identity.siteId),
      client.from("builder_newsletter_webhook_receipts")
        .select("provider_message_id,event_type,provider_broadcast_id,disposition")
        .eq("site_id", identity.siteId),
      collectNewsletterProviderInventory(createProductionNewsletterInventoryReader({
        managementApiKey: process.env.RESEND_MANAGEMENT_API_KEY!,
        sendApiKey: process.env.RESEND_SEND_API_KEY!,
        segmentId: configuration.segmentId
      }))
    ]);

    const ownerEmail = authUser.data.user?.email?.trim() ?? "";
    if (authUser.error || !ownerEmail || proofs.error || receipts.error) {
      throw new Error("newsletter provider history evidence unavailable");
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
      providerHistoryCount: plan.providerHistoryCount,
      existingAuthProofCount: plan.existingAuthProofCount,
      reconciliationEntryCount: plan.entries.length
    };
    if (mode === "dry_run") {
      return Response.json({ state: "ready", mode, ...safeResult }, {
        headers: { "cache-control": "no-store" }
      });
    }

    const result = await createNewsletterProviderOperationsRepository(
      client,
      identity.siteId
    ).recordHistoryReconciliation({
      commandId,
      operatorId: identity.userId,
      entries: plan.entries,
      safeEvidenceDigest: createNewsletterHistoryReconciliationDigest({
        siteId: identity.siteId,
        operatorId: identity.userId,
        entries: plan.entries
      })
    });

    return Response.json({
      state: result.status === "recorded" ? "reconciled" : "unavailable",
      mode,
      replayed: result.replayed === true,
      ...safeResult
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({
      event: "newsletter_provider_history_reconciliation_failed",
      code: error instanceof Error && "code" in error
        ? String((error as Error & { code?: unknown }).code ?? "reconciliation_unavailable")
        : "reconciliation_unavailable"
    }));
    return newsletterOperationError(error);
  }
}
