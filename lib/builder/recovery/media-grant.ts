import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

import type { RecoveryEnvironment } from "./contracts";

export interface RecoveryMediaGrantClaims {
  readonly schemaVersion: 1;
  readonly environment: RecoveryEnvironment;
  readonly siteKey: string;
  readonly generationId: number;
  readonly route: string;
  readonly mediaDigest: string;
  readonly manifestPath: string;
  readonly expiresAt: number;
}
function key(secret: string) {
  if (secret.length < 32) throw new TypeError("Recovery media grant secret is too short.");
  return createHash("sha256").update(secret, "utf8").digest();
}

function invalid(): never {
  throw new TypeError("Recovery media grant is invalid.");
}

function validClaims(value: unknown): value is RecoveryMediaGrantClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  return claims.schemaVersion === 1 &&
    (claims.environment === "preview" || claims.environment === "production") &&
    typeof claims.siteKey === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(claims.siteKey) &&
    Number.isSafeInteger(claims.generationId) && Number(claims.generationId) > 0 &&
    typeof claims.route === "string" && claims.route.startsWith("/") &&
    typeof claims.mediaDigest === "string" && /^[a-f0-9]{64}$/.test(claims.mediaDigest) &&
    typeof claims.manifestPath === "string" && claims.manifestPath.length > 0 &&
    Number.isSafeInteger(claims.expiresAt);
}

export function createRecoveryMediaGrant(claims: RecoveryMediaGrantClaims, secret: string) {
  if (!validClaims(claims)) invalid();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(claims), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, ciphertext]).toString("base64url");
}

export function verifyRecoveryMediaGrant(token: string, secret: string, expected: {
  environment: RecoveryEnvironment;
  siteKey: string;
  generationId: number;
  mediaDigest: string;
  nowEpochSeconds: number;
}) {
  try {
    const sealed = Buffer.from(token, "base64url");
    if (sealed.length < 30 || sealed[0] !== 1) invalid();
    const iv = sealed.subarray(1, 13);
    const tag = sealed.subarray(13, 29);
    const ciphertext = sealed.subarray(29);
    const decipher = createDecipheriv("aes-256-gcm", key(secret), iv);
    decipher.setAuthTag(tag);
    const value = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as unknown;
    if (!validClaims(value)) invalid();
    if (value.environment !== expected.environment || value.siteKey !== expected.siteKey ||
        value.generationId !== expected.generationId || value.mediaDigest !== expected.mediaDigest) {
      throw new TypeError("Recovery media grant scope is invalid.");
    }
    if (value.expiresAt <= expected.nowEpochSeconds || value.expiresAt > expected.nowEpochSeconds + 300) {
      throw new TypeError("Recovery media grant is expired or invalid.");
    }
    return value;
  } catch (error) {
    if (error instanceof TypeError && /scope|expired/.test(error.message)) throw error;
    invalid();
  }
}
