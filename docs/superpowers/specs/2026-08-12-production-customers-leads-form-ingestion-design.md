# Production Customers, Leads, and Form Ingestion Design

**Date:** 2026-08-12

**Status:** Approved by standing user authorization on 2026-08-12

**Project:** Official Assembly Website V2

## Objective

Make the production **Customers**, **Leads**, **Overview**, and **Submissions** workspaces reliably accessible to authorized staff and connect first-party public form submissions to durable, site-scoped growth records.

The system must preserve truthful intent classification:

- every accepted first-party form participant creates or updates one deduplicated Customer;
- the approved Contact form also creates a Lead;
- newsletter-only signups remain Customers with newsletter consent and subscription state, but do not create Leads;
- the current Google volunteer form and any future form types are not silently imported or represented as connected. Adding a first-party volunteer or other staff-follow-up form requires a separate reviewed form-revision and ingestion contract.

No synthetic or placeholder production records are permitted.

## Existing-state findings

The production Supabase project already contains the required growth schema, active module configuration, current entitlement evidence, and an authorized owner membership. Read-only production queries confirm that a real newsletter submission created one canonical Customer and no Lead, which is the intended newsletter classification. Direct database growth RPC calls return the Customer and dashboard facts successfully.

The live Vercel deployment receives requests for Customers, Leads, Overview, and Submissions, but each request returns HTTP 401. The editor page can remain visible after its separate signed editor cookie expires, so the workspaces report that production data is unavailable even when the underlying Supabase user session remains renewable. This is a shared session-boundary failure, not a missing database, entitlement, or ingestion feature.

Production is also running an older application revision using the 0.2.6 package profile. The repaired release must include the already-approved 0.3.0 package attachment and must be verified as one exact deployment.

## Considered approaches

### 1. Fail closed on expiry and preserve intent-aware ingestion - recommended

On a growth API 401, the client stops and directs the staff member through the normal login flow with the current editor location encoded as a safe local return path. Staff must complete fresh authentication before a new signed editor session is issued. A still-valid older Supabase session is not sufficient by itself to mint that session.

This approach preserves the existing Supabase identity, site membership, signed preview-session, session-generation revocation, origin, capability, entitlement, and site-scoping boundaries. It repairs the misleading unavailable state across all four workspaces without allowing an expired, tampered, membership-removed, account-revoked, or generation-revoked session to renew itself.

The existing strict managed-form transaction remains the durable ingestion boundary. Classification is made from the approved form revision, not from browser-supplied intent labels.

### 2. Lengthen the editor cookie lifetime

This reduces how often the failure appears but does not eliminate it. A stale editor shell would still eventually outlive its authorization, and a longer bearer lifetime increases exposure after a device is left unattended. Rejected.

### 3. Authorize growth APIs from the Supabase session alone

This would remove the signed editor-session check from growth requests. It broadens the trust boundary, creates inconsistent authorization between editor domains, and weakens session revocation semantics. Rejected.

## Architecture

### Editor session expiry and reauthentication

The browser growth client keeps its current same-origin, no-store POST contract. A focused typed request helper performs this bounded sequence:

1. Send the growth request with same-origin credentials.
2. Preserve the HTTP status and stable server error code in a typed client error.
3. If the response is 401 `AUTH_REQUIRED`, navigate once to `/admin/login` with the current editor path and query encoded as a validated, same-origin `returnTo` value.
4. Do not retry the request and do not call the session-issuance endpoint automatically.
5. Treat 403, 409, and 5xx outcomes according to their actual category rather than as authentication expiry.

There is no automatic renewal, retry loop, background heartbeat, extended token lifetime, service-role exposure, or client-side membership decision. A deliberate session-generation bump, invalid signature, membership removal, or account revocation therefore remains effective until the user completes the approved authentication flow again.

The successful magic-link callback creates a cryptographically random, short-lived, single-use login-completion proof. Only a digest is stored in an additive private proof table. The proof is bound to the site, authenticated user, current membership/session generation, and expiry, then delivered in a Secure, HttpOnly, SameSite=Strict cookie scoped to the session endpoint. `POST /api/builder/session` atomically consumes that proof before issuing the signed editor cookie. Missing, expired, replayed, user/site-mismatched, membership-removed, or generation-stale proofs fail closed. The endpoint clears the proof cookie after either consumption or terminal rejection. Direct calls carrying only an older Supabase session cannot mint a new editor session.

The proof table has RLS enabled with no browser policy, no `anon` or `authenticated` grants, and service-role-only access. The migration is additive and applied before the application release. The earlier 0.2.6 application ignores the table and remains compatible with rollback.

The workspace presentation distinguishes authentication expiry from service unavailability. An expired session prompts sign-in; empty data produces an honest empty state; forbidden access produces an access message; a genuine storage/query outage remains an unavailable state.

### Mutation request protection

Growth query handlers retain their package-enforced same-origin checks and never mutate state. Every growth operation sends the current `builder_csrf` cookie value as `x-builder-csrf` and the server verifies it against the CSRF value in the signed editor session before calling persistence. The package already requires an exact same-origin request before parsing an operation. Missing, invalid, or stale CSRF values fail with HTTP 403 and a stable authorization code; they never reach a database mutation. Client errors preserve the server status and code.

### Form-to-growth classification

Accepted first-party managed forms use server-owned, revision-pinned configuration:

| Form intent | Customer | Lead | Notes |
|---|---:|---:|---|
| Newsletter signup | Yes | No | Store consent, locale, confirmation, and subscription state |
| Approved Contact form | Yes | Yes | Lead enters the staff follow-up pipeline |
| External Google or third-party form | No automatic import | No automatic import | Requires replacement or separately approved integration |

The server ignores any public request field that attempts to select the growth consumer. The exact approved template identity determines behavior: `local-business.newsletter-signup` is Customer-only and `local-business.contact` is Customer-plus-Lead. Customer matching, submission storage, consent recording, and optional Lead creation execute through the existing strict, idempotent, site-scoped ingestion RPC.

The current strict schema supports only these two templates and remains unchanged in this release. No new form-configuration key is added, so existing schema-v1 form revisions and rollback to the 0.2.6 application remain compatible. Any future first-party form classification requires an additive, revision- and digest-bound platform migration, migration-before-application rollout, backward-compatible reads, package release, database tests, and separate approval.

The term **Customer** is retained because it is the platform workspace name, but the records represent site contacts or constituents and do not imply a commercial purchase.

### Existing and future records

Existing production Customers and submissions are preserved. The release does not retroactively turn newsletter-only Customers into Leads. Production reconciliation or backfill is out of scope and prohibited in this release; preflight and verification remain read-only.

For Contact, an ambiguous or conflicting identity is not accepted as a partial submission: the strict transaction rolls back the submission, consent, Customer, and Lead together and returns a safe unavailable/conflict outcome. Staff must resolve the existing identity records through separately authorized Customer tooling before the visitor retries. Newsletter identity matching remains exact-email and site-scoped.

## Security and privacy

- Supabase publishable credentials remain client-visible; service-role credentials remain server-only.
- Every growth query and mutation verifies the Supabase user, site membership, signed editor session, session generation, module entitlement, capability scope, and site identifier.
- Expired or rejected sessions are never automatically renewed. Fresh session issuance requires an atomically consumed login-completion proof from the successful magic-link callback and never accepts a target user, site, role, or capability from the browser.
- Every growth mutation requires same-origin validation and CSRF verification before persistence.
- Form ingestion remains protected by approved revision, Turnstile, allowed-origin, rate-limit, idempotency, consent, and transaction checks.
- Public payloads cannot select whether a Lead is created.
- Logs and release evidence record only safe IDs, status codes, timing, and counts; they never include form bodies, email addresses, phone numbers, session tokens, or consent content.
- Existing RLS, RPC grants, and additive migration lineage remain authoritative. No permissive client table access or entitlement bypass is added.
- Direct identifiers (name, email, phone, address/ZIP), constituent-service free text, Lead notes, consent evidence, and stable pseudonymous identifiers are private constituent data. Browser projections expose only fields authorized for the active role and site; logs and telemetry redact values; search is site-scoped; exports and deletion require their existing elevated controls; legal or records holds block deletion with audited reason codes.
- The retention, correction, export, deletion/redaction, merge-review, consent, audit, and legal-hold lifecycle in `2026-08-05-production-staff-portal-growth-launch-design.md` remains authoritative. Newsletter data may be used for the approved marketing-email purpose; Contact data may be used for constituent follow-up. Neither purpose is silently broadened.

## Error handling

- 401 `AUTH_REQUIRED`: stop, preserve the current local return path, and require fresh sign-in. Do not retry or renew automatically.
- 403 or restricted projection: show an access message; do not retry as authentication.
- 5xx/query error: show a truthful production-service unavailable state and retain a manual retry control.
- Empty Customer or Lead results: show a genuine zero-record state, not an unavailable message.
- Ingestion failure: commit no partial submission, Customer, Lead, or consent result and never display success.
- Duplicate public-form retry: return the original committed result without creating duplicate records.
- Ambiguous Contact identity: roll back the complete strict transaction and return no success acknowledgement.

## Testing and verification

### Automated tests

- A successful growth request returns without authentication navigation.
- A 401 preserves status/code and triggers one sign-in navigation with a safe local return path, without retrying or calling session issuance.
- Concurrent 401 responses do not create navigation or request loops.
- Expired, malformed, signature-invalid, generation-revoked, membership-removed, and account-revoked sessions cannot access data or automatically renew.
- A freshly authenticated member can receive a new editor session through the existing approved login flow.
- Direct session POST with only an old Supabase session, and missing, expired, replayed, user/site-mismatched, membership-removed, or generation-stale login-completion proofs fail closed.
- Mutations include the current CSRF token; missing, invalid, and stale tokens fail 403 before persistence.
- Cross-origin query and operation requests fail before authorization/persistence.
- 403 and 5xx responses are not treated as renewable authentication failures.
- Newsletter ingestion creates or matches a Customer and consent state without a Lead.
- Contact and approved staff-follow-up ingestion create or match a Customer and create/link one Lead.
- Duplicate submissions do not duplicate Customers or Leads.
- Ambiguous Contact identities roll back submission, consent, Customer, and Lead atomically and never merge automatically.
- Public attempts to choose an ingestion consumer are ignored or rejected.
- Cross-site access and unauthorized roles fail closed.
- Role projections, log redaction, purpose limitation, retention, deletion/redaction, export, and legal-hold controls preserve the authoritative privacy lifecycle.
- Existing schema-v1 Contact and Newsletter revisions remain valid, and the prior 0.2.6 deployment remains compatible with the unchanged schema.

### Database verification

- Run the isolated database tests for strict ingestion, deduplication, consent, site scoping, and rollback.
- Confirm migration lineage and function checksums.
- Verify the additive login-completion proof table, RLS, grants, expiry cleanup, and atomic single-use consumption.
- Run Supabase security and performance advisors and review relevant findings.
- Use read-only production checks to confirm module state, Customer/Lead counts, RPC authorization, and the absence of reconciliation writes before deployment.
- Do not insert synthetic production records.

### Deployment and browser acceptance

1. Build and test the exact website revision using the approved 0.3.0 package set.
2. Apply the additive login-completion proof migration in the protected environment before deploying the application.
3. Deploy a protected Vercel preview and verify login, deliberate session expiry, single-use proof issuance/consumption, direct reissue denial, revoked-session denial, CSRF enforcement, Customers, Leads, Overview, and Submissions.
4. Confirm empty Leads and populated Customers render as data states rather than unavailable states.
5. Verify the contact and newsletter UI without submitting synthetic production data.
6. Apply the verified additive proof migration to production, then promote the exact verified application deployment.
7. Confirm the production alias points to the approved commit and package profile.
8. Review Vercel runtime logs for successful growth routes and absence of new authorization/error clusters.
9. Leave existing authentic records intact and avoid provider side effects.

## Rollback

- Record the current production deployment before promotion.
- A web regression rolls back by promoting the recorded Vercel deployment.
- Growth workspaces can be disabled through their existing entitlement/configuration boundary without deleting records.
- Database changes, if required, are additive; rollback never drops constituent, consent, submission, Customer, Lead, or audit data.
- Authentication navigation can be removed independently while protected APIs continue to fail closed.
- The previous 0.2.6 deployment must continue to operate against the unchanged production schema.

## Acceptance criteria

- An authorized staff member can open Customers, Leads, Overview, and Submissions in production.
- An expired editor session is sent through fresh sign-in with a safe local return path and is not automatically renewed or retried.
- An invalid, tampered, membership-removed, account-revoked, or generation-revoked session cannot read growth data or renew itself.
- A new editor session requires a fresh, short-lived, single-use, user/site/generation-bound login-completion proof; an older Supabase session alone cannot issue it.
- Every growth mutation enforces same-origin and CSRF validation before persistence.
- Existing authentic newsletter signups appear as Customers and do not create Leads.
- Every accepted Contact submission creates or matches a Customer and creates/links a Lead atomically; every accepted Newsletter submission creates or matches a Customer without a Lead.
- Ambiguous Contact identities commit no partial records and produce no false success.
- Empty Leads is displayed as an empty state.
- No duplicate, cross-site, synthetic, or placeholder records are introduced.
- No production reconciliation or backfill runs as part of this release.
- The live Vercel aliases point to the exact tested 0.3.0 application revision.
- Automated tests, isolated database tests, production build, preview browser acceptance, live read-only checks, and runtime-log review pass.
