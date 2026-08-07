import { authorizeNewsletterOperation, newsletterOperationBody, newsletterOperationCommandId, newsletterOperationError, newsletterOperationReason } from "../../../../../lib/newsletter/operations-route";
import { createNewsletterProviderOperationsRepository } from "../../../../../lib/newsletter/provider-operations-repository";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, true, true);
    const body = await newsletterOperationBody(request, ["commandId", "reason"]);
    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter database unavailable");
    const result = await createNewsletterProviderOperationsRepository(
      client,
      identity.siteId
    ).recover({
      commandId: newsletterOperationCommandId(body.commandId),
      operatorId: identity.userId,
      reason: newsletterOperationReason(body.reason)
    });
    return Response.json({
      state: result.status === "queued" ? "queued" : "unavailable",
      replayed: result.replayed === true
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return newsletterOperationError(error);
  }
}
