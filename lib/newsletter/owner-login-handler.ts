import "server-only";

import {
  collectNewsletterOwnerLoginEmails,
  createNewsletterAuthLoginEvidenceCommandId,
  createNewsletterAuthLoginEvidenceDigest,
  selectNewsletterOwnerLoginMessage,
  type NewsletterOwnerLoginEmailReader
} from "./owner-login-evidence";
import type { NewsletterClaimedJob } from "./worker";
import { NewsletterJobFailure } from "./worker";

export interface NewsletterOwnerLoginReconciliationData {
  hasEvidence(occurrenceId: string): Promise<boolean>;
  ownerEmail(operatorId: string): Promise<string>;
  excludedProviderMessageIds(): Promise<ReadonlySet<string>>;
  recordEvidence(input: {
    readonly commandId: string;
    readonly occurrenceId: string;
    readonly operatorId: string;
    readonly providerMessageId: string;
    readonly providerCreatedAt: string;
    readonly authLastSignInAt: string;
    readonly evidenceDigest: string;
  }): Promise<{ readonly status: "recorded" | "already_recorded" }>;
}

export function createNewsletterOwnerLoginReconciliationHandler(input: {
  readonly siteId: string;
  readonly provider: NewsletterOwnerLoginEmailReader;
  readonly data: NewsletterOwnerLoginReconciliationData;
}) {
  return async (job: NewsletterClaimedJob) => {
    if (
      job.kind !== "newsletter.auth_login.reconcile" ||
      typeof job.occurrenceId !== "string" ||
      typeof job.operatorId !== "string" ||
      typeof job.authLastSignInAt !== "string" ||
      !Number.isFinite(Date.parse(job.authLastSignInAt))
    ) {
      throw new NewsletterJobFailure("invalid_job", true);
    }

    try {
      if (await input.data.hasEvidence(job.occurrenceId)) {
        return { code: "owner_login_evidence_recorded", alreadyCompleted: false };
      }
      const [ownerEmail, excludedProviderMessageIds, emails] = await Promise.all([
        input.data.ownerEmail(job.operatorId),
        input.data.excludedProviderMessageIds(),
        collectNewsletterOwnerLoginEmails(input.provider, {
          occurredAt: new Date(job.authLastSignInAt)
        })
      ]);
      const providerMessage = selectNewsletterOwnerLoginMessage(emails, {
        ownerEmail,
        occurredAt: job.authLastSignInAt,
        excludedProviderMessageIds
      });
      if (!providerMessage) {
        throw new NewsletterJobFailure("owner_login_evidence_pending", false);
      }

      await input.data.recordEvidence({
        commandId: createNewsletterAuthLoginEvidenceCommandId({
          siteId: input.siteId,
          occurrenceId: job.occurrenceId,
          providerMessageId: providerMessage.id
        }),
        occurrenceId: job.occurrenceId,
        operatorId: job.operatorId,
        providerMessageId: providerMessage.id,
        providerCreatedAt: providerMessage.createdAt,
        authLastSignInAt: job.authLastSignInAt,
        evidenceDigest: createNewsletterAuthLoginEvidenceDigest({
          siteId: input.siteId,
          operatorId: job.operatorId,
          occurrenceId: job.occurrenceId,
          providerMessageId: providerMessage.id,
          providerCreatedAt: providerMessage.createdAt,
          authLastSignInAt: job.authLastSignInAt
        })
      });
      return { code: "owner_login_evidence_recorded", alreadyCompleted: false };
    } catch (error) {
      if (error instanceof NewsletterJobFailure) throw error;
      throw new NewsletterJobFailure("owner_login_evidence_pending", false);
    }
  };
}
