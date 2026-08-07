import type { EditableValue } from "@reuben-williams/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  RecoveryClaim,
  RecoveryGenerationSource,
  RecoveryWorkerRepository
} from "./worker";

type GenerationRow = {
  site_id: unknown;
  generation_id: unknown;
  command_id: unknown;
  global_version_id: unknown;
  page_versions: unknown;
  created_at: unknown;
};

function errorMessage(error: unknown) {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Recovery repository operation failed.";
}
function snapshotValues(snapshot: unknown): Record<string, EditableValue> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("INVALID_SNAPSHOT");
  const regions = (snapshot as Record<string, unknown>).regions;
  if (!regions || typeof regions !== "object" || Array.isArray(regions)) throw new Error("INVALID_SNAPSHOT");
  return regions as Record<string, EditableValue>;
}

export function createSupabaseRecoveryWorkerRepository(
  client: SupabaseClient,
  options: {
    now?: () => Date;
    maxAttempts?: number;
    mediaBucket?: string;
  } = {}
): RecoveryWorkerRepository {
  const now = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? 8;
  const mediaBucket = options.mediaBucket ?? "builder-media";

  return {
    async claim(input) {
      const result = await client.rpc("builder_claim_content_recovery_job_v1", {
        p_worker: input.workerId,
        p_lease_seconds: input.leaseSeconds
      });
      if (result.error) throw new Error(errorMessage(result.error));
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!row) return null;
      const value = row as Record<string, unknown>;
      return {
        siteId: String(value.site_id),
        generationId: Number(value.generation_id),
        fenceToken: Number(value.fence_token),
        attemptCount: Number(value.attempt_count)
      };
    },

    async loadGeneration(claim) {
      const generationResult = await client
        .from("builder_site_generations")
        .select("site_id, generation_id, command_id, global_version_id, page_versions, created_at")
        .eq("site_id", claim.siteId)
        .eq("generation_id", claim.generationId)
        .single();
      if (generationResult.error || !generationResult.data) {
        throw new Error(errorMessage(generationResult.error));
      }
      const generation = generationResult.data as unknown as GenerationRow;
      const siteResult = await client.from("builder_sites").select("site_key")
        .eq("id", claim.siteId).single();
      if (siteResult.error || !siteResult.data?.site_key) throw new Error(errorMessage(siteResult.error));

      const pages = generation.page_versions;
      if (!pages || typeof pages !== "object" || Array.isArray(pages)) throw new Error("INVALID_GENERATION");
      const pageVersions = Object.entries(pages as Record<string, unknown>)
        .map(([path, versionId]) => ({ path, versionId: String(versionId) }));
      const versionIds = [String(generation.global_version_id), ...pageVersions.map((page) => page.versionId)];
      const versionsResult = await client.from("builder_versions")
        .select("id, page_path, snapshot")
        .eq("site_id", claim.siteId)
        .in("id", versionIds);
      if (versionsResult.error) throw new Error(errorMessage(versionsResult.error));
      const versions = new Map((versionsResult.data ?? []).map((row) => [String(row.id), row]));
      const global = versions.get(String(generation.global_version_id));
      if (!global) throw new Error("INCOMPLETE_GENERATION_GLOBAL");
      const sourcePages = pageVersions.map((page) => {
        const version = versions.get(page.versionId);
        if (!version || String(version.page_path) !== page.path) throw new Error("INCOMPLETE_ROUTES");
        return { path: page.path, versionId: page.versionId, values: snapshotValues(version.snapshot) };
      });

      const mediaRefsResult = await client.from("builder_page_version_media")
        .select("version_id, media_id, revision_id")
        .eq("site_id", claim.siteId)
        .in("version_id", versionIds);
      if (mediaRefsResult.error) throw new Error(errorMessage(mediaRefsResult.error));
      const mediaRefs = mediaRefsResult.data ?? [];
      const revisionIds = [...new Set(mediaRefs.map((row) => String(row.revision_id)))];
      let media: RecoveryGenerationSource["media"] = [];
      if (revisionIds.length > 0) {
        const revisionsResult = await client.from("builder_media_revisions")
          .select("media_id, id, object_key, mime_type, byte_size, sha256")
          .eq("site_id", claim.siteId)
          .in("id", revisionIds);
        if (revisionsResult.error) throw new Error(errorMessage(revisionsResult.error));
        media = await Promise.all((revisionsResult.data ?? []).map(async (revision) => {
          if (!revision.sha256) throw new Error("MEDIA_DIGEST_MISSING");
          const download = await client.storage.from(mediaBucket).download(String(revision.object_key));
          if (download.error || !download.data) throw new Error(errorMessage(download.error));
          const referencedVersions = new Set(mediaRefs
            .filter((row) => String(row.revision_id) === String(revision.id))
            .map((row) => String(row.version_id)));
          return {
            mediaId: String(revision.media_id),
            revisionId: String(revision.id),
            bytes: new Uint8Array(await download.data.arrayBuffer()),
            digest: String(revision.sha256),
            mimeType: String(revision.mime_type),
            routePaths: sourcePages.filter((page) => referencedVersions.has(page.versionId)).map((page) => page.path)
          };
        }));
      }

      return {
        siteId: claim.siteId,
        siteKey: String(siteResult.data.site_key),
        generationId: Number(generation.generation_id),
        commandId: String(generation.command_id),
        fenceToken: claim.fenceToken,
        attemptCount: claim.attemptCount,
        createdAt: String(generation.created_at),
        global: {
          versionId: String(generation.global_version_id),
          values: snapshotValues(global.snapshot)
        },
        pages: sourcePages,
        media
      } as RecoveryGenerationSource;
    },

    async complete(input) {
      const result = await client.rpc("builder_complete_content_recovery_job_v1", {
        p_site_id: input.siteId,
        p_generation_id: input.generationId,
        p_worker: input.workerId,
        p_fence_token: input.fenceToken
      });
      if (result.error) throw new Error(errorMessage(result.error));
      return result.data === true;
    },

    async retry(input) {
      const status = (input.attemptCount ?? 1) >= maxAttempts ? "dead_letter" : "retry";
      const seconds = Math.min(300, 2 ** Math.min(input.attemptCount ?? 1, 8));
      const availableAt = new Date(now().getTime() + seconds * 1000).toISOString();
      const result = await client.from("builder_content_recovery_jobs")
        .update({
          status,
          available_at: availableAt,
          lease_owner: null,
          lease_expires_at: null,
          last_error: input.safeCode,
          updated_at: now().toISOString()
        })
        .eq("site_id", input.siteId)
        .eq("generation_id", input.generationId)
        .eq("status", "claimed")
        .eq("lease_owner", input.workerId)
        .eq("fence_token", input.fenceToken)
        .select("status")
        .maybeSingle();
      if (result.error || !result.data?.status) throw new Error(errorMessage(result.error));
      return result.data.status === "dead_letter" ? "dead_letter" : "retry";
    }
  };
}
