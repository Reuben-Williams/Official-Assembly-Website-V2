import "server-only";

import { timingSafeEqual } from "node:crypto";

import type { ActiveBuilderIdentity } from "../builder/authorization";
import { BUILDER_SITE_KEY } from "../builder/authorization";

export class NewsletterStaffAuthorizationError extends Error {
  constructor(readonly status: 401 | 403, readonly code: string) {
    super("Newsletter operations are not authorized.");
    this.name = "NewsletterStaffAuthorizationError";
  }
}

function equal(left: string, right: string | null): boolean {
  const expected = Buffer.from(left, "utf8");
  const received = Buffer.from(right ?? "", "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function authorizeNewsletterStaffRequest(
  request: Request,
  input: {
    readonly mutation: boolean;
    readonly authenticate: () => Promise<ActiveBuilderIdentity | null>;
  }
) {
  const identity = await input.authenticate();
  if (!identity) throw new NewsletterStaffAuthorizationError(401, "AUTH_REQUIRED");
  if (identity.siteKey !== BUILDER_SITE_KEY) throw new NewsletterStaffAuthorizationError(403, "SITE_DENIED");
  if (identity.sessionGeneration !== identity.tokenGeneration) {
    throw new NewsletterStaffAuthorizationError(401, "SESSION_REVOKED");
  }
  if (input.mutation) {
    if (identity.role !== "owner") throw new NewsletterStaffAuthorizationError(403, "OWNER_REQUIRED");
    const suppliedOrigin = request.headers.get("origin");
    if (suppliedOrigin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") !== "same-origin") {
      throw new NewsletterStaffAuthorizationError(403, "ORIGIN_REJECTED");
    }
    if (!equal(identity.csrfToken ?? "", request.headers.get("x-builder-csrf"))) {
      throw new NewsletterStaffAuthorizationError(403, "CSRF_REJECTED");
    }
  }
  return identity;
}
