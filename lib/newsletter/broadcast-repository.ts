import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("newsletter operations unavailable");
  }
  return value as Record<string, unknown>;
}

export function createNewsletterBroadcastRepository(client: SupabaseClient, siteId: string) {
  async function rpc(name: string, p_request: Record<string, unknown>) {
    const result = await client.rpc(name, { p_request });
    if (result.error) throw new Error("newsletter operations unavailable");
    return record(result.data);
  }

  return {
    async status() {
      const result = await rpc("builder_get_newsletter_operations_status_v1", { version: 1, siteId });
      const confirmedTest = await client.from("builder_newsletter_staff_test_observations")
        .select("id,provider_broadcast_id,digest,confirmed_at")
        .eq("site_id", siteId).eq("state", "confirmed_test")
        .order("confirmed_at", { ascending: false }).limit(1).maybeSingle();
      const validation = await client.from("builder_newsletter_broadcast_validations")
        .select("id,provider_broadcast_id,digest,audience_count,validated_at,valid_until,state,readiness_revision_id")
        .eq("site_id", siteId).order("validated_at", { ascending: false }).limit(1).maybeSingle();
      return {
        version: 1,
        queuedJobs: Number(result.queuedJobs ?? 0),
        openIncidents: Number(result.openIncidents ?? 0),
        confirmedTest: confirmedTest.data ?? null,
        validation: validation.data ?? null
      };
    },

    async openStaffTestWindow(input: Record<string, unknown>) {
      const result = await rpc("builder_open_newsletter_staff_test_window_v1", { version: 1, ...input, siteId });
      if (result.state !== "open" || typeof result.windowId !== "string") {
        throw new Error("newsletter operations unavailable");
      }
      return { state: "open" as const, windowId: result.windowId };
    },

    async recordStaffTestObservation(input: Record<string, unknown>) {
      return rpc("builder_record_newsletter_staff_test_observation_v1", { version: 1, ...input, siteId });
    },

    async createValidation(input: Record<string, unknown>) {
      const result = await rpc("builder_create_newsletter_broadcast_validation_v1", { version: 1, ...input, siteId });
      if (result.state !== "valid" || typeof result.validationId !== "string") {
        throw new Error("newsletter operations unavailable");
      }
      return { state: "valid" as const, validationId: result.validationId };
    },

    async classify(input: Record<string, unknown>) {
      return rpc("builder_classify_newsletter_broadcast_v1", { version: 1, ...input, siteId });
    },

    async findOpenStaffTestWindow(input: {
      readonly providerBroadcastId: string;
      readonly digest: string;
      readonly recipientFingerprint: string;
    }) {
      const result = await client.from("builder_newsletter_staff_test_windows")
        .select("id")
        .eq("site_id", siteId)
        .eq("provider_broadcast_id", input.providerBroadcastId)
        .eq("digest", input.digest)
        .eq("recipient_fingerprint", input.recipientFingerprint)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) throw new Error("newsletter operations unavailable");
      return result.data?.id ? String(result.data.id) : null;
    },

    async findCurrentValidation(providerBroadcastId: string, digest: string) {
      const result = await client.from("builder_newsletter_broadcast_validations")
        .select("id")
        .eq("site_id", siteId)
        .eq("provider_broadcast_id", providerBroadcastId)
        .eq("digest", digest)
        .eq("state", "valid")
        .order("validated_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) throw new Error("newsletter operations unavailable");
      return result.data?.id ? String(result.data.id) : null;
    },

    async auditCheckpoint(input: {
      readonly jobId: string;
      readonly workerId: string;
      readonly fencingToken: number;
      readonly hasMore: boolean;
      readonly after?: string;
      readonly pageCount: number;
    }) {
      return rpc("builder_record_newsletter_broadcast_audit_page_v1", {
        version: 1,
        siteId,
        jobId: input.jobId,
        workerId: input.workerId,
        fencingToken: input.fencingToken,
        hasMore: input.hasMore,
        afterCursor: input.after,
        pageCount: input.pageCount
      });
    }
  };
}
