import "server-only";

import type { ConfirmationRpcClient } from "./confirmation-repository";

export function createNewsletterWebhookRepository(client: ConfirmationRpcClient) {
  return {
    async reconcile(input: {
      readonly siteId: string;
      readonly providerScopeId: string;
      readonly svixId: string;
      readonly eventType: string;
      readonly providerCreatedAt: string;
      readonly providerMessageId?: string;
      readonly providerBroadcastId?: string;
      readonly disposition: "ignored" | "matched" | "incident";
      readonly incidentReason?: "unvalidated" | "mismatch" | "expired" | "provider_anomaly";
      readonly providerStatus?: string;
      readonly sentAt?: string;
      readonly digest: string;
    }) {
      const result = await client.rpc("builder_reconcile_newsletter_webhook_v1", {
        p_request: {
          version: 1,
          siteId: input.siteId,
          providerScopeId: input.providerScopeId,
          svixId: input.svixId,
          eventType: input.eventType,
          providerCreatedAt: input.providerCreatedAt,
          providerMessageId: input.providerMessageId,
          providerBroadcastId: input.providerBroadcastId,
          disposition: input.disposition,
          incidentReason: input.incidentReason,
          providerStatus: input.providerStatus,
          sentAt: input.sentAt,
          digest: input.digest
        }
      });
      if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
        throw new Error("webhook reconciliation unavailable");
      }
      const value = result.data as Record<string, unknown>;
      if (!["ignored", "matched", "incident"].includes(String(value.disposition))) {
        throw new Error("webhook reconciliation unavailable");
      }
      return {
        disposition: value.disposition as "ignored" | "matched" | "incident",
        replayed: value.replayed === true
      };
    }
  };
}
