import {
  createCustomerDeletionRouteHandler,
  createCustomerProfileUpdateRouteHandler,
  createLeadAssignmentRouteHandler,
  createLeadNoteRouteHandler,
  createLeadPriorityRouteHandler,
  createLeadStatusRouteHandler,
  createManualLeadRouteHandler,
  createSubmissionRestoreRouteHandler,
  createSubmissionSpamRouteHandler
} from "@reuben-williams/next/operations/server";
import {
  createCustomerDetailQueryRouteHandler,
  createCustomerListQueryRouteHandler,
  createDashboardFactsQueryRouteHandler,
  createFormSubmissionDetailQueryRouteHandler,
  createFormSubmissionListQueryRouteHandler,
  createLeadDetailQueryRouteHandler,
  createLeadListQueryRouteHandler
} from "@reuben-williams/next/queries/server";

import { createGrowthOperationalDependencies, createGrowthQueryDependencies } from "../../../../lib/growth/server";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable(status = 503, code = "GROWTH_UNAVAILABLE") {
  return Response.json(
    { error: { code, message: "The production data service is temporarily unavailable." } },
    { status, headers: { "cache-control": "no-store" } }
  );
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const admin = getBuilderAdminClient();
  if (!admin) return unavailable();
  const siteId = await resolveBuilderSiteId(admin);
  if (!siteId) return unavailable();
  const { path } = await context.params;
  const key = path.join("/");
  const query = createGrowthQueryDependencies(admin, siteId);
  const operations = createGrowthOperationalDependencies(admin, siteId);

  if (key === "queries/leads") return createLeadListQueryRouteHandler(query).handle(request);
  if (key === "queries/customers") return createCustomerListQueryRouteHandler(query).handle(request);
  if (key === "queries/dashboard") return createDashboardFactsQueryRouteHandler(query).handle(request);
  if (key === "queries/submissions") return createFormSubmissionListQueryRouteHandler(query).handle(request);
  if (path[0] === "queries" && path[1] === "leads" && path[2]) {
    return createLeadDetailQueryRouteHandler(query).handle(request, { leadId: path[2] });
  }
  if (path[0] === "queries" && path[1] === "customers" && path[2]) {
    return createCustomerDetailQueryRouteHandler(query).handle(request, { customerId: path[2] });
  }
  if (path[0] === "queries" && path[1] === "submissions" && path[2]) {
    return createFormSubmissionDetailQueryRouteHandler(query).handle(request, { submissionId: path[2] });
  }

  if (key === "operations/leads/manual") return createManualLeadRouteHandler(operations).handle(request);
  if (path[0] === "operations" && path[1] === "leads" && path[2]) {
    const params = { leadId: path[2] };
    if (path[3] === "status") return createLeadStatusRouteHandler(operations).handle(request, params);
    if (path[3] === "priority") return createLeadPriorityRouteHandler(operations).handle(request, params);
    if (path[3] === "assignment") return createLeadAssignmentRouteHandler(operations).handle(request, params);
    if (path[3] === "note") return createLeadNoteRouteHandler(operations).handle(request, params);
  }
  if (path[0] === "operations" && path[1] === "submissions" && path[2]) {
    const params = { submissionId: path[2] };
    if (path[3] === "spam") return createSubmissionSpamRouteHandler(operations).handle(request, params);
    if (path[3] === "restore") return createSubmissionRestoreRouteHandler(operations).handle(request, params);
  }
  if (path[0] === "operations" && path[1] === "customers" && path[2]) {
    const params = { customerId: path[2] };
    if (path[3] === "profile") return createCustomerProfileUpdateRouteHandler(operations).handle(request, params);
    if (path[3] === "deletion") return createCustomerDeletionRouteHandler(operations).handle(request, params);
  }

  return unavailable(404, "GROWTH_ROUTE_NOT_FOUND");
}
