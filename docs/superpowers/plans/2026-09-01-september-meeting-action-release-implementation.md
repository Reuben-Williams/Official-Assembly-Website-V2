# September Meeting Action Release Implementation Plan

Date: 2026-09-01

Spec: `docs/superpowers/specs/2026-09-01-september-meeting-action-release-design.md`

Status: Ready for implementation

Release rule: one tested Vercel deployment is promoted once to production after the database migration and every pre-production gate passes.

## Planning fallback

The required `writing-plans` skill is not installed in any configured local skill root. This plan uses the repository's established implementation-plan format plus the approved specification, test-driven-development, current Supabase migration/RLS guidance, Next.js 16 conventions, and the existing Morales release patterns.

## Non-negotiable working rules

- Preserve the user-owned untracked `artifacts/` directory and `client-website-setup-operator-walkthrough.md`.
- Do not modify or publish synthetic production events, submissions, leads, customers, or newsletter subscribers.
- Write one failing test, run it, confirm the expected failure, then write the minimum implementation to pass it.
- Keep every database change additive and compatible with the currently deployed application.
- Keep calendar management server-authorized and site-scoped; never expose a service-role credential to the browser.
- Do not hotlink Google Photos or commit share URLs containing personal email or opaque identifiers.
- Do not deploy partial meeting-sheet features publicly.

## Task 1: Baseline and tool verification

Files changed: none.

1. Record `git status --short`, current branch, HEAD, remotes, Node/npm versions, Supabase CLI version, Vercel link, and current migration list.
2. Use `npx supabase --help`, `npx supabase migration --help`, and `npx supabase db --help` rather than assuming CLI flags.
3. Run the existing focused tests, full `npm test`, `npm run lint`, `npm run build`, `npm run verify:platform-migrations`, and `npm run verify:production-migrations`.
4. Record any pre-existing failures before changing code. Stop if the baseline cannot be distinguished from new failures.
5. Confirm the production environment remains the linked Morales project and that no unrelated provider/project is selected.

## Task 2: Canonical public-link contract

Create:

- `tests/public-link-contract.test.ts`
- `lib/public-links/safe-public-url.ts`

RED:

1. Add focused tests for absolute HTTPS acceptance; normalization; exact checked-in allowlist; credentials, IP literals, non-default ports, HTTP, malformed URLs, unapproved hosts, and 2,049-character rejection; 2,048-character acceptance; and no network fetch.
2. Run `npx vitest run tests/public-link-contract.test.ts` and confirm failure because the contract does not exist.

GREEN:

3. Implement one pure parser returning the normalized URL string.
4. Export the reviewed allowlist without an editor bypass.
5. Run the focused test until green, then run existing link and alert tests.

Commit boundary: `feat: add canonical public link policy`.

## Task 3: Calendar domain contract

Create:

- `tests/calendar-contract.test.ts`
- `lib/calendar/contract.ts`

RED:

1. Test canonical draft input, locale fields, fixed `America/New_York` display timezone, end-after-start, public/hosted confirmations, media reference, URL validation, event entity/revision projections, and field length limits.
2. Test exact lifecycle commands and allowed roles.
3. Test effective-end behavior for explicit ends, no-end local day boundaries, DST transitions, equality at cutoff, ongoing events, future events, and deterministic start/ID ordering.
4. Test that the public projection omits actors, internal state, draft pointers, and revision metadata.
5. Run the test and confirm it fails on missing implementation.

GREEN:

6. Implement pure types, validators, normalizers, transition guards, effective-end calculation, and public projection helpers.
7. Use dependency injection for the current instant so tests remain deterministic.
8. Run focused tests, then refactor only after green.

Commit boundary: `feat: define calendar publishing contract`.

## Task 4: Additive calendar and History migration

Create with the current Supabase CLI first:

- one timestamped `supabase/migrations/*_site_calendar_publishing.sql`
- one `supabase/tests/*_site_calendar_publishing.test.sql`

RED:

1. Run `npx supabase migration new site_calendar_publishing` to create the migration shell.
2. Run the CLI's current test-file generator when available; otherwise create the SQL test with `apply_patch`.
3. Write pgTAP tests first for:
   - site-scoped event entities and immutable revisions;
   - entity pointer and lifecycle constraints;
   - event/revision foreign-key ownership;
   - contributor/editor/owner/viewer command permissions;
   - create, save, publish, unpublish, archive, and restore transitions;
   - stale version and invalid transition rollback;
   - publication validation and allowlisted URLs;
   - effective public read ordering and expiry;
   - atomic normalized History insertion;
   - `calendar` History source and `events` category constraints;
   - anon/authenticated grants denied for direct calendar mutation;
   - site isolation and service-role-only command execution; and
   - no hard delete.
4. Start/reset the local database and confirm the new tests fail because schema/functions are absent.

GREEN:

5. Add entity and immutable-revision tables, indexes for site/status/published start ordering, constraints, triggers, and private helper functions.
6. Extend the latest `builder_history_events_v1` source/category checks and add nullable calendar foreign keys.
7. Add command/read functions with explicit `search_path`, bounded JSON input, caller/site/role checks, optimistic concurrency, and one transaction per command.
8. Enable RLS on every new public-schema table, revoke default client grants, and grant only the exact server-side function/table privileges required.
9. Do not create a public view that bypasses RLS. If a view is needed, use `security_invoker = true` and test it.
10. Run `npm run db:reset`, `npm run test:db`, migration checksum verification, and database advisors supported by the installed CLI.

Commit boundary: `feat: add versioned calendar persistence`.

## Task 5: Calendar repository and protected API

Create:

- `tests/calendar-repository.test.ts`
- `tests/calendar-api.test.ts`
- `lib/calendar/repository.ts`
- `lib/calendar/supabase-repository.ts`
- `lib/calendar/client.ts`
- `app/api/builder/calendar/route.ts`
- `app/api/builder/calendar/[command]/route.ts`

RED:

1. Test repository list/read/command interfaces with real contract values and bounded adapters.
2. Test public reads as no-store, published-only, active-only, ongoing/future-only, deterministic, and site-scoped.
3. Test distinct unavailable results instead of empty fallback on database failure.
4. Test API authentication, CSRF, same-origin boundary, roles, content type, body size, idempotency, stale versions, status codes, and safe error text.
5. Run both files and confirm expected failures.

GREEN:

6. Implement the repository interface and Supabase adapter around the migration functions.
7. Implement the server-only public reader and protected calendar handlers.
8. Reuse existing builder request-auth and CSRF/origin helpers.
9. Implement the browser client without embedding credentials.
10. Run focused tests and the existing builder route/auth test suites.

Commit boundary: `feat: expose protected calendar operations`.

## Task 6: Calendar History integration

Modify:

- `lib/builder/history.ts`
- `app/api/builder/route.ts` only if reader wiring changes
- existing History UI mappings where categories/source labels are defined
- `tests/editor-history.test.ts`
- `tests/builder-routes.test.ts`

RED:

1. Test `calendar` source and `events` category validation, filtering, keyset pagination, unavailable-source reporting, and stable IDs.
2. Test command-specific source/result revision semantics.
3. Test that global restore is unavailable with the Calendar-workspace recovery reason.
4. Confirm current tests fail on the missing source/category.

GREEN:

5. Extend local source/category constants, readers, filters, labels, cursor parsing, and response mapping.
6. Preserve existing page/media/post/form behavior and partial-source semantics.
7. Run History and builder route suites.

Commit boundary: `feat: include calendar events in site history`.

## Task 7: Protected Calendar editor workspace

Create:

- `tests/calendar-workspace.test.tsx`
- `app/admin/editor/calendar-workspace.tsx`
- `app/admin/editor/calendar-workspace.module.css`

Modify:

- `app/admin/editor/editor-client.tsx`
- `app/admin/editor/page.tsx`

RED:

1. Test workspace registration/deep link `workspace=website.calendar`.
2. Test exactly one list membership per event, `Past`, and `Unpublished changes` states.
3. Test role-dependent controls and server-error handling.
4. Test required/optional indicators, English/Spanish inputs, dates/times, location, confirmations, link/media controls, preview, save, publish, unpublish, archive, restore, conflict refresh, and unsaved-change warning.
5. Test keyboard operation, accessible labels, focus restoration, and live status announcements.
6. Confirm focused tests fail because the workspace is absent.

GREEN:

7. Register a bounded local workspace following Alerts/Bilingual Readiness patterns.
8. Implement independent editor form/list components using the calendar client.
9. Keep static explanatory copy outside render loops and avoid avoidable client bundles.
10. Run focused editor, navigation, auth, and workspace tests.

Commit boundary: `feat: add calendar editor workspace`.

## Task 8: Public homepage and Events page

Create:

- `tests/public-calendar.test.tsx`
- `tests/events-page.test.tsx`
- `app/events/page.tsx`
- `app/ui/PublicEventsSection.tsx`
- `app/ui/public-events-section.module.css`

Modify:

- `app/ui/HomePageView.tsx`
- `builder.config.ts`
- route/page registries and metadata helpers as required
- `app/i18n/catalog.public.ts`
- `app/i18n/translations.ts`
- translation completeness tests

RED:

1. Test next-three homepage ordering and placement after News & Updates.
2. Test `/events` single `h1`, agenda semantics, `<time>` values, direct route, metadata, English/Spanish rendering, and no primary-navbar item.
3. Test separate empty and unavailable states.
4. Test no draft/internal fields in rendered output and no content flash/client fetch.
5. Confirm failures before implementation.

GREEN:

6. Implement server-rendered, no-store public event components and route.
7. Add stable page and section regions while keeping event records in the Calendar workspace.
8. Add complete bilingual catalog coverage.
9. Run focused public, builder mapping, route, and translation tests.

Commit boundary: `feat: add public community events calendar`.

## Task 9: Meeting-sheet profile, resources, community, voting, and newsletter updates

Modify/create focused tests first:

- `tests/official-legislature-profile.test.ts`
- page/component tests for Resources, Community, Voting, and Newsletter
- link-contract integration tests
- `app/data/official-legislature-profile.ts`
- `app/ui/OfficialProfileSection.tsx`
- `app/data/site.ts`
- bounded page components where the generic template cannot express approved layouts cleanly
- `builder.config.ts`
- translation catalogs/tests

RED:

1. Assert no `born` field or `Born:` label and exact `EDS / EDD`.
2. Assert Resources has a first-class current-flyer block with `media.current-resource-flyer` and truthful empty state.
3. Assert Community prominently links the exact approved Google form and explains external operation/new-tab behavior.
4. Assert Voting prioritizes the exact Essex County Clerk Election, Forms, Voter Registration, Vote by Mail, and Sample Ballots URLs while keeping state links secondary.
5. Assert Newsletter has no external Fireside newsletter presentation and retains existing onsite form behavior.
6. Confirm focused tests fail for the missing changes.

GREEN:

7. Implement only the approved page changes and stable regions.
8. Use the canonical URL contract for every new external link.
9. Preserve the existing Fireside legislative-contact form only under truthful contact labeling.
10. Run focused page tests plus newsletter regression suites.

Commit boundary: `feat: apply September constituent content updates`.

## Task 10: Approved professional media intake

Create tests before importing public derivatives:

- `tests/professional-media-manifest.test.ts`
- `content/approved-professional-media.json`
- `content/media-source/professional/` with exactly five selected tracked originals
- optimized desktop/mobile derivatives under `public/images/`

Modify:

- `.vercelignore`
- `app/data/site.ts` and/or approved media registry
- page image mappings and translation/alt catalogs

RED:

1. Test exactly five stable placements: Home supporting, About primary, News supporting, Community primary, Resources supporting.
2. Test manifest schema, sanitized source labels/paths, tracked source existence, SHA-256 checksums, derivative existence/dimensions, public paths, English/Spanish alt text, and approval state.
3. Test the source directory is excluded by `.vercelignore` and public output contains no Google Photos URL, personal email, or opaque share token.
4. Confirm the test fails before manifest/assets exist.

GREEN:

5. Generate contact sheets or inspect candidates from the approved local/public collections without modifying originals.
6. Select five high-resolution, in-focus, context-appropriate images according to the spec's page mapping.
7. Copy only the selected originals into the tracked non-public source directory.
8. Generate responsive AVIF/WebP derivatives with Sharp, preserving aspect ratio and useful focal points.
9. Populate exact checksums, dimensions, sanitized collection labels, mappings, and bilingual alternative text.
10. Update page mappings and run manifest/page/image tests.
11. Visually inspect every derivative at original detail before accepting it.

Commit boundary: `feat: refresh approved professional photography`.

## Task 11: Full local and isolated release verification

1. Run all focused suites from Tasks 2-10.
2. Run `npm test`, `npm run lint`, `npm run build`, `npm run test:db`, `npm run test:newsletter`, `npm run test:e2e`, `npm run verify:platform-migrations`, and `npm run verify:production-migrations`.
3. Reset local Supabase and exercise the full draft -> publish -> edit while published -> republish -> unpublish -> archive -> restore lifecycle.
4. Verify atomic History, site/role isolation, URL rejection, and no draft leakage.
5. Exercise flyer replacement/restoration and newsletter/form regressions only in the isolated environment.
6. Start the production build locally and inspect 1440x900, 1280x800, 768x1024, 390x844, and 320x700.
7. Verify English/Spanish, keyboard order, landmarks, accessible names, contrast, focus, reduced motion, image loading, deep routes, console/network errors, and overflow.
8. Run a current web-interface-guidelines review over changed UI files and resolve every blocking finding.
9. Run React/Next performance review over changed TSX files and resolve material findings.

Commit boundary: `test: verify September release candidate`.

## Task 12: Preview, production migration, and one public launch

1. Confirm clean tracked worktree, final commit, Vercel project link, Supabase project ref, migration lineage, and environment boundaries.
2. Deploy one Vercel preview from the final commit; never attach production service-role credentials to a mutating preview.
3. Run read-only preview route, asset, metadata, localization, responsive, accessibility, console, network, and overflow checks.
4. Create a secure pre-change Supabase backup or provider-supported restore point outside the repository.
5. Run `npx supabase migration list` and the repository lineage checks.
6. Apply the exact tested migration once with the current supported `npx supabase db push` workflow.
7. Verify the production migration version, tables, constraints, functions, grants, RLS, and History extensions. Stop before web promotion if any check fails.
8. Promote the exact tested Vercel deployment once to production.
9. Record deployment ID/URL and commit.

## Task 13: Post-launch production verification

All production checks are read-only unless an already approved staff member intentionally performs an authentic newsletter confirmation.

1. Require HTTP 200 and correct canonical/social metadata for `/`, `/events`, `/about`, `/resources`, `/community`, `/voting`, `/newsletter`, and authorized editor deep links.
2. Verify the homepage calendar and `/events` display the approved empty state, not unavailable, and expose no draft data.
3. Open the Calendar workspace, verify authenticated read access and client-side guidance, then leave without saving.
4. Verify exact `EDS / EDD` and complete absence of birth output.
5. Verify current-flyer region, volunteer form link, all Essex County Clerk links, state secondary links, and no external Fireside newsletter link.
6. Verify all five professional images and responsive derivatives directly by HTTP and at desktop/mobile viewports.
7. Verify onsite newsletter rendering, Turnstile/configuration health, existing delivery evidence, and existing authentic submissions/leads/customers through read-only dashboards/API evidence.
8. If an approved staff member supplies their real address during the check, execute one authentic confirmation; otherwise report live-send verification as unavailable.
9. Verify external official destinations return successful or expected redirect responses without submitting their forms.
10. Inspect settled Vercel runtime logs and Supabase errors for first-party 5xx or database failures.
11. Repeat keyboard, localization, contrast, focus, reduced-motion, console/network, and overflow checks on production.
12. Roll back the Vercel deployment immediately on a critical trigger; do not destructively reverse the additive migration or delete History.
13. Report the final production URL, commit, deployment, migration, passed checks, truthfully unavailable checks, and rollback posture.

## Completion definition

The task is complete only after the one production deployment is live and every available post-launch check passes. A passed build or preview alone is not completion. Any unavailable live-send or first-real-event lifecycle check is reported explicitly and never replaced with synthetic production data.
