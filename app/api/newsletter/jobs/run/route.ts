import { createNewsletterBroadcastAuditHandler } from "../../../../../lib/newsletter/broadcast-audit";
import { digestNewsletterBroadcast } from "../../../../../lib/newsletter/broadcast-digest";
import { auditNewsletterBroadcastInventory } from "../../../../../lib/newsletter/broadcast-operations";
import { createNewsletterBroadcastRepository } from "../../../../../lib/newsletter/broadcast-repository";
import { readNewsletterConfiguration } from "../../../../../lib/newsletter/config";
import { createNewsletterContactAuditHandler } from "../../../../../lib/newsletter/contact-audit";
import { readNewsletterConfirmationKeyring } from "../../../../../lib/newsletter/confirmation-token";
import { createNewsletterCronHandler } from "../../../../../lib/newsletter/cron-handler";
import { createNewsletterOwnerLoginReconciliationHandler } from "../../../../../lib/newsletter/owner-login-handler";
import { createSupabaseNewsletterOwnerLoginData } from "../../../../../lib/newsletter/owner-login-repository";
import {
  createSupabaseNewsletterAuditData,
  createSupabaseNewsletterJobRepository,
  createSupabaseNewsletterReconciliationData,
  createSupabaseNewsletterSubscriptionJobData
} from "../../../../../lib/newsletter/job-repository";
import {
  createProductionNewsletterContactProvider,
  createProductionNewsletterBroadcastProvider,
  createProductionNewsletterReconciliationProvider,
  createProductionNewsletterSendAdapter
} from "../../../../../lib/newsletter/resend/client";
import { createProductionNewsletterOwnerLoginEmailReader } from "../../../../../lib/newsletter/resend/inventory-adapter";
import { createNewsletterSegmentReconciliationHandler } from "../../../../../lib/newsletter/segment-reconciliation";
import {
  createNewsletterConfirmationJobHandler,
  createNewsletterContactSyncJobHandler
} from "../../../../../lib/newsletter/subscription-jobs";
import { NewsletterJobFailure, runNewsletterWorker } from "../../../../../lib/newsletter/worker";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  return createNewsletterCronHandler({
    secret: process.env.CRON_SECRET,
    workerFactory: async () => {
      const client = getBuilderAdminClient();
      if (!client) throw new Error("newsletter database unavailable");
      const siteId = await resolveBuilderSiteId(client);
      if (!siteId) throw new Error("newsletter site unavailable");
      const configuration = readNewsletterConfiguration();
      const enabled = configuration.status === "ready";
      const repository = createSupabaseNewsletterJobRepository(client, siteId);
      const subscriptionData = createSupabaseNewsletterSubscriptionJobData(client, siteId);
      const workerId = crypto.randomUUID();
      const reconciliationData = createSupabaseNewsletterReconciliationData(client, siteId, workerId);
      const auditData = createSupabaseNewsletterAuditData(client, siteId);
      const broadcastRepository = createNewsletterBroadcastRepository(client, siteId);
      const keyring = readNewsletterConfirmationKeyring();
      const sendKey = process.env.RESEND_SEND_API_KEY;
      const managementKey = process.env.RESEND_MANAGEMENT_API_KEY;
      const ownerLoginData = createSupabaseNewsletterOwnerLoginData(client, siteId);
      const managementProvider = managementKey
        ? createProductionNewsletterContactProvider(managementKey)
        : null;
      const reconciliationProvider = managementKey
        ? createProductionNewsletterReconciliationProvider(managementKey)
        : null;
      const broadcastProvider = managementKey
        ? createProductionNewsletterBroadcastProvider(managementKey)
        : null;
      const unavailable = async () => {
        throw new NewsletterJobFailure("provider_unavailable", false);
      };
      const confirmationSend = enabled && keyring && sendKey
        ? createNewsletterConfirmationJobHandler({
            data: subscriptionData,
            sender: createProductionNewsletterSendAdapter(sendKey),
            keyring: keyring.keys,
            canonicalSiteUrl: configuration.canonicalSiteUrl,
            now: () => new Date()
          })
        : unavailable;
      const contactSync = enabled && managementProvider
        ? createNewsletterContactSyncJobHandler({
            data: subscriptionData,
            provider: managementProvider,
            segmentId: configuration.segmentId,
            topicId: configuration.topicId
          })
        : unavailable;
      const contactAudit = managementProvider && process.env.RESEND_NEWSLETTER_TOPIC_ID && process.env.RESEND_NEWSLETTER_SEGMENT_ID
        ? createNewsletterContactAuditHandler({
            audit: () => auditData.contactAudit(
              managementProvider,
              process.env.RESEND_NEWSLETTER_TOPIC_ID!,
              process.env.RESEND_NEWSLETTER_SEGMENT_ID!
            )
          })
        : unavailable;
      const segmentReconcile = enabled && reconciliationProvider
        ? createNewsletterSegmentReconciliationHandler({
            provider: reconciliationProvider,
            data: reconciliationData,
            topicId: configuration.topicId,
            segmentId: configuration.segmentId
          })
        : unavailable;
      const broadcastAudit = broadcastProvider
        ? createNewsletterBroadcastAuditHandler({
            audit: async (job) => {
              await auditNewsletterBroadcastInventory(broadcastProvider, {
                after: typeof job.afterCursor === "string" ? job.afterCursor : null,
                checkpoint: async (page) => {
                  for (const snapshot of page.broadcasts) {
                    if (snapshot.status === "draft" && snapshot.scheduledAt === null) continue;
                    const digest = digestNewsletterBroadcast(snapshot);
                    await broadcastRepository.classify({
                      providerScopeId: "resend-team-production",
                      providerBroadcastId: snapshot.id,
                      digest,
                      providerStatus: snapshot.status,
                      sentAt: snapshot.sentAt ?? snapshot.createdAt,
                      evidenceSource: "audit",
                      evidenceId: `audit/${job.id}/${page.pageCount}/${snapshot.id}`
                    });
                  }
                  await broadcastRepository.auditCheckpoint({
                    jobId: job.id,
                    workerId,
                    fencingToken: job.fencingToken,
                    hasMore: page.hasMore,
                    after: page.after,
                    pageCount: page.pageCount
                  });
                }
              });
            }
          })
        : unavailable;
      const ownerLoginReconcile = managementKey
        ? createNewsletterOwnerLoginReconciliationHandler({
            siteId,
            provider: createProductionNewsletterOwnerLoginEmailReader(managementKey),
            data: ownerLoginData
          })
        : unavailable;

      return {
        run: async () => {
          await reconciliationData.housekeeping();
          if (enabled) await reconciliationData.schedule();
          return runNewsletterWorker({
            repository,
            handlers: {
              confirmationSend,
              contactSync,
              contactAudit,
              segmentReconcile,
              broadcastAudit,
              ownerLoginReconcile
            },
            workerId,
            emailEnabled: enabled,
            limit: 10,
            now: () => new Date()
          });
        }
      };
    }
  })(request);
}
