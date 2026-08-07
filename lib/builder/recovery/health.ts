import {
  canonicalRecoveryJson,
  recoveryDigest,
  type RecoveryArtifactStore
} from "./blob-store";
import { validateGenerationManifest } from "./contracts";

export async function readRecoveryHealth(input: {
  artifacts: RecoveryArtifactStore;
  configuredRoutes: readonly string[];
}) {
  try {
    const latest = await input.artifacts.readLatest();
    if (!latest) return { ready: false, generationId: null, routeCount: 0, mediaCount: 0 };
    const manifestValue = await input.artifacts.readJson(latest.pointer.manifestPath, { useCache: false });
    if (!manifestValue) throw new Error("MISSING_MANIFEST");
    const manifestBytes = new TextEncoder().encode(canonicalRecoveryJson(manifestValue.value));
    if (await recoveryDigest(manifestBytes) !== latest.pointer.manifestDigest) throw new Error("MANIFEST_DIGEST");
    const manifest = validateGenerationManifest(manifestValue.value, {
      environment: input.artifacts.environment,
      siteKey: input.artifacts.siteKey,
      routes: input.configuredRoutes,
      expectedGenerationId: latest.pointer.generationId
    });
    for (const route of manifest.routes) {
      const artifact = await input.artifacts.readJson(route.artifactPath, { useCache: false });
      if (!artifact) throw new Error("MISSING_ROUTE");
      const bytes = new TextEncoder().encode(canonicalRecoveryJson(artifact.value));
      if (await recoveryDigest(bytes) !== route.artifactDigest) throw new Error("ROUTE_DIGEST");
    }
    for (const media of manifest.media) {
      const artifact = await input.artifacts.readObject(media.artifactPath, { useCache: false });
      if (!artifact || artifact.bytes.byteLength !== media.byteLength || artifact.contentType !== media.mimeType ||
          await recoveryDigest(artifact.bytes) !== media.artifactDigest) throw new Error("MEDIA_DIGEST");
    }
    return {
      ready: true,
      generationId: manifest.generationId,
      routeCount: manifest.routes.length,
      mediaCount: manifest.media.length
    };
  } catch {
    return { ready: false, generationId: null, routeCount: 0, mediaCount: 0 };
  }
}
