# Production Staff Portal and Growth Launch Design

**Status:** Approved for implementation design on 2026-08-05

**Production target:** `https://assemblywomanmorales.vercel.app/`

**Site key:** `official-assembly-website-v2`

## Purpose

Launch the private Site Editor Platform and its production data workspaces from the public Assembly website. Staff will be able to sign in and use the site editor, form submissions, leads, customers, and dashboard against real site-scoped data. The production system starts empty and never inserts synthetic, demo, seeded, or placeholder records.

Email, SMS, and AI provider features are outside this launch because the currently published platform packages do not include approved provider runtime adapters. The interface must represent that boundary truthfully and must not simulate provider activity.

## Goals

- Add a discreet public **Staff Portal** button to the footer.
- Protect `/admin/editor` with Supabase email/password authentication and site membership authorization.
- Run the site as a server-capable Next.js application on the confirmed Vercel production project.
- Expose the Pages, Media, Forms, Submissions, History, Overview, Leads, and Customers workspaces through published platform package APIs.
- Accept real contact and newsletter submissions only after the database, privacy, consent, and security prerequisites are complete.
- Keep every tenant query and mutation scoped to this site.
- Provide safe failure handling and a reversible web release without deleting production records.

## Non-goals

- No synthetic data, test-mode records, sample contacts, fake submissions, placeholder leads, or demo dashboard metrics.
- No email delivery, SMS delivery, AI generation, automated reply, campaign send, or simulated provider success.
- No survey activation or site-managed social post workflow in this release.
- No public registration for staff accounts.
- No entitlement bypass, client-side-only access control, or copying unpublished platform source into the client repository.
- No destructive rollback of submissions, contacts, customers, leads, consent receipts, or audit history.

## Architecture and Trust Boundary

The public website remains unchanged except for the footer entry. Selecting **Staff Portal** opens `/admin/login?returnTo=%2Fadmin%2Feditor` in the same tab.

Supabase Auth establishes the user identity. The site then exchanges that authenticated identity for the short-lived, signed editor session already used by the attached Site Editor Platform. Server-side authorization verifies both the session and an allow-listed membership in `builder_site_members` for `official-assembly-website-v2`. Anonymous users are redirected to the login route. Authenticated users without membership receive a truthful access-denied response and no editor data.

The Vercel deployment must remain a server-capable Next.js deployment. Static export is not compatible with the protected APIs, session exchange, form ingestion, and site-local data workspaces required by this design.

The editor shell is composed only from the published private packages already consumed by this repository. Its registration exposes these groups:

- **Website:** Pages, Media, Forms, Submissions, History.
- **Growth:** Dashboard (labeled **Overview**), Leads, Customers.

The published `DashboardWorkspace`, labeled **Overview** in the site navigation, is the initial workspace. Mobile navigation prioritizes Overview, Leads, Customers, and Pages. Desktop navigation groups Website and Growth without exposing internal control-plane concepts to ordinary staff.

The control plane remains authoritative for package publication, installation, entitlements, and health. A package being available is not treated as proof that its database schema is installed or that its workspace is entitled for this site.

The editor consumes a versioned, signed or server-trusted entitlement snapshot containing the site identifier/key, installation identifier and version, entitled module/workspace identifiers, issuance time, expiry time, and revision/epoch. Missing, invalid, site-mismatched, version-mismatched, or expired snapshots fail closed. Activation requires a fresh snapshot. Revocation increments the revision/epoch, invalidates the prior cache, and must hide the revoked workspace no later than the platform-defined refresh interval, which may not exceed five minutes for this site. `builder check` and browser acceptance verify both activation and revocation.

## Public Footer Entry

The existing `AppFooter` Office Access column gains one secondary, lock-marked button labeled **Staff Portal**. It is deliberately visible but visually subordinate to resident-facing calls to action.

Requirements:

- Link target: `/admin/login?returnTo=%2Fadmin%2Feditor`.
- Same-tab navigation.
- Keyboard focus, contrast, hover, and reduced-motion behavior consistent with the current site.
- Usable without horizontal overflow at supported mobile widths.
- Independent activation switch so the entry can be removed if staff authentication or editor availability regresses.
- The link never implies that the portal is available to the public.

## Workspace Behavior

The workspaces operate in live mode and render persisted production data only.

- **Pages, Media, Forms, and History** use the existing site-editor repositories and site configuration.
- **Submissions** presents immutable form receipts and their processing state.
- **Dashboard (Overview)** is the published `DashboardWorkspace` and presents authorized site-scoped aggregates. With no data, it renders a genuine empty state rather than zero-like demo trends.
- **Leads** presents constituent inquiries derived from contact submissions and allows only supported production mutations.
- **Customers** presents canonical people/contact identities and supported consent and record-management actions.

If an installed package or backend capability is unavailable, the workspace must show a clear unavailable or setup-required state. It must not substitute demo data.

## Live Data Flow

### Contact form

The public contact form submits through the existing managed-form endpoint. Turnstile validation, allowed-origin checks, rate limiting, template/revision validation, and the site lookup happen before storage.

The approved Growth database handoff must supply one idempotent, synchronous, atomic site-local operation that:

1. stores the immutable base submission and consent receipt;
2. creates or matches the canonical customer/contact identity within this site;
3. creates the inquiry lead or links the submission to the existing open lead according to the platform contract;
4. records the resulting identifiers and completed processing state for the Submissions workspace; and
5. commits the complete result as one transaction.

If any step fails, the transaction commits nothing and the public endpoint returns a truthful error. It does not acknowledge receipt, customer creation, or lead creation. A client retry with the same idempotency key must not create duplicate submissions, contacts, or leads. A successful retry returns the original committed receipt/result rather than creating another record.

### Newsletter form

The newsletter form uses the same synchronous, all-or-nothing transaction boundary. It stores the immutable receipt, creates or matches the site-local customer/contact identity, and records newsletter consent in one commit. A newsletter signup does not create a sales or constituent-service lead unless a later authentic action expresses inquiry intent. Failure commits nothing and returns no success acknowledgement.

### Identity conflicts

Exact, contract-approved identity matches may link automatically. Ambiguous duplicates are placed into a review state and are not silently merged. Merge, export, correction, and deletion operations require authorization, audit evidence, and the platform's supported commands.

### Dashboard projections

Dashboard metrics are calculated from authorized site projections. The browser never receives the service-role credential and does not query cross-site tables. Empty production data produces empty-state content, not invented metrics.

## Provider Boundary

The currently published release has no approved email, SMS, or AI runtime adapter. Consequently:

- provider credentials are not required for this launch;
- send, reply, automation, campaign, and generation controls are hidden or disabled with a truthful unavailable explanation;
- no provider job is enqueued;
- no UI state claims that an email, SMS, or AI action succeeded; and
- adding a credential alone is never treated as provider activation.

Provider activation requires a separate platform release, provider-specific configuration, consent and compliance review, secret entry by an authorized operator, isolated testing, and explicit production approval.

## Security, Privacy, and Data Governance

- All protected routes authenticate on the server.
- Every repository operation carries the resolved site identifier and is enforced by database permissions/RLS or a security-definer RPC with equivalent site checks.
- Browser code receives only the Supabase public key. Service-role, session-signing, Turnstile secret, and fingerprint secrets remain server-only Vercel variables.
- Preview/session cookies are Secure in production, appropriately SameSite, scoped to `/`, and short lived. State-changing requests retain CSRF and allowed-origin validation.
- Contact and newsletter forms must display an approved privacy notice and consent purpose before production collection is enabled.
- The production configuration must define retention, correction, export, deletion, merge, and audit behavior for constituent data. Receipt identity, site, form/revision, policy version, timestamps, and non-identifying outcome metadata remain immutable. An approved deletion removes or irreversibly redacts direct constituent PII and replaces relational identity references with a non-reversible tombstone while preserving only the minimum non-identifying audit evidence required by policy. A legal or records hold, if applicable, blocks deletion with a recorded reason rather than silently retaining data.
- Logs must not expose message bodies, credentials, session tokens, or full contact records.
- A failed validation or storage operation returns a truthful unavailable/error response. The public form never displays a success state until durable storage succeeds.

## Required Platform Handoff

The current client attachment contains editor and form integration code, but the installed Growth package artifacts do not deliver the production database migrations, command-processing worker, or entitlement snapshot cache needed for live Growth data.

Production activation is therefore gated on an approved, versioned platform handoff that provides:

- the exact additive Supabase migrations and grants;
- the synchronous, atomic form-to-submission/customer/lead RPC or equivalent server contract;
- synchronous, idempotent command/RPC paths for every enabled Leads or Customers mutation;
- entitlement and installation records for Overview, Leads, Customers, and Submissions;
- the versioned entitlement snapshot/cache contract, refresh interval, immediate revision/epoch invalidation path, and provisioning required by `builder check`; and
- a reversal/disable procedure that preserves records.

This launch deliberately uses synchronous processing: no asynchronous ingestion or command worker is permitted or required. If the approved platform release instead requires asynchronous processing, implementation stops and this design must be revised to specify worker deployment, least-privilege authorization, idempotent retry, reconciliation, health/lag monitoring, drain behavior, and rollback before production activation.

These assets must come from the platform publisher or approved operator process. They must not be reconstructed from an example application or copied ad hoc from unpublished source. If the handoff is absent or fails acceptance, the Growth workspaces remain unavailable and real form collection does not launch.

## Deployment Sequence

1. Confirm the local repository and exact Vercel project identity for `assemblywomanmorales.vercel.app`.
2. Record the currently promoted production deployment for rollback.
3. Obtain and validate the approved Growth platform handoff in an isolated environment.
4. Create or select the dedicated production Supabase project and apply additive migrations, grants, site record, membership, installation, and entitlements.
5. Enter production secrets directly through Vercel or the authorized operator terminal. Secrets are never committed or pasted into chat.
6. Deploy a Vercel preview with the production build shape and non-production backend isolation.
7. Run automated and browser acceptance against the preview.
8. Promote the same verified code revision to the confirmed production project.
9. Run a non-mutating production readiness probe that verifies schema migration identifiers/checksums, required RPC signatures, execution grants, site and membership records, installation state, a fresh entitlement snapshot, published form revisions, allowed origins, and required server configuration without inserting or updating records.
10. Perform read-only production route, authentication, workspace, console, network, responsive, and isolation checks.
11. Leave production data empty. Do not submit fake production forms; the first persistent production record must come from an authentic user action. Record the residual risk that this authentic request is the first end-to-end production write.

## Verification

### Automated tests

- Footer link label, target, and accessibility behavior.
- Anonymous redirect and safe return-path handling.
- Authenticated non-member denial.
- Member access to the registered workspaces.
- Genuine empty states with no demo records.
- Site scoping and cross-site denial at repository and database boundaries.
- Contact submission creates one immutable receipt, one matched/created customer, and one linked lead.
- Newsletter submission creates the receipt and consent-bearing customer/contact record without a lead.
- Full transaction rollback on every injected step failure, with no false acknowledgement.
- Idempotent successful retry, duplicate retry, and ambiguous-identity review behavior.
- Turnstile, rate-limit, invalid-revision, stale-write, origin, CSRF, and storage-failure responses.
- Provider actions are absent or unavailable and no provider job is emitted.
- Entitlement snapshot activation, expiry, site/version mismatch, revision/epoch revocation, and cache invalidation.
- The non-mutating production readiness probe detects missing schema, RPC, grant, site, installation, entitlement, origin, and form-revision prerequisites.
- Production build and the platform `builder check` pass with the approved handoff.

Data-flow tests run against an isolated database and clean up their own records. They never seed or mutate the production database.

### Browser acceptance

On desktop and mobile viewports:

- verify the public site and all approved direct/deep routes;
- verify the Staff Portal footer placement and keyboard operation;
- verify login, denial, logout, session expiry, and editor navigation;
- inspect every enabled workspace's empty state;
- confirm no horizontal overflow, broken assets, console errors, or failed protected requests;
- verify direct refreshes of `/admin/login` and `/admin/editor`; and
- capture evidence from the Vercel preview and the promoted production deployment.

Production verification remains read-only until an authentic submission arrives. The readiness probe substantially reduces configuration risk but cannot prove the first production write without creating prohibited fake production data; this residual risk is recorded in the release evidence.

## Failure Handling and Rollback

- Public form configuration, validation, or storage failure returns a truthful unavailable message and creates no false receipt.
- Contact and newsletter ingestion are synchronous and all-or-nothing. Any failed step rolls back the entire transaction, produces no receipt/customer/lead/consent mutation, and returns no success acknowledgement.
- Web regression: promote the recorded previous Vercel deployment.
- Growth-only regression: revoke or disable the affected installation entitlement, increment its snapshot revision/epoch, invalidate the cached snapshot, and verify the workspace is hidden within the accepted refresh interval while preserving all records and the public website.
- Authentication/editor regression: independently hide the Staff Portal footer entry while the protected routes remain fail-closed.
- Database migrations are additive. Do not roll back by dropping production tables or deleting constituent records.

## Expected Repository Changes

Implementation is expected to touch only the approved attachment surface and focused additions, including:

- `app/ui/AppFooter.tsx` and related styles/tests for the Staff Portal entry;
- `app/admin/editor/editor-client.tsx` and site-local workspace adapters;
- `.builder/module-manifest.json` and `.builder/installation-manifest.json` after entitlement/package acceptance;
- `app/api/forms/[formKey]/route.ts` or a focused server adapter for the approved atomic Growth ingestion contract;
- server-only Supabase repositories/types and targeted tests;
- `.env.example` for variable names only, never values;
- Vercel deployment configuration if required to preserve the server runtime; and
- deployment/acceptance documentation.

The pre-existing untracked `client-website-setup-operator-walkthrough.md` is outside implementation scope and must remain untouched.

## Acceptance Criteria

The launch is complete only when all of the following are true:

- `assemblywomanmorales.vercel.app` serves the verified server-capable production revision.
- The public footer contains the accessible Staff Portal button at the approved location.
- Anonymous and unauthorized users cannot access editor or Growth data.
- An authorized member can reach Pages, Media, Forms, Submissions, History, the published Dashboard labeled Overview, Leads, and Customers.
- Workspaces start empty and contain no synthetic, seeded, demo, or placeholder records.
- Isolated acceptance proves the approved contact and newsletter data flows and site isolation.
- The non-mutating production readiness probe passes and its results are included in the release evidence.
- Production contains no fake QA records.
- Email, SMS, and AI actions are truthfully unavailable and create no side effects.
- Automated tests, production build, `builder check`, and desktop/mobile browser acceptance pass.
- Rollback evidence identifies the prior Vercel deployment and the Growth disable path without destructive database action.
