import { validateNewsletterBroadcast } from "../../../../../lib/newsletter/broadcast-operations";
import { createNewsletterBroadcastRepository } from "../../../../../lib/newsletter/broadcast-repository";
import { createSupabaseNewsletterReconciliationRequestRepository } from "../../../../../lib/newsletter/job-repository";
import {
  authorizeNewsletterOperation,
  newsletterOperationBody,
  newsletterOperationError,
  requireReadyNewsletterConfiguration
} from "../../../../../lib/newsletter/operations-route";
import { createProductionNewsletterBroadcastProvider } from "../../../../../lib/newsletter/resend/client";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, true);
    const body = await newsletterOperationBody(request, ["broadcastId", "commandId", "confirmedTestObservationId"]);
    const broadcastId = String(body.broadcastId ?? "");
    const commandId = String(body.commandId ?? "");
    const observationId = String(body.confirmedTestObservationId ?? "");
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(broadcastId) ||
        !/^[0-9a-f-]{36}$/i.test(commandId) || !/^[0-9a-f-]{36}$/i.test(observationId)) {
      throw new TypeError("Invalid validation request");
    }
    const configuration = requireReadyNewsletterConfiguration();
    const key = process.env.RESEND_MANAGEMENT_API_KEY!;
    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter database unavailable");
    const repository = createNewsletterBroadcastRepository(client, identity.siteId);
    if ((await repository.status()).openIncidents > 0) throw new Error("newsletter incident lockout");
    const readiness = await createSupabaseNewsletterReconciliationRequestRepository(client, identity.siteId)
      .request({ commandId, operation: "validate" });
    if (readiness.status !== "ready") {
      return Response.json({ state: readiness.status, commandId }, {
        status: readiness.status === "pending" ? 202 : 409,
        headers: { "cache-control": "no-store" }
      });
    }
    const result = await validateNewsletterBroadcast(createProductionNewsletterBroadcastProvider(key), {
      siteId: identity.siteId,
      commandId,
      operatorId: identity.userId,
      broadcastId,
      segmentId: configuration.segmentId,
      topicId: configuration.topicId,
      confirmedTestObservationId: observationId,
      readiness,
      createValidation: repository.createValidation
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return newsletterOperationError(error);
  }
}
