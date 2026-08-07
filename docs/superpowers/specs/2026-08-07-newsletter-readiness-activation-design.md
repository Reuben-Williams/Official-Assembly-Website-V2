# Newsletter Readiness and Production Activation Design

**Status:** Proposed; implementation pending independent review and user approval

**Approved direction:** User on 2026-08-07

**Production site:** `https://www.assemblywomanmorales.com`

**Site key:** `official-assembly-website-v2`

## Purpose

Complete the approved live newsletter design by making Resend audience readiness durable and two-sided, publishing the approved double-opt-in form copy, proving the hidden Production provider configuration semantically, and activating the public newsletter form. This release does not authorize a Production Segment Broadcast, synthetic subscribers, SMS, AI, survey collection, or unrelated provider work.

## Verified Current State

- The newsletter schema, protected worker, confirmation flow, Resend adapters, webhook route, and Staff Portal operations are deployed.
- `updates.assemblywomanmorales.com` is verified in Resend.
- Vercel contains purpose-specific Production variables for sending, management, webhook verification, Segment, Topic, confirmation signing, staff recipients, and the newsletter feature flag.
- The promoted Production deployment keeps `NEWSLETTER_EMAIL_ENABLED=false`; signup, confirmation sending, Contact mutation, and Segment mutation are disabled.
- Supabase contains no `builder_newsletter_readiness_revisions` row for this site.
- No code path schedules the initial or recurring `newsletter.segment.reconcile` site job.
- The current reconciliation reads only locally known active subscriptions. It cannot discover provider-only Segment members, it is not paginated or resumable, and it writes the readiness revision outside the job-fencing transaction.
- The current claim RPC never reclaims an expired `leased` job, so a terminated worker can block reconciliation permanently.
- `activation-check`, `validate`, and `staff-test` can call reconciliation directly and therefore can race the Cron worker.
- The published `newsletter-signup` form uses the approved template and `marketing-v1` policy but still contains generic consent and completion copy.
- Vercel exports Sensitive values as `[REDACTED]`; a local export cannot validate the real Segment or Topic identifiers.

## Chosen Approach

Use one site-scoped durable reconciliation state machine, with fenced resumable checkpoints and a semantic provider preflight in the protected Vercel candidate build.

Rejected alternatives:

- A manual activation check is temporary because readiness expires after thirty minutes.
- A local-only audience walk can falsely report ready when the Resend Segment contains unknown or ineligible Contacts.
- Permanent or bypassed readiness can accept public requests while provider state is stale.
- Synthetic subscribers or placeholder Contacts are prohibited and unnecessary.

## Database Contract

Add one additive migration that extends the existing site-job model and introduces durable reconciliation evidence.

### Site job lifecycle

1. Add a partial unique index allowing at most one active `newsletter.segment.reconcile` job per site when state is `queued`, `leased`, or `retryable_failed`.
2. Extend `builder_claim_newsletter_jobs_v1` so a site job is claimable when it is queued, retryable and due, or leased with `lease_expires_at <= clock_timestamp()`.
3. Reclaim an expired lease atomically under `FOR UPDATE SKIP LOCKED`: assign the new worker, increment `lease_fencing_token`, increment `attempt_count`, and set a new expiry. An unexpired lease is never preempted.
4. Preserve the existing bounded retry limit. A reclaimed attempt at or beyond the limit transitions to `terminal_failed` with a safe code instead of being leased forever.
5. Continue to reject completion, failure, checkpoint, or finalization from an old worker, an old fencing token, or an expired current lease.

### Reconciliation run and evidence

Add:

- `builder_newsletter_reconciliation_runs`, keyed by site and run ID, containing the owning site-job ID, phase, provider cursor, local cursor, page counts, audience counts, safe state/code, and timestamps;
- `builder_newsletter_reconciliation_members`, keyed by site, run, and provider Contact ID, containing only provider IDs, local subscription IDs when matched, source flags, eligibility flags, and safe dispositions. It stores no email address or provider response body.

One active job owns one run. The run moves through these phases:

1. `provider_segment`: walk every Resend Segment Contact page, up to the provider maximum page size, and checkpoint the cursor after each fully processed page.
2. `local_eligible`: walk the exact Supabase active-eligible set in stable `(id)` order and checkpoint the last subscription ID after each page.
3. `finalize`: atomically verify that both walks reached end-of-list, that every evidence row is resolved, and that the job's current lease/fence still owns the run.

The provider walk retrieves each Segment Contact's global unsubscribe state and exact Topic subscription. A Contact is eligible only when all of the following agree:

- it maps to an active, confirmed Supabase subscription for this site;
- it is not globally unsubscribed or otherwise suppressed;
- the configured public default-opt-out Topic is explicitly `opt_in`; and
- it is a member of the configured dedicated Segment.

Provider-only and locally ineligible Segment members are removed from the Segment idempotently and recorded with a safe disposition. They are never opted in, resubscribed, or added to another audience. A transient read/removal failure leaves the evidence unresolved and the run not ready. The local walk then proves that every active local subscription appears in the provider evidence and remains eligible. Missing, suppressed, wrong-Topic, or missing-Segment records block readiness; the reconciliation does not silently opt them in.

Each provider page and local page is committed through a security-definer checkpoint RPC that verifies the current site-job owner, fencing token, unexpired lease, expected phase, and prior cursor before writing evidence, advancing the cursor, and renewing the lease. A process termination can therefore resume the same run after atomic lease reclamation; a stale process cannot write a later checkpoint.

The finalization RPC obtains a site-scoped transaction lock, re-verifies the current lease/fence and completed cursors, computes the audience count and SHA-256 eligibility digest from the resolved eligible local subscription IDs, allocates `max(revision) + 1`, inserts exactly one thirty-minute `builder_newsletter_readiness_revisions` row, and completes the job in the same transaction. Concurrent finalizers cannot allocate the same revision or complete the same run twice.

### Scheduler and freshness

Add `public.builder_schedule_newsletter_reconciliation_v1(jsonb)`:

- accepts only `{ "version": 1, "siteId": "<uuid>" }`;
- uses the fixed provider scope `resend-team-production`;
- is executable only by `service_role`;
- returns only `fresh`, `queued`, or `already_queued`;
- examines the single latest readiness revision overall, not the latest ready revision;
- returns `fresh` only if that latest revision is `ready` and expires more than fifteen minutes in the future; and
- otherwise queues one reconciliation job unless the partial unique index reports an active one.

A newer `blocked` or `stale` revision therefore overrides every older ready revision.

## Serialized Entry Points

Every reconciliation entry point uses the same durable site-job lease:

1. The five-minute Vercel Cron invokes `/api/newsletter/jobs/run` with `CRON_SECRET`.
2. When email is enabled and configuration is structurally ready, the route schedules before claiming work.
3. The worker claims or reclaims the single site job and advances at most the bounded page budget for that invocation.
4. `activation-check`, `validate`, and `staff-test` do not call `segmentReconcile()` directly. They call the scheduler and consume only the latest completed fresh readiness revision. If reconciliation is queued or active, they return a safe pending code and the operator retries after the protected worker completes.
5. The public readiness RPC also reads only the single latest revision overall and returns ready only when that exact row is ready and unexpired.

When `NEWSLETTER_EMAIL_ENABLED=false`, the Cron route does not schedule or claim provider-mutating newsletter work. Existing verified webhook handling and approved read-only audits keep their current behavior.

## Production Provider Preflight

Two gates run before `next build` when the candidate has `NEWSLETTER_EMAIL_ENABLED=true`.

### Structural gate

The server-only structural check calls `readNewsletterConfiguration()` and fails on missing or malformed values. It prints only safe codes and never prints identifiers, keys, secrets, or recipient addresses.

### Semantic gate

The server-only semantic preflight uses the actual hidden Production values inside the protected Vercel build environment. It is read-only and must prove all of the following across complete cursor pagination:

- the management credential can read the configured Segment, Topic, sending domain, webhook registrations, and complete Broadcast inventory;
- the send credential cannot perform the chosen management-only probe, proving it is not interchangeable with the management credential;
- the configured Segment exists and is the dedicated `District Newsletter` audience;
- the configured Topic exists, is public, and has immutable default subscription `opt_out`;
- `updates.assemblywomanmorales.com` is verified and matches the configured sender domain;
- an enabled webhook registration targets the expected Production webhook URL with the required email-delivery and audience events;
- a webhook signing secret is structurally present. Exact secret/register matching is later proven by accepting an authentic signed event, because Resend does not return the signing secret for comparison;
- the complete Broadcast inventory contains no scheduled, queued, or sent Production Segment Broadcast; drafts are allowed but never mutated or sent by preflight;
- the full configured Segment contains zero Contacts before first activation; and
- Supabase contains zero active eligible subscribers before first activation.

The preflight makes no send, Contact, Topic, Segment, webhook, domain, or Broadcast mutation. If the expected zero-audience premise is false, the candidate build fails closed with a safe code and activation stops for explicit reconciliation review. Provider cleanup is not hidden inside a build.

Every list operation follows cursors until exhaustion, with a bounded maximum page count that fails closed rather than accepting a truncated result. Valid-looking but wrong IDs or credentials cannot pass. Only safe aggregate counts and status codes may enter build logs.

The disabled baseline build may run only the structural disabled-mode check. The enablement sequence sets the flag on a non-public `--prod --skip-domain` candidate; semantic success is required before that exact candidate can be promoted.

## Managed Form Revision

Before activation, publish a new immutable revision of `newsletter-signup` using:

- template `local-business.newsletter-signup` version `1.0.0`;
- policy `marketing-v1`;
- required email field;
- optional first-name field;
- required marketing-consent checkbox with the exact approved label:

> I agree to receive District Newsletter emails from the Office of Assemblywoman Carmen Morales. I understand that submitting this form is a confirmation request, that I am not subscribed until I confirm by email, and that I can unsubscribe at any time.

- inline success copy:

> Check your inbox to continue. Your request is pending, and you are not subscribed unless you complete the confirmation step.

The existing privacy notice and pre-form confirmation explanation remain visible. Publishing uses the immutable form-command and history contracts and does not modify existing submissions.

## Failure Behavior

- A structural or semantic Production preflight failure rejects the candidate build.
- A provider or database reconciliation failure creates no ready revision and keeps or returns the public page to its phone fallback when the latest revision is absent, blocked, stale, or expired.
- A stale worker cannot checkpoint, finalize, complete, or fail a reclaimed job.
- Expired leases are reclaimed with a new fence and bounded attempts.
- No failure path reports a successful subscription, Contact sync, email delivery, or Broadcast send.
- Immediate containment remains `NEWSLETTER_EMAIL_ENABLED=false` plus a fresh Production deployment.
- Application rollback promotes the recorded baseline deployment; additive database state remains intact.

## Test Strategy

Implementation follows red-green-refactor.

### Database and fencing tests

- missing readiness queues one reconciliation job;
- the single latest fresh ready revision queues nothing;
- a newer blocked or stale revision overrides an older ready revision;
- readiness inside the fifteen-minute refresh window queues one job;
- concurrent scheduler calls cannot create multiple active jobs;
- an expired lease is reclaimed once with a higher fence and preserved/incremented attempt history;
- an unexpired lease is not preempted;
- concurrent reclaimers yield one owner;
- the old owner cannot checkpoint, finalize, complete, or fail after reclamation;
- terminal retry bounds are enforced after worker termination;
- concurrent finalizers allocate one readiness revision and one completion;
- browser roles cannot call scheduler, checkpoint, or finalization RPCs;
- malformed and cross-site requests fail without mutation.

### Reconciliation tests

- zero local subscribers and an empty provider Segment produces authentic zero-audience readiness;
- zero local subscribers and a nonempty provider Segment removes provider-only members and does not finalize until the Segment is empty;
- provider-only, locally inactive, globally unsubscribed, suppressed, wrong-Topic, and missing-Segment cases are handled according to the eligibility contract;
- Topic state must be explicit `opt_in`; missing/default state is not eligible;
- provider and local lists larger than one page are fully traversed;
- interruption after any provider or local page resumes from the committed cursor;
- duplicate provider removal and replayed page handling are idempotent;
- simultaneous manual and Cron requests share one job/run;
- stale finalization is rejected and provider effects remain idempotent.

### Provider preflight and route tests

- disabled mode performs no provider preflight;
- valid-looking wrong credentials, Segment IDs, Topic IDs, sender domains, and webhook registrations fail safely;
- send-key management access fails the separation requirement;
- every Segment, Broadcast, and resource page is inspected;
- unexpected Segment members, local eligible subscribers, or scheduled/queued/sent Broadcasts fail first-activation preflight;
- logs expose no secret or address values;
- Cron schedules only when enabled and structurally ready;
- activation-check, validation, and staff-test never reconcile directly and return pending while the durable job is active;
- public readiness uses only the exact latest revision;
- the exact managed-form consent and completion strings are preserved.

### Release verification

- migration lineage, dry run, application, database tests, lint, full tests, and Production build pass;
- protected candidate build proves the real hidden provider resources without a provider mutation or send;
- candidate routes and security boundaries pass before promotion;
- after promotion, the scheduler creates a complete zero-audience readiness revision;
- `/newsletter` renders the live Turnstile-protected form at desktop and 390px without overflow or console errors;
- `/api/newsletter/jobs/run` remains secret-protected;
- Vercel and Supabase logs contain no activation errors or sensitive values;
- one authentic user-controlled inbox completes the double-opt-in flow;
- Supabase consent evidence and Resend Contact, explicit Topic opt-in, and Segment membership agree;
- an authentic signed Resend webhook proves the configured webhook secret works;
- no Production Segment Broadcast is sent during activation.

## Production Sequence

1. Record the promoted deployment and encrypted backup as rollback evidence.
2. Implement the migration, durable state machine, provider pagination, semantic preflight, serialized operations, and exact form-copy tests red-first.
3. Run migration dry-run, database tests, advisor review, lint, full tests, and local Production build.
4. Apply the additive migration and publish the immutable newsletter form revision; verify its projection and history.
5. Confirm Supabase active eligibility and the complete Resend Segment are both empty without creating records.
6. Set `NEWSLETTER_EMAIL_ENABLED=true` for Production only.
7. Create a fresh `--prod --skip-domain` candidate. Its structural and semantic gates must pass using actual hidden Production values.
8. Verify candidate routes and security boundaries without submitting the public form.
9. Promote that exact candidate.
10. Observe Cron schedule, page through, finalize, and complete the initial zero-audience reconciliation.
11. Verify the public form, latest readiness, runtime logs, and fallback behavior.
12. Have the user submit one authentic approved inbox and open its confirmation link.
13. Verify consent evidence, Contact state, explicit Topic opt-in, Segment membership, and one authentic signed webhook without recording the address in release evidence.

## Scope Boundary

This release activates the existing editor, posts, media, forms, submissions, leads, customers, dashboard, and newsletter capabilities. SMS, AI, survey collection, and generic outbound actions remain unavailable until separately designed and provisioned. Newsletter campaign composition and final Production Segment sending remain deliberate Resend-dashboard operations with the existing staff-test and validation gates.
