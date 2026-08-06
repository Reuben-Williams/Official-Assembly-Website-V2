import { createHash } from "node:crypto";
import { Resend } from "resend";

import { digestNewsletterBroadcast } from "../../../../lib/newsletter/broadcast-digest";
import { createNewsletterBroadcastRepository } from "../../../../lib/newsletter/broadcast-repository";
import { createProductionNewsletterBroadcastProvider } from "../../../../lib/newsletter/resend/client";
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
  const broadcasts = process.env.RESEND_MANAGEMENT_API_KEY
    ? createProductionNewsletterBroadcastProvider(process.env.RESEND_MANAGEMENT_API_KEY)
    : null;
  const operations = createNewsletterBroadcastRepository(client, siteId);
  return handleResendNewsletterWebhook(request, {
    siteId,
    providerScopeId: "resend-team-production",
    verify: (input) => resend.webhooks.verify({ ...input, webhookSecret }),
    classify: async (event) => {
      if (!event.providerBroadcastId) {
        return {
          disposition: "matched" as const,
          digest: createHash("sha256")
            .update(`${event.eventType}\n${event.providerMessageId ?? event.svixId}`)
            .digest("hex")
        };
      }
      if (!broadcasts) throw new Error("provider read unavailable");
      const snapshot = await broadcasts.get(event.providerBroadcastId);
      const digest = digestNewsletterBroadcast(snapshot);
      if (snapshot.status === "draft" && snapshot.scheduledAt === null && snapshot.sentAt === null) {
        const allowlist: unknown = JSON.parse(process.env.NEWSLETTER_TEST_RECIPIENTS ?? "[]");
        if (!Array.isArray(allowlist) || !event.recipient ||
            !allowlist.some((value) => typeof value === "string" && value.toLowerCase() === event.recipient)) {
          return {
            disposition: "incident" as const,
            providerBroadcastId: snapshot.id,
            digest,
            incidentReason: "unvalidated" as const,
            providerStatus: snapshot.status
          };
        }
        const recipientFingerprint = createHash("sha256")
          .update(allowlist.map((value) => String(value).toLowerCase()).sort().join("\n"))
          .digest("hex");
        const windowId = await operations.findOpenStaffTestWindow({
          providerBroadcastId: snapshot.id,
          digest,
          recipientFingerprint
        });
        if (!windowId || !event.providerMessageId) throw new Error("staff test window unavailable");
        await operations.recordStaffTestObservation({
          siteId,
          windowId,
          providerMessageId: event.providerMessageId,
          providerBroadcastId: snapshot.id,
          digest,
          recipientFingerprint,
          providerStatus: snapshot.status
        });
        return {
          disposition: "matched" as const,
          providerBroadcastId: snapshot.id,
          digest,
          providerStatus: snapshot.status
        };
      }
      if (snapshot.status === "queued" && snapshot.sentAt === null) {
        throw new Error("provider timing pending");
      }
      if (snapshot.status === "sent" && snapshot.sentAt) {
        return {
          disposition: "matched" as const,
          providerBroadcastId: snapshot.id,
          digest,
          providerStatus: snapshot.status,
          sentAt: snapshot.sentAt,
          validationId: await operations.findCurrentValidation(snapshot.id, digest) ?? undefined,
          classificationRequested: true
        };
      }
      return {
        disposition: "incident" as const,
        providerBroadcastId: snapshot.id,
        digest,
        incidentReason: "unvalidated" as const,
        providerStatus: snapshot.status
      };
    },
    reconcile: repository.reconcile
  });
}
