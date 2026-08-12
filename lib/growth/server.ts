import "server-only";

import type { GrowthCapability } from "@reuben-williams/core";
import { verifyPreviewCsrf } from "@reuben-williams/next/auth";
import {
  OperationalAuthorizationError,
  createSupabaseOperationalPersistence,
  type OperationalAuthorizationRequirement,
  type OperationalAuthorizer,
  type OperationalRouteDependencies,
  type TrustedAuthenticatedUserContext,
  type TrustedOperationalContext
} from "@reuben-williams/next/operations/server";
import {
  QueryAuthorizationError,
  createSupabaseQueryPersistence,
  type QueryAuthorizationRequirement,
  type QueryAuthorizer,
  type QueryRouteDependencies,
  type TrustedQueryAuthorizationContext
} from "@reuben-williams/next/queries/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { authenticateBuilderRequest } from "../builder/request-auth";
import type { ActiveBuilderIdentity } from "../builder/authorization";

export class GrowthMutationCsrfError extends Error {
  readonly code = "CSRF_REJECTED";
  readonly status = 403;

  constructor() {
    super("The growth operation could not be verified.");
    this.name = "GrowthMutationCsrfError";
  }
}

export function verifyGrowthMutationCsrf(
  identity: ActiveBuilderIdentity,
  suppliedToken: string | null
): void {
  try {
    verifyPreviewCsrf(identity.csrfToken ?? "", suppliedToken);
  } catch {
    throw new GrowthMutationCsrfError();
  }
}

const CAPABILITY_MODULE: Partial<Record<GrowthCapability, "growth.dashboard" | "growth.leads" | "growth.customers">> = {
  "dashboard.read": "growth.dashboard",
  "leads.read": "growth.leads",
  "leads.create": "growth.leads",
  "leads.update": "growth.leads",
  "leads.assign": "growth.leads",
  "leads.export": "growth.leads",
  "customers.read": "growth.customers",
  "customers.update": "growth.customers",
  "customers.export": "growth.customers",
  "customers.deleteRequest": "growth.customers"
};

type GrowthModuleState = {
  setup_status?: string | null;
  entitlement_state?: string | null;
  disabled_by_default?: boolean | null;
};

export function isGrowthModuleOperational(state: GrowthModuleState | null | undefined): boolean {
  return state?.setup_status === "configured"
    && state.entitlement_state === "active"
    && state.disabled_by_default === true;
}

async function entitlementIsCurrent(client: SupabaseClient, siteId: string, capability?: GrowthCapability) {
  const moduleId = capability ? CAPABILITY_MODULE[capability] : undefined;
  if (!moduleId) return true;
  const { data, error } = await client
    .from("builder_module_configurations")
    .select("setup_status, entitlement_state, disabled_by_default")
    .eq("site_id", siteId)
    .eq("module_id", moduleId)
    .maybeSingle();
  return !error && isGrowthModuleOperational(data);
}

async function capabilityScope(client: SupabaseClient, input: {
  memberId: string;
  role: "owner" | "editor" | "contributor" | "viewer";
  siteId: string;
  capability?: GrowthCapability;
  allowedScopes: readonly ("site" | "assigned")[];
}) {
  if (!input.capability) return input.allowedScopes.includes("site") ? "site" as const : input.allowedScopes[0];
  if (input.role === "owner") return input.allowedScopes.includes("site") ? "site" as const : input.allowedScopes[0];
  const { data, error } = await client
    .from("builder_member_capabilities")
    .select("scope")
    .eq("site_id", input.siteId)
    .eq("member_id", input.memberId)
    .eq("capability", input.capability);
  if (error) return undefined;
  if (input.allowedScopes.includes("site") && data?.some((row) => row.scope === "site")) return "site" as const;
  if (input.allowedScopes.includes("assigned") && data?.some((row) => row.scope === "assigned")) return "assigned" as const;
  return undefined;
}

async function identityForRequirement(client: SupabaseClient, request: Request, requirement: {
  siteId: string;
  capability?: GrowthCapability;
  allowedRoles?: readonly ("owner" | "editor" | "contributor" | "viewer")[];
  allowedScopes: readonly ("site" | "assigned")[];
}) {
  const identity = await authenticateBuilderRequest(request);
  if (!identity) return { error: "AUTH_REQUIRED" as const };
  if (identity.siteId !== requirement.siteId) return { error: "SITE_ACCESS_DENIED" as const };
  if (requirement.allowedRoles && !requirement.allowedRoles.includes(identity.role)) {
    return { error: "OPERATION_DENIED" as const };
  }
  const scope = await capabilityScope(client, {
    memberId: identity.userId,
    role: identity.role,
    siteId: identity.siteId,
    capability: requirement.capability,
    allowedScopes: requirement.allowedScopes
  });
  if (!scope) return { error: "OPERATION_DENIED" as const };
  const current = await entitlementIsCurrent(client, identity.siteId, requirement.capability);
  return { identity, scope, current };
}

export async function authorizeGrowthMutationRequest(request: Request): Promise<Response | null> {
  const identity = await authenticateBuilderRequest(request);
  if (!identity) {
    return Response.json(
      { error: { code: "AUTH_REQUIRED", message: "A verified member session is required." } },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }
  try {
    verifyGrowthMutationCsrf(identity, request.headers.get("x-builder-csrf"));
    return null;
  } catch (error) {
    if (error instanceof GrowthMutationCsrfError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status, headers: { "cache-control": "no-store" } }
      );
    }
    throw error;
  }
}

export function createGrowthQueryDependencies(client: SupabaseClient, siteId: string): QueryRouteDependencies {
  const authorizer: QueryAuthorizer = {
    async authorize(request: Request, requirement: QueryAuthorizationRequirement): Promise<TrustedQueryAuthorizationContext> {
      const resolved = await identityForRequirement(client, request, requirement);
      if ("error" in resolved) {
        const code = resolved.error ?? "AUTH_REQUIRED";
        throw new QueryAuthorizationError(code === "OPERATION_DENIED" ? "QUERY_DENIED" : code);
      }
      return {
        siteId,
        memberId: resolved.identity.userId,
        role: resolved.identity.role,
        scope: resolved.scope,
        entitlementVerification: resolved.current ? "current" : "missing"
      };
    },
    async requireRecentAal2() {
      throw new QueryAuthorizationError("AAL2_REQUIRED");
    }
  };
  return { siteId, authorizer, persistence: createSupabaseQueryPersistence(client), now: () => new Date() };
}

export function createGrowthOperationalDependencies(client: SupabaseClient, siteId: string): OperationalRouteDependencies {
  const authorizer: OperationalAuthorizer = {
    async authorize(request: Request, requirement: OperationalAuthorizationRequirement): Promise<TrustedOperationalContext> {
      const resolved = await identityForRequirement(client, request, requirement);
      if ("error" in resolved) throw new OperationalAuthorizationError(resolved.error ?? "AUTH_REQUIRED");
      return {
        siteId,
        memberId: resolved.identity.userId,
        role: resolved.identity.role,
        scope: resolved.scope,
        entitlementVerification: resolved.current ? "current" : "missing",
        entitlementMode: "operational_write"
      };
    },
    async requireRecentAal2() {
      throw new OperationalAuthorizationError("AAL2_REQUIRED");
    },
    async requireAuthenticatedUser(request, requirement): Promise<TrustedAuthenticatedUserContext> {
      const identity = await authenticateBuilderRequest(request);
      if (!identity) throw new OperationalAuthorizationError("AUTH_REQUIRED");
      if (identity.siteId !== requirement.siteId) throw new OperationalAuthorizationError("SITE_ACCESS_DENIED");
      return {
        siteId,
        userId: identity.userId,
        email: null,
        entitlementVerification: await entitlementIsCurrent(client, siteId) ? "current" : "missing",
        entitlementMode: requirement.entitlementMode
      };
    }
  };
  return {
    siteId,
    allowedServices: ["Constituent services", "Community inquiry", "Legislative inquiry", "District office request"],
    authorizer,
    persistence: createSupabaseOperationalPersistence(client),
    invitationSecrets: {
      async digestCanonicalEmail() { throw new Error("Invitations are not enabled in this release."); },
      async generateToken() { throw new Error("Invitations are not enabled in this release."); },
      async hashToken() { throw new Error("Invitations are not enabled in this release."); }
    },
    now: () => new Date()
  };
}
