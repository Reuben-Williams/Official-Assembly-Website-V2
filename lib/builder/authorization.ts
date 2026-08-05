import {
  canBuilderRole,
  type BuilderCapability,
  type BuilderRole
} from "@reuben-williams/core";
import {
  verifyPreviewCsrf,
  type BuilderMembership
} from "@reuben-williams/next/auth";
import type { BuilderRouteOperation } from "@reuben-williams/next/routes";
import type { SupabaseClient } from "@supabase/supabase-js";

export const BUILDER_SITE_KEY = "official-assembly-website-v2";

const OPERATION_CAPABILITIES: Record<Exclude<BuilderRouteOperation, "content.readPublished">, BuilderCapability> = {
  "content.readDraft": "preview.read",
  "content.editDraft": "post.editDraft",
  "content.publish": "post.publish",
  "history.read": "history.read",
  "history.rollback": "post.rollback",
  "media.read": "preview.read",
  "media.create": "media.upload"
};

const STATE_CHANGING = new Set<BuilderRouteOperation>([
  "content.editDraft",
  "content.publish",
  "history.rollback",
  "media.create"
]);

export class BuilderAuthorizationError extends Error {
  constructor(
    readonly code:
      | "AUTH_REQUIRED"
      | "AUTH_SESSION_REVOKED"
      | "CSRF_REJECTED"
      | "ORIGIN_REJECTED"
      | "ROLE_DENIED"
      | "SITE_ACCESS_DENIED",
    readonly status: 401 | 403,
    message: string
  ) {
    super(message);
    this.name = "BuilderAuthorizationError";
  }
}

export type ActiveBuilderIdentity = {
  userId: string;
  role: BuilderRole;
  siteKey: string;
  siteId: string;
  sessionGeneration: number;
  tokenGeneration: number;
  csrfToken?: string;
};

export function isSafeReturnPath(value: string): boolean {
  return /^\/(?!\/)[^\\\s]*$/.test(value);
}

export function allowedBuilderOrigins(requestOrigin?: string): string[] {
  const configured = [
    process.env.NEXT_PUBLIC_SITE_URL,
    ...(process.env.BUILDER_ALLOWED_ORIGINS?.split(",") ?? [])
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });

  if (process.env.NODE_ENV !== "production") {
    configured.push("http://localhost:3000", "http://127.0.0.1:3000");
    if (requestOrigin?.startsWith("http://localhost:")) configured.push(requestOrigin);
  }

  return [...new Set(configured)];
}

export function assertRequestOrigin(request: Request, allowedOrigins: readonly string[]): void {
  const supplied = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!supplied || (fetchSite !== null && fetchSite !== "same-origin")) {
    throw new BuilderAuthorizationError("ORIGIN_REJECTED", 403, "The request origin is not allowed.");
  }

  let origin: string;
  try {
    const parsed = new URL(supplied);
    if (parsed.origin !== supplied || !["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid");
    origin = parsed.origin;
  } catch {
    throw new BuilderAuthorizationError("ORIGIN_REJECTED", 403, "The request origin is not allowed.");
  }

  if (!allowedOrigins.includes(origin)) {
    throw new BuilderAuthorizationError("ORIGIN_REJECTED", 403, "The request origin is not allowed.");
  }
}

export function roleCanPerformBuilderOperation(role: BuilderRole, operation: BuilderRouteOperation): boolean {
  if (operation === "content.readPublished") return true;
  return canBuilderRole(role, OPERATION_CAPABILITIES[operation]);
}

export async function authorizeBuilderRequest(input: {
  request: Request;
  operation: BuilderRouteOperation;
  allowedOrigins: readonly string[];
  authenticate: () => Promise<ActiveBuilderIdentity | null>;
}): Promise<ActiveBuilderIdentity | null> {
  if (input.operation === "content.readPublished") return null;
  if (STATE_CHANGING.has(input.operation)) assertRequestOrigin(input.request, input.allowedOrigins);

  const identity = await input.authenticate();
  if (!identity) {
    throw new BuilderAuthorizationError("AUTH_REQUIRED", 401, "A verified editor session is required.");
  }
  if (identity.siteKey !== BUILDER_SITE_KEY) {
    throw new BuilderAuthorizationError("SITE_ACCESS_DENIED", 403, "This account cannot access this site.");
  }
  if (identity.sessionGeneration !== identity.tokenGeneration) {
    throw new BuilderAuthorizationError(
      "AUTH_SESSION_REVOKED",
      401,
      "The editor session is no longer active."
    );
  }
  if (!roleCanPerformBuilderOperation(identity.role, input.operation)) {
    throw new BuilderAuthorizationError("ROLE_DENIED", 403, "This account cannot perform that action.");
  }
  if (STATE_CHANGING.has(input.operation)) {
    try {
      verifyPreviewCsrf(identity.csrfToken ?? "", input.request.headers.get("x-builder-csrf"));
    } catch {
      throw new BuilderAuthorizationError("CSRF_REJECTED", 403, "The request could not be verified.");
    }
  }
  return identity;
}

export async function lookupBuilderMembership(
  client: SupabaseClient,
  siteKey: string,
  userId: string
): Promise<BuilderMembership | null> {
  const siteResult = await client.from("builder_sites").select("id, site_key").eq("site_key", siteKey).maybeSingle();
  if (siteResult.error || !siteResult.data) return null;
  const siteId = String(siteResult.data.id ?? "");
  if (!siteId) return null;

  const memberResult = await client
    .from("builder_site_members")
    .select("user_id, role, session_generation")
    .eq("site_id", siteId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memberResult.error || !memberResult.data) return null;
  const role = memberResult.data.role;
  if (!["owner", "editor", "contributor", "viewer"].includes(String(role))) return null;

  return {
    siteId,
    siteKey,
    userId,
    email: null,
    role: role as BuilderRole,
    previewGeneration: Number(memberResult.data.session_generation)
  };
}
