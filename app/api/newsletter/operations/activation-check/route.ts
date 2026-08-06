import { inspectNewsletterBroadcast } from "../../../../../lib/newsletter/broadcast-operations";
import { createNewsletterBroadcastRepository } from "../../../../../lib/newsletter/broadcast-repository";
import { createSupabaseNewsletterAuditData } from "../../../../../lib/newsletter/job-repository";
import {
  authorizeNewsletterOperation,
  newsletterOperationBody,
  newsletterOperationError,
  requireReadyNewsletterConfiguration
} from "../../../../../lib/newsletter/operations-route";
import { createProductionNewsletterBroadcastProvider, createProductionNewsletterContactProvider } from "../../../../../lib/newsletter/resend/client";
import { getBuilderAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await authorizeNewsletterOperation(request, true);
    const body = await newsletterOperationBody(request, ["broadcastId"]);
    const broadcastId = String(body.broadcastId ?? "");
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(broadcastId)) throw new TypeError("Invalid Broadcast ID");
    const configuration = requireReadyNewsletterConfiguration();
    const key = process.env.RESEND_MANAGEMENT_API_KEY!;
    const client = getBuilderAdminClient();
    if (!client) throw new Error("newsletter database unavailable");
    const audit = createSupabaseNewsletterAuditData(client, identity.siteId);
    const result = await inspectNewsletterBroadcast(createProductionNewsletterBroadcastProvider(key), {
      broadcastId,
      segmentId: configuration.segmentId,
      topicId: configuration.topicId,
      reconcile: () => audit.segmentReconcile(
        createProductionNewsletterContactProvider(key),
        configuration.topicId,
        configuration.segmentId
      )
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
