import { Resend } from "resend";

import { handleResendNewsletterWebhook } from "../../../../lib/newsletter/webhook";
import { createNewsletterWebhookRepository } from "../../../../lib/newsletter/webhook-repository";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const client = getBuilderAdminClient();
  if (!webhookSecret || !client) {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const siteId = await resolveBuilderSiteId(client);
  if (!siteId) {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const resend = new Resend();
  const repository = createNewsletterWebhookRepository(client);
  return handleResendNewsletterWebhook(request, {
    siteId,
    providerScopeId: "resend-team-production",
    verify: (input) => resend.webhooks.verify({ ...input, webhookSecret }),
    classify: async () => {
      // Relevant events require provider read-through before a receipt can be
      // committed. Broadcast/Contact classification is supplied by the
      // operations layer and fails retryably until that read succeeds.
      throw new Error("provider read unavailable");
    },
    reconcile: repository.reconcile
  });
}
