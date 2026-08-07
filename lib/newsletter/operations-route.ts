import "server-only";

import { authenticateBuilderRequest } from "../builder/request-auth";
import {
  readNewsletterConfiguration
} from "./config";
import { authorizeNewsletterStaffRequest, NewsletterStaffAuthorizationError } from "./staff-authorization";

export async function authorizeNewsletterOperation(
  request: Request,
  mutation: boolean,
  ownerOnly = false
) {
  return authorizeNewsletterStaffRequest(request, {
    mutation,
    ownerOnly,
    authenticate: () => authenticateBuilderRequest(request)
  });
}

export async function newsletterOperationBody(request: Request, allowed: readonly string[]) {
  if ((request.headers.get("content-type") ?? "").split(";", 1)[0] !== "application/json") {
    throw new TypeError("A JSON newsletter request is required.");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > 8_192) throw new TypeError("The newsletter request is too large.");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError("The newsletter request is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("The newsletter request is invalid.");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !allowed.includes(key))) throw new TypeError("The newsletter request has unknown fields.");
  return result;
}

const COMMAND_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newsletterOperationCommandId(value: unknown) {
  if (typeof value !== "string" || !COMMAND_ID_PATTERN.test(value)) {
    throw new TypeError("The newsletter command is invalid.");
  }
  return value.toLowerCase();
}

export function newsletterOperationReason(value: unknown) {
  if (typeof value !== "string") throw new TypeError("The newsletter reason is invalid.");
  const reason = value.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new TypeError("The newsletter reason is invalid.");
  }
  return reason;
}

export function newsletterOperationError(error: unknown) {
  if (error instanceof NewsletterStaffAuthorizationError) {
    return Response.json({ error: { code: error.code } }, {
      status: error.status,
      headers: { "cache-control": "no-store" }
    });
  }
  if (error instanceof TypeError) {
    return Response.json({ error: { code: "INVALID_NEWSLETTER_REQUEST" } }, {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }
  return Response.json({ error: { code: "NEWSLETTER_OPERATIONS_UNAVAILABLE" } }, {
    status: 503,
    headers: { "cache-control": "no-store" }
  });
}

export function requireReadyNewsletterConfiguration() {
  const configuration = readNewsletterConfiguration();
  if (configuration.status !== "ready" || !process.env.RESEND_MANAGEMENT_API_KEY) {
    throw new Error("newsletter operations unavailable");
  }
  return configuration;
}
