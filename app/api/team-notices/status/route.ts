import { authorizeNewsletterOperation, newsletterOperationBody, newsletterOperationError, newsletterOperationCommandId } from "../../../../lib/newsletter/operations-route";
import { getBuilderAdminClient } from "../../../../lib/supabase/admin";
import { teamNoticeRpc } from "../../../../lib/team-notices/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, false, true);
    const client = getBuilderAdminClient(); if (!client) throw new Error("notice service unavailable");
    const status = await teamNoticeRpc(client, identity.siteId, "status");
    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch (error) { return newsletterOperationError(error); }
}
export async function POST(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, true, true);
    const body = await newsletterOperationBody(request, ["jobId"]);
    const jobId = newsletterOperationCommandId(body.jobId);
    const client = getBuilderAdminClient(); if (!client) throw new Error("notice service unavailable");
    const result = await teamNoticeRpc(client, identity.siteId, "investigate", { jobId, actorId: identity.userId });
    return Response.json({ recorded: Boolean(result), result }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return newsletterOperationError(error); }
}
