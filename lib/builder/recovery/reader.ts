import type { EditableValue } from "@reuben-williams/core";

import {
  canonicalRecoveryJson,
  recoveryDigest,
  type RecoveryArtifactStore
} from "./blob-store";
import { validateGenerationManifest } from "./contracts";
import { createRecoveryMediaGrant } from "./media-grant";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function createRecoveryContentReader(input: {
  artifacts: RecoveryArtifactStore;
  configuredRoutes: readonly string[];
  grantSecret: string;
  nowEpochSeconds: () => number;
}) {
  return async (pagePath: string) => {
    try {
      const latest = await input.artifacts.readLatest();
      if (!latest) return null;
      const manifestValue = await input.artifacts.readJson(latest.pointer.manifestPath, { useCache: false });
      if (!manifestValue) return null;
      const manifestBytes = new TextEncoder().encode(canonicalRecoveryJson(manifestValue.value));
      if (await recoveryDigest(manifestBytes) !== latest.pointer.manifestDigest) return null;
      const manifest = validateGenerationManifest(manifestValue.value, {
        environment: input.artifacts.environment,
        siteKey: input.artifacts.siteKey,
        routes: input.configuredRoutes,
        expectedGenerationId: latest.pointer.generationId
      });
      const route = manifest.routes.find((candidate) => candidate.path === pagePath);
      if (!route) return null;
      const artifactValue = await input.artifacts.readJson(route.artifactPath, { useCache: false });
      if (!artifactValue || !record(artifactValue.value)) return null;
      const artifactBytes = new TextEncoder().encode(canonicalRecoveryJson(artifactValue.value));
      if (await recoveryDigest(artifactBytes) !== route.artifactDigest ||
          artifactValue.value.generationId !== manifest.generationId || artifactValue.value.route !== pagePath ||
          !record(artifactValue.value.values)) return null;

      const expiresAt = input.nowEpochSeconds() + 60;
      const regions: Record<string, EditableValue> = {};
      for (const [regionId, unknownValue] of Object.entries(artifactValue.value.values)) {
        if (!record(unknownValue) || typeof unknownValue.type !== "string") continue;
        const value = unknownValue as unknown as EditableValue;
        if (value.type === "image" && value.mediaId) {
          const media = manifest.media.find((candidate) => candidate.mediaId === value.mediaId);
          if (!media) return null;
          const grant = createRecoveryMediaGrant({
            schemaVersion: 1,
            environment: input.artifacts.environment,
            siteKey: input.artifacts.siteKey,
            generationId: manifest.generationId,
            route: pagePath,
            mediaDigest: media.artifactDigest,
            manifestPath: latest.pointer.manifestPath,
            expiresAt
          }, input.grantSecret);
          regions[regionId] = {
            ...value,
            src: `/api/builder/recovery/media/${manifest.generationId}/${media.artifactDigest}?grant=${encodeURIComponent(grant)}`
          };
        } else {
          regions[regionId] = value;
        }
      }
      return { regions };
    } catch {
      return null;
    }
  };
}
