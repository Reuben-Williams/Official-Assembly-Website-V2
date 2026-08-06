# Live Newsletter and Resend Implementation Plan

**Design source:** `docs/superpowers/specs/2026-08-06-live-newsletter-resend-design.md`

**Status:** Approved design; implementation not started

**Goal:** Launch real double-opt-in newsletter collection and Resend delivery while Supabase remains authoritative for consent and eligibility. Staff composes, tests, and sends the final Broadcast in Resend. The Staff Portal validates the exact draft and audits provider evidence; it does not create, schedule, or send Broadcasts.

**Stack:** Next.js 16 App Router, React 19, Supabase/Postgres, Resend, React Email, Vitest, pgTAP, Playwright, Vercel Cron.

## Implementation rules

- Follow test-driven development for every task: add the smallest failing test, run it and confirm the intended failure, implement the minimum behavior, then rerun the focused and affected suites.
- Never use Production Resend from Preview. Preview provider adapters stay fake unless a wholly separate Resend team is provisioned.
- Never seed synthetic or placeholder production subscribers.
- Never send a Production Segment Broadcast during deployment or activation acceptance.
- Keep `client-website-setup-operator-walkthrough.md` untracked and outside every commit.
- Commit each completed task separately so database, public-flow, provider, editor, and activation changes remain reviewable.

## Task 1: Add the server-only newsletter foundation

**Files**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Create: `lib/newsletter/types.ts`
- Create: `lib/newsletter/config.ts`
- Create: `lib/newsletter/errors.ts`
- Create: `lib/newsletter/safe-log.ts`
- Create: `tests/newsletter-config.test.ts`

**Test first**

1. Add tests proving configuration fails closed when keys, Segment, Topic, canonical URL, signing keyring, or staff-test allowlist are missing or malformed.
2. Prove Production credentials are rejected in Preview and no configuration result exposes secret values or full staff addresses.
3. Run `npm test -- tests/newsletter-config.test.ts` and confirm failure because the modules do not exist.

**Implementation**

1. Install exact, lockfile-pinned server dependencies: `resend` and React Email 6's supported unified `react-email` package. The originally planned `@react-email/components` and `@react-email/render` packages were deprecated when React Email 6 unified their exports.
2. Add only names and safe examples to `.env.example`:
   `RESEND_SEND_API_KEY`, `RESEND_MANAGEMENT_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_NEWSLETTER_SEGMENT_ID`, `RESEND_NEWSLETTER_TOPIC_ID`, `NEWSLETTER_CONFIRMATION_KEYRING`, `NEWSLETTER_CONFIRMATION_ACTIVE_KEY_ID`, `NEWSLETTER_TEST_RECIPIENTS`, and `NEWSLETTER_EMAIL_ENABLED`.
3. Parse configuration in a server-only module. Return typed `disabled`, `ready`, or bounded `unavailable` results; never return raw credentials or allowlisted addresses.
4. Centralize safe error codes and structured logging that permits identifiers/status codes but redacts tokens, request bodies, email addresses, message bodies, webhook payloads, and secrets.

**Verify**

- `npm test -- tests/newsletter-config.test.ts`
- `npm run lint`

## Task 2: Make the database test environment reproducible

**Files**

- Create: `supabase/config.toml`
- Add unchanged upstream files: `supabase/migrations/<platform migrations through 20260805205128_strict_public_form_ingestion.sql>`
- Create: `scripts/verify-platform-migration-checksums.mjs`
- Create: `supabase/tests/00_platform_schema_ready.test.sql`
- Modify: `package.json`

**Test first**

1. Add a pgTAP preflight that requires the deployed platform tables and `builder_ingest_form_submission_strict_v3(jsonb)` with service-role-only execution.
2. Add a checksum test/script that compares every vendored upstream migration with the immutable files from the approved platform release and rejects edits.
3. Run the database test command and confirm it fails because the local app repository lacks the base platform schema.

**Implementation**

1. Copy the exact already-deployed platform migration history from `D:\Project Morales\site-editor-platform-official-assembly-release\supabase\migrations` through `20260805205128_strict_public_form_ingestion.sql` into this repository. Preserve filenames and bytes; do not rewrite them.
2. Add local Supabase configuration and scripts for `supabase start`, `supabase db reset`, and `supabase test db` against an isolated local database only.
3. Add `test:db` and `test:newsletter` scripts. The latter runs newsletter Vitest files plus pgTAP.
4. Verify the remote migration history already contains the vendored versions before any future linked migration push; never reapply them manually to Production.

**Verify**

- `node scripts/verify-platform-migration-checksums.mjs`
- `npx supabase db reset --local`
- `npx supabase test db`

## Task 3: Add the additive newsletter database contract

**Files**

- Create with `supabase migration new`: `supabase/migrations/<timestamp>_official_assembly_live_newsletter.sql`
- Create: `supabase/tests/30_official_assembly_newsletter_schema.test.sql`
- Create: `supabase/tests/31_official_assembly_newsletter_ingestion.test.sql`
- Create: `supabase/tests/32_official_assembly_newsletter_jobs.test.sql`
- Create: `supabase/tests/33_official_assembly_newsletter_webhooks.test.sql`
- Create: `supabase/tests/34_official_assembly_newsletter_broadcasts.test.sql`

**Test first**

1. Specify RLS, grants, site scoping, unique constraints, allowed states, three mutually exclusive job shapes, and cross-site denial in pgTAP.
2. Specify atomic strict-ingestion-plus-subscription/job behavior, replay, receipt incompatibility, generation/ordinal limits, confirmation consumption, and injected rollback points.
3. Specify job leasing/fencing, Contact audit while outbound work is disabled, webhook receipt atomicity, test-observation isolation, half-open Broadcast validation timing, incident upsert, full-audit cursor checkpoints, and two-operator recovery.
4. Run `npx supabase test db`; confirm the new contracts fail before the migration exists.

**Implementation**

Create site-scoped tables for:

- subscriptions and confirmation generations;
- confirmation delivery ledger and confirmation sessions;
- subscription jobs;
- site jobs (`segment_reconcile`, `contact_audit`);
- Broadcast audit jobs/runs;
- readiness revisions;
- verified webhook receipts;
- staff-test windows and message-scoped observations;
- Broadcast validations; and
- Broadcast incidents and containment/recovery evidence.

Create security-definer RPCs with `search_path=''`, explicit site verification, no anonymous/authenticated grants, and service-role-only execution for:

- `builder_ingest_official_assembly_newsletter_v1(jsonb)`;
- confirmation-session exchange and single-use confirmation;
- job claim/complete/retry/terminal transitions with leases and fencing;
- read-only Contact audit and mutating Segment reconciliation results;
- atomic webhook receipt plus local state transition;
- staff-test window/observation transitions;
- Broadcast validation creation, provider-timing-pending, exact `sent_at` classification, incident upsert, and two-operator recovery; and
- non-mutating readiness/status projections for the public route and Staff Portal.

The ingestion RPC must call `builder_ingest_form_submission_strict_v3` and create/replay the pending subscription plus initial confirmation job in the same PostgreSQL transaction. It must return the existing version-2 acceptance shape expected by `@reuben-williams/next`.

**Verify**

- `npx supabase db reset --local`
- `npx supabase test db`
- `npx supabase inspect db table-stats --local`

## Task 4: Route newsletter submissions through the atomic RPC

**Files**

- Create: `lib/newsletter/ingestion.ts`
- Create: `lib/newsletter/readiness.ts`
- Modify: `app/api/forms/[formKey]/route.ts`
- Modify: `app/ui/ResidentForms.tsx`
- Create: `tests/newsletter-ingestion.test.ts`
- Modify: `tests/forms-attachment.test.ts`

**Test first**

1. Prove contact submissions still call `builder_ingest_form_submission_strict_v3` unchanged.
2. Prove newsletter submissions call only `builder_ingest_official_assembly_newsletter_v1`, return the same `202` acceptance shape, and do not claim active subscription or delivery.
3. Prove disabled/missing readiness returns the existing truthful unavailable response and creates no partial mutation.
4. Prove accepted and replayed commands do not duplicate a subscription or initial confirmation job.

**Implementation**

1. Implement a `PublicFormIngestionService` adapter for the new RPC, preserving package error mappings (`P2F29`, `P2F09`, unavailable).
2. Select the custom adapter only for `newsletter-signup`; leave contact ingestion untouched.
3. Gate newsletter rendering/submission on `NEWSLETTER_EMAIL_ENABLED` plus the non-mutating readiness RPC. Keep the phone/contact fallback when disabled.
4. Let the five-minute cron provide durable delivery. Do not make provider success part of the public request transaction.

**Verify**

- `npm test -- tests/newsletter-ingestion.test.ts tests/forms-attachment.test.ts`
- `npx supabase test db supabase/tests/31_official_assembly_newsletter_ingestion.test.sql`

## Task 5: Implement confirmation tokens, session exchange, and confirmation UI

**Files**

- Create: `lib/newsletter/confirmation-token.ts`
- Create: `lib/newsletter/confirmation-session.ts`
- Create: `lib/newsletter/confirmation-repository.ts`
- Create: `app/newsletter/confirm/page.tsx`
- Create: `app/newsletter/confirm/confirmation-client.tsx`
- Create: `app/api/newsletter/confirmation-session/route.ts`
- Create: `app/api/newsletter/confirm/route.ts`
- Create: `tests/newsletter-token.test.ts`
- Create: `tests/newsletter-confirmation-routes.test.ts`
- Create: `tests/newsletter-confirmation-client.test.tsx`

**Test first**

1. Cover canonical JSON field order, base64url wire form, HMAC-SHA256, key rotation, unknown keys, duplicate fields, expiry, skew, tampering, generation invalidation, and constant-time comparison.
2. Prove the fragment token is removed before network work, never enters the request URL/Referer/logs, and exchanges only for a ten-minute Secure/HttpOnly/SameSite=Lax `__Host-newsletter-confirmation` cookie with `Path=/` and no Domain.
3. Prove GET cannot confirm, POST is same-origin/Fetch-Metadata protected, confirmation is single-use, replay is harmless, and arbitrary subscription existence is never exposed.

**Implementation**

1. Keep the usable signed token out of the database; persist generation, nonce, key identifier, issue/expiry, and consumption state.
2. Implement the fragment-to-session exchange as read-only and the separate explicit **Confirm subscription** POST as the only mutation.
3. Enqueue Contact synchronization after confirmation; return truthful `activation pending` until provider verification completes.
4. Set `no-store` and `Referrer-Policy: no-referrer` on confirmation responses.

**Verify**

- `npm test -- tests/newsletter-token.test.ts tests/newsletter-confirmation-routes.test.ts tests/newsletter-confirmation-client.test.tsx`
- `npx supabase test db supabase/tests/32_official_assembly_newsletter_jobs.test.sql`

## Task 6: Add confirmation email and Resend provider adapters

**Files**

- Create: `lib/newsletter/email/confirmation-email.tsx`
- Create: `lib/newsletter/email/render-confirmation.ts`
- Create: `lib/newsletter/resend/contracts.ts`
- Create: `lib/newsletter/resend/client.ts`
- Create: `lib/newsletter/resend/contact-adapter.ts`
- Create: `tests/newsletter-email.test.tsx`
- Create: `tests/newsletter-resend-adapter.test.ts`

**Test first**

1. Snapshot semantic HTML/plain text for the approved bilingual confirmation message, canonical `www` fragment URL, 48-hour explanation, no-action copy, office contact, and unmonitored sender statement.
2. Prove confirmation sends use the fixed sender and deterministic idempotency key; identical retries reuse key/payload, while ambiguity after 24 hours becomes terminal.
3. Prove Contact synchronization reads current Contact/Topic/Segment state before mutation and cannot automatically reverse Topic/global withdrawal, complaint, bounce, suppression, or Contact deletion.

**Implementation**

1. Isolate transactional sending behind `RESEND_SEND_API_KEY` and Contact/Topic/Segment/Broadcast reads behind `RESEND_MANAGEMENT_API_KEY`.
2. Implement resumable phases: lookup, contact ensured, topic ensured, segment ensured, verified.
3. Persist each provider identifier/phase before continuing. On timeout, read provider state before retry.
4. Never call Broadcast create, update, schedule, or send endpoints.

**Verify**

- `npm test -- tests/newsletter-email.test.tsx tests/newsletter-resend-adapter.test.ts`
- Search client bundles/import graph to prove Resend is server-only.

## Task 7: Implement durable workers and the dedicated cron route

**Files**

- Create: `lib/newsletter/worker.ts`
- Create: `lib/newsletter/subscription-jobs.ts`
- Create: `lib/newsletter/contact-audit.ts`
- Create: `lib/newsletter/segment-reconciliation.ts`
- Create: `lib/newsletter/broadcast-audit.ts`
- Create: `lib/newsletter/cron-handler.ts`
- Create: `app/api/newsletter/jobs/run/route.ts`
- Modify: `vercel.json`
- Create: `tests/newsletter-worker.test.ts`
- Create: `tests/newsletter-cron.test.ts`

**Test first**

1. Prove bearer authorization is constant-time and missing/mismatched `CRON_SECRET` constructs no worker.
2. Cover leases, fencing, bounded batches, backoff/jitter, terminal errors, same-job retry, and concurrent invocations.
3. Prove `NEWSLETTER_EMAIL_ENABLED=false` blocks confirmation sends, Contact mutations, Segment mutations, and production validation while allowing verified webhook handling, provider-read-only `contact_audit`, and Broadcast audit.
4. Prove hourly Contact audit records Topic/global withdrawal locally without provider mutation.

**Implementation**

1. Add `/api/newsletter/jobs/run` as a Node.js no-store route protected by the existing `CRON_SECRET` pattern.
2. Add a five-minute Vercel Cron entry. Due timestamps decide which jobs run hourly or every five minutes.
3. Keep this worker independent from the installation runtime so a newsletter provider failure cannot block installation commands or health reporting.

**Verify**

- `npm test -- tests/newsletter-worker.test.ts tests/newsletter-cron.test.ts tests/installation-cron.test.ts`
- `npx supabase test db supabase/tests/32_official_assembly_newsletter_jobs.test.sql`

## Task 8: Verify and reconcile Resend webhooks

**Files**

- Create: `lib/newsletter/webhook.ts`
- Create: `lib/newsletter/webhook-repository.ts`
- Create: `app/api/webhooks/resend/route.ts`
- Create: `tests/newsletter-webhook.test.ts`

**Test first**

1. Prove signature verification uses the exact raw body before JSON parsing and rejects missing/invalid Svix headers without mutation.
2. Cover duplicate `svix-id`, crash rollback, reordered events, unknown recipients, Contact Topic read-through, provider-read failure/retry, suppression precedence, and safe ignored events.
3. Prove staff-test reuse is scoped to the exact provider message ID; a new message always triggers fresh Broadcast classification unless a Broadcast-wide production/incident disposition exists.
4. Prove webhook and audit races converge on one consumed validation or one incident.

**Implementation**

1. Normalize only approved fields after verification.
2. Retrieve Broadcast or Contact/Segment/Topic state before the atomic RPC when required; provider-read failure returns retryable and inserts no receipt.
3. Apply receipt, test/send classification, subscriber transition, and incident upsert atomically.
4. Never retain raw webhook bodies after processing.

**Verify**

- `npm test -- tests/newsletter-webhook.test.ts`
- `npx supabase test db supabase/tests/33_official_assembly_newsletter_webhooks.test.sql`

## Task 9: Implement Broadcast validation, full audit, and incident status

**Files**

- Create: `lib/newsletter/broadcast-digest.ts`
- Create: `lib/newsletter/broadcast-operations.ts`
- Create: `lib/newsletter/broadcast-repository.ts`
- Create: `app/api/newsletter/operations/status/route.ts`
- Create: `app/api/newsletter/operations/activation-check/route.ts`
- Create: `app/api/newsletter/operations/staff-test/route.ts`
- Create: `app/api/newsletter/operations/validate/route.ts`
- Create: `lib/newsletter/staff-authorization.ts`
- Create: `tests/newsletter-broadcast-operations.test.ts`
- Create: `tests/newsletter-operations-routes.test.ts`

**Test first**

1. Cover canonical digest fields, sender/Segment/Topic/unsubscribe/footer/Reply-To rules, no schedule, exact same-ID/same-digest confirmed test within 24 hours, ten-minute validation, and no provider mutation.
2. Cover `validated_at <= sent_at < valid_until`, exact-expiry rejection, post-send validation, queued/null `sent_at`, 24-hour timing terminal state, content edits, supersession, single consumption, and duplicate provider events.
3. Cover activation inventory with zero scheduled/queued/sent exceptions; complete `limit=100` pagination; per-page checkpoint/resume; next-run newest restart; and status changes to old drafts.
4. Cover incident lockout and two distinct authorized resolving operators.
5. Prove every mutation route requires an active owner session, same-origin/Fetch-Metadata, and editor CSRF; non-owners may read only bounded status.

**Implementation**

1. Reuse editor session authentication but add newsletter-specific authorization instead of inventing a builder capability.
2. `activation-check` performs content/config/readiness checks but creates no test window or send-valid approval.
3. `staff-test` uses the server-configured allowlist only. Its message-scoped observation stays provisional for fifteen minutes and is reclassified if the draft leaves unscheduled `draft` state.
4. `validate` requires the confirmed exact-digest test, fresh Segment/Topic reconciliation, and no open incident. It stores an expiring approval but never sends.
5. The audit always paginates the entire dedicated team. It records provider evidence and lockout; it never treats detection as prevention.

**Verify**

- `npm test -- tests/newsletter-broadcast-operations.test.ts tests/newsletter-operations-routes.test.ts`
- `npx supabase test db supabase/tests/34_official_assembly_newsletter_broadcasts.test.sql`

## Task 10: Add the Staff Portal Forms workspace

**Files**

- Create: `app/admin/editor/newsletter-operations-workspace.tsx`
- Create: `lib/newsletter/operations-client.ts`
- Modify: `app/admin/editor/editor-client.tsx`
- Modify: `app/admin/editor/page.tsx`
- Modify: `app/admin/editor/editor-operational-header.tsx`
- Modify: `app/globals.css`
- Modify: `tests/editor-workspaces.test.tsx`
- Create: `tests/newsletter-operations-workspace.test.tsx`

**Test first**

1. Prove the existing `website.forms` workspace appears as **Forms**, survives direct `?workspace=website.forms`, and renders real status without demo/sample data.
2. Prove owners see **Open staff test window**, **Validate newsletter**, and **Open Resend**; other roles see read-only status and no mutation controls.
3. Cover CSRF headers, loading/error states, ten-minute expiry, digest abbreviation, audience count, confirmed-test prerequisite, incident lockout, and no full recipient/body/provider-payload rendering.
4. Update operational-header tests to say newsletter email uses Resend while SMS/AI remain unavailable and survey remains unavailable.

**Implementation**

1. Pass `formsWorkspace={<NewsletterOperationsWorkspace ... />}` to `AttachedSiteEditor` and add `website.forms` to the allowed return-workspace set.
2. Keep the composer and final send in Resend. The workspace only shows bounded status and operations.
3. Use the existing editor CSRF cookie and same-origin fetch conventions.
4. Make the layout usable at desktop and 390px without moving the operational explanation back into a dense warning box.

**Verify**

- `npm test -- tests/editor-workspaces.test.tsx tests/newsletter-operations-workspace.test.tsx`
- Browser-check direct `?workspace=website.forms` and session restoration.

## Task 11: Publish truthful newsletter and privacy UX

**Files**

- Create: `app/privacy/page.tsx`
- Create: `app/data/privacy.ts`
- Modify: `app/data/site.ts`
- Modify: `app/ui/ResidentForms.tsx`
- Modify: `app/ui/PageTemplate.tsx`
- Modify: `app/ui/AppFooter.tsx`
- Modify: `app/globals.css`
- Modify: `tests/site-data.test.ts`
- Create: `tests/newsletter-public.test.tsx`
- Modify: `tests/staff-portal.test.tsx`

**Test first**

1. Prove `/newsletter` states that submission is pending until confirmation, links the privacy notice before submission, and never claims delivery or active subscription.
2. Prove `/privacy` explains collected data, purpose, Resend processing, confirmation, unsubscribe, access/correction/deletion request path, and retention approach without unsupported legal promises.
3. Prove disabled/unready configuration renders the phone/contact fallback and no active form endpoint.
4. Keep survey copy and functionality unavailable.

**Implementation**

1. Replace the current planned/unavailable newsletter copy only when application readiness is enabled.
2. Add a visible Privacy link in the footer and beside the newsletter consent context.
3. Keep business facts from `siteConfig`; do not add unverified response times or policy claims.
4. Before activation, publish a managed newsletter form revision whose exact rendered consent text and policy version match the approved privacy notice.

**Verify**

- `npm test -- tests/newsletter-public.test.tsx tests/site-data.test.ts tests/staff-portal.test.tsx`
- Desktop/mobile accessibility, overflow, direct routes, console, and network checks.

## Task 12: Add end-to-end and release-boundary verification

**Files**

- Create: `playwright.config.ts`
- Create: `tests/e2e/newsletter.spec.ts`
- Create: `scripts/check-newsletter-boundaries.mjs`
- Modify: `package.json`
- Modify: `proxy.ts` only if tests prove a header change is required
- Modify: `tests/security-headers.test.ts` only for approved header behavior

**Test first**

1. Exercise signup unavailable/ready states, fragment removal, explicit confirmation POST, replay, Forms workspace navigation, staff-test/validation status, and mobile layout against provider fakes and an isolated database.
2. Add static checks that reject Resend imports from client modules, secret names prefixed `NEXT_PUBLIC_`, Broadcast create/update/send calls, synthetic production seeds, and token/body logging.
3. Verify direct `/newsletter`, `/newsletter/confirm`, `/privacy`, and `/admin/editor?workspace=website.forms` routes.

**Full verification**

- `npm run test:newsletter`
- `npm test`
- `npm run lint`
- `npm run build`
- `npx playwright test tests/e2e/newsletter.spec.ts`
- `node scripts/check-newsletter-boundaries.mjs`
- Run Supabase security/performance advisors and resolve newsletter-table findings before deployment.

## Task 13: Deploy disabled, activate safely, and record evidence

**Repository/runbook file**

- Create: `docs/newsletter-operations-runbook.md`

**Deployment sequence**

1. Record the currently promoted Vercel deployment for rollback.
2. Remove the temporary Production Resend key from Preview. Confirm Preview has no Production Resend credentials.
3. Create the purpose-specific Resend keys, add all Production variables directly in Vercel, and keep `NEWSLETTER_EMAIL_ENABLED=false`.
4. Apply the additive migration through the reviewed migration workflow; run database readiness and verify RLS/grants.
5. Deploy to Preview with provider calls fake/disabled and complete all automated and browser acceptance.
6. Deploy the verified revision to Production while still disabled.
7. Register `https://www.assemblywomanmorales.com/api/webhooks/resend`, add the webhook secret, and redeploy.
8. Create/verify the dedicated District Newsletter Segment, default-opt-out Topic, fixed sender, and real staff-test allowlist.
9. Run the full activation Broadcast inventory; require zero scheduled, queued, or sent Broadcasts and no unrelated team resources.
10. Publish and approve the exact privacy notice and managed-form consent revision.
11. Enable the feature and redeploy.
12. Perform one authentic signup using an authorized real inbox, confirm it deliberately, and retain it as a real subscriber record.
13. Verify Contact ID, explicit Topic opt-in, Segment membership, webhook receipts, and editor status without exposing personal data in evidence.
14. Compose one dashboard draft, run `activation-check`, open the staff-test window, send only to allowlisted staff inboxes, and wait for the fifteen-minute audit confirmation that the Broadcast stayed an unscheduled draft.
15. Do **not** click final Send to the Production Segment during activation. The first real newsletter requires its own authorized operational action after the release evidence is accepted.

**Rollback/incident evidence**

- Verify feature disablement stops new outbound/mutating work while webhook, Contact audit, and Broadcast audit continue.
- Verify the incident runbook covers schedule cancellation, provider-member restriction/Leave Team fallback, key rotation, complete audit, two-operator recovery, and the fact that queued/sent mail cannot be recalled.
- Record deployment ID, migration versions, test/build results, provider resource identifiers, readiness revisions, staff-test observation, audit completion, and rollback target without recording secrets, full addresses, message bodies, or raw provider payloads.

## Completion definition

Implementation is complete only when Tasks 1–12 pass locally/Preview, Task 13 activation evidence is recorded, the authentic subscriber flow works end to end, and no Production Segment Broadcast has been sent as part of activation.
