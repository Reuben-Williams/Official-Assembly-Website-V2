import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NewsletterOwnerLoginReconciliationData } from "./owner-login-handler";

const PAGE_SIZE = 1_000;

type QueryResult = {
  readonly data: unknown[] | null;
  readonly error: unknown;
};

async function allMessageIds(
  load: (from: number, to: number) => PromiseLike<QueryResult>
) {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await load(from, from + PAGE_SIZE - 1);
    if (result.error || !Array.isArray(result.data)) {
      throw new Error("owner login evidence unavailable");
    }
    for (const value of result.data) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("owner login evidence unavailable");
      }
      const id = (value as Record<string, unknown>).provider_message_id;
      if (typeof id === "string" && id) ids.add(id);
    }
    if (result.data.length < PAGE_SIZE) return ids;
  }
}

export function createSupabaseNewsletterOwnerLoginData(
  client: SupabaseClient,
  siteId: string
): NewsletterOwnerLoginReconciliationData & {
  requeue(input: {
    readonly commandId: string;
    readonly operatorId: string;
  }): Promise<{ readonly status: "queued"; readonly queuedCount: number }>;
} {
  return {
    async ownerEmail(operatorId) {
      const result = await client.auth.admin.getUserById(operatorId);
      const email = result.data.user?.email?.trim().toLowerCase();
      if (result.error || !email) throw new Error("owner login evidence unavailable");
      return email;
    },

    async excludedProviderMessageIds() {
      const sets = await Promise.all([
        allMessageIds((from, to) => client.from("builder_newsletter_jobs")
          .select("provider_message_id").eq("site_id", siteId)
          .not("provider_message_id", "is", null).order("id", { ascending: true }).range(from, to)),
        allMessageIds((from, to) => client.from("builder_newsletter_staff_test_observations")
          .select("provider_message_id").eq("site_id", siteId)
          .not("provider_message_id", "is", null).order("id", { ascending: true }).range(from, to)),
        allMessageIds((from, to) => client.from("builder_newsletter_auth_smtp_proofs")
          .select("provider_message_id").eq("site_id", siteId)
          .order("id", { ascending: true }).range(from, to)),
        allMessageIds((from, to) => client.from("builder_newsletter_provider_history_reconciliations")
          .select("provider_message_id").eq("site_id", siteId)
          .order("id", { ascending: true }).range(from, to)),
        allMessageIds((from, to) => client.from("builder_newsletter_auth_login_evidence")
          .select("provider_message_id").eq("site_id", siteId)
          .order("id", { ascending: true }).range(from, to))
      ]);
      return new Set(sets.flatMap((set) => [...set]));
    },

    async recordEvidence(input) {
      const result = await client.rpc("builder_record_newsletter_auth_login_evidence_v1", {
        p_request: {
          version: 1,
          policyVersion: "resend-owner-login-v1",
          siteId,
          commandId: input.commandId,
          occurrenceId: input.occurrenceId,
          operatorId: input.operatorId,
          providerMessageId: input.providerMessageId,
          providerCreatedAt: input.providerCreatedAt,
          authLastSignInAt: input.authLastSignInAt,
          safeEvidenceDigest: input.evidenceDigest
        }
      });
      const value = result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? result.data as Record<string, unknown>
        : null;
      if (
        result.error || value?.version !== 1 || value.status !== "recorded" ||
        typeof value.evidenceId !== "string" || typeof value.replayed !== "boolean"
      ) throw new Error("owner login evidence unavailable");
      return { status: value.replayed ? "already_recorded" as const : "recorded" as const };
    },

    async requeue(input) {
      const result = await client.rpc("builder_requeue_newsletter_auth_login_jobs_v1", {
        p_request: {
          version: 1,
          siteId,
          commandId: input.commandId,
          operatorId: input.operatorId
        }
      });
      const value = result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? result.data as Record<string, unknown>
        : null;
      if (
        result.error || value?.version !== 1 || value.status !== "queued" ||
        !Number.isSafeInteger(value.queuedCount) || Number(value.queuedCount) < 0
      ) throw new Error("owner login evidence unavailable");
      return { status: "queued", queuedCount: Number(value.queuedCount) };
    }
  };
}
