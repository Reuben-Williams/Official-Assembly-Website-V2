# Staff authentication delivery evidence

## Purpose and approval

The owner approved an audited reconciliation of five verified authentication emails and a tracking repair so normal staff sign-ins do not block future releases. This is a narrowly scoped repair to the Morales newsletter readiness boundary, not a newsletter activation bypass or a new authentication provider.

The calendar, photograph and caption release remains staged until its existing readiness checks pass. This document completes the design review required before implementing this repair.

## Verified cause

`app/admin/login/login-form.tsx` currently sends `signInWithOtp` directly through the browser client. `app/auth/callback/route.ts` queues evidence only on the token-hash/email callback path. That workflow accepts only owner membership, the exact sign-in subject, and a completed login occurrence. It therefore cannot account for ordinary staff email requests, unredeemed links, or signup confirmations.

The five messages below have verified Resend sender/recipient/subject metadata and exactly one matched sent receipt and one matched delivered receipt in `resend-team-production`, without a broadcast ID. They currently lack a recognized local evidence record. Existing owner-login evidence is valid.

Delivery is not proof that a particular link was redeemed. Neither this repair nor its backfill may manufacture a login occurrence, session, successful-login timestamp, newsletter consent, or audience member.

## Approaches considered

1. **Separate delivery evidence and tracked requests (selected).** Preserve completed-owner-login proofs, add a distinct delivery classification for the five owner-approved messages, and track future staff requests before sending. This fixes both the immediate release blocker and its cause while retaining fail-closed checks.
2. **Reconcile only these five messages.** Smallest immediate change, but another unredeemed or non-owner sign-in could block the next release. This does not meet the approved durable-repair objective.
3. **Allow any message with an authentication-looking subject.** Simple, but a subject and recipient alone do not establish trusted origin. This would weaken the provider boundary and is rejected.

## Scope and invariants

- Use the existing Morales Supabase project, verified site registration, Resend management reader, SMTP configuration, webhook receipts and audit ledger. Do not change provider resources or credentials.
- Preserve authentication, membership, session-generation, callback return-path and completion-cookie checks. Grant no new memberships or roles. Damon is already an audited site owner; his upgrade is not repeated here.
- Keep newsletter double opt-in, suppression, staff-test, broadcast approval, inventory identity, owner-login and SMTP proofs unchanged.
- The preflight remains read-only. It must not send email, write evidence, run recovery, or silently reconcile history during a build.
- Unrecognized, ambiguous, failed, bounced, complained, wrong-scope or wrong-recipient messages continue to block readiness. No wildcard message IDs or automatic approval of signup/invitation/password-reset history.

## Units and data flow

### 1. Tracked staff sign-in request

Replace the browser's direct send with a same-origin, uncached POST route, `/api/builder/sign-in`. Accept a bounded JSON body containing email and a safe local return path. Enforce the existing configured-origin policy and reject cross-site requests before database or Auth calls. Invalid return paths use `/admin/editor`; callback origin comes from trusted configuration, not an arbitrary forwarded header.

A service-only database operation resolves the normalized address against a confirmed, non-anonymous Auth user joined to this site's current membership. All four existing staff roles may request sign-in; none receives new privileges. Unknown, unconfirmed, removed and nonmember addresses produce the same generic response without sending. Do not accept client-supplied user IDs, roles, request times or evidence IDs.

Before calling Auth, atomically reserve a database-timestamped request with a server-generated UUID, site, target user, membership generation, normalized-recipient SHA-256 digest and current policy version. Persistent limits are one reservation per target per 60 seconds, six per target per rolling hour, and twenty per site per rolling hour. Attempts consume their reservation even on failure. Concurrent reservations must share a per-site transaction lock; no in-memory limits. This adds no public newsletter-form limit or provider configuration change.

Use the request-scoped Supabase SSR/public-key client to call `signInWithOtp`, with `shouldCreateUser: false` and the existing callback path. Retain SSR cookie writes for PKCE. No service-role Auth send, automatic signup, secret in the browser, or sending retry after an uncertain outcome.

Record `accepted` only after the Auth API returns without error, with a database acceptance timestamp. A known API error becomes `failed`; timeout, process interruption or failure to persist the outcome remains `uncertain`. Sending is never repeated automatically. Bound the call to ten seconds, the route to thirty seconds, and do not start the Auth call after a failed reservation. Uncertain requests are not eligible for automatic evidence and require owner review.

Use generic wording such as “If this address has staff access, a secure sign-in link will arrive shortly.” Return no user IDs, membership result or detailed Auth error. A known infrastructure outage may produce a generic unavailable response. Keep browser submitting/retry state usable, with a 60-second wait before another request. Do not log addresses, tokens, links, cookies, raw requests or provider payloads.

### 2. Read-only delivery matcher

Add a focused metadata-only matcher and repository. It takes an accepted request and a bounded provider-email inventory; it returns a single candidate or a safe pending/ambiguous result. Eligible metadata must have:

- exact mailbox `no-reply@updates.assemblywomanmorales.com`;
- exact subject `Your sign-in link`;
- exactly one recipient whose normalized digest equals the reserved recipient digest;
- provider status sent/delivered/opened/clicked, with no negative delivery event;
- provider creation time between the reservation timestamp minus five seconds and acceptance timestamp plus five seconds, with total matching interval at most thirty seconds;
- exactly one matching request and one matching provider message in those overlapping windows.

Check all overlapping accepted/uncertain reservations, not only unprocessed requests, so a competing send is not hidden by an earlier evidence record. Exclude message IDs already used for confirmation, newsletter tests, broadcasts, SMTP setup or historical backfill. A completed owner-login proof may reference the same physical sign-in message: that is a separate factual claim, not another delivery, and must not starve either workflow. Do not alter existing owner-login proof validation or use a delivery as its substitute.

Before writing, require the existing signature-verified, matched receipts in the configured scope: exactly one `email.sent`, exactly one `email.delivered`, no broadcast ID, and no failed/bounced/complained/other unexpected event for that message. Recheck under the evidence-write transaction. Unknown receipt dispositions are not treated as matched. Missing or delayed receipts leave the request pending, not allowed.

Use bounded existing rate-paced metadata pagination: at most twenty pages and five seconds per request window. Exhaustion, invalid dates, cursor loops, unavailable provider or database errors fail closed. Never inspect message bodies or magic-link URLs. Periodic reconciliation is read-only at Resend; its only mutation is local audited evidence.

### 3. Separate immutable delivery evidence

Create service-only request/evidence tables with RLS and explicit revocation from PUBLIC, anon and authenticated. Persist evidence separately from `builder_newsletter_auth_login_evidence`. Each evidence row records site/scope, policy `resend-staff-auth-delivery-v1`, provider message ID, target user, recipient digest, purpose, provenance (`tracked_request` or `owner_approved_history`), provider creation time, request ID when applicable, sent/delivered receipt IDs, canonical metadata digest and audit correlation. Evidence is unique by site/provider message and tracked request.

Evidence writes are atomic and idempotent: identical repeats return already recorded; conflicting repeats fail without changing the original record. Evidence and its audit event commit together. No raw bodies, token hashes, credentials or email links are retained. Recipient digests are sensitive, not anonymized; keep them service-only and out of logs. Do not introduce a new deletion/retention policy for the existing audit ledger. Mutable request status remains separate from immutable evidence; access changes cannot rewrite past evidence or grant present access.

New privileged functions must have a fixed safe search path, fully qualified relations and explicit EXECUTE revocation/grants. Prefer invoker functions where privileges suffice; any necessary definer lookup stays internal/service-only. Verify anon/authenticated cannot select or write either table or invoke the privileged functions. Do not modify existing authenticated RLS rules to fix a service permission error.

### 4. Exactly five historical deliveries

The bounded reconciliation manifest is:

| Provider message | Target | Purpose |
| --- | --- | --- |
| `01a10f46-0578-7ea0-bb40-9b0a67302246` | Damon | staff sign-in delivery |
| `01a10f42-92f2-7c6a-92d7-af4105f4f749` | Damon | staff sign-in delivery |
| `01a10466-178c-721d-8b68-48cc14ca8238` | Damon | staff sign-in delivery |
| `01a0fb38-5f40-755d-ada4-e820dd4fc50b` | Damon | account confirmation delivery |
| `01a0fb38-b3bc-7d96-9065-8fe8ef2a7b9e` | existing owner | staff sign-in delivery |

Resolve target accounts by verified normalized addresses and membership; do not hardcode database-generated IDs in a migration. Damon address is `damonyoung@dtvprods.com`; existing owner is `anotherstory713@gmail.com`. For the confirmation only, require exact subject `Confirm your email address`; require `Your sign-in link` for the other four. Re-read exact provider metadata before applying; use actual provider dates, never estimated dates from the review notes.

Implement an owner-authorized dry-run/apply operation, with existing verified staff session, owner role, origin and CSRF checks. The service-only writer rechecks current operator ownership, the exact approved set and purposes, all five metadata/receipt matches, absence of conflicting classifications, and the digest of the dry-run plan. Apply all five records and their audit event atomically or none. A deterministic command and unique provider IDs make retries safe. Report counts and safe status, not message bodies or recipient lists.

This is a new policy, not an extension of the eleven-message August initial-history approval. Historical evidence explicitly states `owner_approved_history`, without a synthetic request, login occurrence or claimed redemption. Any additional message stays blocked and needs a new bounded review.

### 5. Runtime and readiness integration

Run the delivery reconciliation alongside the existing protected cron/worker before ordinary newsletter work, with leases/fencing and bounded retry/backoff. It must operate when newsletter sending is disabled or inventory is blocked, otherwise accounting could never recover; no contact, audience or outbound work is enabled by this exemption. Retry delayed receipts up to seven days, then retain an unresolved request for explicit owner review. An owner-checked recovery operation can retry accounting without resending an email.

Extend inventory evidence reads to validate the delivery policy, digest, scope, provenance and required receipts before adding its IDs to the allowed set. Invalid persisted evidence blocks readiness. Keep all twenty-two inventory categories, the existing owner-proof predicate and resource-identity digest enforcement. Do not auto-map new messages during an inventory read.

The callback continues to record genuine owner-login occurrences only for verified owners. Staff delivery is tracked at request time, independent of redemption. Make that role guard explicit instead of issuing an owner-only operation for other staff. Preserve both existing token-hash and PKCE session completion paths.

## Verification and release

1. Write failing tests before implementation: exact metadata and time boundaries, false positives, two competing requests/messages, delayed/duplicate/wrong-scope receipts, negative events, uncertainty, idempotency and conflicting writes. Verify existing owner proofs and all newsletter exclusions remain effective.
2. Cover sign-in UI/route: origin, body bounds, normalized membership, all existing roles, unknown/unconfirmed/nonmembers, persistent/concurrent limits, no signup, safe redirect, SSR cookies, accepted/failed/uncertain outcomes and no automatic resend. Cover both callback paths without using production magic links.
3. Test service-only permissions, RLS, immutable evidence/audit atomicity, receipt rechecks and exact-five backfill rollback. Verify migration lineage and security advisors. Do not restart Docker/WSL or run destructive production tests.
4. Run the five-message metadata dry run without provider mutation or email sending. Apply only after the manifest still matches its owner approval. Read back all five evidence and audit rows.
5. Run the full application suite, type checking and focused lint. Stage the complete release without assigning live domains; run the unchanged read-only newsletter preflight and responsive/public/admin checks. Promote only after readiness passes.
6. Publish the already-reviewed carousel draft after compatible code is live. Verify the one real future event, calendar links/download/feed, optional-Spanish controls, recoverable deletion UI, global caption toggle, approved portraits/guidance image and unchanged volunteer image. Do not create placeholder records or delete a real production event for QA.

## Rollback and limitations

The database addition is backward-compatible and append-only. Preserve reconciled evidence and its audits during a code rollback; do not erase history to emulate the previous state. A previous deployment does not understand the new policy and may re-block inventory, which is safer than bypassing it. Restore the prior public deployment only through the established reversible promotion/rollback workflow if public checks fail.

Portal-requested sign-ins are automatically accountable only when the strict match completes. Auth emails initiated directly from Supabase, signup/invite/reset messages, ambiguous sends and uncertain requests still require owner review. Email delivery is not a guarantee of inbox placement, login success, newsletter enrollment or permission. No translation provider, credential change or unsolicited verification email is part of this repair.
