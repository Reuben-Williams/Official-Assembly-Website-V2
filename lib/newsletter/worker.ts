import "server-only";

export type NewsletterClaimedJob = {
  readonly subject: "subscription" | "site" | "broadcast";
  readonly id: string;
  readonly kind:
    | "newsletter.confirmation.send"
    | "newsletter.contact.sync"
    | "newsletter.contact.audit"
    | "newsletter.segment.reconcile"
    | "newsletter.broadcast.audit";
  readonly fencingToken: number;
  readonly attemptCount?: number;
  readonly [key: string]: unknown;
};

export class NewsletterJobFailure extends Error {
  readonly safeCode: string;
  readonly terminal: boolean;

  constructor(safeCode: string, terminal: boolean) {
    super("Newsletter job failed.");
    this.name = "NewsletterJobFailure";
    this.safeCode = /^[a-z][a-z0-9_]{0,63}$/.test(safeCode)
      ? safeCode
      : "internal_unavailable";
    this.terminal = terminal;
  }
}

export function calculateNewsletterRetryAt(
  now: Date,
  attemptCount: number,
  random: () => number = Math.random
): Date {
  const boundedAttempt = Math.max(1, Math.min(12, Math.trunc(attemptCount)));
  const baseMs = Math.min(60 * 60 * 1_000, 30_000 * 2 ** (boundedAttempt - 1));
  const randomValue = Math.max(0, Math.min(1, random()));
  const jitter = 0.75 + randomValue * 0.5;
  return new Date(now.getTime() + Math.round(baseMs * jitter));
}

type Handler = (job: NewsletterClaimedJob) => Promise<{ readonly code: string }>;

export async function runNewsletterWorker(input: {
  readonly repository: {
    claim(input: {
      readonly workerId: string;
      readonly limit: number;
      readonly leaseSeconds: number;
      readonly emailEnabled: boolean;
    }): Promise<readonly NewsletterClaimedJob[]>;
    complete(input: {
      readonly job: NewsletterClaimedJob;
      readonly workerId: string;
      readonly fencingToken: number;
      readonly resultCode: string;
    }): Promise<void>;
    fail(input: {
      readonly job: NewsletterClaimedJob;
      readonly workerId: string;
      readonly fencingToken: number;
      readonly terminal: boolean;
      readonly retryAt: Date;
      readonly failureCode: string;
    }): Promise<void>;
  };
  readonly handlers: {
    readonly confirmationSend: Handler;
    readonly contactSync: Handler;
    readonly contactAudit: Handler;
    readonly segmentReconcile: Handler;
    readonly broadcastAudit: Handler;
  };
  readonly workerId: string;
  readonly emailEnabled: boolean;
  readonly limit: number;
  readonly now: () => Date;
  readonly random?: () => number;
}) {
  const limit = Math.max(1, Math.min(25, Math.trunc(input.limit)));
  const jobs = await input.repository.claim({
    workerId: input.workerId,
    limit,
    leaseSeconds: 120,
    emailEnabled: input.emailEnabled
  });
  let completed = 0;
  let failed = 0;
  let blocked = 0;

  for (const job of jobs.slice(0, limit)) {
    const mutatesProvider = [
      "newsletter.confirmation.send",
      "newsletter.contact.sync",
      "newsletter.segment.reconcile"
    ].includes(job.kind);
    if (!input.emailEnabled && mutatesProvider) {
      blocked += 1;
      continue;
    }

    const handler = job.kind === "newsletter.confirmation.send"
      ? input.handlers.confirmationSend
      : job.kind === "newsletter.contact.sync"
        ? input.handlers.contactSync
        : job.kind === "newsletter.contact.audit"
          ? input.handlers.contactAudit
          : job.kind === "newsletter.segment.reconcile"
            ? input.handlers.segmentReconcile
            : input.handlers.broadcastAudit;
    try {
      const result = await handler(job);
      await input.repository.complete({
        job,
        workerId: input.workerId,
        fencingToken: job.fencingToken,
        resultCode: /^[a-z][a-z0-9_]{0,63}$/.test(result.code) ? result.code : "completed"
      });
      completed += 1;
    } catch (error) {
      const failure = error instanceof NewsletterJobFailure
        ? error
        : new NewsletterJobFailure("internal_unavailable", false);
      await input.repository.fail({
        job,
        workerId: input.workerId,
        fencingToken: job.fencingToken,
        terminal: failure.terminal,
        retryAt: calculateNewsletterRetryAt(
          input.now(),
          typeof job.attemptCount === "number" ? job.attemptCount : 1,
          input.random
        ),
        failureCode: failure.safeCode
      });
      failed += 1;
    }
  }
  return { claimed: jobs.length, completed, failed, blocked };
}
