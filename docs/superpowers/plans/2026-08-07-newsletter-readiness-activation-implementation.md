# Newsletter Readiness and Production Activation Implementation Plan

**Design source:** `docs/superpowers/specs/2026-08-07-newsletter-readiness-activation-design.md`

**Status:** User-approved design; implementation starting

**Goal:** Ship the durable, fail-closed newsletter infrastructure while sending remains disabled; then complete provider/Auth SMTP gates and activate one authentic double-opt-in flow without synthetic data or a Production Segment Broadcast.

**Stack:** Next.js 16 App Router, React 19, Supabase/Postgres, Resend, Vitest, pgTAP, Playwright, Vercel Cron.

## Implementation rules

- Use red-green-refactor for every behavior change. Capture the intended failure before implementation.
- Keep `NEWSLETTER_EMAIL_ENABLED=false` through the infrastructure release.
- Use read-only provider adapters for inventory and preflight; no Broadcast send is implemented or invoked.
- Never seed a Production subscriber, Contact, submission, or placeholder record.
- Never print credentials, email addresses, message bodies, provider response bodies, or full resource identifiers.
- Keep `client-website-setup-operator-walkthrough.md` untracked and outside every commit.
- Apply only additive Supabase migrations; never reset, squash, or destructively roll back Production.

## Task 1: Add the durable reconciliation database contract

**Files**

- Create: `supabase/migrations/<timestamp>_newsletter_durable_readiness.sql`
- Create: `supabase/tests/39_newsletter_durable_readiness.test.sql`
- Modify: `scripts/verify-production-migration-lineage.mjs` only if required by its manifest contract

**Test first**

1. Specify the active-job uniqueness, invocation/failure split, fenced yield, expired-lease reclaim, eight-consecutive-failure circuit, owner recovery, and stale-owner denial.
2. Specify reconciliation runs, member evidence, command-bound requests, eligibility epoch, atomic ready/stale/blocked revision allocation, activation revisions, inventory attestations, and service-role-only access.
3. Specify latest-revision precedence, force-fresh request binding, successful compaction, forty-eight-hour abandonment, seven-day purge, and cross-site denial.
4. Run the pgTAP file and confirm the new tables/RPCs are absent.

**Implementation**

1. Add the tables, indexes, checks, foreign keys, RLS, grants, and security-definer RPCs from the approved design.
2. Replace or version the site-job claim/complete/fail operations without weakening existing subscription and Broadcast job behavior.
3. Make eligibility-changing newsletter RPCs advance the epoch and insert stale readiness within their transaction.
4. Keep all new return values to safe codes, counts, UUIDs, cursors, and digests.

**Verify**

- `npm run db:reset`
- `npm run test:db`
- `npm run verify:production-migrations`

## Task 2: Add typed resumable reconciliation

**Files**

- Modify: `lib/newsletter/resend/contracts.ts`
- Modify: `lib/newsletter/resend/contact-adapter.ts`
- Modify: `lib/newsletter/job-repository.ts`
- Modify: `lib/newsletter/segment-reconciliation.ts`
- Modify: `lib/newsletter/worker.ts`
- Modify: `app/api/newsletter/jobs/run/route.ts`
- Create or modify focused newsletter worker/reconciliation tests

**Test first**

1. Require full provider and local pagination, provider-only removal, explicit Topic opt-in, suppression rejection, cursor resume, idempotent replay, and zero-audience success.
2. Require checkpoint-and-yield across more than eight healthy invocations.
3. Require epoch mismatch restart, owned-mutation saga fencing, stale finalizer rejection, expired-lease recovery, circuit blocking, disabled abandonment, and evidence purge.
4. Confirm existing one-sided reconciliation fails these tests.

**Implementation**

1. Add the paginated Segment/member adapter operations and read-only Contact/Topic/suppression snapshots.
2. Move all cursor/evidence/finalization writes behind the new fenced RPCs.
3. Make the Cron route run database-only housekeeping in both enabled and disabled modes, then schedule/claim mutating work only when enabled.
4. Remove direct readiness inserts and unbounded local audience loops.

**Verify**

- focused Vitest suites
- `npm run test:newsletter`

## Task 3: Serialize protected Broadcast operations

**Files**

- Modify: `lib/newsletter/broadcast-operations.ts`
- Modify: `lib/newsletter/broadcast-repository.ts`
- Modify: `app/api/newsletter/operations/activation-check/route.ts`
- Modify: `app/api/newsletter/operations/staff-test/route.ts`
- Modify: `app/api/newsletter/operations/validate/route.ts`
- Modify: corresponding operation tests

**Test first**

1. Require every protected operation to create/replay a command-bound force-fresh request.
2. Require pending while the bound run is incomplete and refusal to reuse an older generic revision.
3. Require concurrent commands before run start to share it and commands arriving during a run to wait for its successor.

**Implementation**

Replace direct `segmentReconcile()` calls with service-role request/status operations and bind validation to the exact returned readiness revision.

**Verify**

- `npm test -- tests/newsletter-broadcast-operations.test.ts tests/newsletter-operations-routes.test.ts`

## Task 4: Add disabled provider inventory and semantic preflight

**Files**

- Modify: `lib/newsletter/config.ts`
- Create: `lib/newsletter/provider-inventory.ts`
- Create: `lib/newsletter/resend/inventory-adapter.ts`
- Create: `app/api/newsletter/operations/provider-inventory/route.ts`
- Create: `scripts/verify-newsletter-production-readiness.mjs`
- Modify: `package.json`
- Create or modify inventory/config/route tests

**Test first**

1. Require the disabled parser to validate hidden provider configuration independently of the feature flag.
2. Require the inventory adapter to expose read-only methods only and fully paginate every versioned resource category.
3. Require category-specific exact/mapped/empty/manual policies, safe failures, no mutation, and no PII/secrets in output.
4. Require initial mode zero audience/history, steady mode mapped authentic history, current activation digest, fresh non-API attestation, and live rerun by the enabled build.

**Implementation**

1. Implement `resend-district-newsletter-v1` and the safe resource-identity digest.
2. Add the owner-only disabled inventory route and a build command that runs structural plus applicable semantic checks before `next build`.
3. Keep the first-activation evidence write in a separate protected runtime command.

**Verify**

- focused config/inventory/route tests
- `npm run build` with disabled local configuration

## Task 5: Add Staff Portal setup, activation, and circuit recovery controls

**Files**

- Modify: `app/admin/editor/newsletter-operations-workspace.tsx`
- Modify: `lib/newsletter/operations-client.ts`
- Create: protected inventory-attestation, first-activation, and circuit-recovery routes
- Modify: Staff Portal tests

**Test first**

1. Require owner authorization, idempotent commands, nonempty recovery reason, and service-role-only database writes.
2. Require safe per-category inventory state while disabled and no raw provider data.
3. Require first activation to repeat initial checks and record evidence only after success.
4. Require the public form to remain unavailable until activation evidence and the exact latest ready revision exist.

**Implementation**

Add concise setup/status controls without adding a campaign composer or send button.

**Verify**

- focused workspace and route tests
- accessibility and keyboard interaction checks

## Task 6: Publish the exact managed-form revision

**Files**

- Create: a service-only script or command using the existing immutable managed-form command contract
- Modify: exact-copy tests and operations runbook if command usage needs clarification

**Test first**

Require exact consent label, pending-confirmation success text, required email/consent, optional first name, `marketing-v1`, and no mutation of prior submissions.

**Implementation**

Publish one new immutable `newsletter-signup` revision while the feature remains disabled; record its revision/history evidence.

**Verify**

- form projection tests
- read-only Supabase projection check

## Task 7: Verify and ship the disabled infrastructure release

1. Run migration checksum/lineage verification, local reset, pgTAP, focused tests, full Vitest, lint, and Production build.
2. Create a fresh encrypted backup and record the promoted rollback deployment.
3. Apply the additive migration with linked dry-run and advisor checks.
4. Deploy `--prod --skip-domain` with `NEWSLETTER_EMAIL_ENABLED=false`.
5. Verify routes, auth, Cron protection, disabled inventory UI, no provider mutation, and public phone fallback at desktop and 390px.
6. Promote the exact verified candidate and inspect Vercel/Supabase logs.

## Task 8: Complete provider/Auth SMTP activation gates

1. Run disabled automated inventory and record the owner-only non-API attestation.
2. Create a sending-only Site Auth SMTP key, configure Supabase Auth SMTP, and prove a fresh signed-out magic-link login.
3. Revoke the legacy Onboarding key only after proving the replacement, then prove a second signed-out login.
4. Rerun inventory; require the final three-key policy, no unrelated resources, zero initial newsletter audience, and zero historical newsletter sends.

No key value is entered into chat, source control, logs, or release evidence.

## Task 9: Enable and verify authentic double opt-in

1. Set `NEWSLETTER_EMAIL_ENABLED=true` for Production only.
2. Build a new `--prod --skip-domain` candidate; require live initial semantic preflight.
3. Promote the exact candidate; confirm the public form still falls back before activation evidence.
4. Run the owner-only first-activation command and observe the durable zero-audience reconciliation.
5. Verify the live form, then have the user submit one authentic approved inbox and confirm it.
6. Verify consent evidence, Contact, explicit Topic opt-in, Segment membership, signed webhook, logs, and history without recording the address.
7. Build one steady-state candidate to prove authentic audience/history no longer triggers the initial zero premise.

No Production Segment Broadcast is sent in this plan.
