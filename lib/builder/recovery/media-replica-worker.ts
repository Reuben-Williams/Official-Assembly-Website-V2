import type { RecoveryArtifactStore } from "./blob-store";
import { recoveryDigest } from "./blob-store";
import type { RecoveryEnvironment } from "./contracts";

export interface MediaReplicaClaim {
  readonly siteId: string;
  readonly siteKey: string;
  readonly mediaId: string;
  readonly revisionId: string;
  readonly objectKey: string;
  readonly contentDigest: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly fenceToken: number;
  readonly attemptCount: number;
}

export interface MediaReplicaRepository {
  claim(input: { workerId: string; leaseSeconds: number }): Promise<MediaReplicaClaim | null>;
  download(claim: MediaReplicaClaim): Promise<Uint8Array>;
  complete(input: MediaReplicaClaim & { workerId: string; objectPath: string }): Promise<boolean>;
  retry(input: MediaReplicaClaim & { workerId: string; safeCode: string }): Promise<"pending" | "failed" | "stale_fence">;
}

function extension(mimeType: string) {
  const values: Record<string, string> = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const value = values[mimeType];
  if (!value) throw new Error("INVALID_MEDIA_TYPE");
  return value;
}

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/DIGEST|BYTE_SIZE/.test(message)) return "MEDIA_DIGEST_MISMATCH";
  if (/INVALID_MEDIA_TYPE/.test(message)) return "INVALID_MEDIA_TYPE";
  if (/IDENTITY/.test(message)) return "MEDIA_IDENTITY_MISMATCH";
  return "MEDIA_REPLICA_WRITE_FAILED";
}

export async function runMediaReplicaWorkerOnce(input: {
  environment: RecoveryEnvironment;
  workerId: string;
  repository: MediaReplicaRepository;
  artifacts: RecoveryArtifactStore;
  leaseSeconds?: number;
}) {
  const claim = await input.repository.claim({
    workerId: input.workerId,
    leaseSeconds: input.leaseSeconds ?? 60,
  });
  if (!claim) return { status: "idle" as const };

  try {
    if (claim.siteKey !== input.artifacts.siteKey || input.environment !== input.artifacts.environment) {
      throw new Error("MEDIA_IDENTITY_MISMATCH");
    }
    const bytes = await input.repository.download(claim);
    if (bytes.byteLength !== claim.byteSize || await recoveryDigest(bytes) !== claim.contentDigest) {
      throw new Error("MEDIA_DIGEST_MISMATCH");
    }
    const objectPath = `recovery/v1/${input.environment}/${claim.siteKey}/media/${claim.mediaId}/${claim.revisionId}/${claim.contentDigest}.${extension(claim.mimeType)}`;
    await input.artifacts.writeImmutableBytes(objectPath, bytes, {
      contentType: claim.mimeType,
      expectedDigest: claim.contentDigest,
    });
    const completed = await input.repository.complete({ ...claim, workerId: input.workerId, objectPath });
    return completed
      ? { status: "media_completed" as const, mediaId: claim.mediaId, revisionId: claim.revisionId }
      : { status: "media_stale_fence" as const, mediaId: claim.mediaId, revisionId: claim.revisionId };
  } catch (error) {
    const code = safeCode(error);
    const status = await input.repository.retry({ ...claim, workerId: input.workerId, safeCode: code });
    return {
      status: status === "failed" ? "media_dead_letter" as const : status === "stale_fence" ? "media_stale_fence" as const : "media_retry" as const,
      mediaId: claim.mediaId,
      revisionId: claim.revisionId,
      safeCode: code,
    };
  }
}
