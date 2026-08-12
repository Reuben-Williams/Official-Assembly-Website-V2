import {
  authorizeNewsletterOperation,
  newsletterOperationBody,
  newsletterOperationCommandId,
  newsletterOperationError
} from "../../../../../lib/newsletter/operations-route";
import { createSupabaseNewsletterOwnerLoginData } from "../../../../../lib/newsletter/owner-login-repository";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, true, true);
    const body = await newsletterOperationBody(request, ["commandId"]);
    const commandId = newsletterOperationCommandId(body.commandId);
    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter owner login recovery database unavailable");

    const result = await createSupabaseNewsletterOwnerLoginData(
      client,
      identity.siteId
    ).requeue({
      commandId,
      operatorId: identity.userId
    });
    return Response.json({
      state: result.status,
      queuedCount: result.queuedCount
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({
      event: "newsletter_owner_login_recovery_failed",
      code: error instanceof TypeError ? "invalid_request" : "recovery_unavailable"
    }));
    return newsletterOperationError(error);
  }
}
