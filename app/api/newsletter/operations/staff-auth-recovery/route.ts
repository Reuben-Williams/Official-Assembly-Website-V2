import { authorizeNewsletterOperation, newsletterOperationBody, newsletterOperationCommandId, newsletterOperationError } from "../../../../../lib/newsletter/operations-route";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, true, true);
    const body = await newsletterOperationBody(request, ["requestId", "commandId"]);
    const client = getBuilderAdminClient(); if (!client) throw new Error("unavailable");
    const result = await client.rpc("builder_staff_auth_recover", { p_site_id: identity.siteId, p_owner_id: identity.userId,
      p_request_id: newsletterOperationCommandId(body.requestId), p_command_id: newsletterOperationCommandId(body.commandId) });
    if (result.error) throw new Error("unavailable");
    return Response.json({ status: result.data }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return newsletterOperationError(error); }
}
