import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { NewsletterConfirmationTokenPayload } from "./confirmation-token";

export const CONFIRMATION_COOKIE = "__Host-newsletter-confirmation";
const MAX_BODY_BYTES = 4_096;
const SESSION_SECONDS = 10 * 60;
const RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer"
} as const;

export function createNewsletterSessionSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function digestNewsletterSessionSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function json(status: number, body: Record<string, unknown>, cookie?: string): Response {
  const headers = new Headers(RESPONSE_HEADERS);
  headers.set("content-type", "application/json");
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  try {
    return origin === new URL(request.url).origin && fetchSite === "same-origin";
  } catch {
    return false;
  }
}

function sessionCookie(secret: string, maxAge: number): string {
  const value = maxAge > 0 ? secret : "";
  return `${CONFIRMATION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function readCookie(request: Request, name: string): string | null {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) {
      const value = pair.slice(separator + 1).trim();
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
    }
  }
  return null;
}

async function boundedJson(request: Request): Promise<Record<string, unknown> | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;
  if ((request.headers.get("content-type") ?? "").split(";", 1)[0] !== "application/json") return null;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function handleNewsletterConfirmationSessionRequest(
  request: Request,
  dependencies: {
    readonly verifyToken: (token: string) => NewsletterConfirmationTokenPayload;
    readonly exchange: (input: {
      readonly siteId: string;
      readonly subscriptionId: string;
      readonly generation: number;
      readonly nonce: string;
      readonly keyId: string;
      readonly sessionDigest: string;
      readonly sessionExpiresAt: string;
    }) => Promise<{ readonly status: "ready" }>;
    readonly createSessionSecret?: () => string;
    readonly now?: () => Date;
  }
): Promise<Response> {
  if (request.method !== "POST" || !sameOrigin(request)) {
    return json(403, { error: { code: "CONFIRMATION_UNAVAILABLE" } });
  }
  const body = await boundedJson(request);
  if (!body || Object.keys(body).length !== 1 || typeof body.token !== "string" || body.token.length > 2_048) {
    return json(400, { error: { code: "CONFIRMATION_UNAVAILABLE" } });
  }

  try {
    const payload = dependencies.verifyToken(body.token);
    const secret = (dependencies.createSessionSecret ?? createNewsletterSessionSecret)();
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("invalid session");
    const now = (dependencies.now ?? (() => new Date()))();
    const sessionExpiresAt = new Date(now.getTime() + SESSION_SECONDS * 1_000).toISOString();
    await dependencies.exchange({
      siteId: payload.site,
      subscriptionId: payload.sub,
      generation: payload.gen,
      nonce: payload.nonce,
      keyId: payload.kid,
      sessionDigest: digestNewsletterSessionSecret(secret),
      sessionExpiresAt
    });
    return json(200, { status: "ready" }, sessionCookie(secret, SESSION_SECONDS));
  } catch {
    return json(400, { error: { code: "CONFIRMATION_UNAVAILABLE" } });
  }
}

export async function handleNewsletterConfirmationRequest(
  request: Request,
  dependencies: {
    readonly confirm: (input: { readonly sessionDigest: string }) => Promise<{
      readonly status: "confirmed_pending_provider" | "already_confirmed";
    }>;
  }
): Promise<Response> {
  if (request.method !== "POST" || !sameOrigin(request)) {
    return json(403, { error: { code: "CONFIRMATION_UNAVAILABLE" } });
  }
  const secret = readCookie(request, CONFIRMATION_COOKIE);
  if (!secret) return json(400, { error: { code: "CONFIRMATION_UNAVAILABLE" } });

  try {
    const result = await dependencies.confirm({
      sessionDigest: digestNewsletterSessionSecret(secret)
    });
    return json(
      result.status === "confirmed_pending_provider" ? 202 : 200,
      {
        status: result.status === "confirmed_pending_provider"
          ? "activation_pending"
          : "already_confirmed"
      },
      sessionCookie("", 0)
    );
  } catch {
    return json(400, { error: { code: "CONFIRMATION_UNAVAILABLE" } }, sessionCookie("", 0));
  }
}
