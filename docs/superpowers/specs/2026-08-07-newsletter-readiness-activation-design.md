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
4. Set the reconciliation ceiling to eight total claims. Claim eight may run; any retryable failure from claim eight becomes `terminal_failed`, opens the site reconciliation circuit, and inserts a latest `blocked` readiness revision in one transaction. An expired job already at eight claims is terminalized rather than reclaimed.
5. Continue to reject completion, failure, checkpoint, or finalization from an old worker, an old fencing token, or an expired current lease.
6. Add one site/provider reconciliation-circuit row. While the circuit is open, Cron and operation requests return `blocked`; the scheduler cannot create a replacement job and cannot reset attempt history.
7. Closing the circuit requires an authenticated site-owner recovery command with a nonempty reason. The server records the operator, exhausted job, reason, and timestamp, closes the circuit, and requests a new run. This is the only path that can resume after terminal exhaustion.

### Reconciliation run and evidence

Add:

- `builder_newsletter_reconciliation_runs`, keyed by site and run ID, containing the owning site-job ID, phase, provider cursor, local cursor, page counts, audience counts, safe state/code, and timestamps;
- `builder_newsletter_reconciliation_members`, keyed by site, run, and provider Contact ID, containing only provider IDs, local subscription IDs when matched, source flags, eligibility flags, and safe dispositions. It stores no email address or provider response body;
- `builder_newsletter_reconciliation_requests`, keyed by site and command ID, containing the operation kind, request time, bound run ID, and resulting readiness revision ID; and
- `builder_newsletter_reconciliation_circuits`, keyed by site/provider scope, containing circuit state and safe terminal/recovery audit metadata.

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

Successful finalization retains the immutable run summary, page counts, audience count, digest, and linked readiness/command evidence but deletes its per-member rows in the same transaction. Retryable runs retain member rows only because they are required to resume. Terminal runs retain per-member rows for at most seven days; the protected Cron invokes a service-role purge RPC that excludes queued, leased, and retryable runs, deletes expired terminal member rows, and reports only a safe aggregate count. An open circuit therefore preserves its immutable terminal run summary without retaining provider or subscription identifiers indefinitely.

### Least privilege

Every new table has RLS enabled. `PUBLIC`, `anon`, and `authenticated` have no direct `SELECT`, `INSERT`, `UPDATE`, or `DELETE`; only the minimum service-role access is granted. Every new security-definer RPC uses `SET search_path = ''`, revokes default `PUBLIC` execute, and grants execute only to `service_role`. Authenticated Staff Portal actions reach these RPCs only through server routes that independently enforce the site and owner/operator role.

### Scheduler and freshness

Add a generic scheduler plus a force-fresh operation request RPC:

- the generic scheduler accepts only `{ "version": 1, "siteId": "<uuid>" }`;
- the operation RPC additionally requires an idempotent command ID and an allowlisted operation kind;
- uses the fixed provider scope `resend-team-production`;
- is executable only by `service_role`;
- returns only `fresh`, `queued`, `already_queued`, `pending`, or `blocked`;
- examines the single latest readiness revision overall, not the latest ready revision;
- returns `fresh` only if that latest revision is `ready` and expires more than fifteen minutes in the future; and
- otherwise queues one reconciliation job unless the partial unique index reports an active one.

A newer `blocked` or `stale` revision therefore overrides every older ready revision.

The force-fresh RPC never reuses a generic readiness revision. Under the site transaction lock, it creates or replays a command-bound request. It may attach the request to a queued run that has not started; otherwise it waits for a successor run whose `started_at` is after the request's database timestamp. Finalization binds only requests that predate that run's start to the new revision; requests arriving during a run remain pending and cause a successor job to be queued. The protected operation accepts only the exact readiness revision linked to its command ID.

Every locally observed eligibility-changing transition atomically inserts a new `stale` readiness revision using the same site-scoped revision allocator. This includes confirmation/activation, withdrawal, unsubscribe, complaint, bounce/suppression, provider removal, Contact sync, Segment removal, Topic changes, and verified webhook or audit drift. External drift that has not yet been observed is caught by the force-fresh two-sided run before any Broadcast validation.

## Serialized Entry Points

Every reconciliation entry point uses the same durable site-job lease:

1. The five-minute Vercel Cron invokes `/api/newsletter/jobs/run` with `CRON_SECRET`.
2. When email is enabled and configuration is structurally ready, the route schedules before claiming work.
3. The worker claims or reclaims the single site job and advances at most the bounded page budget for that invocation.
4. `activation-check`, `validate`, and `staff-test` do not call `segmentReconcile()` directly. Each creates or replays a force-fresh command-bound request and returns pending until a run begun after that request links its new revision to the command.
5. The public readiness RPC also reads only the single latest revision overall and returns ready only when that exact row is ready and unexpired.

When `NEWSLETTER_EMAIL_ENABLED=false`, the Cron route does not schedule or claim provider-mutating newsletter work. Existing verified webhook handling and approved read-only audits keep their current behavior.

## Production Provider Preflight

Two gates run before `next build` when the candidate has `NEWSLETTER_EMAIL_ENABLED=true`. A separate protected first-activation operation records the durable transition from initial to steady-state mode; changing an environment variable alone cannot skip it.

### Structural gate

The server-only structural check calls `readNewsletterConfiguration()` and fails on missing or malformed values. It prints only safe codes and never prints identifiers, keys, secrets, or recipient addresses.

### Semantic gate and dedicated-team inventory

The server-only semantic preflight uses the actual hidden Production values inside the protected Vercel build environment. It is read-only and must prove all of the following across complete cursor pagination:

- the management credential can read the configured Segment, Topic, sending domain, webhook registrations, and complete Broadcast inventory;
- the send credential cannot perform the chosen management-only probe, proving it is not interchangeable with the management credential;
- the complete team inventory matches an explicit allowlist: exactly the verified `updates.assemblywomanmorales.com` sending domain, the configured `District Newsletter` Segment, the configured public default-`opt_out` Topic, the expected Production webhook, and the approved purpose-specific API keys; no unrelated domain, Segment, Topic, webhook, key, application, or other enumerable team resource is permitted;
- every provider Contact maps to a site-local subscription or an approved retained withdrawal/suppression record, and no unrelated Contact is present;
- `updates.assemblywomanmorales.com` is verified and matches the configured sender domain;
- an enabled webhook registration targets the expected Production webhook URL with the required email-delivery and audience events;
- a webhook signing secret is structurally present. Exact secret/register matching is later proven by accepting an authentic signed event, because Resend does not return the signing secret for comparison;
- no Broadcast is queued or scheduled anywhere in the team;
- each draft belongs to this site and uses only the approved sender/audience boundary; and
- each previously sent Broadcast matches a recorded validation and provider-audit observation for this site. An unmatched historical send fails closed as an incident.

The preflight enumerates every provider resource category exposed by the Resend account API. If a required category cannot be enumerated, it fails with `unsupported_inventory`; a dashboard assumption is not accepted as automated proof. It makes no send, Contact, Topic, Segment, webhook, domain, key, or Broadcast mutation.

Every list operation follows cursors until exhaustion, with a bounded maximum page count that fails closed rather than accepting a truncated result. Valid-looking but wrong IDs or credentials cannot pass. Only safe aggregate counts and status codes may enter build logs.

### Initial versus steady-state mode

Add `builder_newsletter_provider_activation_revisions`, an immutable service-only table keyed to the site, provider scope, and canonical resource-identity digest. The public readiness RPC requires a current activation revision as well as a fresh audience revision.

When no matching activation revision exists, the build semantic gate runs in `initial` mode and additionally requires zero Contacts in the full Segment, zero locally active eligible subscribers, and zero historical sent Broadcasts. The candidate may build, but the public form remains on its fallback after promotion because no activation revision exists.

An authenticated site-owner then invokes the protected first-activation operation. The server repeats the complete initial semantic checks at runtime and, only on success, calls a service-role security-definer RPC that records the provider/resource digest and zero-audience evidence. The operation cannot accept provider IDs or a mode override from the browser. It neither sends nor mutates Resend. Cron may schedule the initial reconciliation only after this durable activation revision exists.

Subsequent enabled builds with the same provider/resource digest run in `steady` mode: they retain every identity, permission, dedicated-team, webhook, Contact-mapping, incident, and Broadcast-evidence check, but they do not require an empty authentic audience or zero historical sends. A containment deployment with the feature disabled does not delete the activation revision; re-enablement uses steady mode plus a newly fresh reconciliation. A provider/resource identity change invalidates the match and requires a separately reviewed provider-migration operation rather than silently reverting or spoofing mode.

The disabled baseline build runs only the structural disabled-mode check. The enablement sequence sets the flag on a non-public `--prod --skip-domain` candidate; the applicable semantic mode must succeed before that exact candidate can be promoted, and first activation remains publicly unavailable until the protected runtime operation records its durable evidence.

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
- Expired leases are reclaimed with a new fence through claim eight; terminal exhaustion opens the durable circuit and repeated Cron calls cannot bypass it.
- First-activation evidence is required independently of the feature flag. Missing or mismatched evidence keeps the public form unavailable.
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
- claim eight is the final runnable reconciliation attempt, terminal exhaustion opens the site circuit, and repeated Cron calls cannot create a replacement job;
- only an audited owner recovery command closes the circuit and creates a new attempt lineage;
- concurrent finalizers allocate one readiness revision and one completion;
- every new table denies browser-role `SELECT`, `INSERT`, `UPDATE`, and `DELETE`;
- browser roles cannot call scheduler, force-request, checkpoint, finalization, circuit, purge, or activation-evidence RPCs;
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
- a command request arriving after a run starts waits for a successor and cannot reuse that run's revision;
- stale finalization is rejected and provider effects remain idempotent;
- successful finalization compacts all member evidence while preserving the immutable run summary;
- active/retryable evidence is never purged, terminal member evidence is purged after seven days, and cleanup is service-only and site-isolated.

### Provider preflight and route tests

- disabled mode performs no provider preflight;
- valid-looking wrong credentials, Segment IDs, Topic IDs, sender domains, and webhook registrations fail safely;
- send-key management access fails the separation requirement;
- every Segment, Broadcast, and resource page is inspected;
- unexpected Segment members, local eligible subscribers, or scheduled/queued/sent Broadcasts fail first-activation preflight;
- the complete domain, Contact, Segment, Topic, webhook, API-key, application, and Broadcast inventory rejects unrelated resources or an unsupported/unlistable required category;
- steady-state preflight permits authentic subscribers and previously sent Broadcasts only when they match site-local and validation/audit evidence;
- first activation creates a durable resource-digest revision only after the runtime recheck; an environment flag alone cannot create or spoof it;
- post-signup redeployment, disabled containment, and steady-state re-enablement do not reimpose the zero-audience first-activation premise;
- a provider/resource identity change invalidates activation evidence and fails closed for reviewed migration;
- logs expose no secret or address values;
- Cron schedules only when enabled and structurally ready;
- activation-check, validation, and staff-test never reconcile directly, return pending while their command-bound run is active, and reject any older generic revision;
- a local or webhook-observed eligibility change immediately makes the latest readiness revision stale;
- provider/local drift after a generic Cron revision is caught by the operation's force-fresh run;
- public readiness uses only the exact latest revision;
- the exact managed-form consent and completion strings are preserved.

### Release verification

- migration lineage, dry run, application, database tests, lint, full tests, and Production build pass;
- protected candidate build proves the real hidden provider resources without a provider mutation or send;
- candidate routes and security boundaries pass before promotion;
- after promotion, the protected first-activation operation records durable zero-audience provider evidence and then the scheduler creates a complete zero-audience readiness revision;
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
5. Confirm Supabase active eligibility, the complete Resend Segment, and historical sends satisfy the first-activation zero boundary without creating records.
6. Set `NEWSLETTER_EMAIL_ENABLED=true` for Production only.
7. Create a fresh `--prod --skip-domain` candidate. Its structural and initial semantic gates must pass using actual hidden Production values.
8. Verify candidate routes and security boundaries without submitting the public form.
9. Promote that exact candidate; verify `/newsletter` remains on the fallback because durable first-activation evidence is still absent.
10. Invoke the authenticated owner-only first-activation operation, repeat the complete initial preflight, and record the matching resource-digest revision.
11. Observe Cron schedule, page through, finalize, and complete the initial zero-audience reconciliation.
12. Verify the public form, latest readiness, runtime logs, and fallback behavior.
13. Have the user submit one authentic approved inbox and open its confirmation link.
14. Verify consent evidence, Contact state, explicit Topic opt-in, Segment membership, and one authentic signed webhook without recording the address in release evidence.
15. Build a steady-state candidate after the authentic signup to prove future deployments no longer require an empty audience while all dedicated-team and evidence checks remain enforced.

## Scope Boundary

This release activates the existing editor, posts, media, forms, submissions, leads, customers, dashboard, and newsletter capabilities. SMS, AI, survey collection, and generic outbound actions remain unavailable until separately designed and provisioned. Newsletter campaign composition and final Production Segment sending remain deliberate Resend-dashboard operations with the existing staff-test and validation gates.
