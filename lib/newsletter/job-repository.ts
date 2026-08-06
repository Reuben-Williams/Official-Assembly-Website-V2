import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NewsletterClaimedJob } from "./worker";
import type { NewsletterContactProvider } from "./resend/contracts";

function parseClaimedJobs(value: unknown): NewsletterClaimedJob[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid job claim");
  const jobs = (value as Record<string, unknown>).jobs;
  if (!Array.isArray(jobs)) throw new Error("invalid job claim");
  return jobs.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid job claim");
    const job = value as Record<string, unknown>;
    if (
      !["subscription", "site", "broadcast"].includes(String(job.subject)) ||
      typeof job.id !== "string" ||
      typeof job.kind !== "string" ||
      !Number.isSafeInteger(job.fencingToken)
    ) throw new Error("invalid job claim");
    return job as NewsletterClaimedJob;
  });
}

function subjectTable(subject: NewsletterClaimedJob["subject"]): string {
  return subject === "subscription"
    ? "builder_newsletter_jobs"
    : subject === "site"
      ? "builder_newsletter_site_jobs"
      : "builder_newsletter_broadcast_audit_jobs";
}

export function createSupabaseNewsletterJobRepository(client: SupabaseClient, siteId: string) {
  return {
    async claim(input: {
      readonly workerId: string;
      readonly limit: number;
      readonly leaseSeconds: number;
      readonly emailEnabled: boolean;
    }): Promise<NewsletterClaimedJob[]> {
      const result = await client.rpc("builder_claim_newsletter_jobs_v1", {
        p_request: {
          version: 1,
          siteId,
          workerId: input.workerId,
          limit: input.limit,
          leaseSeconds: input.leaseSeconds,
          emailEnabled: input.emailEnabled
        }
      });
      if (result.error) throw new Error("job claim unavailable");
      const jobs = parseClaimedJobs(result.data);
      return Promise.all(jobs.map(async (job) => {
        const attempt = await client
          .from(subjectTable(job.subject))
          .select("attempt_count")
          .eq("site_id", siteId)
          .eq("id", job.id)
          .maybeSingle();
        return { ...job, attemptCount: Number(attempt.data?.attempt_count ?? 1) };
      }));
    },

    async complete(input: {
      readonly job: NewsletterClaimedJob;
      readonly workerId: string;
      readonly fencingToken: number;
      readonly resultCode: string;
    }) {
      const result = await client.rpc("builder_complete_newsletter_job_v1", {
        p_request: {
          version: 1,
          siteId,
          subject: input.job.subject,
          jobId: input.job.id,
          workerId: input.workerId,
          fencingToken: input.fencingToken,
          resultCode: input.resultCode
        }
      });
      if (result.error) throw new Error("job completion unavailable");
    },

    async fail(input: {
      readonly job: NewsletterClaimedJob;
      readonly workerId: string;
      readonly fencingToken: number;
      readonly terminal: boolean;
      readonly retryAt: Date;
      readonly failureCode: string;
    }) {
      const result = await client.rpc("builder_fail_newsletter_job_v1", {
        p_request: {
          version: 1,
          siteId,
          subject: input.job.subject,
          jobId: input.job.id,
          workerId: input.workerId,
          fencingToken: input.fencingToken,
          terminal: input.terminal,
          retryAt: input.retryAt.toISOString(),
          failureCode: input.failureCode
        }
      });
      if (result.error) throw new Error("job failure transition unavailable");
    }
  };
}

export function createSupabaseNewsletterSubscriptionJobData(client: SupabaseClient, siteId: string) {
  return {
    async loadConfirmation(jobId: string) {
      const jobResult = await client
        .from("builder_newsletter_jobs")
        .select("subscription_id,confirmation_generation,delivery_ordinal,provider_message_id,first_attempt_at,ambiguous_since,created_at")
        .eq("site_id", siteId).eq("id", jobId).single();
      if (jobResult.error || !jobResult.data) throw new Error("confirmation job unavailable");
      const subscriptionResult = await client
        .from("builder_newsletter_subscriptions")
        .select("contact_id,status")
        .eq("site_id", siteId).eq("id", jobResult.data.subscription_id).single();
      const generationResult = await client
        .from("builder_newsletter_confirmation_generations")
        .select("nonce,signing_key_id,issued_at,expires_at,consumed_at")
        .eq("site_id", siteId)
        .eq("subscription_id", jobResult.data.subscription_id)
        .eq("generation", jobResult.data.confirmation_generation)
        .single();
      if (subscriptionResult.error || generationResult.error || !subscriptionResult.data || !generationResult.data) {
        throw new Error("confirmation job unavailable");
      }
      const identityResult = await client
        .from("builder_contact_identities")
        .select("normalized_value")
        .eq("site_id", siteId)
        .eq("contact_id", subscriptionResult.data.contact_id)
        .eq("kind", "email")
        .neq("verification_state", "invalid")
        .limit(1)
        .maybeSingle();
      if (identityResult.error || !identityResult.data?.normalized_value) throw new Error("confirmation job unavailable");
      return {
        siteId,
        subscriptionId: String(jobResult.data.subscription_id),
        generation: Number(jobResult.data.confirmation_generation),
        deliveryOrdinal: Number(jobResult.data.delivery_ordinal),
        providerMessageId: jobResult.data.provider_message_id ? String(jobResult.data.provider_message_id) : undefined,
        firstAttemptAt: new Date(String(jobResult.data.first_attempt_at ?? jobResult.data.created_at)),
        ambiguous: Boolean(jobResult.data.ambiguous_since),
        recipient: String(identityResult.data.normalized_value),
        nonce: String(generationResult.data.nonce),
        keyId: String(generationResult.data.signing_key_id),
        issuedAt: new Date(String(generationResult.data.issued_at)),
        expiresAt: new Date(String(generationResult.data.expires_at)),
        pending: subscriptionResult.data.status === "pending_confirmation" && !generationResult.data.consumed_at
      };
    },

    async recordConfirmationAttempt(jobId: string, input: {
      readonly firstAttemptAt: Date;
      readonly providerMessageId?: string;
      readonly ambiguous: boolean;
    }) {
      const update = await client
        .from("builder_newsletter_jobs")
        .update({
          first_attempt_at: input.firstAttemptAt.toISOString(),
          provider_message_id: input.providerMessageId ?? null,
          ambiguous_since: input.ambiguous ? new Date().toISOString() : null
        })
        .eq("site_id", siteId).eq("id", jobId);
      if (update.error) throw new Error("confirmation evidence unavailable");
    },

    async loadContactSync(jobId: string) {
      const jobResult = await client
        .from("builder_newsletter_jobs")
        .select("subscription_id")
        .eq("site_id", siteId).eq("id", jobId).single();
      if (jobResult.error || !jobResult.data) throw new Error("contact sync unavailable");
      const subscriptionResult = await client
        .from("builder_newsletter_subscriptions")
        .select("contact_id,status,provider_contact_id")
        .eq("site_id", siteId).eq("id", jobResult.data.subscription_id).single();
      if (subscriptionResult.error || !subscriptionResult.data) throw new Error("contact sync unavailable");
      const contactResult = await client
        .from("builder_contacts")
        .select("display_name")
        .eq("site_id", siteId).eq("id", subscriptionResult.data.contact_id).single();
      const identityResult = await client
        .from("builder_contact_identities")
        .select("normalized_value")
        .eq("site_id", siteId).eq("contact_id", subscriptionResult.data.contact_id)
        .eq("kind", "email").neq("verification_state", "invalid").limit(1).maybeSingle();
      if (contactResult.error || identityResult.error || !contactResult.data || !identityResult.data) {
        throw new Error("contact sync unavailable");
      }
      return {
        subscriptionId: String(jobResult.data.subscription_id),
        status: String(subscriptionResult.data.status),
        providerContactId: subscriptionResult.data.provider_contact_id
          ? String(subscriptionResult.data.provider_contact_id)
          : undefined,
        email: String(identityResult.data.normalized_value),
        firstName: String(contactResult.data.display_name).split(/\s+/, 1)[0]
      };
    },

    async recordContactSync(subscriptionId: string, result:
      | { readonly state: "verified"; readonly providerContactId: string }
      | { readonly state: "withdrawn_topic" | "withdrawn_global" }
      | { readonly state: "blocked" }
    ) {
      const values = result.state === "verified"
        ? { status: "active", provider_contact_id: result.providerContactId, updated_at: new Date().toISOString() }
        : result.state === "blocked"
          ? { status: "suppressed", updated_at: new Date().toISOString() }
          : { status: "unsubscribed", updated_at: new Date().toISOString() };
      const update = await client.from("builder_newsletter_subscriptions")
        .update(values).eq("site_id", siteId).eq("id", subscriptionId);
      if (update.error) throw new Error("contact sync evidence unavailable");
    }
  };
}

export function createSupabaseNewsletterAuditData(client: SupabaseClient, siteId: string) {
  async function eligibleContacts() {
    const subscriptions = await client.from("builder_newsletter_subscriptions")
      .select("id,contact_id,status,provider_contact_id")
      .eq("site_id", siteId)
      .not("provider_contact_id", "is", null);
    if (subscriptions.error) throw new Error("newsletter audit unavailable");
    return subscriptions.data ?? [];
  }

  async function emailFor(contactId: string) {
    const identity = await client.from("builder_contact_identities")
      .select("normalized_value").eq("site_id", siteId).eq("contact_id", contactId)
      .eq("kind", "email").neq("verification_state", "invalid").limit(1).maybeSingle();
    if (identity.error || !identity.data?.normalized_value) throw new Error("newsletter audit unavailable");
    return String(identity.data.normalized_value);
  }

  async function snapshot(
    provider: NewsletterContactProvider,
    row: { readonly contact_id: string; readonly provider_contact_id: string | null },
    topicId: string,
    segmentId: string
  ) {
    const email = await emailFor(String(row.contact_id));
    const providerContactId = String(row.provider_contact_id);
    const [contact, topics, segments] = await Promise.all([
      provider.getContact({ id: providerContactId, email }),
      provider.listTopics({ contactId: providerContactId, email }),
      provider.listSegments({ contactId: providerContactId, email })
    ]);
    return {
      contact,
      topic: topics.find((entry) => entry.id === topicId),
      inSegment: segments.some((entry) => entry.id === segmentId)
    };
  }

  return {
    async contactAudit(provider: NewsletterContactProvider, topicId: string, segmentId: string) {
      for (const row of await eligibleContacts()) {
        const current = await snapshot(provider, row, topicId, segmentId);
        if (!current.contact || current.contact.unsubscribed || current.topic?.subscription === "opt_out") {
          const update = await client.from("builder_newsletter_subscriptions")
            .update({ status: "unsubscribed", updated_at: new Date().toISOString() })
            .eq("site_id", siteId).eq("id", row.id);
          if (update.error) throw new Error("newsletter audit unavailable");
        }
      }
    },

    async segmentReconcile(provider: NewsletterContactProvider, topicId: string, segmentId: string) {
      const rows = (await eligibleContacts()).filter((row) => row.status === "active");
      const eligibleIds: string[] = [];
      for (const row of rows) {
        const current = await snapshot(provider, row, topicId, segmentId);
        if (!current.contact || current.contact.unsubscribed || current.topic?.subscription !== "opt_in" || !current.inSegment) {
          throw new Error("newsletter audience is not ready");
        }
        eligibleIds.push(String(row.id));
      }
      const revisionResult = await client.from("builder_newsletter_readiness_revisions")
        .select("revision").eq("site_id", siteId).order("revision", { ascending: false }).limit(1).maybeSingle();
      if (revisionResult.error) throw new Error("newsletter readiness unavailable");
      const { createHash } = await import("node:crypto");
      const reconciledAt = new Date();
      const insert = await client.from("builder_newsletter_readiness_revisions").insert({
        site_id: siteId,
        revision: Number(revisionResult.data?.revision ?? 0) + 1,
        provider_scope_id: "resend-team-production",
        audience_count: eligibleIds.length,
        eligibility_digest: createHash("sha256").update(eligibleIds.sort().join("\n")).digest("hex"),
        reconciled_at: reconciledAt.toISOString(),
        expires_at: new Date(reconciledAt.getTime() + 30 * 60 * 1_000).toISOString(),
        state: "ready"
      }).select("id").single();
      if (insert.error || !insert.data?.id) throw new Error("newsletter readiness unavailable");
      return { readinessRevisionId: String(insert.data.id), audienceCount: eligibleIds.length };
    }
  };
}
