import type { BuilderRouteOperation } from "@reuben-williams/next/routes";

import site from "../../../builder.config";
import {
  BuilderAuthorizationError,
  allowedBuilderOrigins,
  authorizeBuilderRequest
} from "../../../lib/builder/authorization";
import {
  createHistoryResponseV1,
  createSupabaseHistoryReadersV1,
} from "../../../lib/builder/history";
import { authenticateBuilderRequest } from "../../../lib/builder/request-auth";
import {
  createSecuredBuilderHandlers,
  createSupabaseContentCommandExecutor,
  createSiteKeyResolvingAdapter
} from "../../../lib/builder/repositories";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable() {
  return Response.json(
    { error: { code: "BUILDER_UNAVAILABLE", message: "The editor data service is unavailable." } },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}

function createHandlers(request: Request) {
  const admin = getBuilderAdminClient();
  if (!admin) return null;
  const adapter = createSiteKeyResolvingAdapter({ client: admin, siteKey: site.siteId });
  return createSecuredBuilderHandlers({
    site,
    adapter,
    contentCommands: createSupabaseContentCommandExecutor(admin),
    authorize: async (authorizedRequest: Request, operation: BuilderRouteOperation) => {
      await authorizeBuilderRequest({
        request: authorizedRequest,
        operation,
        allowedOrigins: allowedBuilderOrigins(new URL(request.url).origin),
        authenticate: () => authenticateBuilderRequest(authorizedRequest)
      });
    },
    getUserId: async (authorizedRequest: Request) => {
      const identity = await authenticateBuilderRequest(authorizedRequest);
      if (!identity) throw new Error("A verified editor identity is required.");
      return identity.userId;
    },
    validateLinkedPost: async (entryId: string) => {
      const siteId = await resolveBuilderSiteId(admin);
      if (!siteId) return false;
      const result = await admin
        .from("builder_public_posts")
        .select("entry_id")
        .eq("site_id", siteId)
        .eq("entry_id", entryId)
        .maybeSingle();
      return !result.error && Boolean(result.data?.entry_id);
    }
  });
}

function historyError(error: unknown) {
  if (error instanceof BuilderAuthorizationError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "cache-control": "no-store" } }
    );
  }
  if (error instanceof TypeError) {
    return Response.json(
      { error: { code: "INVALID_HISTORY_QUERY", message: error.message } },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }
  return Response.json(
    { error: { code: "HISTORY_UNAVAILABLE", message: "Website history is temporarily unavailable." } },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}

async function readUnifiedHistory(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.searchParams.get("resource") !== "history") return null;
  try {
    const admin = getBuilderAdminClient();
    if (!admin) return unavailable();
    const identity = await authorizeBuilderRequest({
      request,
      operation: "history.read",
      allowedOrigins: allowedBuilderOrigins(url.origin),
      authenticate: () => authenticateBuilderRequest(request),
    });
    if (!identity) throw new BuilderAuthorizationError("AUTH_REQUIRED", 401, "A verified editor session is required.");
    return await createHistoryResponseV1({
      request,
      readers: createSupabaseHistoryReadersV1(admin, identity.siteId),
      role: identity.role,
    });
  } catch (error) {
    return historyError(error);
  }
}

export async function GET(request: Request) {
  const history = await readUnifiedHistory(request);
  if (history) return history;
  return createHandlers(request)?.GET(request) ?? unavailable();
}

export async function POST(request: Request) {
  return createHandlers(request)?.POST(request) ?? unavailable();
}

export async function PUT(request: Request) {
  return createHandlers(request)?.PUT(request) ?? unavailable();
}

export async function PATCH(request: Request) {
  return createHandlers(request)?.PATCH(request) ?? unavailable();
}
