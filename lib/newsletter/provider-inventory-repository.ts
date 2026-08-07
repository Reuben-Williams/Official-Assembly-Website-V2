import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NewsletterProviderInventoryEvidence } from "./provider-inventory";

const PAGE_SIZE = 1_000;
const REQUIRED_MANUAL_CATEGORIES = [
  "billing_ownership",
  "oauth_application_view",
  "team_membership"
] as const;

type QueryResult = {
  readonly data: unknown[] | null;
  readonly error: unknown;
};

async function allRows(
  load: (from: number, to: number) => PromiseLike<QueryResult>
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await load(from, from + PAGE_SIZE - 1);
    if (result.error || !Array.isArray(result.data)) {
      throw new Error("newsletter inventory evidence unavailable");
    }
    for (const value of result.data) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("newsletter inventory evidence unavailable");
      }
      rows.push(value as Record<string, unknown>);
    }
    if (result.data.length < PAGE_SIZE) return rows;
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function createNewsletterProviderInventoryEvidenceRepository(
  client: SupabaseClient,
  siteId: string
) {
  return {
    async activeActivationDigest(): Promise<string | null> {
      const result = await client
        .from("builder_newsletter_provider_activation_revisions")
        .select("resource_identity_digest")
        .eq("site_id", siteId)
        .eq("provider_scope_id", "resend-team-production")
        .eq("state", "active")
        .maybeSingle();
      if (result.error) throw new Error("newsletter inventory evidence unavailable");
      return result.data?.resource_identity_digest
        ? String(result.data.resource_identity_digest)
        : null;
    },

    async read(): Promise<NewsletterProviderInventoryEvidence> {
      const subscriptions = await allRows((from, to) => client
        .from("builder_newsletter_subscriptions")
        .select("contact_id,status,provider_contact_id")
        .eq("site_id", siteId)
        .order("id", { ascending: true })
        .range(from, to));
      const identities = await allRows((from, to) => client
        .from("builder_contact_identities")
        .select("contact_id,normalized_value")
        .eq("site_id", siteId)
        .eq("kind", "email")
        .neq("verification_state", "invalid")
        .order("id", { ascending: true })
        .range(from, to));
      const suppressions = await allRows((from, to) => client
        .from("builder_suppressions")
        .select("contact_id")
        .eq("site_id", siteId)
        .eq("channel", "email")
        .eq("active", true)
        .order("id", { ascending: true })
        .range(from, to));
      const confirmationJobs = await allRows((from, to) => client
        .from("builder_newsletter_jobs")
        .select("provider_message_id")
        .eq("site_id", siteId)
        .eq("kind", "newsletter.confirmation.send")
        .not("provider_message_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to));
      const staffTests = await allRows((from, to) => client
        .from("builder_newsletter_staff_test_observations")
        .select("provider_message_id")
        .eq("site_id", siteId)
        .in("state", ["provisional_test", "confirmed_test"])
        .order("id", { ascending: true })
        .range(from, to));
      const validations = await allRows((from, to) => client
        .from("builder_newsletter_broadcast_validations")
        .select("provider_broadcast_id,state")
        .eq("site_id", siteId)
        .eq("state", "consumed_matching")
        .order("id", { ascending: true })
        .range(from, to));
      const incidents = await allRows((from, to) => client
        .from("builder_newsletter_broadcast_incidents")
        .select("provider_broadcast_id,state")
        .eq("site_id", siteId)
        .neq("state", "resolved")
        .order("id", { ascending: true })
        .range(from, to));
      const receipts = await allRows((from, to) => client
        .from("builder_newsletter_webhook_receipts")
        .select("provider_message_id,provider_broadcast_id,disposition")
        .eq("site_id", siteId)
        .eq("disposition", "matched")
        .order("id", { ascending: true })
        .range(from, to));

      const attestation = await client
        .from("builder_newsletter_provider_inventory_attestations")
        .select("categories,expires_at")
        .eq("site_id", siteId)
        .eq("policy_version", "resend-district-newsletter-v1")
        .gt("expires_at", new Date().toISOString())
        .order("attested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (attestation.error) {
        throw new Error("newsletter inventory evidence unavailable");
      }

      const subscriptionContactIds = new Set(
        subscriptions.map((row) => text(row.contact_id)).filter(Boolean)
      );
      const suppressionContactIds = new Set(
        suppressions.map((row) => text(row.contact_id)).filter(Boolean)
      );
      const providerContactIds = new Set(
        subscriptions.map((row) => text(row.provider_contact_id)).filter(Boolean)
      );
      const retainedContactEmails = new Set(
        identities
          .filter((row) => subscriptionContactIds.has(text(row.contact_id)))
          .map((row) => text(row.normalized_value).trim().toLowerCase())
          .filter(Boolean)
      );
      const suppressionEmails = new Set(
        identities
          .filter((row) => suppressionContactIds.has(text(row.contact_id)))
          .map((row) => text(row.normalized_value).trim().toLowerCase())
          .filter(Boolean)
      );
      const unresolvedIncidentBroadcastIds = new Set(
        incidents.map((row) => text(row.provider_broadcast_id)).filter(Boolean)
      );
      const allowedSentBroadcastIds = new Set(
        validations
          .map((row) => text(row.provider_broadcast_id))
          .filter((id) => id && !unresolvedIncidentBroadcastIds.has(id))
      );
      const allowedProviderMessageIds = new Set([
        ...confirmationJobs.map((row) => text(row.provider_message_id)),
        ...staffTests.map((row) => text(row.provider_message_id)),
        ...receipts
          .filter((row) => allowedSentBroadcastIds.has(text(row.provider_broadcast_id)))
          .map((row) => text(row.provider_message_id))
      ].filter(Boolean));

      const categories = new Set(
        Array.isArray(attestation.data?.categories)
          ? attestation.data.categories.filter((value): value is string => typeof value === "string")
          : []
      );

      return {
        providerContactIds,
        retainedContactEmails,
        suppressionEmails,
        allowedProviderMessageIds,
        allowedSentBroadcastIds,
        localEligibleCount: subscriptions.filter((row) => row.status === "active").length,
        manualAttestationCurrent: REQUIRED_MANUAL_CATEGORIES.every((name) => categories.has(name)),
        authSmtpPermissionAttested: categories.has("auth_smtp_sending_only"),
        authSmtpLoginBeforeRevocationProved: categories.has("auth_smtp_login_before_revocation"),
        authSmtpLoginAfterRevocationProved: categories.has("auth_smtp_login_after_revocation")
      };
    }
  };
}
