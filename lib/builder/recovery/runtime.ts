import site from "../../../builder.config";
import { getBuilderAdminClient } from "../../supabase/admin";
import { createRecoveryArtifactStore, createVercelBlobObjectStore } from "./blob-store";
import type { RecoveryEnvironment } from "./contracts";
import { readRecoveryHealth } from "./health";
import { createRecoveryMediaHandler } from "./media-route";
import { createRecoveryContentReader } from "./reader";
import { createSupabaseMediaReplicaRepository, createSupabaseRecoveryWorkerRepository } from "./repository";
import { runRecoveryWorkerOnce } from "./worker";
import { runMediaReplicaWorkerOnce } from "./media-replica-worker";

export function readRecoveryConfiguration(environment = process.env.BUILDER_RECOVERY_ENVIRONMENT) {
  if (environment !== "preview" && environment !== "production") {
    throw new Error("Recovery environment is not configured.");
  }
  const suffix = environment === "production" ? "PRODUCTION" : "PREVIEW";
  const blobToken = process.env[`BUILDER_RECOVERY_BLOB_TOKEN_${suffix}`];
  const grantSecret = process.env[`BUILDER_RECOVERY_MEDIA_GRANT_SECRET_${suffix}`];
  if (!blobToken || !grantSecret) throw new Error("Recovery credentials are not configured.");
  return { environment: environment as RecoveryEnvironment, blobToken, grantSecret };
}

export function createOfficialAssemblyRecoveryRuntime(input: {
  environment?: RecoveryEnvironment;
  workerId?: string;
} = {}) {
  const configuration = readRecoveryConfiguration(input.environment);
  const client = getBuilderAdminClient();
  if (!client) throw new Error("Recovery database is unavailable.");
  const artifacts = createRecoveryArtifactStore({
    objects: createVercelBlobObjectStore({ token: configuration.blobToken }),
    environment: configuration.environment,
    siteKey: site.siteId
  });
  const repository = createSupabaseRecoveryWorkerRepository(client);
  const mediaRepository = createSupabaseMediaReplicaRepository(client);
  const configuredRoutes = site.pages.map((page) => page.path);
  const workerId = input.workerId ?? crypto.randomUUID();
  return {
    environment: configuration.environment,
    siteKey: site.siteId,
    runOnce: async () => {
      const mediaResult = await runMediaReplicaWorkerOnce({
        environment: configuration.environment,
        workerId,
        repository: mediaRepository,
        artifacts,
      });
      if (mediaResult.status !== "idle") return mediaResult;
      return runRecoveryWorkerOnce({
        environment: configuration.environment,
        workerId,
        configuredRoutes,
        repository,
        artifacts
      });
    },
    health: () => readRecoveryHealth({ artifacts, configuredRoutes }),
    readContent: createRecoveryContentReader({
      artifacts,
      configuredRoutes,
      grantSecret: configuration.grantSecret,
      nowEpochSeconds: () => Math.floor(Date.now() / 1000)
    }),
    mediaHandler: createRecoveryMediaHandler({
      environment: configuration.environment,
      siteKey: site.siteId,
      configuredRoutes,
      grantSecret: configuration.grantSecret,
      nowEpochSeconds: () => Math.floor(Date.now() / 1000),
      artifacts
    })
  };
}
