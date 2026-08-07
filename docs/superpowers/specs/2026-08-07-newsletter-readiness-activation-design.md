# Newsletter Readiness and Production Activation Design

**Status:** Approved for specification; implementation pending written-spec review

**Approved direction:** User on 2026-08-07

**Production site:** `https://www.assemblywomanmorales.com`

**Site key:** `official-assembly-website-v2`

## Purpose

Complete the approved live newsletter design by making Resend audience readiness durable, publishing the already-approved double-opt-in form copy, validating hidden Production configuration without exposing secrets, and activating the public newsletter form. This amendment does not authorize a Production Segment Broadcast, synthetic subscribers, SMS, AI, survey collection, or unrelated provider work.

## Verified Current State

- The newsletter implementation, Supabase schema, protected worker, confirmation flow, Resend adapters, webhook route, and Staff Portal operations are deployed.
- `updates.assemblywomanmorales.com` is verified in Resend.
- Vercel contains purpose-specific Production variables for sending, management, webhook verification, Segment, Topic, confirmation signing, staff recipients, and the newsletter feature flag.
- The active Production deployment keeps `NEWSLETTER_EMAIL_ENABLED=false`, so no signup, confirmation send, Contact mutation, or Segment mutation can run.
- Supabase contains no `builder_newsletter_readiness_revisions` row for this site.
- No code path schedules the initial or recurring `newsletter.segment.reconcile` site job. An activation check can create one readiness revision directly, but that revision expires after thirty minutes.
- The published `newsletter-signup` form uses the approved template and `marketing-v1` policy, but still contains generic consent and completion strings rather than the exact wording approved in the operations runbook.
- Vercel exports Sensitive values as `[REDACTED]`; local parsing of that export cannot validate the real Segment or Topic identifiers.

## Chosen Approach

Use a database-backed recurring reconciliation scheduler plus a Production build-time configuration gate.

Rejected alternatives:

- Manual activation checks are temporary because readiness expires after thirty minutes.
- Permanent or bypassed readiness would allow the public form to accept requests while provider state may be stale.
- Synthetic subscribers or placeholder Contacts are prohibited and unnecessary.

## Database Contract

Add one additive migration that:

1. Creates a partial unique index allowing at most one active `newsletter.segment.reconcile` job per site when the job state is `queued`, `leased`, or `retryable_failed`.
2. Adds `public.builder_schedule_newsletter_reconciliation_v1(jsonb)`.
3. Accepts only `{ "version": 1, "siteId": "<uuid>" }`.
4. Returns safe status only: `fresh`, `queued`, or `already_queued`.
5. Treats readiness as fresh when the latest `ready` revision expires more than fifteen minutes in the future.
6. Queues one reconciliation job when readiness is missing, stale, blocked, or within the fifteen-minute refresh window.
7. Uses the fixed Production provider scope `resend-team-production` and never accepts a provider scope from the caller.
8. Is executable only by `service_role`; `public`, `anon`, and `authenticated` receive no execute grant.
9. Preserves completed and failed jobs as audit evidence.

The existing reconciliation handler remains authoritative. It reads every active Supabase subscription and verifies that the corresponding Resend Contact exists, is not globally unsubscribed, has explicit `opt_in` for the configured default-opt-out Topic, and belongs to the configured Segment. Only then does it create a thirty-minute readiness revision. An empty authentic audience produces a valid zero-audience revision without creating or mutating a Contact.

## Worker Data Flow

When `NEWSLETTER_EMAIL_ENABLED=true` and the full Production configuration is ready:

1. The five-minute Vercel Cron invokes `/api/newsletter/jobs/run` with `CRON_SECRET`.
2. Before claiming work, the route calls the scheduling RPC.
3. The scheduler returns `fresh`, queues one job, or reports an existing active job.
4. The existing fenced worker claims the reconciliation job.
5. Resend Contact, Topic, Segment, and suppression state are read and compared with Supabase eligibility.
6. Success records a new expiring readiness revision and completes the job.
7. Failure records only a safe failure code and uses the existing bounded retry path.

When the feature is disabled, the route must not schedule reconciliation or other provider-mutating work. Existing verified webhook handling and approved read-only audits keep their current behavior.

## Production Configuration Gate

Add a server-only build verification command that:

- reads `readNewsletterConfiguration()` from the actual deployment environment;
- performs no provider call and prints no identifier, secret, key material, or recipient address;
- succeeds when the feature is disabled;
- requires configuration status `ready` when `NEWSLETTER_EMAIL_ENABLED=true`; and
- fails the Vercel build with only the existing safe configuration code when any Production value is malformed or missing.

The project build runs this verification before `next build`. This validates the real hidden Vercel values inside the protected build environment, avoiding the unusable `[REDACTED]` local export.

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

The existing privacy notice and pre-form confirmation explanation remain visible. Publishing uses the existing immutable form-command and history contracts; it does not modify existing submissions.

## Failure Behavior

- Missing or malformed Production configuration fails the candidate build.
- Provider or database reconciliation failure keeps or returns the public page to its phone fallback.
- A stale readiness revision never authorizes signup.
- Failed jobs retry through the existing bounded backoff and fencing controls.
- No failure path reports a successful subscription, Contact sync, email delivery, or Broadcast send.
- Immediate containment remains `NEWSLETTER_EMAIL_ENABLED=false` plus a fresh Production deployment.
- Application rollback promotes the recorded baseline deployment; additive database state remains intact.

## Test Strategy

Implementation follows red-green-refactor.

### Database tests

- missing readiness queues one reconciliation job;
- fresh readiness queues nothing;
- readiness inside the refresh window queues one job;
- concurrent or repeated scheduler calls cannot create multiple active jobs;
- completed jobs permit a later refresh job;
- cross-site requests remain isolated;
- browser roles cannot call the scheduler;
- malformed requests fail without mutation.

### Unit and route tests

- Production build verification accepts disabled mode;
- enabled mode accepts only a fully ready configuration;
- safe failures expose no secret values;
- the Cron route schedules before claiming work only when enabled and ready;
- disabled mode does not schedule reconciliation;
- the exact managed-form consent and completion strings are preserved.

### Release verification

- migration lineage, dry run, application, database tests, lint, full tests, and Production build pass;
- protected candidate build proves the actual hidden Vercel configuration;
- the candidate performs no public signup and no Broadcast send;
- after promotion, the scheduler creates a zero-audience readiness revision;
- `/newsletter` renders the live Turnstile-protected form at desktop and 390px without overflow or console errors;
- `/api/newsletter/jobs/run` remains secret-protected;
- Vercel and Supabase logs contain no activation errors;
- one authentic user-controlled inbox completes the double-opt-in flow;
- the resulting Contact has explicit Topic opt-in and Segment membership;
- no Production Segment Broadcast is sent during activation.

## Production Sequence

1. Record the current promoted deployment and encrypted backup as rollback evidence.
2. Implement and verify the scheduler, configuration gate, and exact form copy test-first.
3. Apply the additive migration after a linked dry run and advisor review.
4. Publish the new immutable newsletter form revision and verify its projection.
5. Set `NEWSLETTER_EMAIL_ENABLED=true` for Production only.
6. Create a fresh `--prod --skip-domain` candidate; the build must prove configuration readiness.
7. Verify candidate routes and security boundaries without submitting a form.
8. Promote that exact candidate.
9. Observe the protected Cron create and complete the initial reconciliation job.
10. Verify the public form, runtime logs, and zero-audience readiness.
11. Have the user submit one authentic approved inbox and open its confirmation link.
12. Verify Supabase consent evidence plus Resend Contact, Topic, and Segment state without recording the address in release evidence.

## Scope Boundary

This release activates the existing editor, posts, media, forms, submissions, leads, customers, dashboard, and newsletter capabilities. SMS, AI, survey collection, and generic outbound actions remain unavailable until separately designed and provisioned. Newsletter campaign composition and final Production Segment sending remain deliberate Resend-dashboard operations with the existing staff-test and validation gates.

