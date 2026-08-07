import { inspectNewsletterBroadcast } from "../../../../../lib/newsletter/broadcast-operations";
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
    const body = await newsletterOperationBody(request, ["broadcastId", "commandId"]);
    const broadcastId = String(body.broadcastId ?? "");
    const commandId = String(body.commandId ?? "");
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(broadcastId) || !/^[0-9a-f-]{36}$/i.test(commandId)) {
      throw new TypeError("Invalid activation check");
    }
    const configuration = requireReadyNewsletterConfiguration();
    const key = process.env.RESEND_MANAGEMENT_API_KEY!;
    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter database unavailable");
    const readiness = await createSupabaseNewsletterReconciliationRequestRepository(client, identity.siteId)
      .request({ commandId, operation: "activation_check" });
    if (readiness.status !== "ready") {
      return Response.json({ state: readiness.status, commandId }, {
        status: readiness.status === "pending" ? 202 : 409,
        headers: { "cache-control": "no-store" }
      });
    }
    const result = await inspectNewsletterBroadcast(createProductionNewsletterBroadcastProvider(key), {
      broadcastId,
      segmentId: configuration.segmentId,
      topicId: configuration.topicId,
      readiness
    });
    return Response.json({
      state: result.state,
      broadcastId: result.broadcastId,
      digest: result.digest,
      audienceCount: result.audienceCount,
      readinessRevisionId: result.readinessRevisionId
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return newsletterOperationError(error);
  }
}
