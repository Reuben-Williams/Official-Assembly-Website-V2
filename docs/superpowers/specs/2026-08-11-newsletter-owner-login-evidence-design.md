# Newsletter Owner Login Evidence Design

**Status:** Approved approach, revised after safety review

**Date:** 2026-08-11

**Production site:** `https://www.assemblywomanmorales.com`

**Site ID:** `a3f57b25-df25-4d98-9ff6-a4a3f3a00a68`

## Problem

The newsletter production-readiness gate fails closed when Resend contains an email that has no durable local evidence. That behavior is correct for unrelated email, but the current evidence model recognizes only the two initial Auth SMTP proofs and a frozen one-time setup-history reconciliation.

On 2026-08-11, a normal Staff Portal magic-link email was sent at `21:24:21Z`, its matched `email.sent` and `email.delivered` webhooks were recorded, and the owner completed sign-in at `21:24:29Z`. The message was nevertheless unmapped, so the next production build stopped before deployment. Future owner sign-ins would repeat the same failure.

## Goals

- Record durable evidence for every verified future owner magic-link login.
- Preserve the production inventory's fail-closed treatment of unrelated email.
- Handle callback-before-webhook, webhook-before-callback, duplicate callback, duplicate webhook, and later-login ordering.
- Keep authentication successful even if evidence reconciliation is temporarily unavailable.
- Avoid storing addresses, address hashes, message bodies, sign-in tokens, provider payloads, raw provider errors, or provider credentials in evidence and logs.
- Reconcile the already verified 2026-08-11 owner login so the approved production release can proceed.

## Non-goals

- Do not weaken or bypass the newsletter production-readiness gate.
- Do not classify password recovery, invitation, newsletter confirmation, Broadcast, or arbitrary transactional email as owner-login evidence.
- Do not send email, create subscribers, alter Contacts, or mutate Resend resources.
- Do not change or satisfy the two historical replacement/post-revocation Auth SMTP proof requirements.

## Considered approaches

### 1. Durable post-login evidence (selected)

After a successful Staff Portal email OTP exchange, atomically persist a non-PII login occurrence and a durable reconciliation job. The existing newsletter cron worker correlates that immutable occurrence with exact Resend metadata and matched local delivery receipts, then records separate ongoing-login evidence.

This fixes the lifecycle rather than expanding a frozen allowlist. It uses the project's existing lease, fencing, retry, and cron model, while future sign-ins no longer require manual release work.

### 2. Manual reconciliation after each login

Expose a Staff Portal button that repeats the correlation and recording step. This is operationally explicit, but it makes normal authentication an ongoing deployment prerequisite and is easy to forget.

### 3. Append the current provider message ID

Add the latest ID to the initial-history allowlist. This is the smallest immediate change, but the next legitimate magic link would block production again.

## Architecture

### Immutable login occurrences

Add `public.builder_newsletter_auth_login_occurrences` with:

- `site_id`, `id`, and `command_id`;
- `operator_id` with a composite foreign key to `builder_site_members(site_id, user_id)`;
- the exact `auth_last_sign_in_at` observed in the successful OTP result;
- `policy_version = 'resend-owner-login-v1'`;
- `expires_at`, `recorded_at`, and `created_at`.

It stores no email address, address hash, token, provider identifier, or message content. Constraints include `UNIQUE(site_id, command_id)` and `UNIQUE(site_id, operator_id, auth_last_sign_in_at)`. Occurrences are immutable.

`public.builder_record_newsletter_auth_login_occurrence_v1(jsonb)` is a security-definer RPC with an empty search path. Under a site-scoped advisory transaction lock it:

1. accepts an exact, versioned request with only `version`, `siteId`, `operatorId`, `commandId`, and `authLastSignInAt`;
2. requires the operator to be an active site owner;
3. accepts the timestamp only from the successful server-side `verifyOtp` result; the protected application callback is the trusted assertion and the RPC does not re-read mutable `auth.users.last_sign_in_at`;
4. requires a deterministic server-generated UUID derived from policy version, site ID, operator ID, and the exact Auth sign-in timestamp;
5. atomically inserts the occurrence and one `newsletter.auth_login.reconcile` site job;
6. replays only when the deterministic command and every occurrence field match, and rejects same-command/conflicting-occurrence or same-occurrence/conflicting-field requests.

The callback captures the successful OTP result before any other lookup and awaits this bounded database-only RPC. A strict timeout and catch-all preserve the existing successful redirect if recording is unavailable. Login A remains recordable even when login B completes before A's RPC because A's trusted callback timestamp is never compared with mutable current Auth state. If the database RPC is unavailable, login still succeeds and the inventory remains fail-closed; recovery requires an explicit owner-reviewed backfill rather than inferred approval.

### Durable reconciliation job

Extend `builder_newsletter_site_jobs` with:

- `kind = 'newsletter.auth_login.reconcile'`;
- nullable `auth_login_occurrence_id` with a composite foreign key to the occurrence;
- exactly one active job per occurrence;
- the existing queued, leased, retryable-failed, completed, and terminal-failed states, fencing token, lease expiry, attempt counter, and safe failure code.

The claim RPC returns the occurrence ID for this job kind. Auth-login reconciliation is read-only at the provider and runs even when newsletter sending is disabled. The existing complete/fail transitions remain lease- and fencing-protected. Attempts use the existing exponential backoff, stop after 12 attempts or occurrence expiry (seven days), and retain a terminal safe failure code. No failure opens the Broadcast/audience reconciliation circuit because this job has its own boundary.

The cron route is the only job processor and runs at least every five minutes. The callback and owner recovery only enqueue or requeue work; neither calls the correlation handler. Every provider read and evidence write therefore starts from an atomically claimed job with a worker ID, live lease, and fencing token. Auth-login jobs remain claimable while newsletter sending is disabled because they are provider-read-only and do not send email.

Both timing orders converge:

- webhook before callback: the occurrence job immediately finds both receipts;
- callback before webhook: the job retries until both receipts exist;
- duplicate callbacks: the deterministic command, occurrence, and job replay idempotently;
- duplicate webhooks: the webhook receipt layer remains idempotent and the job observes one logical sent/delivered pair.

### Provider correlation

Add an email-only Resend reader. It never invokes the full 22-category inventory collector. For one occurrence it:

1. searches newest-first;
2. requests at most 100 records per page;
3. stops once message timestamps precede the occurrence's one-hour window;
4. stops after 20 pages or five seconds, whichever comes first;
5. returns a safe unavailable result when a provider page or cursor is invalid.

The correlation handler requires exactly one unused candidate with:

- subject exactly `Your sign-in link`;
- sender mailbox exactly `no-reply@updates.assemblywomanmorales.com`;
- exactly one normalized recipient, equal to the owner email resolved server-side;
- provider `last_event` in `sent`, `delivered`, `opened`, or `clicked`;
- provider creation time at or before the immutable occurrence and no more than one hour earlier;
- a provider message ID absent from confirmation jobs, staff tests, initial-history reconciliation, initial Auth SMTP proofs, and ongoing owner-login evidence.

Zero or two valid candidates record nothing. The matched `email.delivered` receipt, not mutable `last_event`, is the semantic delivery proof.

### Ongoing login evidence

Add `public.builder_newsletter_auth_login_evidence` with:

- `site_id`, `id`, `command_id`, and `occurrence_id`;
- `operator_id` with the composite member foreign key;
- `provider_message_id`, `provider_created_at`, and `auth_last_sign_in_at`;
- `policy_version = 'resend-owner-login-v1'`;
- a secret-safe SHA-256 digest;
- `recorded_at` and `created_at`.

Constraints include `UNIQUE(site_id, command_id)`, `UNIQUE(site_id, occurrence_id)`, and `UNIQUE(site_id, provider_message_id)`. The digest inputs are only policy version, site ID, operator ID, occurrence ID, provider message ID, provider-created timestamp, and Auth sign-in timestamp. It never includes an email address or address hash, token, subject, body, raw payload, raw provider error, or credential.

`public.builder_record_newsletter_auth_login_evidence_v1(jsonb)` uses an empty search path, a site-scoped advisory lock, exact request keys, compare-all-fields idempotency, and these checks:

1. the occurrence exists, is unexpired, and belongs to the same owner and site;
2. supplied occurrence/sign-in values equal the immutable occurrence, not mutable current Auth state;
3. provider creation precedes the occurrence by no more than one hour;
4. one matched `email.sent` and one matched `email.delivered` receipt exist for the message in `resend-team-production`;
5. neither receipt carries a Broadcast ID;
6. every current receipt for the message is a harmless Auth lifecycle event: `email.sent`, `email.delivered`, `email.opened`, or `email.clicked`.

The read-only inventory revalidates each ongoing evidence row against current receipts. A later `email.opened` or `email.clicked` remains allowed. Any `email.failed`, `email.bounced`, `email.complained`, `email.suppressed`, Broadcast ID, unexpected event, malformed policy row, or evidence-table read failure blocks inventory instead of allowlisting the message.

### Authentication callback

Only a successful `verifyOtp({ type: 'email' })` path records an occurrence. The callback captures `result.data.user.id` and `result.data.user.last_sign_in_at`, derives the deterministic command ID, calls the bounded occurrence RPC, and returns the existing redirect regardless of occurrence-recording failure. Unsupported token types, failed exchanges, and non-owner accounts do not enqueue jobs.

The code logs only stable event names and safe codes. It does not log query parameters, email addresses, tokens, provider metadata, provider payloads, or exceptions containing provider/database details.

### Owner recovery

The Newsletter Operations workspace receives `Reconcile pending owner logins`. Its protected mutation route uses the existing owner authorization and CSRF contract. The client supplies only a fresh command ID. Site ID, operator ID, occurrences, timestamps, provider identifiers, and candidate metadata are server-derived.

The route requeues unresolved, unexpired occurrences under a site-scoped lock and returns their safe queued count. Only the cron worker can claim and process those jobs. It is not a general history approval and cannot create an occurrence or select an arbitrary provider message. Expired or absent occurrences require a separate explicit forensic backfill.

### Existing orphaned login

The 2026-08-11 login predates occurrence recording. Provide versioned, exact-target dry-run and apply SQL operator artifacts for only provider message `db73a773-8609-462c-ac57-3545a535e9d5` and owner sign-in `2026-08-11T21:24:29.356981Z`.

Before apply:

1. the dry run verifies the owner membership and exact current Auth timestamp;
2. it verifies the two matched, non-Broadcast sent/delivered receipts and rejects any disqualifying receipt;
3. an operator reviews the Resend dashboard metadata against the exact subject, sender, single recipient, allowed state, and one-hour window;
4. the user gives exact production backfill approval.

The apply artifact calls the same occurrence and evidence RPCs with a deterministic command ID and digest. It does not add a static provider allowlist. Both artifacts print only safe booleans, timestamps, counts, policy versions, and message IDs—never addresses, content, tokens, payloads, raw errors, or credentials.

## Authorization and privileges

Both new tables have RLS enabled. Explicitly revoke all table and RPC access from `public`, `anon`, and `authenticated`. Grant the minimum table privileges and RPC execution only to `service_role`. Recording RPCs validate exact object keys, active owner membership, site scoping, timestamp windows, policy versions, digests, and idempotency under advisory locks.

The recovery HTTP route uses the existing session, owner-role, origin, and CSRF checks. The cron route retains its timing-safe `CRON_SECRET` authorization. No browser request can submit provider IDs or timestamps.

## Inventory integration

The provider inventory evidence repository adds ongoing evidence IDs to `allowedProviderMessageIds` only after loading and revalidating their current receipts. Existing sources remain unchanged. Therefore:

- verified ongoing evidence satisfies only the transactional-email category;
- it cannot satisfy `replacement_login` or `post_revocation_login`, whose booleans still derive solely from `builder_newsletter_auth_smtp_proofs.proof_kind`;
- unrecorded, malformed, disqualified, ambiguous, or unrelated email still produces `unmapped_email_history`;
- Broadcast validation, confirmations, staff tests, and historical setup proofs keep their current independent rules.

The build preflight remains strictly read-only. Tests prohibit it from calling any RPC, insert, update, delete, provider send, or provider mutation.

## Failure handling

- Occurrence RPC timeout: login redirect remains successful; no occurrence is inferred later.
- Missing or ambiguous Resend candidate: retry until bounded expiry; record nothing.
- Missing or late webhook: retry; callback-before-webhook converges through cron.
- Duplicated, mismatched, Broadcast, or disqualifying receipt: fail closed.
- Provider/database timeout: retry with a safe code; no raw error is retained.
- Non-owner account: no occurrence or job is recorded.
- Duplicate callback/job: deterministic-command, compare-all-fields idempotent replay.
- New unrelated provider email: production build fails closed with `unmapped_email_history`.
- Terminal occurrence: inventory remains blocked and owner recovery displays a safe, actionable state.

## Test contract

### Unit and route tests

- exact metadata and time window selects one candidate;
- wrong subject, sender, recipient cardinality, recipient, status, or time window selects none;
- two valid candidates remain fail-closed;
- email-only reader stops at the time boundary, page limit, and wall-clock limit;
- already used IDs are excluded;
- callback records only after successful email OTP, captures immutable values, and derives a deterministic command;
- login A still records when login B verifies before A's occurrence RPC;
- same-occurrence/different-command and same-command/conflicting-occurrence requests fail closed;
- redirect remains unchanged when occurrence recording rejects or times out;
- unsupported token types never enqueue;
- recovery is owner/CSRF protected and accepts only a command ID;
- provider inventory revalidates ongoing rows and blocks on table/read/policy/receipt errors;
- ongoing evidence never satisfies either historical Auth SMTP proof.

### Durable ordering tests

- receipt-before-callback completes;
- callback-before-receipt retries then completes;
- login A reconciles after login B changes current Auth state;
- duplicate callbacks, duplicate jobs, and duplicate webhooks replay safely;
- cron/callback and cron/recovery races never execute an unclaimed handler;
- stale fencing tokens are rejected;
- auth-login jobs remain claimable while sending is disabled;
- an expired occurrence terminates without allowlisting;
- malformed job/occurrence/evidence state fails closed.

### Database tests

- browser roles cannot read or write either table or execute either RPC;
- service-role requests must name an active owner;
- occurrence recording trusts only the successful callback assertion and is unaffected by a later mutable Auth timestamp;
- evidence references the immutable occurrence after later Auth changes;
- exact sent/delivered non-Broadcast receipts are required;
- allowed later open/click receipts pass, while disqualifying events block;
- command, occurrence, and message replay is compare-all-fields idempotent;
- conflicts and cross-site references are rejected;
- site-scoped locks and lease fencing prevent duplicate completion.

### Build and release tests

- production preflight performs no RPC, insert, update, delete, send, or provider mutation;
- local migration/reset and pgTAP cover both new tables, RPCs, job transitions, and privileges;
- focused newsletter/auth tests, migration verifiers, lint, TypeScript, full suite, and production build pass.

## Release sequence

1. Run local migration/reset, pgTAP, unit/integration tests, lint, TypeScript, and non-production build.
2. Apply the additive production migration and verify local/remote migration parity.
3. Run the exact-target orphan dry run and complete the Resend dashboard metadata review.
4. With explicit approval, run the exact-target apply artifact and verify the provider inventory is ready without sending email.
5. Run the strictly read-only production preflight and build.
6. Deploy the application and verify the live homepage, alerts API, authenticated editor route, alert scrolling, recovery status, newsletter readiness, and runtime logs.

The migration precedes every build that reads the new tables. The orphan operator artifacts are named, versioned, reviewed, exact-target, and separate from the build.

## Rollback

Rollback disables callback/recovery writers and new job scheduling first. It retains read-only consumption and receipt revalidation of already-recorded ongoing evidence, so the known message does not become unmapped during rollback. Existing occurrences and evidence remain immutable audit records.

A later cleanup migration may remove dormant job/RPC code only after Resend retention no longer returns the affected provider messages and a read-only inventory proves removal cannot remap current history.
