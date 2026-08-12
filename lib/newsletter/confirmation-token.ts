import "server-only";

import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const TOKEN_LIFETIME_SECONDS = 48 * 60 * 60;
const CLOCK_SKEW_SECONDS = 5 * 60;

export type NewsletterConfirmationTokenPayload = {
  readonly v: 1;
  readonly site: string;
  readonly sub: string;
  readonly gen: number;
  readonly nonce: string;
  readonly iat: number;
  readonly exp: number;
  readonly kid: string;
};

export type NewsletterConfirmationKeyring = ReadonlyMap<string, Uint8Array>;

function invalid(): never {
  throw new Error("invalid newsletter confirmation token");
}

function assertPayload(value: unknown): asserts value is NewsletterConfirmationTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const payload = value as Record<string, unknown>;
  if (
    payload.v !== 1 ||
    typeof payload.site !== "string" || !UUID_PATTERN.test(payload.site) ||
    typeof payload.sub !== "string" || !UUID_PATTERN.test(payload.sub) ||
    !Number.isSafeInteger(payload.gen) || Number(payload.gen) < 1 ||
    typeof payload.nonce !== "string" || !NONCE_PATTERN.test(payload.nonce) ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    Number(payload.exp) <= Number(payload.iat) ||
    Number(payload.exp) - Number(payload.iat) > TOKEN_LIFETIME_SECONDS ||
    typeof payload.kid !== "string" || !KEY_ID_PATTERN.test(payload.kid)
  ) invalid();
}

export function canonicalNewsletterConfirmationPayload(
  payload: NewsletterConfirmationTokenPayload
): string {
  assertPayload(payload);
  return JSON.stringify({
    v: payload.v,
    site: payload.site,
    sub: payload.sub,
    gen: payload.gen,
    nonce: payload.nonce,
    iat: payload.iat,
    exp: payload.exp,
    kid: payload.kid
  });
}

function keyFor(keyring: NewsletterConfirmationKeyring, keyId: string): Buffer {
  const key = keyring.get(keyId);
  if (!key || key.byteLength < 32) invalid();
  return Buffer.from(key);
}

export function signNewsletterConfirmationToken(
  payload: NewsletterConfirmationTokenPayload,
  keyring: NewsletterConfirmationKeyring
): string {
  const canonical = canonicalNewsletterConfirmationPayload(payload);
  const body = Buffer.from(canonical, "utf8");
  const signature = createHmac("sha256", keyFor(keyring, payload.kid)).update(body).digest();
  return `${body.toString("base64url")}.${signature.toString("base64url")}`;
}

export function verifyNewsletterConfirmationToken(
  token: string,
  keyring: NewsletterConfirmationKeyring,
  now = new Date()
): NewsletterConfirmationTokenPayload {
  if (typeof token !== "string" || token.length > 2_048) invalid();
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0].includes("=") || parts[1].includes("=")) {
    invalid();
  }

  let body: Buffer;
  let signature: Buffer;
  let parsed: unknown;
  try {
    body = Buffer.from(parts[0], "base64url");
    signature = Buffer.from(parts[1], "base64url");
    if (body.toString("base64url") !== parts[0] || signature.toString("base64url") !== parts[1]) invalid();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    parsed = JSON.parse(text);
  } catch {
    invalid();
  }
  assertPayload(parsed);
  const canonical = canonicalNewsletterConfirmationPayload(parsed);
  const canonicalBytes = Buffer.from(canonical, "utf8");
  if (canonicalBytes.length !== body.length || !timingSafeEqual(canonicalBytes, body)) invalid();

  const expected = createHmac("sha256", keyFor(keyring, parsed.kid)).update(body).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) invalid();

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!Number.isFinite(nowSeconds) || parsed.iat > nowSeconds + CLOCK_SKEW_SECONDS || parsed.exp <= nowSeconds) {
    invalid();
  }
  return Object.freeze({ ...parsed });
}

export function readNewsletterConfirmationKeyring(
  environment: Readonly<Record<string, string | undefined>> = process.env
): { readonly activeKeyId: string; readonly keys: NewsletterConfirmationKeyring } | null {
  try {
    const parsed: unknown = JSON.parse(environment.NEWSLETTER_CONFIRMATION_KEYRING ?? "");
    const activeKeyId = environment.NEWSLETTER_CONFIRMATION_ACTIVE_KEY_ID ?? "";
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !KEY_ID_PATTERN.test(activeKeyId)) {
      return null;
    }
    const keys = new Map<string, Uint8Array>();
    for (const [keyId, encoded] of Object.entries(parsed as Record<string, unknown>)) {
      if (!KEY_ID_PATTERN.test(keyId) || typeof encoded !== "string" || encoded.includes("=")) return null;
      const decoded = Buffer.from(encoded, "base64url");
      if (decoded.length < 32 || decoded.toString("base64url") !== encoded) return null;
      keys.set(keyId, decoded);
    }
    if (!keys.has(activeKeyId)) return null;
    return { activeKeyId, keys };
  } catch {
    return null;
  }
}
