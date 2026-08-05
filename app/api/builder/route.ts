import type { BuilderRouteOperation } from "@reuben-williams/next/routes";

import site from "../../../builder.config";
import {
  allowedBuilderOrigins,
  authorizeBuilderRequest
} from "../../../lib/builder/authorization";
import { authenticateBuilderRequest } from "../../../lib/builder/request-auth";
import {
  createSecuredBuilderHandlers,
  createSiteKeyResolvingAdapter
} from "../../../lib/builder/repositories";
import { getBuilderAdminClient } from "../../../lib/supabase/admin";

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
    }
  });
}

export async function GET(request: Request) {
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
