# Production Customers, Leads, and Form Ingestion Design

**Date:** 2026-08-12

**Status:** Approved by standing user authorization on 2026-08-12

**Project:** Official Assembly Website V2

## Objective

Make the production **Customers**, **Leads**, **Overview**, and **Submissions** workspaces reliably accessible to authorized staff and connect first-party public form submissions to durable, site-scoped growth records.

The system must preserve truthful intent classification:

- every accepted first-party form participant creates or updates one deduplicated Customer;
- contact, constituent-service, volunteer, and other staff-follow-up submissions also create a Lead;
- newsletter-only signups remain Customers with newsletter consent and subscription state, but do not create Leads;
- external forms, including the current Google volunteer form, are not silently imported or represented as connected until they are replaced by an approved first-party managed form or a separately approved provider integration.

No synthetic or placeholder production records are permitted.

## Existing-state findings

The production Supabase project already contains the required growth schema, active module configuration, current entitlement evidence, and an authorized owner membership. Read-only production queries confirm that a real newsletter submission created one canonical Customer and no Lead, which is the intended newsletter classification. Direct database growth RPC calls return the Customer and dashboard facts successfully.

The live Vercel deployment receives requests for Customers, Leads, Overview, and Submissions, but each request returns HTTP 401. The editor page can remain visible after its separate signed editor cookie expires, so the workspaces report that production data is unavailable even when the underlying Supabase user session remains renewable. This is a shared session-boundary failure, not a missing database, entitlement, or ingestion feature.

Production is also running an older application revision using the 0.2.6 package profile. The repaired release must include the already-approved 0.3.0 package attachment and must be verified as one exact deployment.

## Considered approaches

### 1. Renew the bounded editor session and preserve intent-aware ingestion - recommended

On the first authenticated growth API 401, the client requests a new short-lived editor session from the existing server-controlled session endpoint, then retries the original request once. If renewal or the retry fails, the client stops and directs the staff member through the normal login flow with a safe return path.

This approach preserves the existing Supabase identity, site membership, signed preview-session, origin, CSRF, capability, entitlement, and site-scoping boundaries. It repairs all four workspaces at their shared failure point and retains the existing secure session lifetime.

The existing strict managed-form transaction remains the durable ingestion boundary. Classification is made from the approved form revision, not from browser-supplied intent labels.

### 2. Lengthen the editor cookie lifetime

This reduces how often the failure appears but does not eliminate it. A stale editor shell would still eventually outlive its authorization, and a longer bearer lifetime increases exposure after a device is left unattended. Rejected.

### 3. Authorize growth APIs from the Supabase session alone

This would remove the signed editor-session check from growth requests. It broadens the trust boundary, creates inconsistent authorization between editor domains, and weakens session revocation semantics. Rejected.

## Architecture

### Editor session recovery

The browser growth client keeps its current same-origin, no-store POST contract. A focused session-aware request helper performs this bounded sequence:

1. Send the growth request with same-origin credentials.
2. If the response is not 401, return it unchanged.
3. If it is 401, coalesce concurrent renewal attempts into one POST to `/api/builder/session`.
4. If renewal succeeds, retry the original growth request exactly once.
5. If renewal fails or the retry still returns 401, raise a stable authentication-required error and navigate to `/admin/login` with the current editor URL as a validated, same-origin `returnTo` value.

There is no infinite retry, background renewal loop, extended token lifetime, service-role exposure, or client-side membership decision. State-changing growth calls retain idempotency keys across the single retry so a network ambiguity cannot create a duplicate mutation.

The workspace presentation distinguishes authentication expiry from service unavailability. An expired session prompts sign-in; empty data produces an honest empty state; a genuine storage/query outage remains an unavailable state.

### Form-to-growth classification

Accepted first-party managed forms use server-owned, revision-pinned configuration:

| Form intent | Customer | Lead | Notes |
|---|---:|---:|---|
| Newsletter signup | Yes | No | Store consent, locale, confirmation, and subscription state |
| Contact or constituent service | Yes | Yes | Lead enters the staff follow-up pipeline |
| First-party volunteer interest | Yes | Yes | Enabled only after a managed volunteer form is approved and published |
| Other approved staff-follow-up form | Yes | Yes | Requires an explicit approved growth consumer in the form revision |
| External Google or third-party form | No automatic import | No automatic import | Requires replacement or separately approved integration |

The server ignores any public request field that attempts to select the growth consumer. Customer matching, submission storage, consent recording, and optional Lead creation execute through the existing strict, idempotent, site-scoped ingestion RPC. Ambiguous identity matches remain reviewable and are not merged heuristically.

The term **Customer** is retained because it is the platform workspace name, but the records represent site contacts or constituents and do not imply a commercial purchase.

### Existing and future records

Existing production Customers and submissions are preserved. The release does not retroactively turn newsletter-only Customers into Leads. Any authentic contact submission already processed without a Lead is eligible for a bounded, idempotent reconciliation based on its immutable approved form revision; reconciliation must never infer intent from free text or create a Lead for newsletter consent alone.

Future first-party form revisions must declare either `customer_only` or `customer_and_lead` through the server-owned managed-form configuration. Publishing is rejected when an unknown or missing ingestion classification would otherwise make collection ambiguous.

## Security and privacy

- Supabase publishable credentials remain client-visible; service-role credentials remain server-only.
- Every growth query and mutation verifies the Supabase user, site membership, signed editor session, session generation, module entitlement, capability scope, and site identifier.
- Session renewal is same-origin and server-authorized. It never accepts a target user, site, role, or capability from the browser.
- Form ingestion remains protected by approved revision, Turnstile, allowed-origin, rate-limit, idempotency, consent, and transaction checks.
- Public payloads cannot select whether a Lead is created.
- Logs and release evidence record only safe IDs, status codes, timing, and counts; they never include form bodies, email addresses, phone numbers, session tokens, or consent content.
- Existing RLS, RPC grants, and additive migration lineage remain authoritative. No permissive client table access or entitlement bypass is added.

## Error handling

- First 401: renew once and retry once.
- Renewal failure or second 401: stop, preserve unsaved UI state where possible, and require sign-in with a safe return path.
- 403 or restricted projection: show an access message; do not retry as authentication.
- 5xx/query error: show a truthful production-service unavailable state and retain a manual retry control.
- Empty Customer or Lead results: show a genuine zero-record state, not an unavailable message.
- Ingestion failure: commit no partial submission, Customer, Lead, or consent result and never display success.
- Duplicate retry: return the original committed result without creating duplicate records.

## Testing and verification

### Automated tests

- A growth request that succeeds does not call session renewal.
- A first 401 triggers one renewal and one successful retry.
- Concurrent 401 responses share one renewal request.
- A failed renewal or second 401 produces the stable authentication-required outcome without looping.
- Mutation retries reuse the original idempotency key and body.
- 403 and 5xx responses are not treated as renewable authentication failures.
- Newsletter ingestion creates or matches a Customer and consent state without a Lead.
- Contact and approved staff-follow-up ingestion create or match a Customer and create/link one Lead.
- Duplicate submissions do not duplicate Customers or Leads.
- Ambiguous identities enter review and do not merge automatically.
- Public attempts to choose an ingestion consumer are ignored or rejected.
- Cross-site access and unauthorized roles fail closed.

### Database verification

- Run the isolated database tests for strict ingestion, deduplication, consent, site scoping, and rollback.
- Confirm migration lineage and function checksums.
- Run Supabase security and performance advisors and review relevant findings.
- Use read-only production checks to confirm module state, customer/lead counts, and RPC authorization before deployment.
- Do not insert synthetic production records.

### Deployment and browser acceptance

1. Build and test the exact website revision using the approved 0.3.0 package set.
2. Deploy a protected Vercel preview and verify login, deliberate session expiry, automatic one-time renewal, Customers, Leads, Overview, and Submissions.
3. Confirm empty Leads and populated Customers render as data states rather than unavailable states.
4. Verify the contact and newsletter UI without submitting synthetic production data.
5. Promote the same verified deployment to production.
6. Confirm the production alias points to the approved commit and package profile.
7. Review Vercel runtime logs for successful growth routes and absence of new authorization/error clusters.
8. Leave existing authentic records intact and avoid provider side effects.

## Rollback

- Record the current production deployment before promotion.
- A web regression rolls back by promoting the recorded Vercel deployment.
- Growth workspaces can be disabled through their existing entitlement/configuration boundary without deleting records.
- Database changes, if required, are additive; rollback never drops constituent, consent, submission, Customer, Lead, or audit data.
- Session recovery can be disabled independently while protected APIs continue to fail closed.

## Acceptance criteria

- An authorized staff member can open Customers, Leads, Overview, and Submissions in production.
- A still-valid Supabase user session transparently renews one expired editor session and retries the failed growth request once.
- An invalid or revoked account is sent through sign-in and cannot read growth data.
- Existing authentic newsletter signups appear as Customers and do not create Leads.
- Every future accepted first-party staff-follow-up form creates or matches a Customer and creates/links a Lead atomically.
- Empty Leads is displayed as an empty state.
- No duplicate, cross-site, synthetic, or placeholder records are introduced.
- The live Vercel aliases point to the exact tested 0.3.0 application revision.
- Automated tests, isolated database tests, production build, preview browser acceptance, live read-only checks, and runtime-log review pass.
