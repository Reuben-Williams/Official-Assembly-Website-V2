import type { EditableValue } from "@reuben-williams/core";

import {
  canonicalRecoveryJson,
  recoveryDigest,
  type RecoveryArtifactStore
} from "./blob-store";
import {
  validateGenerationManifest,
  type RecoveryEnvironment,
  type RecoveryGenerationManifest,
  type RecoveryMediaReference,
  type RecoveryRouteReference
} from "./contracts";

export interface RecoveryClaim {
  readonly siteId: string;
  readonly generationId: number;
  readonly fenceToken: number;
  readonly attemptCount?: number;
}

export interface RecoveryGenerationSource {
  readonly siteId: string;
  readonly siteKey: string;
  readonly generationId: number;
  readonly commandId: string;
  readonly fenceToken: number;
  readonly createdAt?: string;
  readonly global: {
    readonly versionId: string;
    readonly values: Record<string, EditableValue>;
  };
  readonly pages: readonly {
    readonly path: string;
    readonly versionId: string;
    readonly values: Record<string, EditableValue>;
  }[];
  readonly media: readonly {
    readonly mediaId: string;
    readonly revisionId: string;
    readonly bytes: Uint8Array;
    readonly digest: string;
    readonly mimeType: string;
    readonly routePaths?: readonly string[];
  }[];
}

export interface RecoveryWorkerRepository {
  claim(input: { workerId: string; leaseSeconds: number }): Promise<RecoveryClaim | null>;
  loadGeneration(claim: RecoveryClaim): Promise<RecoveryGenerationSource>;
  complete(input: RecoveryClaim & { workerId: string }): Promise<boolean>;
  retry(input: RecoveryClaim & {
    workerId: string;
    safeCode: string;
  }): Promise<"retry" | "dead_letter">;
}

function extension(mimeType: string) {
  const extensions: Record<string, string> = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  const value = extensions[mimeType];
  if (!value) throw new Error("INVALID_MEDIA_TYPE");
  return value;
}

function exactRoutes(source: RecoveryGenerationSource, configuredRoutes: readonly string[]) {
  const pages = new Set(source.pages.map((page) => page.path));
  const configured = new Set(configuredRoutes);
  return pages.size === source.pages.length && pages.size === configured.size &&
    [...configured].every((path) => pages.has(path));
}

function recoveryValues(values: Record<string, EditableValue>) {
  return Object.fromEntries(Object.entries(values).map(([regionId, value]) => [
    regionId,
    value.type === "image" && value.mediaId ? { ...value, src: "" } : value
  ]));
}

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/INCOMPLETE_ROUTES/.test(message)) return "INCOMPLETE_ROUTES";
  if (/DIGEST|INVALID_ARTIFACT/.test(message)) return "MEDIA_DIGEST_MISMATCH";
  if (/INVALID_MEDIA_TYPE/.test(message)) return "INVALID_MEDIA_TYPE";
  return "RECOVERY_WRITE_FAILED";
}

export async function runRecoveryWorkerOnce(input: {
  environment: RecoveryEnvironment;
  workerId: string;
  configuredRoutes: readonly string[];
  repository: RecoveryWorkerRepository;
  artifacts: RecoveryArtifactStore;
  leaseSeconds?: number;
}) {
  const claim = await input.repository.claim({
    workerId: input.workerId,
    leaseSeconds: input.leaseSeconds ?? 60
  });
  if (!claim) return { status: "idle" as const };

  try {
    const source = await input.repository.loadGeneration(claim);
    if (source.siteId !== claim.siteId || source.generationId !== claim.generationId ||
        source.fenceToken !== claim.fenceToken || source.siteKey !== input.artifacts.siteKey ||
        input.environment !== input.artifacts.environment) {
      throw new Error("GENERATION_IDENTITY_MISMATCH");
    }
    if (!exactRoutes(source, input.configuredRoutes)) throw new Error("INCOMPLETE_ROUTES");

    const namespace = `recovery/v1/${input.environment}/${source.siteKey}`;
    const mediaReferences: RecoveryMediaReference[] = [];
    for (const media of source.media) {
      const actualDigest = await recoveryDigest(media.bytes);
      if (actualDigest !== media.digest) throw new Error("MEDIA_DIGEST_MISMATCH");
      const artifactPath = `${namespace}/media/${media.mediaId}/${media.revisionId}/${media.digest}.${extension(media.mimeType)}`;
      await input.artifacts.writeImmutableBytes(artifactPath, media.bytes, {
        contentType: media.mimeType,
        expectedDigest: media.digest
      });
      mediaReferences.push({
        mediaId: media.mediaId,
        revisionId: media.revisionId,
        artifactPath,
        artifactDigest: media.digest,
        byteLength: media.bytes.byteLength,
        mimeType: media.mimeType
      });
    }

    const routeReferences: RecoveryRouteReference[] = [];
    for (const page of [...source.pages].sort((left, right) => left.path.localeCompare(right.path))) {
      const artifact = {
        schemaVersion: 1 as const,
        environment: input.environment,
        siteKey: source.siteKey,
        generationId: source.generationId,
        route: page.path,
        globalVersionId: source.global.versionId,
        pageVersionId: page.versionId,
        values: recoveryValues({ ...source.global.values, ...page.values }),
        media: mediaReferences.filter((reference) => {
          const media = source.media.find((candidate) => candidate.revisionId === reference.revisionId);
          return !media?.routePaths || media.routePaths.includes(page.path);
        })
      };
      const bytes = new TextEncoder().encode(canonicalRecoveryJson(artifact));
      const digest = await recoveryDigest(bytes);
      const routeKey = page.path === "/" ? "home" : page.path.slice(1).replace(/[^a-z0-9-]+/g, "-");
      const artifactPath = `${namespace}/generations/${source.generationId}/routes/${routeKey}-${digest}.json`;
      await input.artifacts.writeImmutableJson(artifactPath, artifact);
      routeReferences.push({ path: page.path, pageVersionId: page.versionId, artifactPath, artifactDigest: digest });
    }

    const manifest: RecoveryGenerationManifest = {
      schemaVersion: 1,
      environment: input.environment,
      siteKey: source.siteKey,
      generationId: source.generationId,
      commandId: source.commandId,
      globalVersionId: source.global.versionId,
      routes: routeReferences,
      media: mediaReferences,
      createdAt: source.createdAt ?? new Date().toISOString()
    };
    validateGenerationManifest(manifest, {
      environment: input.environment,
      siteKey: source.siteKey,
      routes: input.configuredRoutes,
      expectedGenerationId: source.generationId
    });
    const manifestBytes = new TextEncoder().encode(canonicalRecoveryJson(manifest));
    const manifestDigest = await recoveryDigest(manifestBytes);
    const manifestPath = `${namespace}/generations/${source.generationId}/manifest-${manifestDigest}.json`;
    await input.artifacts.writeImmutableJson(manifestPath, manifest);
    await input.artifacts.advanceLatest({
      schemaVersion: 1,
      environment: input.environment,
      siteKey: source.siteKey,
      generationId: source.generationId,
      manifestPath,
      manifestDigest
    });

    const completed = await input.repository.complete({ ...claim, workerId: input.workerId });
    return completed
      ? { status: "completed" as const, generationId: source.generationId }
      : { status: "stale_fence" as const, generationId: source.generationId };
  } catch (error) {
    const code = safeCode(error);
    const status = await input.repository.retry({ ...claim, workerId: input.workerId, safeCode: code });
    return { status, generationId: claim.generationId, safeCode: code };
  }
}
