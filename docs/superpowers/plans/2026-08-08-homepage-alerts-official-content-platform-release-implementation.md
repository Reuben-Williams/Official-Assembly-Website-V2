# Homepage Alerts, Official Content, and Reusable Platform Release Implementation Plan

**Status:** Approved design; ready for implementation

**Design source of truth:** `docs/superpowers/specs/2026-08-08-homepage-alerts-official-content-platform-release-design.md` at commit `f4c7014`

**Client repository:** `D:\Project Morales\Official Assembly Website V2`

**Reusable platform implementation worktree:** `D:\Project Morales\site-editor-platform-editor-production-quality`

**Protected platform checkout:** `D:\Project Morales\site-editor-platform`

## Outcome

Deliver a source-governed public homepage for Assemblywoman Carmen Theresa Morales with an accessible editor-managed alert bar, official New Jersey Legislature facts and actions, the existing first-party Resend newsletter, an external volunteer path, and deterministic latest-posts content. Extract the reusable alert data, editor, server, recovery, and attachment contracts into the private Site Editor Platform without moving Morales-specific content into shared packages.

The client implementation can reach a review deployment after automated verification. Public production deployment still requires settled desktop/mobile visual approval. Publishing a new private package version still requires an explicit version and package-list approval.

## Non-negotiable implementation rules

- Use red-green-refactor for every behavior change: add a focused failing test, observe the intended failure, implement the smallest correct contract, rerun the focused test, then run the relevant package or repository gate.
- Keep official names, roles, dates, education, occupation, address, phone, fax, committees, and canonical destinations in the reviewed client snapshot. Ordinary editor actions may change presentation text, not protected facts or URLs.
- Do not scrape the New Jersey Legislature at runtime. Source refresh is an explicit reviewed code/data change.
- Keep newsletter delivery on the existing first-party Resend double-opt-in flow. Do not send synthetic production subscriptions, confirmations, contact requests, or broadcasts.
- Keep the volunteer form external. Do not copy its questions or collect volunteer answers in the client database.
- Do not expose alert tables or mutation RPCs directly to browsers. Public reads return a bounded published projection; editor mutations pass through authenticated server routes.
- Keep draft and published alert revisions immutable. All mutations use optimistic concurrency, idempotency, authorization, audit, and site scope.
- Copy the canonical alert migration byte-for-byte from the platform worktree into the client production migration lineage. Fail closed on filename or checksum drift.
- Never print, store, or commit GitHub, Supabase, Vercel, Resend, Blob, service-role, Turnstile, SMTP, or HMAC secrets.
- Do not edit, reset, stash, clean, stage, or commit unrelated user files. In particular, leave `client-website-setup-operator-walkthrough.md` untracked and leave the dirty platform `main` checkout untouched.
- Do not edit installed `node_modules` or commit temporary `file:` dependency paths, package tarballs, generated coverage, browser traces, or local Supabase state.
- Finish each task with `git diff --check`, focused tests, and a narrow commit in the repository where the change belongs.

## Branch, worktree, and release map

- Client branch: `codex/private-media-post-linking` in `D:\Project Morales\Official Assembly Website V2`.
- Client review PR: existing draft PR #1; push reviewed client commits to this branch only.
- Protected platform checkout: `D:\Project Morales\site-editor-platform`, whose unrelated local modifications must remain untouched.
- Platform implementation: clean `codex/editor-production-quality` worktree at `D:\Project Morales\site-editor-platform-editor-production-quality`, based on and containing `origin/main`.
- Platform release: prepare and validate on the review branch/PR. Do not publish or merge directly to `main` from this plan without the explicit package approval gate.
- Client-package rehearsal: use a disposable external directory or npm-packed artifacts outside the repositories. Never make permanent client manifests point to local paths.

## Phase 0 - Safety and reproducible baselines

### Task 1: Freeze both repository baselines

**Files changed:** none.

**Actions:**

1. Record branch, HEAD, status, remotes, Node/npm versions, lockfile digests, Supabase CLI version, and installed `@reuben-williams/*` versions.
2. Confirm the client has only the unrelated untracked walkthrough file.
3. Confirm the platform implementation worktree is clean and tracks `origin/codex/editor-production-quality`.
4. Confirm the implementation worktree contains `origin/main` and the fourteen previously approved editor-quality commits.
5. Confirm the protected platform `main` checkout remains untouched.
6. Run the current client and platform unit/type/build baselines and record any pre-existing failure before feature work.

**Verification:**

```powershell
git -C "D:\Project Morales\Official Assembly Website V2" status --short --branch
git -C "D:\Project Morales\site-editor-platform-editor-production-quality" status --short --branch
git -C "D:\Project Morales\site-editor-platform" status --short --branch
npm ls @reuben-williams/core @reuben-williams/content @reuben-williams/editor @reuben-williams/next @reuben-williams/cli
npm test
npm run lint
npm run build
```

**Commit:** none.

### Task 2: Reconcile the approved spec with current package and client entry points

**Platform files inspected:**

- `packages/core/src/capabilities.ts`
- `packages/core/src/permissions.ts`
- `packages/content/src/repository.ts`
- `packages/content/src/migration-manifest.ts`
- `packages/editor/src/shell/types.ts`
- `packages/editor/src/shell/ResponsiveNavigation.tsx`
- `packages/editor/src/shell/WorkspaceRegistryHost.tsx`
- `packages/next/src/content/server/index.ts`
- `packages/cli/src/onboarding/*`
- `supabase/migrations/*`

**Client files inspected:**

- `app/layout.tsx`
- `app/page.tsx`
- `app/admin/editor/editor-client.tsx`
- `app/admin/editor/page.tsx`
- `app/ui/AppHeader.tsx`
- `app/ui/NewsletterSignupSection.tsx`
- `app/data/site.ts`
- `builder.config.ts`
- `lib/builder/published-posts.ts`
- `lib/builder/recovery/*`

**Actions:**

1. Map each approved contract to its current implementation seam.
2. Record any upstream rename in this plan before editing code.
3. Confirm the alert feature dependency closure is limited to `core`, `content`, `editor`, `next`, and `cli`, plus the canonical Supabase migration. Expand only if package tests prove a required internal dependency.
4. Confirm the current newsletter flow remains reusable as-is except for the approved validation-order contract.

**Verification:** path and dependency inventory reviewed in the task commit notes.

**Commit:** none unless this plan requires path-only corrections.

## Phase 1 - Reusable alert domain and canonical database contract

### Task 3: Add alert types, lifecycle rules, permissions, and canonical digests

**Platform files:**

- `packages/core/src/alerts.ts` (new)
- `packages/core/src/capabilities.ts`
- `packages/core/src/permissions.ts`
- `packages/core/src/audit.ts`
- `packages/core/src/index.ts`
- `packages/core/tests/alerts.test.ts` (new)
- `packages/core/tests/permissions.test.ts`
- `packages/core/tests/history-event.test.ts`

**Red tests first:**

- `AlertItemSnapshot` accepts only the four approved categories and `active|archived` lifecycle values.
- Message is required and bounded; link is optional but must be a safe HTTP(S) or site-relative destination.
- Invalid start/end order is rejected.
- Canonical revision and command digests are stable for equivalent inputs.
- Viewer can read; contributor can create/edit draft; editor can reorder/publish/archive; owner has all alert capabilities.
- Alert audit events distinguish create, edit, reorder, enable/schedule, archive, and publish.

**Implementation:**

Add framework-free alert contracts, validators, canonicalizers, capability constants, permission templates, and audit metadata. Keep site-specific alert copy and routes out of `core`.

**Verification:**

```powershell
npm test -- packages/core/tests/alerts.test.ts packages/core/tests/permissions.test.ts packages/core/tests/history-event.test.ts
npm run typecheck
git diff --check
```

**Commit:** `feat(core): add governed alert contracts`

### Task 4: Add revision and public-projection workflows

**Platform files:**

- `packages/content/src/alerts.ts` (new)
- `packages/content/src/repository.ts`
- `packages/content/src/index.ts`
- `packages/content/tests/alerts.test.ts` (new)

**Red tests first:**

- Array order remains the display order.
- Archived or disabled items are excluded from public output.
- Start/end boundaries are evaluated against the supplied clock.
- Projection returns `activeAlerts`, `evaluatedAt`, and the earliest future `nextTransitionAt`.
- Equal-time projection is deterministic.
- Draft mutation and publish inputs require `expectedLockVersion`, `expectedDraftRevisionId`, and an idempotency key.
- Same idempotency key/same digest replays; same key/different digest conflicts.

**Implementation:**

Add pure revision builders, mutation contracts, published projection logic, public item shaping, and repository interfaces. Do not add database or Next.js imports to `content`.

**Verification:**

```powershell
npm test -- packages/content/tests/alerts.test.ts
npm run typecheck
git diff --check
```

**Commit:** `feat(content): add versioned alert workflows`

### Task 5: Author the canonical additive alert migration

**Platform files:**

- New Supabase CLI-generated `supabase/migrations/<timestamp>_versioned_site_alerts.sql`
- Next free `supabase/tests/*_versioned_site_alerts.test.sql`

**Database red cases:**

- A site has one alert collection with draft and published revision pointers plus a lock version.
- Revisions and item snapshots are immutable.
- Every create/edit/reorder/enable/schedule/archive draft command validates the expected lock and draft revision in one transaction.
- Publish validates the same dual expectation and atomically advances only the published pointer.
- Stale expectations return `STALE_REVISION` with no partial writes.
- Same idempotency key and request digest replays the original result; a different digest returns `IDEMPOTENCY_MISMATCH`.
- Viewer/contributor/editor/owner permissions match the approved matrix.
- Browser roles have no direct alert table or mutation-function access.
- Site A cannot read or mutate Site B.
- Each successful command writes complete actor, site, collection, revision, action, and request provenance to the existing audit boundary.
- Publish enqueues one durable recovery job transactionally.
- A stale recovery worker cannot advance the latest pointer.

**Implementation:**

Create explicitly named collection, immutable revision/item, command receipt, and recovery outbox structures. Reuse existing site/member/audit conventions and worker fencing. Use restricted `search_path`, narrow grants, and explicit RLS. Do not use `IF NOT EXISTS` to conceal partial or mismatched attachment state.

**Verification:**

```powershell
npm run test:db:site:reset
npx supabase db lint --local
npx supabase db advisors --local --type all
git diff --check
```

**Commit:** `feat(db): add versioned site alerts`

### Task 6: Register the canonical migration identity

**Platform files:**

- `packages/content/src/migration-manifest.ts`
- `packages/content/tests/migration-manifest.test.ts`
- `packages/cli/src/onboarding/inspect.ts`
- `packages/cli/src/onboarding/plan.ts`
- `packages/cli/src/onboarding/verify.ts`
- `packages/cli/tests/onboarding-inspect.test.ts`
- `packages/cli/tests/onboarding-plan.test.ts`
- `packages/cli/tests/onboarding-verify.test.ts`

**Red tests first:**

- A missing alert migration is reported as an additive attachment action.
- An exact filename/checksum match is adopted without duplicate SQL.
- A checksum mismatch or partial schema fails closed with actionable output.
- Verification proves browser grants are absent and expected server functions exist.

**Implementation:**

Add the fixed migration identity and checksum to the manifest and onboarding inspection/plan/verify paths. Attachment may copy or adopt only the exact reviewed artifact.

**Verification:**

```powershell
npm test -- packages/content/tests/migration-manifest.test.ts packages/cli/tests/onboarding-inspect.test.ts packages/cli/tests/onboarding-plan.test.ts packages/cli/tests/onboarding-verify.test.ts
npm run typecheck
git diff --check
```

**Commit:** `feat(cli): govern alert migration attachment`

## Phase 2 - Reusable server, recovery, and editor packages

### Task 7: Add authenticated alert management and public read adapters

**Platform files:**

- `packages/next/src/alerts/index.ts` (new)
- `packages/next/src/alerts/server/index.ts` (new)
- `packages/next/src/alerts/server/supabase-alerts.ts` (new)
- `packages/next/src/alerts/server/route-handlers.ts` (new)
- `packages/next/src/alerts/server/recovery.ts` (new)
- `packages/next/src/index.tsx`
- `packages/next/tests/alerts-route-handlers.test.ts` (new)
- `packages/next/tests/alerts-supabase-adapter.test.ts` (new)
- `packages/next/tests/alerts-server-boundary.test.ts` (new)
- `packages/next/tests/alerts-recovery.test.ts` (new)

**Red tests first:**

- Management routes derive site and member context server-side and enforce capability checks.
- Caller-supplied site IDs cannot cross the bound site.
- Safe 409 responses preserve `STALE_REVISION` and `IDEMPOTENCY_MISMATCH` without leaking database details.
- Public read returns only the published projection with `Cache-Control: no-store`.
- Recovery artifact path is `{environment}/{siteKey}/alerts/revisions/{revisionNumber}-{digest}.json`.
- Latest pointer advances through compare-and-swap only to a newer verified artifact.
- A missing, corrupt, wrong-site, wrong-environment, or digest-mismatched fallback fails closed.
- Authoritative read failure may serve the last verified artifact; transition filtering still removes expired alerts locally.
- Worker retry/dead-letter state is observable without exposing secrets.

**Implementation:**

Add server-only Supabase adapters, management/public route factories, safe error mapping, immutable recovery serialization, latest-pointer validation, and fenced outbox handling. Keep all service-role and recovery-store dependencies outside client exports.

**Verification:**

```powershell
npm test -- packages/next/tests/alerts-route-handlers.test.ts packages/next/tests/alerts-supabase-adapter.test.ts packages/next/tests/alerts-server-boundary.test.ts packages/next/tests/alerts-recovery.test.ts
npm run typecheck
git diff --check
```

**Commit:** `feat(next): add server-governed alerts`

### Task 8: Add the reusable Alerts editor workspace

**Platform files:**

- `packages/editor/src/alerts/AlertsWorkspace.tsx` (new)
- `packages/editor/src/alerts/AlertEditor.tsx` (new)
- `packages/editor/src/alerts/alerts.module.css` (new)
- `packages/editor/src/api/builder-api.ts`
- `packages/editor/src/shell/types.ts`
- `packages/editor/src/shell/ResponsiveNavigation.tsx`
- `packages/editor/src/index.tsx`
- `packages/editor/tests/alerts-workspace.test.tsx` (new)
- `packages/editor/tests/alerts-shell-integration.test.tsx` (new)
- `packages/editor/tests/responsive-navigation.test.tsx`
- `packages/editor/tests/interaction-cursors.test.ts`

**Red tests first:**

- `website.alerts` is a first-class Website workspace and direct URL state opens it.
- Viewer sees read-only state; contributor may create/edit drafts; editor may reorder/publish/archive; owner has all controls.
- Required/optional labels, dates, category, enabled state, link validation, archive confirmation, and error summaries are explicit.
- Reordering is keyboard-operable and has button fallbacks; drag support cannot be the only control.
- A stale revision refreshes the current server state and preserves the unsaved local draft for reconciliation.
- Successful mutation followed by refresh failure remains a successful mutation with a warning.
- All actionable controls use the correct pointer cursor, focus indication, accessible name, and disabled state.
- Narrow layouts remain usable without horizontal overflow.

**Implementation:**

Add the workspace ID, navigation entry, API client methods, role-aware collection/editor UI, optimistic concurrency handling, and accessible responsive styling. Do not embed Morales-specific copy.

**Verification:**

```powershell
npm test -- packages/editor/tests/alerts-workspace.test.tsx packages/editor/tests/alerts-shell-integration.test.tsx packages/editor/tests/responsive-navigation.test.tsx packages/editor/tests/interaction-cursors.test.ts
npm run typecheck
git diff --check
```

**Commit:** `feat(editor): add alerts workspace`

### Task 9: Build a local package rehearsal set without publishing

**Files committed:** none unless a package manifest defect is found and fixed through its own red test.

**Actions:**

1. Run the full platform test/type/build gates.
2. Produce npm tarballs for the exact dependency closure in a disposable directory outside both repositories.
3. Inspect tarball contents for missing exports, source maps, secrets, local paths, and unintended artifacts.
4. Install the tarballs into a disposable client copy or clean rehearsal directory.
5. Prove the alert workspace, server exports, and migration manifest resolve without a registry publish.

**Verification:**

```powershell
npm test
npm run typecheck
npm run build
npm pack --dry-run
git diff --check
```

**Commit:** none for generated rehearsal artifacts.

## Phase 3 - Client migration attachment and alert management

### Task 10: Attach the canonical alert migration byte-for-byte

**Client files:**

- Exact copied `supabase/migrations/<timestamp>_versioned_site_alerts.sql`
- Next free `supabase/tests/*_versioned_site_alerts.test.sql`
- `scripts/verify-production-migration-lineage.mjs`
- `scripts/verify-platform-migration-checksums.mjs`
- `tests/production-migration-lineage.test.ts`
- `tests/platform-migration-checksums.test.ts`

**Red tests first:**

- Production lineage rejects a missing alert migration.
- Platform checksum verification rejects any byte difference.
- Existing exact migration is adopted; partial or conflicting state fails closed.
- Client RLS, immutability, concurrency, idempotency, audit, and outbox tests match the canonical platform contract.

**Implementation:**

Copy the canonical migration without edits and add only site-local lineage/checksum registration plus the client pgTAP wrapper/evidence required by the repository. Do not deploy it remotely in this task.

**Verification:**

```powershell
npm run verify:platform-migrations
npm run verify:production-migrations
npm run db:reset
npm run test:db
npx supabase db lint --local
git diff --check
```

**Commit:** `feat(db): attach versioned site alerts`

### Task 11: Wire authenticated client alert routes and recovery

**Client files:**

- `app/api/builder/alerts/route.ts` (new)
- `app/api/builder/alerts/[command]/route.ts` (new)
- `app/api/public/alerts/route.ts` (new)
- `lib/builder/alerts.ts` (new)
- `lib/builder/repositories.ts`
- `lib/builder/recovery/*`
- `app/api/cron/builder-recovery/route.ts` or the existing recovery worker route
- `tests/builder-alert-routes.test.ts` (new)
- `tests/builder-alert-recovery.test.ts` (new)
- `tests/builder-auth.test.ts`

**Red tests first:**

- Management endpoints reject anonymous, wrong-site, and under-capability callers.
- Server derives the Morales site identity from the trusted registry.
- All draft/publish commands preserve dual concurrency and idempotency inputs.
- Public endpoint returns only published active data and emits no-store headers.
- Recovery worker produces and verifies the dedicated alert artifact and pointer.
- Public fallback never returns drafts or another environment/site.

**Implementation:**

Compose the reusable platform route/repository/recovery adapters with the existing client Supabase, membership, site registry, and recovery-store wiring. Keep client routes thin.

**Verification:**

```powershell
npm test -- tests/builder-alert-routes.test.ts tests/builder-alert-recovery.test.ts tests/builder-auth.test.ts
npm run typecheck
git diff --check
```

**Commit:** `feat(editor): attach alert management routes`

### Task 12: Register Alerts in the Morales editor

**Client files:**

- `app/admin/editor/editor-client.tsx`
- `app/admin/editor/page.tsx`
- `tests/editor-workspaces.test.tsx`
- `tests/editor-page-navigation.test.tsx`

**Red tests first:**

- Alerts appears in the Website navigation for authorized members.
- Opening the Alerts URL or clicking Alerts replaces the current main workspace immediately.
- Navigating from Posts, Media, Forms, or Growth to Alerts and back never leaves an overlay or stale workspace.
- Server bootstrap supplies only role-appropriate initial alert state.

**Implementation:**

Register the package workspace and its API client through the existing editor shell configuration. Use the locally rehearsed package build during development without committing local dependency paths.

**Verification:**

```powershell
npm test -- tests/editor-workspaces.test.tsx tests/editor-page-navigation.test.tsx
npm run typecheck
git diff --check
```

**Commit:** `feat(editor): enable site alerts workspace`

## Phase 4 - Public alert rendering and route isolation

### Task 13: Establish a trusted public-route gate

**Client files:**

- `proxy.ts` (new or updated for Next.js 16)
- `lib/public-route.ts` (new)
- `app/layout.tsx`
- `tests/public-route.test.ts` (new)
- `tests/layout-alert-boundary.test.tsx` (new)

**Red tests first:**

- Normal public routes and the public 404 are eligible.
- `/admin`, `/auth`, `/api`, `/_next`, and all descendants are ineligible using segment-aware matching.
- Similar public names such as `/administrator` are not accidentally excluded.
- A missing, malformed, or caller-forged pathname header fails closed.
- The root proxy overwrites rather than trusts an inbound internal pathname header.
- Non-public HTML receives neither alert data props nor alert markup.

**Implementation:**

Use the root proxy to write one trusted internal pathname header. Let `RootLayout` evaluate the pure route predicate before loading alerts, and omit the controller entirely outside public surfaces.

**Verification:**

```powershell
npm test -- tests/public-route.test.ts tests/layout-alert-boundary.test.tsx
npm run typecheck
git diff --check
```

**Commit:** `feat(site): isolate public alert rendering`

### Task 14: Build the accessible moving alert controller

**Client files:**

- `app/ui/PublicAlertController.tsx` (new)
- `app/ui/public-alert-controller.module.css` (new)
- `app/layout.tsx`
- `tests/public-alert-controller.test.tsx` (new)
- `tests/public-alert-api.test.ts` (new)

**Red tests first:**

- Zero active alerts render no space; one alert renders statically without controls.
- Multiple alerts rotate automatically only when motion is allowed and the user has not paused.
- Pause/Resume is sticky; hover, focus-within, and document visibility pauses are transient.
- Reduced-motion disables autoplay but leaves Previous/Next usable.
- Automatic changes use `aria-live="off"`; a manual navigation announcement is polite and emitted once.
- Current expired items disappear locally at the transition boundary.
- Future items appear only after a successful no-store refresh.
- Failed refresh preserves still-valid rendered items, reports no public secret/error detail, and retries safely on focus/visibility.
- Controller sits directly below `AppHeader` and above `<main>`.
- Links, buttons, focus, pointer cursor, keyboard operation, narrow layout, and overflow satisfy the approved interaction contract.

**Implementation:**

Render the server projection immediately, schedule a refresh just after `nextTransitionAt`, and add focus/visibility catch-up. Use transform-based movement with stable layout and CSS motion preferences. Do not provide a dismiss control.

**Verification:**

```powershell
npm test -- tests/public-alert-controller.test.tsx tests/public-alert-api.test.ts tests/layout-alert-boundary.test.tsx
npm run lint
npm run build
git diff --check
```

**Commit:** `feat(site): add accessible global alerts`

## Phase 5 - Official homepage content and conversion paths

### Task 15: Add the reviewed official Legislature snapshot

**Client files:**

- `app/data/official-legislature-profile.ts` (new)
- `tests/official-legislature-profile.test.ts` (new)
- `builder.config.ts`

**Red tests first:**

- Snapshot contains only the facts and official routes approved in the design specification.
- Source URL, API URL, checked-at date, and protected-field classification are present.
- Legislative contact uses the canonical direct Fireside destination, not an Instagram redirect.
- Votes use the two stable official deep links.
- Sponsored-bills action falls back to the official profile because no stable deep link was verified.
- Protected facts and canonical destinations are not ordinary editable regions.

**Implementation:**

Create a typed checked-in snapshot with provenance and a deliberate protected/editable split. Editor-configurable content may supply section labels and framing only.

**Verification:**

```powershell
npm test -- tests/official-legislature-profile.test.ts
npm run typecheck
git diff --check
```

**Commit:** `feat(content): add official legislature snapshot`

### Task 16: Recompose the homepage around three source-governed paths

**Client files:**

- `app/page.tsx`
- `app/ui/OfficialProfileSection.tsx` (new)
- `app/ui/DistrictConnectionsSection.tsx` (new)
- `app/ui/LatestUpdatesSection.tsx` (new or extracted)
- Corresponding CSS module files
- `app/data/site.ts`
- `tests/home-page.test.tsx`
- `tests/homepage-official-content.test.tsx` (new)

**Red tests first:**

- Homepage order is header/conditional alert, hero, service/access band, official profile, District 34 connections, latest posts, and consolidated guidance.
- Hero offers contact, news, and newsletter actions without mislabeling legislative contact as newsletter.
- Official profile exposes the verified facts, official profile, votes, sponsored-bills fallback, and legislative contact.
- District connections contains the existing first-party newsletter, bilingual volunteer summary and external Google Form CTA, and official legislative contact.
- Volunteer link is clearly external and no volunteer answer fields are rendered locally.
- Newsletter form remains one first-party form instance with its existing consent/double-opt-in behavior.
- No Instagram redirect or unverified claim appears in rendered output.

**Implementation:**

Build visually cohesive, responsive sections using the existing Morales typography, navy/blue/red palette, card language, and spacing. Reuse the live newsletter component and public editor bridge rather than duplicating provider behavior.

**Verification:**

```powershell
npm test -- tests/home-page.test.tsx tests/homepage-official-content.test.tsx
npm run lint
npm run build
git diff --check
```

**Commit:** `feat(site): add official district homepage paths`

### Task 17: Make latest posts deterministic and truthfully empty

**Client files:**

- `lib/builder/published-posts.ts`
- `app/ui/LatestUpdatesSection.tsx`
- `tests/published-posts.test.ts`
- `tests/home-page.test.tsx`

**Red tests first:**

- Expired posts are filtered before applying the limit.
- Query orders by `displayDate DESC`, then `entry_id ASC`, before `LIMIT 3`.
- `pinnedFirst` is false for the homepage collection.
- Zero posts produce a truthful empty/latest-news CTA state without placeholder entries.
- Post links use canonical public paths.

**Implementation:**

Add the exact approved query semantics and render the resulting live collection. Do not add synthetic or checked-in example posts.

**Verification:**

```powershell
npm test -- tests/published-posts.test.ts tests/home-page.test.tsx
npm run typecheck
git diff --check
```

**Commit:** `fix(content): make homepage updates deterministic`

### Task 18: Enforce the newsletter validation-order contract

**Client files:**

- `app/ui/NewsletterSignupSection.tsx`
- Relevant newsletter form helper/API route if the current boundary requires it
- `tests/newsletter-signup.test.tsx`
- Existing newsletter route/security tests

**Red tests first:**

- Native/client field validation occurs before reading the Turnstile token.
- Missing token reports verification-needed and makes no network request.
- A valid form with a token makes one request.
- Server independently validates payload, token, rate limit, idempotency, form revision, and consent.
- Existing double opt-in, suppression, unsubscribe, and truthful pending copy remain unchanged.

**Implementation:**

Adjust only validation sequencing and UI integration required by the approved contract. Do not weaken server checks or change provider ownership.

**Verification:**

```powershell
npm test -- tests/newsletter-signup.test.tsx tests/newsletter-routes.test.ts tests/newsletter-security.test.ts
npm run lint
npm run build
git diff --check
```

**Commit:** `fix(newsletter): validate fields before verification`

## Phase 6 - Client integration, database rehearsal, and review deployment

### Task 19: Run full local integration gates

**Files changed:** only fixes proven by focused failing tests.

**Actions:**

1. Run the complete client unit, type, lint, build, migration-lineage, checksum, database, and secret-scan gates.
2. Reset a local Supabase instance and exercise alert create/edit/reorder/schedule/archive/publish/read/recovery with isolated data.
3. Verify newsletter tests without sending production email.
4. Confirm static/output scans contain no private keys, tokens, local paths, synthetic records, or unapproved official claims.

**Verification:**

```powershell
npm test
npm run lint
npm run build
npm run verify:platform-migrations
npm run verify:production-migrations
npm run db:reset
npm run test:db
git diff --check
```

**Commit:** only targeted defect commits; no gate-only commit.

### Task 20: Rehearse and apply the production migration safely

**External state:** Supabase production schema; no content mutation.

**Preconditions:**

- Exact canonical migration checksum passes.
- Local reset, pgTAP, lint, and advisors pass.
- Linked project ref is verified as `rriebibkxymeqhafssvw`.
- Remote migration history is reconciled and there is no unexpected drift.

**Actions:**

1. Run a dry-run migration push against the linked production project.
2. Review the exact pending migration list and SQL identity.
3. Apply only the reviewed additive alert migration.
4. Re-run remote migration status and read-only schema/grant/RLS verification.
5. Do not create a production alert or newsletter subscriber as part of the migration.

**Verification:** Supabase CLI history, checksum evidence, and read-only health output retained without secrets.

**Commit:** none.

### Task 21: Produce and verify a Vercel review deployment

**External state:** review/Preview deployment only.

**Actions:**

1. Push the client commits to the existing review branch/PR.
2. Deploy a Preview using the approved production-like environment bindings without changing the public production alias.
3. Verify direct/deep routes, public 404, alert API no-store headers, admin/auth/API alert exclusion, editor alerts navigation, official links, newsletter validation order, image loading, console/network errors, and no horizontal overflow.
4. Test desktop, tablet, and true mobile device emulation.
5. Test default motion, reduced motion, keyboard-only navigation, pause/resume, focus/visibility transitions, and a scheduled boundary using isolated preview data.
6. Present settled desktop/mobile screenshots and findings for user visual approval.

**Production gate:** stop here until the user explicitly approves settled desktop and mobile visuals.

## Phase 7 - Production website release

### Task 22: Release the approved client build to production

**Preconditions:**

- User has approved the settled desktop and mobile Preview.
- Preview automation and manual QA are green.
- Production migration is present and verified.
- No unresolved provider, recovery, or newsletter health regression exists.

**Actions:**

1. Promote or deploy the exact reviewed client commit to production.
2. Verify `https://www.assemblywomanmorales.com/` and all canonical public routes.
3. Verify non-public route HTML has no alert markup.
4. Verify the editor Alerts workspace loads for authorized roles.
5. Perform only read-only production alert checks unless the user explicitly approves a real alert publication.
6. Verify newsletter rendering and server health without creating a synthetic subscriber.
7. Confirm Vercel deployment SHA, custom domain, TLS, response headers, console/network health, and recovery-worker health.

**Rollback:** redeploy the previously known-good client deployment. The additive schema remains dormant and backward-compatible.

**Commit:** none.

## Phase 8 - Reusable platform release preparation

### Task 23: Validate the complete reusable platform branch

**Platform files:** all alert changes plus any approved editor-quality commits already on the branch.

**Actions:**

1. Run the full platform unit, type, build, database, lint, migration, package-boundary, and secret-scan gates.
2. Run a clean consumer installation from locally packed tarballs.
3. Attach to a disposable sample project with the exact migration and verify inspect/plan/apply/verify idempotency.
4. Confirm all current editor-quality features remain in the release candidate: page workspace synchronization, draggable quick edit, pointer cursors, post required indicators, media linking, successful-mutation handling, complete history, atomic/versioned publishing, authoritative loader, and private media.
5. Confirm alert packages contain no Morales-specific facts, labels, URLs, branding, or site key.
6. Prepare a package dependency closure and candidate version table.
7. Push the review branch and update/create the platform PR; do not merge or publish yet.

**Verification:**

```powershell
npm test
npm run typecheck
npm run build
npm run test:db:site:reset
npm pack --dry-run
git diff --check
```

**Package publication gate:** present the exact candidate version and package list. Stop until the user explicitly approves both.

### Task 24: Publish only the approved private package closure

**Preconditions:** explicit approval of the exact version and package list.

**Actions:**

1. Confirm GitHub Packages authentication without printing the token.
2. Verify every internal dependency version in the approved closure.
3. Publish in dependency order with provenance/evidence supported by the repository.
4. Query the registry for every published version and inspect package metadata/tarball contents.
5. Run a fresh authenticated install in a disposable consumer.
6. Record the published package/version/checksum table in the platform release evidence.

**Failure boundary:** if any package publication fails, stop; do not republish or advance remaining dependents until registry state is reconciled.

### Task 25: Replace the client rehearsal packages with the published versions

**Client files:**

- `package.json`
- `package-lock.json`
- Any attachment receipt/checksum file required by the repository

**Actions:**

1. Update only the approved package closure to exact published versions.
2. Remove all temporary tarball/local-path references from the working installation.
3. Perform a clean authenticated install and prove there are no GitHub Packages 401/404 responses.
4. Re-run the complete client test/type/lint/build/database/migration gates.
5. Verify Preview again, then deploy the exact dependency-only commit after user visual approval if the published package build differs from the already approved website artifact.

**Verification:**

```powershell
npm ci
npm ls @reuben-williams/core @reuben-williams/content @reuben-williams/editor @reuben-williams/next @reuben-williams/cli
npm test
npm run lint
npm run build
npm run verify:platform-migrations
npm run verify:production-migrations
git diff --check
```

**Commit:** `chore: adopt released alert platform packages`

## Completion evidence

The work is complete only when all of the following are true:

- The public homepage uses the approved order and only reviewed official facts/destinations.
- The existing Resend newsletter remains live, first-party, double-opt-in, and truthfully reports pending confirmation.
- The volunteer path is an external Google Form with the approved bilingual summary and no duplicated data collection.
- The global alert bar is absent when empty, accessible when populated, schedule-aware, reduced-motion safe, and excluded from every non-public surface.
- Authorized staff can create, edit, reorder, enable/schedule, archive, and publish alerts with role enforcement, optimistic concurrency, idempotency, audit, and immutable history.
- Alert recovery is a separate verified immutable artifact chain and never exposes draft data.
- The canonical migration is byte-identical in platform and client lineages.
- Latest posts follow the exact deterministic query and contain no placeholders.
- Desktop, tablet, mobile, keyboard, reduced-motion, deep-route, 404, console, network, image, overflow, and recovery checks pass.
- The production custom domain serves the exact approved client commit.
- The reusable platform PR contains the current editor-quality fixes plus generic alert support.
- Only the explicitly approved private package closure is published, registry-verified, and clean-install verified.
- Both repositories are left clean except for the user's pre-existing unrelated files.
