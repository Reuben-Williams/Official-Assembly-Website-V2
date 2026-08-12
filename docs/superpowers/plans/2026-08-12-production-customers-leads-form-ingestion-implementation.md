# Production Customers, Leads, and Form Ingestion Implementation Plan

**Approved design:** `docs/superpowers/specs/2026-08-12-production-customers-leads-form-ingestion-design.md`

## Scope

Repair the shared growth authorization failure, enforce CSRF on growth mutations, make authentication versus empty versus unavailable states truthful, and promote the already-approved 0.3.0 website/package revision. Preserve the current strict Contact and Newsletter ingestion behavior. Do not reconcile, backfill, or create production records.

## Phase 1: Single-use login-completion proof

1. Create a new Supabase migration with the CLI for the private proof table and service-role-only RPCs.
2. Add database tests first for RLS/grants, expiry, atomic single use, replay denial, user/site/generation mismatch, and backward compatibility.
3. Implement the minimal additive table and consume/issue RPC contract.
4. Add a server-only proof adapter using random tokens and stored digests; never persist or log the raw proof.
5. Update the auth callback to issue the proof cookie only after successful magic-link verification.
6. Update `POST /api/builder/session` to require and atomically consume the proof before issuing editor/CSRF cookies.
7. Add route tests for direct old-session POST denial and all proof rejection categories.

## Phase 2: Typed growth authentication and CSRF

1. Add failing client tests for status/code preservation, 401 sign-in navigation, no retry/session POST, and non-auth error handling.
2. Add a typed `GrowthClientError` and a single navigation callback that builds a safe local return path.
3. Pass `getCsrfToken` and the authentication-required callback from `EditorClient` into `createLiveGrowthClient`.
4. Add failing server tests proving every operational route rejects missing, invalid, and stale CSRF before persistence while query routes remain read-only and same-origin.
5. Verify CSRF in the growth operational authorizer after signed-session authentication and before persistence.
6. Send `x-builder-csrf` on operations only; preserve existing idempotency keys and request bodies.

## Phase 3: Truthful workspace behavior

1. Add failing component tests for empty Customer/Lead states, authentication-required states, forbidden states, and genuine 5xx unavailable states.
2. Update the Customer, Leads, Overview, and Submissions wrappers or shared client boundary to display the correct state without inventing records.
3. Ensure a 401 navigates once and cannot create render/request loops.

## Phase 4: Ingestion and privacy regression verification

1. Run existing isolated tests proving Contact creates Customer plus Lead and Newsletter creates Customer without Lead.
2. Add or tighten tests for ambiguous Contact rollback, duplicate idempotency, cross-site denial, and browser inability to choose the consumer.
3. Confirm current schema-v1 form revisions and the 0.2.6 rollback application contract remain compatible.
4. Run migration checksum/lineage validation and Supabase security/performance advisors; document relevant existing advisory findings without broad unrelated schema changes.

## Phase 5: Local and preview verification

1. Run focused tests after each red-green cycle, then the full test suite, lint, TypeScript/build, production migration-lineage verification, and database tests.
2. Run secret and credential scans and inspect the exact staged diff. Preserve the unrelated untracked walkthrough file.
3. Push the approved branch and deploy a protected Vercel preview after the additive migration is applied in the protected environment.
4. Verify fresh login, proof consumption/replay denial, deliberate expiry, revoked-session denial, CSRF failure, populated Customers, empty Leads, Overview, and Submissions on desktop and mobile.
5. Confirm no synthetic forms or provider actions run.

## Phase 6: Production release

1. Record the current production deployment and commit for rollback.
2. Apply the verified additive proof migration to production.
3. Promote the exact preview-verified application revision containing the 0.3.0 package profile.
4. Confirm all aliases point to the expected deployment and commit.
5. Perform read-only live checks and verify growth endpoints no longer show the prior misleading failure during a freshly authenticated session.
6. Review Vercel runtime logs and error clusters without exposing constituent data.
7. Report the final production evidence, residual risks, and rollback identifier.

