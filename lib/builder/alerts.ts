import "server-only";

import type { PublicAlertProjectionV1 } from "@reuben-williams/content";
import {
  createAlertManagementRouteHandlers,
  createPublicAlertsRouteHandler,
  createSupabaseAlertServerRepository,
  loadPublishedAlertsWithRecovery,
  runAlertRecoveryWorkerBatch,
  type AlertRecoveryDigest,
  type AlertRecoveryStore,
  type AlertServerRepository,
} from "@reuben-williams/next/alerts/server";
import { BuilderAuthError, verifyPreviewCsrf } from "@reuben-williams/next/auth";

import {
  BUILDER_SITE_KEY,
  BuilderAuthorizationError,
  allowedBuilderOrigins,
  assertRequestOrigin,
  type ActiveBuilderIdentity,
} from "./authorization";
import { authenticateBuilderRequest } from "./request-auth";
import { getBuilderAdminClient } from "../supabase/admin";
import { isPublicAlertPathname } from "../public-route";
import {
  alertRecoveryDigest,
  createAlertRecoveryStore,
  createVercelBlobObjectStore,
  readRecoveryConfiguration,
} from "./recovery";

type AuthenticateAlertRequest = (request: Request) => Promise<ActiveBuilderIdentity | null>;

export async function resolveLayoutAlertBoundary(input: {
  pathnameHeader: string | null | undefined;
  load: () => Promise<PublicAlertProjectionV1 | null>;
}) {
  if (!isPublicAlertPathname(input.pathnameHeader)) {
    return Object.freeze({ eligible: false as const, projection: null });
  }
  try {
    return Object.freeze({ eligible: true as const, projection: await input.load() });
  } catch {
    return Object.freeze({ eligible: true as const, projection: null });
  }
}

function secured(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function authError(error: unknown): BuilderAuthError {
  if (error instanceof BuilderAuthorizationError) {
    if (error.code === "AUTH_REQUIRED" || error.code === "AUTH_SESSION_REVOKED") {
      return new BuilderAuthError("AUTH_REQUIRED", 401, error.message);
    }
    return new BuilderAuthError("SITE_ACCESS_DENIED", 403, error.message);
  }
  return new BuilderAuthError("AUTH_REQUIRED", 401, "A verified editor session is required.");
}

async function trustedIdentity(
  request: Request,
  authenticate: AuthenticateAlertRequest,
): Promise<ActiveBuilderIdentity> {
  const identity = await authenticate(request);
  if (!identity) throw new BuilderAuthError("AUTH_REQUIRED", 401, "A verified editor session is required.");
  if (identity.siteKey !== BUILDER_SITE_KEY) {
    throw new BuilderAuthError("SITE_ACCESS_DENIED", 403, "This account cannot access this site.");
  }
  if (identity.sessionGeneration !== identity.tokenGeneration) {
    throw new BuilderAuthError("AUTH_REQUIRED", 401, "The editor session is no longer active.");
  }
  return identity;
}

export function createOfficialAssemblyAlertHandlers(input: {
  repository: AlertServerRepository;
  authenticate?: AuthenticateAlertRequest;
  allowedOrigins?: readonly string[];
  environment?: string;
  recovery?: { store: AlertRecoveryStore; digest: AlertRecoveryDigest };
  now?: () => Date;
  createCommandId?: () => string;
}) {
  const authenticate = input.authenticate ?? authenticateBuilderRequest;
  const management = createAlertManagementRouteHandlers({
    repository: input.repository,
    createCommandId: input.createCommandId,
    resolveContext: async (request) => {
      const identity = await trustedIdentity(request, authenticate);
      return {
        siteId: identity.siteId,
        siteKey: BUILDER_SITE_KEY,
        userId: identity.userId,
        email: null,
        role: identity.role,
        previewGeneration: identity.sessionGeneration,
      };
    },
    verifyCsrf: async (request) => {
      try {
        const identity = await trustedIdentity(request, authenticate);
        assertRequestOrigin(
          request,
          input.allowedOrigins ?? allowedBuilderOrigins(new URL(request.url).origin),
        );
        verifyPreviewCsrf(identity.csrfToken ?? "", request.headers.get("x-builder-csrf"));
      } catch (error) {
        if (error instanceof BuilderAuthError) throw error;
        throw authError(error);
      }
    },
  });
  const publicRead = createPublicAlertsRouteHandler({
    repository: input.repository,
    siteKey: BUILDER_SITE_KEY,
    environment: input.environment ?? "production",
    now: input.now,
    recovery: input.recovery,
  });
  const handle = async (request: Request, segments: readonly string[]) =>
    secured(await management.handle(request, segments));

  return Object.freeze({
    read: (request: Request) => handle(request, ["alerts"]),
    initialize: (request: Request) => handle(request, ["alerts", "initialize"]),
    command: (request: Request) => handle(request, ["alerts", "command"]),
    publicRead: async (request: Request) => secured(await publicRead(request)),
  });
}

export function createOfficialAssemblyAlertRepository(): AlertServerRepository | null {
  const client = getBuilderAdminClient();
  return client ? createSupabaseAlertServerRepository(client) : null;
}

export async function loadOfficialAssemblyPublicAlerts(
  evaluatedAt = new Date(),
): Promise<PublicAlertProjectionV1 | null> {
  const repository = createOfficialAssemblyAlertRepository();
  if (!repository) return null;
  let recovery: ReturnType<typeof createOfficialAssemblyAlertRecoveryRuntime> | null = null;
  try {
    recovery = createOfficialAssemblyAlertRecoveryRuntime();
  } catch {
    // Recovery is optional while the authoritative server projection is healthy.
  }
  const result = await loadPublishedAlertsWithRecovery({
    siteKey: BUILDER_SITE_KEY,
    environment: recovery?.environment ?? "production",
    evaluatedAt,
    readAuthoritative: () => repository.readPublishedAlerts(
      BUILDER_SITE_KEY,
      evaluatedAt.toISOString(),
    ),
    recovery: recovery?.recovery,
  });
  return result.projection;
}

export function createOfficialAssemblyAlertRecoveryRuntime(input: {
  environment?: "preview" | "production";
  workerId?: string;
} = {}) {
  const configuration = readRecoveryConfiguration(input.environment);
  const client = getBuilderAdminClient();
  if (!client) throw new Error("Alert recovery database is unavailable.");
  const repository = createSupabaseAlertServerRepository(client);
  const recovery = Object.freeze({
    store: createAlertRecoveryStore(
      createVercelBlobObjectStore({ token: configuration.blobToken }),
    ),
    digest: alertRecoveryDigest,
  });
  const workerId = input.workerId ?? crypto.randomUUID();
  return Object.freeze({
    environment: configuration.environment,
    siteKey: BUILDER_SITE_KEY,
    repository,
    recovery,
    runOnce: () => runAlertRecoveryWorkerBatch({
      repository,
      store: recovery.store,
      digest: recovery.digest,
      environment: configuration.environment,
      workerId,
      claimLimit: 10,
      leaseSeconds: 60,
      now: new Date(),
    }),
  });
}

export function createCombinedRecoveryRunOnce(input: {
  runContentOnce: () => Promise<{ readonly status: string; readonly [key: string]: unknown }>;
  runAlertsOnce: () => Promise<{
    readonly claimed: number;
    readonly completed: number;
    readonly retried: number;
    readonly deadLettered: number;
    readonly staleLeases: number;
  }>;
  runCompositionOnce?: () => Promise<{
    readonly claimed: number;
    readonly completed: number;
    readonly retried: number;
    readonly deadLettered: number;
    readonly staleLeases: number;
  }>;
}) {
  return async () => {
    const content = await input.runContentOnce();
    if (content.status !== "idle") return content;
    const alerts = await input.runAlertsOnce();
    if (alerts.claimed > 0) return { status: "alerts_processed" as const, ...alerts };
    if (!input.runCompositionOnce) return { status: "idle" as const };
    const composition = await input.runCompositionOnce();
    if (composition.claimed === 0) return { status: "idle" as const };
    return { status: "composition_processed" as const, ...composition };
  };
}
