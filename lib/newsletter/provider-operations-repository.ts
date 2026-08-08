import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { NEWSLETTER_INVENTORY_POLICY_VERSION } from "./provider-inventory";
import {
  NEWSLETTER_HISTORY_RECONCILIATION_POLICY_VERSION,
  createNewsletterHistoryReconciliationDigest,
  type NewsletterHistoryReconciliationEntry
} from "./history-reconciliation";

export { createNewsletterHistoryReconciliationDigest };

export const NEWSLETTER_PROVIDER_ATTESTATION_CATEGORIES = [
  "billing_ownership",
  "oauth_application_view",
  "team_membership"
] as const;

export type NewsletterAuthSmtpProofKind =
  | "replacement_login"
  | "post_revocation_login";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("newsletter provider operation unavailable");
  }
  return value as Record<string, unknown>;
}

export function createNewsletterProviderAttestationDigest(input: {
  readonly siteId: string;
  readonly operatorId: string;
  readonly observedAt: Date;
}) {
  return createHash("sha256").update(JSON.stringify({
    policyVersion: NEWSLETTER_INVENTORY_POLICY_VERSION,
    siteId: input.siteId,
    operatorId: input.operatorId,
    observedUtcDay: input.observedAt.toISOString().slice(0, 10),
    categories: NEWSLETTER_PROVIDER_ATTESTATION_CATEGORIES
  }), "utf8").digest("hex");
}

export function createNewsletterAuthSmtpProofDigest(input: {
  readonly siteId: string;
  readonly operatorId: string;
  readonly proofKind: NewsletterAuthSmtpProofKind;
  readonly providerMessageId: string;
  readonly providerCreatedAt: string;
  readonly authLastSignInAt: string;
}) {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    siteId: input.siteId,
    operatorId: input.operatorId,
    proofKind: input.proofKind,
    providerMessageId: input.providerMessageId,
    providerCreatedAt: input.providerCreatedAt,
    authLastSignInAt: input.authLastSignInAt
  }), "utf8").digest("hex");
}

export function createNewsletterProviderOperationsRepository(
  client: SupabaseClient,
  siteId: string
) {
  async function rpc(name: string, request: Record<string, unknown>) {
    const result = await client.rpc(name, { p_request: request });
    if (result.error) throw new Error("newsletter provider operation unavailable");
    return record(result.data);
  }

  return {
    async status() {
      const now = new Date().toISOString();
      const [activation, attestation, circuit, authSmtpProofs] = await Promise.all([
        client.from("builder_newsletter_provider_activation_revisions")
          .select("recorded_at")
          .eq("site_id", siteId)
          .eq("provider_scope_id", "resend-team-production")
          .eq("state", "active")
          .maybeSingle(),
        client.from("builder_newsletter_provider_inventory_attestations")
          .select("expires_at")
          .eq("site_id", siteId)
          .eq("policy_version", NEWSLETTER_INVENTORY_POLICY_VERSION)
          .gt("expires_at", now)
          .order("attested_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        client.from("builder_newsletter_reconciliation_circuits")
          .select("state,safe_failure_code")
          .eq("site_id", siteId)
          .eq("provider_scope_id", "resend-team-production")
          .maybeSingle(),
        client.from("builder_newsletter_auth_smtp_proofs")
          .select("proof_kind")
          .eq("site_id", siteId)
      ]);
      if (activation.error || attestation.error || circuit.error || authSmtpProofs.error) {
        throw new Error("newsletter provider operation unavailable");
      }
      const proofKinds = new Set(
        (authSmtpProofs.data ?? []).map((row) => String(row.proof_kind ?? ""))
      );
      return {
        providerActivation: {
          active: Boolean(activation.data),
          recordedAt: activation.data?.recorded_at ? String(activation.data.recorded_at) : ""
        },
        providerAttestation: {
          current: Boolean(attestation.data),
          expiresAt: attestation.data?.expires_at ? String(attestation.data.expires_at) : ""
        },
        authSmtpProofs: {
          replacementLogin: proofKinds.has("replacement_login"),
          postRevocationLogin: proofKinds.has("post_revocation_login")
        },
        reconciliationCircuit: {
          state: circuit.data?.state === "open" ? "open" as const : "closed" as const,
          code: circuit.data?.safe_failure_code ? String(circuit.data.safe_failure_code) : ""
        }
      };
    },

    recordAttestation(input: {
      readonly commandId: string;
      readonly operatorId: string;
      readonly safeEvidenceDigest: string;
    }) {
      return rpc("builder_record_newsletter_inventory_attestation_v1", {
        version: 1,
        commandId: input.commandId,
        siteId,
        operatorId: input.operatorId,
        policyVersion: NEWSLETTER_INVENTORY_POLICY_VERSION,
        categories: NEWSLETTER_PROVIDER_ATTESTATION_CATEGORIES,
        safeEvidenceDigest: input.safeEvidenceDigest
      });
    },

    activate(input: {
      readonly commandId: string;
      readonly operatorId: string;
      readonly resourceIdentityDigest: string;
    }) {
      return rpc("builder_record_newsletter_provider_activation_v1", {
        version: 1,
        commandId: input.commandId,
        siteId,
        operatorId: input.operatorId,
        resourceIdentityDigest: input.resourceIdentityDigest,
        providerContactCount: 0,
        localEligibleCount: 0,
        historicalSendCount: 0
      });
    },

    recordAuthSmtpProof(input: {
      readonly commandId: string;
      readonly operatorId: string;
      readonly proofKind: NewsletterAuthSmtpProofKind;
      readonly providerMessageId: string;
      readonly providerCreatedAt: string;
      readonly authLastSignInAt: string;
      readonly safeEvidenceDigest: string;
    }) {
      return rpc("builder_record_newsletter_auth_smtp_proof_v1", {
        version: 1,
        commandId: input.commandId,
        siteId,
        operatorId: input.operatorId,
        proofKind: input.proofKind,
        providerMessageId: input.providerMessageId,
        providerCreatedAt: input.providerCreatedAt,
        authLastSignInAt: input.authLastSignInAt,
        safeEvidenceDigest: input.safeEvidenceDigest
      });
    },

    recordHistoryReconciliation(input: {
      readonly commandId: string;
      readonly operatorId: string;
      readonly safeEvidenceDigest: string;
      readonly entries: readonly NewsletterHistoryReconciliationEntry[];
    }) {
      return rpc("builder_record_newsletter_history_reconciliation_v1", {
        version: 1,
        commandId: input.commandId,
        siteId,
        operatorId: input.operatorId,
        policyVersion: NEWSLETTER_HISTORY_RECONCILIATION_POLICY_VERSION,
        safeEvidenceDigest: input.safeEvidenceDigest,
        entries: input.entries
      });
    },

    recover(input: {
      readonly commandId: string;
      readonly operatorId: string;
      readonly reason: string;
    }) {
      return rpc("builder_recover_newsletter_reconciliation_v1", {
        version: 1,
        commandId: input.commandId,
        siteId,
        operatorId: input.operatorId,
        reason: input.reason
      });
    }
  };
}
