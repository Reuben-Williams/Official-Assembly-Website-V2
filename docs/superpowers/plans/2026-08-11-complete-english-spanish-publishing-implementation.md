# Complete English-Spanish Publishing Implementation Plan

**Status:** User-approved design; implementation requires approval of this plan

**Design source of truth:** `docs/superpowers/specs/2026-08-11-complete-english-spanish-publishing-design.md` at commit `a215020`

**Client repository:** `D:\Project Morales\Official Assembly Website V2`

**Protected platform checkout:** `D:\Project Morales\site-editor-platform`

**Planned clean platform worktree:** `D:\Project Morales\site-editor-platform-bilingual-publishing`

## Outcome

Replace the current client-side, partial English-to-Spanish text substitution with a server-rendered, revisioned bilingual publishing system. Every public surface must resolve from one approved site composition in English or Spanish, remain on the same route when language changes, render without an untranslated flash, and fail closed when required Spanish content is missing, stale, or unapproved.

The reusable Site Editor Platform will own localization state, immutable domain revisions, candidate and published site compositions, preview binding, form projection binding, history, activation, and recovery contracts. The Morales website will own its reviewed public catalog, official content, page and component integration, Spanish copy, and production activation evidence.

Implementation may reach a protected review deployment after automated verification. Publishing new private packages, applying a production migration, and activating the bilingual production epoch remain separate explicit approval gates.

## Non-negotiable implementation rules

- Use red-green-refactor for every behavior change: write a focused failing test, observe the intended failure, implement the smallest correct behavior, rerun the focused test, and then run the relevant package or repository gate.
- Treat English as the source locale and Spanish as reviewed public copy. Generated Spanish drafts are optional authoring aids only; they never become approved automatically.
- Keep the private editor shell in English. Localize every public surface listed in the approved design, including chrome, pages, posts, alerts, forms, newsletter confirmation and email, media text, metadata, error text, and accessibility text.
- Publish a complete immutable site composition, never a set of independent latest rows. Preview, publish, restore, recovery, forms, and live rendering must refer to the same composition identity and digest.
- Invalidate approval when the English source digest or exemption digest changes. A stale Spanish value must block publication instead of falling back silently.
- Keep language selection server-owned in `assembly-language=en|es`; the browser may request a locale change but must not mutate rendered text to simulate translation.
- Render locale-dependent public responses dynamically or with locale-safe cache variation. Do not place user locale in a shared CDN response.
- Keep the checked-in approval catalog private to the build and ship only the stripped public runtime catalog.
- Bind managed-form and newsletter submissions to the exact locale, catalog, composition, consent, and email-template projection shown to the visitor.
- Keep draft and published revisions immutable. All write paths require site scope, authorization, optimistic concurrency, idempotency, audit, and bounded recovery evidence.
- Do not activate an AI translation provider or introduce an unapproved provider dependency in this release.
- Do not send synthetic production subscriptions, confirmation messages, contact requests, or broadcasts during validation.
- Author the canonical additive database migration once in the platform worktree and copy it byte-for-byte into the client migration lineage. Fail closed on filename or checksum drift.
- Never print, store, or commit GitHub, Supabase, Vercel, Resend, SMTP, Turnstile, service-role, signing, or recovery secrets.
- Do not edit, reset, stash, clean, stage, or commit unrelated user files. Leave `client-website-setup-operator-walkthrough.md` untracked and leave the dirty protected platform checkout untouched.
- Do not edit installed `node_modules` or commit local `file:` dependencies, package tarballs, generated coverage, browser traces, or local Supabase state.
- Finish each task with `git diff --check`, focused tests, and a narrow commit in the repository where the change belongs.

## Branch, worktree, package, and release map

- Client baseline: `codex/newsletter-owner-login-evidence` at approved design commit `a215020` in `D:\Project Morales\Official Assembly Website V2`.
- Client implementation branch: create `codex/complete-bilingual-publishing` from the approved client baseline after confirming the working tree contains only the unrelated untracked walkthrough.
- Protected platform checkout: `D:\Project Morales\site-editor-platform`; it currently contains unrelated user modifications and is inspection-only.
- Platform implementation branch: create `codex/bilingual-publishing` in the clean worktree `D:\Project Morales\site-editor-platform-bilingual-publishing`.
- Platform starting candidate: `origin/codex/alert-scroll-mode` at the recorded baseline. Before editing, prove that this source contains the behavior shipped in the client’s installed `@reuben-williams/*@0.2.6` packages. Stop if the source-to-package reconciliation fails.
- Provisional private package closure: `@reuben-williams/core`, `content`, `forms`, `next`, `editor`, and `cli`. Do not add growth packages unless dependency tests prove they require a public localization contract change.
- Package rehearsal: use `npm pack` outputs in a disposable directory outside both repositories. Permanent manifests must remain on registry versions.
- Package publication: reserve a version and publish only the verified closure after the user approves the exact version and package list.
- Database lineage: platform migration is canonical; client migration is an identical attached copy registered in both manifests.

## Pause gates

1. **Baseline gate:** source-to-installed-package reconciliation and clean worktree evidence are required before platform edits.
2. **Translation-content gate:** all existing public English values must have reviewed Spanish copy or an approved neutral exemption before activation.
3. **Package gate:** the exact package closure and version require explicit approval before registry publication.
4. **Review-deployment gate:** desktop and mobile English/Spanish visual review must be approved before production promotion.
5. **Production-data gate:** production migration and backfill plans require an explicit review of inventory counts and rollback evidence.
6. **Activation gate:** the bilingual epoch is activated only after the same inactive production deployment passes readiness checks; activation does not trigger a second deployment.

## Phase 0 - Safety, baselines, and contract reconciliation

### Task 1: Freeze client and platform baselines

**Files changed:** none.

**Actions:**

1. Record branch, HEAD, status, remotes, Node/npm versions, lockfile digests, Supabase CLI version, and installed `@reuben-williams/*` versions.
2. Confirm the client contains only the unrelated untracked walkthrough.
3. Fetch platform remotes without changing the protected checkout.
4. Create the clean platform worktree and implementation branch without reusing the dirty `main` checkout.
5. Record the protected checkout’s two existing modifications and prove they remain untouched.
6. Run current client and platform unit, type, lint, migration, and build baselines. Record any pre-existing failure before feature work.

**Verification:**

```powershell
git -C "D:\Project Morales\Official Assembly Website V2" status --short --branch
git -C "D:\Project Morales\Official Assembly Website V2" rev-parse HEAD
git -C "D:\Project Morales\site-editor-platform" status --short --branch
git -C "D:\Project Morales\site-editor-platform" fetch origin --prune
git -C "D:\Project Morales\site-editor-platform" worktree add -b codex/bilingual-publishing "D:\Project Morales\site-editor-platform-bilingual-publishing" origin/codex/alert-scroll-mode
npm ls @reuben-williams/core @reuben-williams/content @reuben-williams/forms @reuben-williams/next @reuben-williams/editor @reuben-williams/cli
npm test
npm run lint
npm run build
```

Run the client `npm` commands in the client repository. In the clean platform worktree, use the repository's actual root gates instead of the client commands:

```powershell
npm run check
npm run test:db:site:reset
npm run check:release
```

**Commit:** none.

### Task 2: Reconcile published 0.2.6 packages with platform source

**Platform files inspected:**

- `packages/*/package.json`
- `packages/*/src/index.ts`
- `packages/core/src/capabilities.ts`
- `packages/content/src/migration-manifest.ts`
- `packages/editor/src/AttachedSiteEditor.tsx`
- `packages/next/src/index.tsx`
- `packages/forms/src/contracts.ts`
- `packages/cli/src/onboarding/*`
- root lockfile and workspace configuration

**Client artifacts inspected:**

- `package.json`
- `package-lock.json`
- `node_modules/@reuben-williams/*/package.json`
- installed package exports and declarations

**Actions:**

1. Pack the clean platform baseline without publishing.
2. Normalize and compare package names, exports, dependency edges, declarations, and runtime entry points against installed `0.2.6` artifacts.
3. Identify the commit that actually represents the reusable `0.2.6` baseline. Rebase or recreate the clean implementation branch from that source if `origin/codex/alert-scroll-mode` is not equivalent.
4. Record a reconciliation manifest with package name, source commit, installed version, archive digest, and differences.
5. Stop before code changes if a published artifact cannot be traced to source.

**Platform files:**

- `docs/releases/bilingual-publishing-baseline.md` (new)
- `scripts/verify-published-baseline.mjs` (new if an equivalent verifier does not already exist)
- `scripts/__tests__/verify-published-baseline.test.mjs` (new)

**Red tests first:**

- The verifier fails on a package-name mismatch, missing export, changed dependency edge, or unaccounted installed file.
- The verifier accepts a documented generated-file difference only when its source and digest are declared.

**Verification:** run the new verifier against all six provisional packages and retain a secret-free evidence report.

**Commit:** platform-only baseline verification commit.

### Task 3: Freeze implementation seams and migration identity

**Files inspected:** the approved design plus current platform and client localization, preview, publishing, form, history, recovery, and migration entry points.

**Actions:**

1. Map each approved design section to the owning package, client module, table/RPC, and test suite.
2. Reserve the next unused monotonic migration identifier after checking both repositories and remote branches.
3. Freeze schema names, versioned contract names, digest algorithms, idempotency retention, recovery retention, and package dependency direction before implementation.
4. Confirm the stripped public catalog cannot import approval evidence or reviewer identity.
5. Confirm the provisional six-package closure. Expand only when a red dependency test demonstrates a required package change.

**Files:**

- `docs/architecture/bilingual-publishing-traceability.md` (new)
- `packages/content/src/migration-manifest.ts`
- related manifest tests

**Verification:** every acceptance criterion in the design has an owner and at least one planned test.

**Commit:** platform traceability and reserved migration-manifest commit.

## Phase 1 - Reusable localization and composition contracts

### Task 4: Add locale values, state transitions, digests, permissions, and audit events

**Platform files:**

- `packages/core/src/localization.ts` (new)
- `packages/core/src/capabilities.ts`
- `packages/core/src/permissions.ts`
- `packages/core/src/audit.ts`
- `packages/core/src/index.ts`
- `packages/core/tests/localization.test.ts` (new)
- `packages/core/tests/permissions.test.ts`
- `packages/core/tests/history-event.test.ts`

**Red tests first:**

- Only `en` and `es` are public locales for this contract version.
- A localized field distinguishes `missing`, `draft`, `needs_review`, `approved`, and neutral exemption state.
- Approval records source digest, translation digest, reviewer, review time, and exemption digest when applicable.
- Changing English or the exemption invalidates Spanish approval deterministically.
- Only the approved translation permission can mark a value approved or exempt.
- Audit events distinguish draft, review, approval, invalidation, publish, restore, and activation.

**Implementation:** add versioned, JSON-safe localization primitives and pure transition functions; export them without importing editor or database concerns.

**Verification:** focused core tests, full core test suite, typecheck, and export-surface test.

**Commit:** `feat(core): add bilingual localization contracts`.

### Task 5: Add localized domain revisions and stable rich-text translation graphs

**Platform files:**

- `packages/content/src/localization.ts` (new)
- `packages/content/src/rich-text.ts`
- `packages/content/src/post-schema.ts`
- `packages/content/src/workflows.ts`
- `packages/content/src/repository.ts`
- `packages/content/src/index.ts`
- `packages/content/tests/localization.test.ts` (new)
- `packages/content/tests/rich-text-localization.test.ts` (new)
- `packages/content/tests/workflows.test.ts`

**Red tests first:**

- Page regions, posts, alerts, media text, form copy, and metadata retain immutable domain ownership.
- Rich-text translations attach to stable source-node IDs and cannot approve a structurally mismatched graph.
- Resolution returns only approved current translations and reports a typed blocker for missing or stale values.
- Neutral URLs, phone numbers, email addresses, dates, IDs, and approved proper-noun exemptions remain value-identical without pretending they were translated.
- A source revision creates a new translation-review requirement without mutating the old revision.

**Implementation:** introduce versioned localized snapshot types, rich-text graph validation, domain readiness summaries, and resolver functions. Keep rendering adapters out of `content`.

**Verification:** focused content tests, schema fixtures, property-based digest checks where practical, full content suite.

**Commit:** `feat(content): add localized revision workflows`.

### Task 6: Add candidate composition, publication, idempotency, and recovery contracts

**Platform files:**

- `packages/content/src/publication-composition.ts` (new)
- `packages/content/src/recovery.ts` (new)
- `packages/content/src/workflows.ts`
- `packages/content/src/repository.ts`
- `packages/content/src/index.ts`
- `packages/content/tests/publication-composition.test.ts` (new)
- `packages/content/tests/recovery.test.ts` (new)

**Red tests first:**

- `RequestedCompositionDeltaV1` contains only caller-selected candidate revision IDs and expected predecessor information.
- `MaterializedCompositionDeltaV1` adds server-generated publication IDs and cannot be supplied by the browser.
- A candidate materializes to one immutable `CandidateSiteComposition` with a canonical digest.
- Publishing atomically advances the site pointer with a persisted monotonic publication sequence.
- Preview and live publication digests are identical for the same materialized candidate.
- `(siteId, idempotencyKey)` is globally unique; replay with the same operation and request hash returns the stored result, while a different hash conflicts.
- Successful idempotency results remain replayable for at least 90 days.
- Restore creates a new publication pointing to an earlier complete composition rather than mutating history.
- Recovery evidence identifies the exact intended predecessor and successor composition.

**Implementation:** define pure composition materialization, canonical serialization, request hashing, idempotent result contracts, restore semantics, and bounded recovery envelopes.

**Verification:** focused composition/recovery tests and cross-runtime digest fixtures.

**Commit:** `feat(content): add atomic site composition contracts`.

### Task 7: Add bilingual managed-form and newsletter projection contracts

**Platform files:**

- `packages/forms/src/contracts.ts`
- `packages/forms/src/projection.ts`
- `packages/forms/src/validation.ts`
- `packages/forms/src/templates/newsletter.ts`
- `packages/forms/src/index.ts`
- `packages/forms/tests/projection.test.ts`
- `packages/forms/tests/validation.test.ts`
- `packages/forms/tests/newsletter-template.test.ts`

**Red tests first:**

- Labels, help, placeholders, options, consent, success, error, and confirmation copy use localized approved values.
- A public projection carries locale, form revision, composition digest, catalog digest, consent digest, and email-template digest.
- The server rejects a submission when its signed projection is expired, altered, stale, from another site, or inconsistent with the submitted locale.
- Validation field names and messages resolve in the visitor’s locale without changing normalized field keys.
- System locale remains `en|es`; only the server derives `en-US|es-US` output formatting identifiers.
- Consent evidence records exactly the localized disclosure shown.

**Implementation:** extend forms contracts additively and preserve normalized storage keys across languages.

**Verification:** focused forms tests and backward-compatibility fixtures for existing English-only stored submissions.

**Commit:** `feat(forms): bind bilingual public projections`.

## Phase 2 - Canonical database, repositories, and recovery

### Task 8: Author the canonical additive database migration

**Platform files:**

- `supabase/migrations/<reserved-id>_complete_bilingual_publishing.sql` (new)
- `supabase/tests/<next-index>-complete-bilingual-publishing.test.sql` (new)
- `packages/content/src/migration-manifest.ts`
- migration manifest tests

**Red database tests first:**

- Existing English rows remain readable before activation.
- Localization revisions are site-scoped, immutable, and uniquely tied to a domain revision and locale.
- Approval metadata and source, translation, and exemption digests are required for approved state.
- Candidate compositions, published compositions, domain manifests, publication sequence, idempotency results, activation epoch, recovery pointers, and outbox evidence persist transactionally.
- Browser roles cannot read private drafts, approval evidence, idempotency records, or recovery payloads and cannot call mutation RPCs directly.
- Authorized server/editor operations are site-scoped and optimistic-concurrency protected.
- Publish readiness locks the exact inventory and cannot pass with missing, draft, stale, or unapproved required Spanish values.
- Atomic publication cannot advance only some domains.
- Restore and recovery preserve monotonic sequence and append-only audit history.

**Implementation:** add the minimum tables, columns, indexes, constraints, RLS policies, and server-only RPCs required by the approved contracts. Keep activation off by default and dual-read/dual-write compatible.

**Verification:** reset the local platform database, run all pgTAP tests, verify migration ordering, dump schema, and inspect policies.

**Commit:** `feat(db): add bilingual composition persistence`.

### Task 9: Implement server repositories and transaction boundaries

**Platform files:**

- `packages/core/src/supabase/content-repository.ts`
- `packages/content/src/repository.ts`
- `packages/next/src/content/server/index.ts`
- `packages/next/src/content/server/publication.ts` (new)
- `packages/next/src/content/server/localization.ts` (new)
- associated repository and integration tests

**Red tests first:**

- Draft, review, approve, invalidate, materialize, preview, publish, restore, and recover use authenticated server operations.
- A publish request locks and verifies the candidate inventory inside the publication transaction.
- Idempotent replay returns the original publication ID and composition digest.
- Cross-site IDs and stale expected predecessors fail without partial writes.
- Dual-write inactive mode records new localization state without changing public reads.

**Implementation:** map the pure contracts to database RPCs and typed repository methods. Keep service credentials server-only.

**Verification:** repository tests against local Supabase, authorization suite, concurrent-publish test, and failure-injection rollback test.

**Commit:** `feat(next): persist bilingual site compositions`.

### Task 10: Extend durable recovery for whole-site publication

**Platform files:**

- `packages/next/src/content/server/recovery.ts`
- existing recovery worker adapters
- `packages/cli/src/recovery/*` or the current recovery command seam
- recovery integration tests

**Red tests first:**

- An interrupted post-commit response can recover the already-committed publication idempotently.
- An uncommitted attempt leaves the predecessor pointer intact.
- Recovery never reconstructs a site from per-domain latest rows.
- Recovery retains at least the current and three prior verified compositions for 90 days.
- The current pointer is tried first, older retained pointers are tried in descending persisted publication sequence, and a lower-sequence worker cannot replace a higher-sequence pointer.

**Implementation:** persist complete composition recovery artifacts and update the worker/CLI to reconcile pointer, sequence, audit, and outbox evidence as one unit.

**Verification:** crash-window integration tests and repeated-worker replay tests.

**Commit:** `feat(next): recover atomic site publications`.

## Phase 3 - Server locale, preview, catalog, and reusable editor

### Task 11: Add server-owned locale selection and cache-safe rendering helpers

**Platform files:**

- `packages/next/src/localization/locale.ts` (new)
- `packages/next/src/localization/catalog.ts` (new)
- `packages/next/src/localization/metadata.ts` (new)
- `packages/next/src/index.tsx`
- `packages/next/tests/localization.test.ts` (new)
- `packages/next/tests/metadata-localization.test.ts` (new)

**Red tests first:**

- Missing or invalid cookie resolves to English.
- `assembly-language` accepts only `en|es`, uses same-route redirect or refresh, `SameSite=Lax`, production `Secure`, and at most 365-day age.
- Locale-dependent content is not stored in a shared unvaried cache.
- Catalog resolution fails closed on unknown or unapproved required keys.
- Metadata, Open Graph text, structured data, errors, and accessibility strings resolve through the same locale context.

**Implementation:** provide server helpers for cookie parsing/writing, locale context, stripped catalog loading, and metadata resolution. Do not add DOM translation.

**Verification:** unit tests plus a minimal Next fixture proving direct Spanish requests have Spanish HTML at first byte.

**Commit:** `feat(next): add server-rendered locale context`.

### Task 12: Bind preview sessions to candidate composition and locale

**Platform files:**

- `packages/core/src/preview-protocol.ts`
- `packages/next/src/auth/preview-session.ts`
- preview route handlers
- preview protocol and session tests

**Red tests first:**

- Preview grants bind site, candidate composition, composition digest, locale, expiry, and authorized editor session.
- A preview cannot switch to another candidate or site by changing query parameters.
- English and Spanish preview the same candidate composition.
- Preview responses are private and `no-store`.
- A missing Spanish draft may show an explicitly marked English fallback only inside authenticated preview; the same fallback is forbidden in public rendering.

**Implementation:** version the preview protocol additively and require the server to resolve all domains from the bound candidate.

**Verification:** session forgery, expiry, cross-site, locale-switch, and preview-to-publish digest tests.

**Commit:** `feat(next): bind preview to bilingual candidate composition`.

### Task 13: Sign and verify exact form projections

**Platform files:**

- `packages/next/src/forms/public/projection-token.ts` (new)
- `packages/next/src/forms/public/route-handlers.ts`
- `packages/next/src/forms/public/projection.ts`
- related form route tests

**Red tests first:**

- The signed token binds all fields required by the approved design and excludes secrets from its payload.
- Reusing a token with another email, site, form, locale, or composition fails.
- Valid idempotent submission replay returns the original result without duplicate delivery work.
- A stale projection receives a localized retry response rather than accepting outdated consent.

**Implementation:** add HMAC or current platform-equivalent signing with versioned key ID, bounded lifetime, canonical payload digest, and constant-time verification.

**Verification:** tamper matrix, rotation fixture, replay tests, and no-secret serialization scan.

**Commit:** `feat(next): verify signed bilingual form projections`.

### Task 14: Build paired-language authoring and readiness UI

**Platform files:**

- `packages/editor/src/localization/LocalizedFieldEditor.tsx` (new)
- `packages/editor/src/localization/LocalizationStatus.tsx` (new)
- `packages/editor/src/localization/ReadinessWorkspace.tsx` (new)
- `packages/editor/src/content/PostEditor.tsx`
- `packages/editor/src/content/RichTextEditor.tsx`
- `packages/editor/src/shell/WebsitePreviewWorkspace.tsx`
- `packages/editor/src/HistoryWorkspace.tsx`
- `packages/editor/src/types.ts`
- editor tests and stories/fixtures where present

**Red tests first:**

- English source and Spanish copy appear side by side with status, stale reason, source change, and reviewer evidence.
- Required/optional/neutral-exempt states are explicit and keyboard accessible.
- Only an authorized reviewer sees approval actions.
- Generated drafts, when available, remain drafts and show provenance; absence of a provider does not block manual entry.
- Readiness groups blockers by pages, shared regions, posts, alerts, forms, email, media, metadata, and errors.
- Clicking a blocker opens the owning record and field.
- Preview changes language without leaving the candidate composition.
- History filters localization changes and restores the complete composition.

**Implementation:** add reusable editor components and adapters while preserving the English private shell.

**Verification:** component tests, keyboard tests, accessible-name assertions, drag/overlay regression tests, and editor workspace navigation tests.

**Commit:** `feat(editor): add bilingual authoring and readiness`.

### Task 15: Add inventory, catalog, backfill, and activation CLI commands

**Platform files:**

- `packages/cli/src/localization/inventory.ts` (new)
- `packages/cli/src/localization/catalog.ts` (new)
- `packages/cli/src/localization/backfill.ts` (new)
- `packages/cli/src/localization/activate.ts` (new)
- `packages/cli/src/index.ts`
- CLI tests and fixtures

**Red tests first:**

- Inventory is read-only and lists every required public value with owner, stable ID, locale status, source digest, and exemption eligibility.
- Catalog validation fails on duplicate keys, approval evidence in the public artifact, stale digests, or missing referenced keys.
- Backfill defaults to dry-run, is idempotent, and refuses unknown content.
- Activation requires locked inventory, current dashboard review, complete migration evidence, approved catalog, no blockers, and the expected inactive deployment identity.
- Activation writes the database flag/epoch without triggering deployment.

**Implementation:** add explicit `inventory`, `catalog:verify`, `backfill --dry-run`, `backfill --apply`, `readiness`, and `activate` commands with machine-readable and human-readable output.

**Verification:** CLI fixture suite, rerun/idempotency tests, and secret-redaction scan.

**Commit:** `feat(cli): add bilingual publishing operations`.

## Phase 4 - Reusable platform rehearsal

### Task 16: Validate and pack the reusable platform without publishing

**Files changed:** only fixes justified by red validation failures.

**Actions:**

1. Run all platform unit, type, lint, build, migration, authorization, and CLI tests.
2. Build all six provisional packages in dependency order.
3. Pack them into a disposable external directory.
4. Install the archives into a disposable Next fixture and run export/import, rendering, editor, form, and migration-contract smoke tests.
5. Produce the final dependency closure and archive digests.
6. Do not publish or change the client lockfile yet.

**Verification:** clean worktree after commits, reproducible archive digests, and no internal `@your-builder/*` identity or local-path reference in publishable artifacts.

**Commit:** platform-only validation fixes, if any.

## Phase 5 - Morales website integration

### Task 17: Attach the canonical migration byte-for-byte

**Client files:**

- `supabase/migrations/<reserved-id>_complete_bilingual_publishing.sql` (new, exact copy)
- `supabase/tests/<next-index>-complete-bilingual-publishing.test.sql` (new or client attachment coverage)
- `lib/builder/migration-manifest.ts` or current client migration registry
- migration verification tests

**Red tests first:**

- Client migration filename and bytes equal the canonical platform file.
- Registered checksum and contract version match.
- Reordered, edited, or absent copies fail verification.

**Implementation:** copy the canonical migration and register its immutable identity. Do not customize SQL in the client.

**Verification:** `npm run db:verify-migrations`, local reset, full client pgTAP suite.

**Commit:** `feat(db): attach bilingual publishing migration`.

### Task 18: Replace DOM text mutation with server-rendered locale context

**Client files:**

- `app/i18n/translations.ts` (retire or reduce to migration input)
- `app/i18n/locale.ts` (new)
- `app/i18n/catalog.private.ts` (new)
- `app/i18n/catalog.public.ts` (generated stripped artifact)
- `app/i18n/catalog-build.ts` (new)
- `app/ui/LanguageToggle.tsx`
- `app/layout.tsx`
- `app/ui/AppHeader.tsx`
- `app/ui/AppFooter.tsx`
- locale action/route handler
- `tests/translator.test.ts`
- `tests/i18n-builder-bridge.test.tsx`
- new server-locale and catalog tests

**Red tests first:**

- Direct Spanish requests return Spanish header, footer, main content, metadata, and accessibility text in initial HTML.
- Direct English requests remain English.
- Language selection preserves pathname, search parameters, and hash intent while setting the cookie safely.
- The two-option selector exposes selected state, preserves focus after refresh, and announces one localized language change rather than announcing the rerendered page.
- No `MutationObserver`, global text-node walk, or localStorage language source remains.
- Public catalog output contains no reviewer identity, notes, source copy, or approval history.
- Unknown required catalog keys fail build/readiness instead of showing English on Spanish pages.

**Implementation:** load locale and stripped catalog on the server, pass typed resolved copy to client components, and make the selector a same-route cookie action/navigation control.

**Verification:** focused tests, server HTML snapshots, static scan for the retired mutation approach, build.

**Commit:** `feat(i18n): render locale on the server`.

### Task 19: Localize public chrome, pages, metadata, media, and errors

**Client files:**

- `app/ui/AppHeader.tsx`
- `app/ui/AppFooter.tsx`
- `app/ui/HomePageView.tsx`
- `app/ui/PageTemplate.tsx`
- shared public sections and cards under `app/ui/*`
- public route pages under `app/**/page.tsx`
- `app/not-found.tsx`
- `app/error.tsx` and public error boundaries if present
- route metadata generators
- `app/data/site.ts`
- image/media projection adapters
- public route tests

**Red tests first:**

- Every public route in the approved inventory renders complete English and Spanish HTML.
- Navigation, calls to action, alert controls, form affordances, footer, 404, validation, loading, and accessibility copy resolve in the selected locale.
- Title, description, Open Graph, structured data, image alt, captions, and link labels are localized where required.
- Protected official names, URLs, phones, addresses, IDs, and approved neutral values remain exact.
- No route contains a mixed-language required string.

**Implementation:** replace literal public copy with typed catalog/content resolution and add page-level readiness ownership.

**Verification:** route matrix tests, metadata tests, HTML mixed-language sentinel scan, and build.

**Commit:** `feat(site): localize all public routes`.

### Task 20: Integrate localized pages, posts, alerts, and live refresh

**Client files:**

- `builder.config.ts`
- builder content adapters under `lib/builder/*`
- post renderers and post routes
- alert API, projection, and `PublicAlertController`
- editor route adapters under `app/api/builder/*`
- integration tests for pages, posts, alerts, and history

**Red tests first:**

- Published pages, posts, and alerts resolve from the active composition, not independent latest records.
- Switching language does not change the selected content revision.
- Alert polling/refetch preserves selected locale and cannot introduce English into Spanish output.
- Locale-specific public APIs are `private, no-store`; the validated cookie wins unless a requested locale is cryptographically bound, and a conflicting free parameter is rejected.
- A source edit marks the paired Spanish content stale and blocks the next site publication.
- Restoring history restores all domain pointers and both locales together.

**Implementation:** add localized domain adapters and composition-aware editor/public APIs; register localization capabilities and history filters.

**Verification:** domain integration suite, composition-digest assertions, alert refresh browser test, and editor navigation regression suite.

**Commit:** `feat(builder): publish localized site compositions`.

### Task 21: Localize contact, newsletter, confirmation, and email flows

**Client files:**

- `app/api/forms/[formKey]/route.ts`
- public form projection route and components
- `app/ui/NewsletterSignupSection.tsx`
- newsletter confirmation page/client
- `lib/newsletter/email/confirmation-email.tsx`
- `lib/newsletter/email/render.ts`
- newsletter ingestion and consent evidence adapters
- form/newsletter tests

**Red tests first:**

- Form projection and server validation use the visitor’s locale and the signed projection token.
- Contact and newsletter labels, consent, errors, pending message, confirmation page, and email body are complete in English and Spanish.
- The saved consent digest and email-template digest match exactly what was shown/sent.
- Spanish signup receives Spanish confirmation mail; English signup receives English mail.
- Idempotent replay does not create a duplicate subscriber, confirmation job, or email.
- Provider failure remains truthfully unavailable/pending and localized.

**Implementation:** thread locale and projection identity through validation, storage, queueing, confirmation-token, and rendering paths. Keep Resend as the existing approved provider.

**Verification:** focused form/newsletter tests with a fake provider, no outbound production sends, email HTML/text snapshots, and accessibility checks.

**Commit:** `feat(newsletter): deliver bilingual double opt-in`.

### Task 22: Register bilingual editor workflows and recovery

**Client files:**

- `app/admin/editor/page.tsx`
- `app/admin/editor/editor-client.tsx`
- authenticated builder API routes
- `builder.config.ts`
- `lib/builder/recovery/*`
- Vercel recovery route/cron configuration if already used
- editor and recovery integration tests

**Red tests first:**

- Authorized staff can draft Spanish, request review, approve, inspect readiness, preview both locales, publish, and restore.
- Unauthorized accounts cannot approve or activate.
- The Pages navigation regression remains fixed while bilingual panels are present.
- Recovery displays and reconciles complete composition evidence.
- Sign-out/session revocation continues to work.

**Implementation:** register the reusable workspaces, capability/permission mapping, client API adapters, and complete-composition recovery worker.

**Verification:** editor integration suite, auth matrix, navigation test, recovery replay test, and production-build smoke test.

**Commit:** `feat(editor): attach bilingual publishing workflows`.

## Phase 6 - Translation inventory and reviewed content backfill

### Task 23: Build the complete public-content inventory

**Files changed:** generated secret-free inventory and review artifacts only; no production writes.

**Actions:**

1. Run the read-only inventory over current pages, shared regions, posts, alerts, managed forms, newsletter email, media text, metadata, errors, and accessibility text.
2. Merge the current small translation map only as candidate Spanish copy; do not mark it approved automatically.
3. Classify every value as required translation, approved neutral exemption, or out of public scope.
4. Produce counts by domain and a review worksheet keyed by stable IDs and source digests.
5. Mark staff-selected active drafts for migration; archive abandoned drafts or mark them `legacy_unmigrated`, read-only, and non-publishable until converted.
6. Fail if the inventory contains unowned public text or unstable rich-text nodes.

**Client files:**

- `content/localization/inventory.json` (generated, no secrets)
- `content/localization/spanish-review.csv` or the repository’s review-friendly equivalent
- `content/localization/exemptions.json`
- inventory validation tests

**Verification:** deterministic rerun yields identical digests and counts.

**Commit:** `chore(i18n): inventory public translation scope`.

### Task 24: Review and import Spanish content

**Actions:**

1. Present every Spanish value and exemption for human review; generated suggestions, if any, remain visibly unapproved.
2. Record reviewer identity, review time, source digest, translation digest, and exemption digest in the private approval catalog/import artifact.
3. Rerun inventory after any English edit and invalidate affected approvals.
4. Require zero missing, draft, stale, or unapproved required values before backfill apply.

**Important gate:** implementation cannot complete production activation without user/staff approval of the Spanish content itself. Plan approval does not approve future translated wording.

**Verification:** private catalog validator and stripped public catalog build both pass; public artifact contains no approval evidence.

**Commit:** reviewed translation content commit after content approval.

### Task 25: Rehearse and apply additive backfill outside production

**Actions:**

1. Reset a local database and load a production-shaped, secret-free fixture.
2. Run backfill in dry-run mode twice and compare plans.
3. Apply once, rerun, and prove idempotent no-op behavior.
4. Build an inactive candidate composition for English and Spanish.
5. Verify public reads remain on the legacy English path while activation is off.
6. Preview the candidate in both locales and confirm identical composition digest.

**Verification:** zero readiness blockers, no duplicate revisions, no public behavior change before activation.

**Commit:** only fixture or test corrections; never commit production data.

## Phase 7 - Full local and protected review verification

### Task 26: Run complete local gates

**Platform verification:**

```powershell
npm run check
npm run test:db:site:reset
npm run check:release
npm run release:pack
npm run release:rehearse
git diff --check
```

**Client verification:**

```powershell
npm run verify:platform-migrations
npm run verify:production-migrations
npm run db:reset
npm run test:db
npm test
npm run lint
npm run build
git diff --check
```

**Additional required evidence:** package archive digests, no secret scan, no internal package identity scan, no local dependency scan, catalog privacy scan, first-byte locale HTML snapshots, form token tamper matrix, recovery replay, and clean statuses except the protected unrelated file.

**Commit:** only narrowly justified validation fixes.

### Task 27: Produce a protected Vercel review deployment

**Actions:**

1. Deploy the client branch to a protected preview with activation off.
2. Use preview-safe database resources and no production outbound sends.
3. Verify direct/deep routes, English and Spanish same-route switching, refreshes, alerts, posts, forms, newsletter fake-provider flow, editor preview, history, and 404 behavior.
4. Check settled desktop and mobile layouts, keyboard operation, focus, screen-reader names, overflow, console errors, network errors, and untranslated flash.
5. Confirm `html[lang]`, metadata, and email snapshots for both languages.
6. Alternate English and Spanish cookies through the production-like cache boundary and prove that no response leaks another visitor's locale.

**Gate:** obtain explicit desktop/mobile English/Spanish visual approval before production promotion.

**Commit:** only review fixes backed by a failing test.

## Phase 8 - Private package publication and client registry upgrade

### Task 28: Approve and publish the exact private package closure

**Precondition:** present the user with the proposed version, six-package closure, dependency graph, test evidence, archive digests, and rollback version. Wait for explicit approval.

**Actions after approval:**

1. Confirm registry authentication without printing the token.
2. Publish in dependency order from the clean platform release commit.
3. Verify each registry package resolves at the approved version and has the expected exports and digest.
4. Do not publish growth packages unless they were explicitly added and approved.

**Verification:** `npm view` for every approved package, clean platform tree, and registry smoke fixture.

**Commit:** package version/release metadata commit before publication; no secrets.

### Task 29: Replace rehearsal packages with exact registry versions

**Client files:**

- `package.json`
- `package-lock.json`

**Red test first:** dependency policy rejects local paths, ranges, mixed reusable package versions, and internal package names.

**Implementation:** install the approved exact versions from GitHub Packages, remove all rehearsal artifacts, and update the lockfile.

**Verification:** clean install, `npm ls`, full client test/lint/build/migration gates, no 401/404, and a fresh protected preview.

**Commit:** `chore(deps): use bilingual platform release`.

## Phase 9 - Production migration, backfill, and activation

### Task 30: Deploy the production-compatible inactive release

**Preconditions:** package gate and visual review gate approved; production migration/backfill plan reviewed.

**Actions:**

1. Confirm current production deployment, database migration head, backups/PITR posture, queue state, recovery state, and provider health without exposing secrets.
2. Apply the additive canonical migration.
3. Deploy the exact reviewed client commit with dual-read/dual-write enabled and bilingual activation off.
4. Verify existing English production behavior, editor login, forms, newsletter double opt-in, alerts, posts, history, and recovery.
5. Record the production deployment identity that will later be activated.
6. Record the migration epoch with the exact application and package versions, migration set, current published pointers, and catalog digest before production backfill begins.

**Rollback:** activation remains off; revert application reads to the legacy path while retaining additive schema and audit data.

### Task 31: Run production inventory and reviewed backfill

**Actions:**

1. Run read-only inventory and reconcile counts with the approved local/review inventory.
2. Freeze public publication briefly for the final locked inventory window.
3. Run backfill dry-run and compare exact creates/updates/no-ops with reviewed evidence.
4. Apply the idempotent backfill and rerun to prove no-op behavior.
5. Materialize the complete production candidate and preview both locales from the already deployed release.
6. Unfreeze if readiness is not perfect; do not activate partially.

**Verification:** zero blockers, exact catalog/composition digests, current dashboard review, no queue/recovery incident, and no synthetic records or outbound tests.

### Task 32: Activate the bilingual production epoch without a second deployment

**Precondition:** obtain explicit activation approval using the locked inventory, candidate digest, deployment identity, and rollback pointer.

**Actions:**

1. Verify the same inactive production deployment is still current.
2. Recheck migration head, package versions, catalog digest, candidate digest, idempotency state, and recovery readiness.
3. Set the database-backed activation flag and epoch once.
4. Verify older dual-read-compatible deployments can still read but can no longer publish after activation.
5. Verify English and Spanish from fresh unauthenticated sessions, direct routes, same-route switching, metadata, forms, newsletter, alerts, posts, 404, and editor preview/history.
6. Record activation audit evidence and the previous complete composition pointer.
7. Do not promote another deployment as part of activation.

**Rollback:** before the first bilingual publication, the recorded epoch may atomically restore the frozen legacy read pointers while retaining all bilingual drafts and audit evidence. After the first bilingual publication, legacy-pointer rollback is forbidden; repair by rolling forward through a newly reviewed complete bilingual composition. Never reconstruct per-domain latest state or discard bilingual history.

### Task 33: Observe the live release and close the rollout

**Actions:**

1. Monitor application errors, form projection rejects, newsletter confirmation queue, recovery jobs, publication conflicts, locale distribution, and missing-key events through the existing approved observability surfaces.
2. Verify no shared-cache locale leakage and no untranslated first paint from multiple regions/browsers.
3. Confirm the protected platform checkout and unrelated client walkthrough remain untouched.
4. Record final client commit, platform commit, package versions, migration checksum, production deployment, activation epoch, composition sequence/digest, live route matrix, and rollback pointer.

**Verification:** settled live desktop/mobile checks in English and Spanish, successful real owner-controlled newsletter test only if separately approved, zero unexplained recovery jobs, and no unresolved readiness blockers.

## Completion evidence

The rollout is complete only when all of the following are recorded:

- Approved design commit and approved implementation-plan commit.
- Clean platform source reconciliation to the former `0.2.6` artifacts.
- Platform and client implementation commits and clean working-tree evidence.
- Canonical migration filename, checksum, pgTAP result, and byte-identical client attachment.
- Exact published private package version and package closure with registry verification.
- Private approval-catalog digest and stripped public-catalog digest.
- Reviewed translation inventory counts with zero missing, draft, stale, or unapproved required values.
- Full platform and client test, lint, build, authorization, migration, recovery, and secret-scan results.
- Protected preview URL and approved desktop/mobile English/Spanish visual review.
- Production deployment identity, activation epoch, publication sequence, candidate/live composition digest equality, and rollback pointer.
- Live verification of every public route, posts, alerts, contact form, newsletter signup/confirmation/email, metadata, error states, media text, and editor preview/history in both languages.
- Confirmation that no synthetic production data or unapproved outbound provider work was used.
- Confirmation that the unrelated client walkthrough and dirty protected platform files were not changed.
