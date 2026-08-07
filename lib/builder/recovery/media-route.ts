import {
  canonicalRecoveryJson,
  recoveryDigest,
  type RecoveryArtifactStore
} from "./blob-store";
import { validateGenerationManifest, type RecoveryEnvironment } from "./contracts";
import { verifyRecoveryMediaGrant } from "./media-grant";

function json(status: number, code: string) {
  return Response.json({ error: { code } }, {
    status,
    headers: { "cache-control": "private, no-store" }
  });
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createRecoveryMediaHandler(input: {
  environment: RecoveryEnvironment;
  siteKey: string;
  configuredRoutes: readonly string[];
  grantSecret: string;
  nowEpochSeconds: () => number;
  artifacts: RecoveryArtifactStore;
  maximumBytes?: number;
}) {
  return async (request: Request, params: { generation: string; digest: string }) => {
    const generationId = Number(params.generation);
    if (!Number.isSafeInteger(generationId) || generationId < 1 || !/^[a-f0-9]{64}$/.test(params.digest)) {
      return json(404, "RECOVERY_MEDIA_NOT_FOUND");
    }
    const token = new URL(request.url).searchParams.get("grant");
    if (!token) return json(403, "RECOVERY_MEDIA_GRANT_REQUIRED");

    try {
      const claims = verifyRecoveryMediaGrant(token, input.grantSecret, {
        environment: input.environment,
        siteKey: input.siteKey,
        generationId,
        mediaDigest: params.digest,
        nowEpochSeconds: input.nowEpochSeconds()
      });
      const manifestValue = await input.artifacts.readJson(claims.manifestPath, { useCache: false });
      if (!manifestValue) return json(503, "RECOVERY_MEDIA_INVALID");
      const manifest = validateGenerationManifest(manifestValue.value, {
        environment: input.environment,
        siteKey: input.siteKey,
        routes: input.configuredRoutes,
        expectedGenerationId: generationId
      });
      const route = manifest.routes.find((candidate) => candidate.path === claims.route);
      const media = manifest.media.find((candidate) => candidate.artifactDigest === params.digest);
      if (!route || !media) return json(404, "RECOVERY_MEDIA_NOT_FOUND");

      const routeValue = await input.artifacts.readJson(route.artifactPath, { useCache: false });
      if (!routeValue || !record(routeValue.value)) return json(503, "RECOVERY_MEDIA_INVALID");
      const routeBytes = new TextEncoder().encode(canonicalRecoveryJson(routeValue.value));
      if (await recoveryDigest(routeBytes) !== route.artifactDigest ||
          routeValue.value.generationId !== generationId || routeValue.value.route !== claims.route ||
          !Array.isArray(routeValue.value.media) || !routeValue.value.media.some((entry) =>
            record(entry) && entry.artifactDigest === params.digest)) {
        return json(503, "RECOVERY_MEDIA_INVALID");
      }

      const object = await input.artifacts.readObject(media.artifactPath, { useCache: false });
      const maximumBytes = input.maximumBytes ?? 10 * 1024 * 1024;
      if (!object || object.bytes.byteLength > maximumBytes || object.bytes.byteLength !== media.byteLength ||
          object.contentType !== media.mimeType || await recoveryDigest(object.bytes) !== media.artifactDigest) {
        return json(503, "RECOVERY_MEDIA_INVALID");
      }
      return new Response(object.bytes.slice().buffer, {
        headers: {
          "content-type": media.mimeType,
          "content-length": String(media.byteLength),
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store"
        }
      });
    } catch {
      return json(403, "RECOVERY_MEDIA_GRANT_INVALID");
    }
  };
}
