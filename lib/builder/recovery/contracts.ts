export type RecoveryEnvironment = "preview" | "production";

export interface RecoveryArtifactReference {
  readonly artifactPath: string;
  readonly artifactDigest: string;
}
export interface RecoveryRouteReference extends RecoveryArtifactReference {
  readonly path: string;
  readonly pageVersionId: string;
}

export interface RecoveryMediaReference extends RecoveryArtifactReference {
  readonly mediaId: string;
  readonly revisionId: string;
  readonly byteLength: number;
  readonly mimeType: string;
}

export interface RecoveryGenerationManifest {
  readonly schemaVersion: 1;
  readonly environment: RecoveryEnvironment;
  readonly siteKey: string;
  readonly generationId: number;
  readonly commandId: string;
  readonly globalVersionId: string;
  readonly routes: readonly RecoveryRouteReference[];
  readonly media: readonly RecoveryMediaReference[];
  readonly createdAt: string;
}

export interface RecoveryLatestPointer {
  readonly schemaVersion: 1;
  readonly environment: RecoveryEnvironment;
  readonly siteKey: string;
  readonly generationId: number;
  readonly manifestPath: string;
  readonly manifestDigest: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validEnvironment(value: unknown): value is RecoveryEnvironment {
  return value === "preview" || value === "production";
}

function assertIdentity(value: Record<string, unknown>, expected: {
  environment: RecoveryEnvironment;
  siteKey: string;
  expectedGenerationId?: number;
}) {
  if (value.schemaVersion !== 1 || value.environment !== expected.environment ||
      value.siteKey !== expected.siteKey) {
    throw new TypeError("Recovery manifest identity is invalid.");
  }
  if (!Number.isSafeInteger(value.generationId) || Number(value.generationId) < 1 ||
      (expected.expectedGenerationId !== undefined && value.generationId !== expected.expectedGenerationId)) {
    throw new TypeError("Recovery manifest generation is invalid.");
  }
}

export function validateLatestPointer(value: unknown, expected: {
  environment: RecoveryEnvironment;
  siteKey: string;
}): RecoveryLatestPointer {
  if (!record(value)) throw new TypeError("Recovery latest pointer is invalid.");
  assertIdentity(value, expected);
  if (typeof value.manifestPath !== "string" || !value.manifestPath ||
      typeof value.manifestDigest !== "string" || !SHA256.test(value.manifestDigest)) {
    throw new TypeError("Recovery latest pointer manifest reference is invalid.");
  }
  return value as unknown as RecoveryLatestPointer;
}

export function validateGenerationManifest(value: unknown, expected: {
  environment: RecoveryEnvironment;
  siteKey: string;
  routes: readonly string[];
  expectedGenerationId?: number;
}): RecoveryGenerationManifest {
  if (!record(value)) throw new TypeError("Recovery generation manifest is invalid.");
  assertIdentity(value, expected);
  if (typeof value.commandId !== "string" || !UUID.test(value.commandId) ||
      typeof value.globalVersionId !== "string" || !UUID.test(value.globalVersionId) ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
      !Array.isArray(value.routes) || !Array.isArray(value.media)) {
    throw new TypeError("Recovery generation manifest fields are invalid.");
  }

  const actualRoutes = new Set<string>();
  for (const route of value.routes) {
    if (!record(route) || typeof route.path !== "string" || !route.path.startsWith("/") ||
        actualRoutes.has(route.path) || typeof route.pageVersionId !== "string" || !UUID.test(route.pageVersionId) ||
        typeof route.artifactPath !== "string" || !route.artifactPath ||
        typeof route.artifactDigest !== "string" || !SHA256.test(route.artifactDigest)) {
      throw new TypeError("Recovery generation routes are invalid.");
    }
    actualRoutes.add(route.path);
  }
  const configured = new Set(expected.routes);
  if (actualRoutes.size !== configured.size || [...configured].some((path) => !actualRoutes.has(path))) {
    throw new TypeError("Recovery generation routes are incomplete or unregistered.");
  }

  const mediaKeys = new Set<string>();
  for (const media of value.media) {
    if (!record(media)) throw new TypeError("Recovery generation media are invalid.");
    const key = `${String(media.mediaId)}:${String(media.revisionId)}`;
    if (mediaKeys.has(key) || typeof media.mediaId !== "string" || !UUID.test(media.mediaId) ||
        typeof media.revisionId !== "string" || !UUID.test(media.revisionId) ||
        !Number.isSafeInteger(media.byteLength) || Number(media.byteLength) < 1 ||
        typeof media.mimeType !== "string" || !media.mimeType.startsWith("image/") ||
        typeof media.artifactPath !== "string" || !media.artifactPath ||
        typeof media.artifactDigest !== "string" || !SHA256.test(media.artifactDigest)) {
      throw new TypeError("Recovery generation media are invalid.");
    }
    mediaKeys.add(key);
  }
  return value as unknown as RecoveryGenerationManifest;
}

export function recoveryNamespace(environment: RecoveryEnvironment, siteKey: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(siteKey)) throw new TypeError("Recovery site key is invalid.");
  return `recovery/v1/${environment}/${siteKey}`;
}
