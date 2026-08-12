# Production-Quality Site Editor Implementation Plan

**Status:** Ready for user review

**Design source of truth:** `docs/superpowers/specs/2026-08-06-editor-production-quality-design.md` at commit `5e7ffed`

**Client repository:** `D:\Project Morales\Official Assembly Website V2`

**Shared platform checkout to preserve:** `D:\Project Morales\site-editor-platform`

## Outcome

Implement the approved production-quality editor design through test-driven, reviewable changes in an isolated shared-platform worktree, this client application, and additive site-local Supabase migrations. The release must eliminate the public stale-content flash, repair page-workspace navigation, add a performant draggable quick editor, make posts/media reliable, provide complete bounded website history, and teach authentic form/growth testing without synthetic production data.

The plan does not authorize private-package publication, external resource provisioning, Preview deployment, production migration, production content mutation, or production deployment. Each of those actions retains its explicit gate below.

## Non-negotiable implementation rules

- Follow red-green-refactor: add one focused failing regression, run it and observe the expected failure, implement the smallest contract, rerun the focused test, then run the relevant package/repository gate.
- Do not edit installed `node_modules`.
- Do not modify, stage, reset, stash, or clean the two unrelated files in the existing platform checkout.
- Do not stage `client-website-setup-operator-walkthrough.md` in the client repository.
- Generate migration timestamps with the Supabase CLI; never invent or rename one manually after creation.
- Keep optional platform migrations outside the deployable client migration lineage.
- Use local/isolated data for automated tests. Do not create production submissions, leads, customers, subscribers, posts, page versions, media, or form activity.
- Never print or commit GitHub, Supabase, Vercel, Blob, Resend, service-role, or HMAC secrets.
- Finish each task with `git diff --check`, targeted tests, and a narrow commit. Do not mix release/infrastructure actions into source commits.

## Worktree and branch map

- Client source/design branch: current `codex/private-media-post-linking` branch in `D:\Project Morales\Official Assembly Website V2`.
- Existing platform checkout: inspection only; currently `main`, behind `origin/main`, with unrelated tracked modifications.
- Fresh platform implementation worktree: create from the fetched `origin/main` at a new path such as `D:\Project Morales\site-editor-platform-editor-production-quality`, on `codex/editor-production-quality`.
- Disposable package-attachment rehearsal: create under an explicit temporary/rehearsal directory; do not rewrite the client manifest to permanent `file:` dependencies.

The source paths below reflect the inspected checkout. Task 1 must record any upstream rename before editing the fresh worktree.

## Phase 0 — Safety, reconciliation, and reproducible baselines

### Task 1: Create the clean platform worktree and freeze baselines

**Files changed:** none in either working tree.

**Actions:**

1. Record client branch/HEAD/status, Node/npm versions, lockfile digest, installed `@reuben-williams/*` tree, Next version, and Supabase CLI version.
2. Record the existing platform checkout status and HEAD without altering its two modified files.
3. Fetch `origin` in the platform repository and create the isolated `codex/editor-production-quality` worktree from the fetched `origin/main`.
4. Record the fresh platform commit and confirm the worktree is clean.
5. Re-run path discovery in the fresh worktree and update this plan only if upstream renamed a referenced source/test path.
6. Generate the internal dependency graph from every `packages/*/package.json`; save the machine-readable closure evidence outside source until the release task adds the reviewed artifact.
7. Inspect the current Vercel plan/runtime constraints needed for one-minute Cron and private Blob consistent reads. Record a blocker if the approved contract is unavailable; do not provision anything.

**Verification:**

```powershell
git -C "D:\Project Morales\Official Assembly Website V2" status --short --branch
git -C "D:\Project Morales\site-editor-platform" status --short --branch
git -C "D:\Project Morales\site-editor-platform-editor-production-quality" status --short --branch
npm ls @reuben-williams/core @reuben-williams/editor @reuben-williams/next
npm run verify:production-migrations
```

**Commit:** none.

### Task 2: Capture the current failures with focused client and package tests

**Client tests:**

- `tests/editor-page-navigation.test.tsx`
- `tests/editor-server-content.test.tsx` (new)
- `tests/posts-client.test.ts`
- `tests/editor-history.test.ts` (new)

**Platform tests in the fresh worktree:**

- `packages/editor/tests/responsive-navigation.test.tsx`
- `packages/editor/tests/editor-shell-workspace-sync.test.tsx`
- `packages/editor/tests/post-editor.test.tsx`
- `packages/editor/tests/attached-posts-workspace.test.tsx`
- `packages/editor/tests/history-workspace.test.tsx`
- `packages/next/tests/server-published-content.test.tsx` (new)

**Red cases:**

1. Start in Posts, click Resources under Pages, and prove the main workspace incorrectly remains Posts.
2. Render a public route and prove the initial HTML contains checked-in content instead of the published value.
3. Save a post successfully, fail the linkable-post refresh, and prove the client incorrectly rejects the full action.
4. Request History from Resources and prove events from other pages/posts are absent.
5. Click the post media control and prove no gallery callback reaches the host.

Run each test independently and retain the expected failure text as implementation evidence. Existing green tests must remain green.

**Verification:**

```powershell
npm test -- tests/editor-page-navigation.test.tsx tests/editor-server-content.test.tsx tests/posts-client.test.ts tests/editor-history.test.ts
npm --prefix "D:\Project Morales\site-editor-platform-editor-production-quality" test -- packages/editor/tests/responsive-navigation.test.tsx packages/editor/tests/editor-shell-workspace-sync.test.tsx packages/editor/tests/post-editor.test.tsx packages/editor/tests/attached-posts-workspace.test.tsx packages/editor/tests/history-workspace.test.tsx packages/next/tests/server-published-content.test.tsx
```

**Commit:** `test: reproduce production editor failures`

## Phase 1 — Transactional content and recovery data contracts

### Task 3: Add shared command, version, history, and recovery contracts

**Platform files:**

- `packages/core/src/content-publishing.ts` (new)
- `packages/core/src/history.ts` (new)
- `packages/core/src/media.ts`
- `packages/core/src/index.ts`
- `packages/core/tests/content-publishing.test.ts` (new)
- `packages/core/tests/history-event.test.ts` (new)
- `packages/core/tests/media.test.ts` (new if the fresh worktree lacks one)

**Red tests first:**

- Canonical command digest is stable and rejects unknown/unregistered region kinds.
- `SaveContentCommandV2`, `PublishContentCommandV2`, and `RestoreContentCommandV2` require command ID, idempotency key, expected draft/published IDs, and per-scope values.
- Composite page/global generation cannot be represented with a missing scope version.
- `HistoryEventV1` has globally stable provenance and an opaque bounded keyset cursor.
- Managed media values serialize only `(assetId, revisionId, alt)` and reject signed URLs.

**Implementation:**

Add backward-compatible exported contracts and pure validators. Keep framework/database code outside `core`. Preserve existing `PageContent`, `AuditEvent`, and adapter APIs until later tasks add compatibility shims.

**Verification:**

```powershell
npm test -- packages/core/tests/content-publishing.test.ts packages/core/tests/history-event.test.ts packages/core/tests/media.test.ts
npm run typecheck
```

**Commit:** `feat(core): add versioned publishing and history contracts`

### Task 4: Add the additive site database migration and pgTAP contract

**Platform files:**

- New CLI-generated `supabase/migrations/<timestamp>_editor_content_publishing_v2.sql`
- `supabase/tests/12_editor_content_publishing_v2.test.sql` (or next free platform test number)

**Client files:**

- New CLI-generated `supabase/migrations/<timestamp>_official_assembly_editor_content_publishing_v2.sql`
- `supabase/tests/35_official_assembly_editor_content_publishing_v2.test.sql` (or next free client test number)
- `scripts/verify-production-migration-lineage.mjs`
- `tests/production-migration-lineage.test.ts`
- `scripts/verify-platform-migration-checksums.mjs`
- `tests/platform-migration-checksums.test.ts`

**Red database cases:**

- Same key/same digest replays the original result; same key/different digest conflicts.
- Stale draft or published identifiers return the mapped `STALE_REVISION` error and write nothing.
- Composite global/page publish locks both scopes and creates one site generation atomically.
- Global/page/version/audit/outbox rows roll back together after injected failure.
- Restore creates a new immutable child and never rewinds an active pointer in place.
- Title-only first draft save derives server defaults; concurrent identical titles receive deterministic site-scoped slug suffixes.
- Post publish rejects a semantically empty body and invalid managed-image alt text through the same server contract as the UI.
- Site A cannot read/write Site B commands or history.
- Recovery job claims are leased/fenced; stale workers cannot advance a generation.
- Latest generation requires every configured route and referenced replica to be ready.
- Referenced media revision rows are immutable/delete-restricted.
- `HistoryEventV1` provenance is unique and keyset pagination is deterministic at equal timestamps.

**Implementation:**

Use additive tables/functions for command receipts, scope pointers/generations, normalized history projection, recovery jobs/replica state, and safe health reads. Reuse existing `builder_outbox` only where its schema provides the required fencing/idempotency; otherwise add a narrowly named recovery job table. Use explicit grants, restricted `search_path`, site-scoped RLS, and no service-role browser path.

Create the client migration through the supported attachment/provenance flow. Update the production-lineage allowlist only for the exact reviewed filename and keep optional migrations excluded.

**Verification:**

```powershell
npm --prefix "D:\Project Morales\site-editor-platform-editor-production-quality" run test:db:site:reset
npm run db:reset
npm run test:db
npm run verify:platform-migrations
npm run verify:production-migrations
npx supabase db lint --local
npx supabase db advisors --local --type all
```

**Commit (platform):** `feat(db): add transactional editor publishing v2`

**Commit (client):** `feat(db): attach editor publishing v2`

### Task 5: Implement the Supabase publishing repository and error mapping

**Platform files:**

- `packages/core/src/supabase/content-repository.ts`
- `packages/core/src/supabase/errors.ts`
- `packages/core/tests/supabase-content-repository.test.ts`

**Client files:**

- `lib/builder/repositories.ts`
- `app/api/builder/route.ts`
- `tests/builder-routes.test.ts`
- `tests/builder-auth.test.ts`

**Red tests first:**

- Save/publish/restore sends the exact command IDs/digest/expected identifiers.
- `STALE_REVISION`, authorization, validation, and post-commit outbox warnings map to distinct safe responses.
- A successful mutation plus failed refresh/invalidation never becomes a second mutation.
- Global/page composite results expose both versions and one generation.

**Implementation:**

Add V2 repository methods and keep V1 adapters as compatibility shims until the client is fully migrated. Route handlers validate the site registry and role, never accept a caller-supplied site ID, and return command IDs plus completed/warning stages.

**Verification:**

```powershell
npm --prefix "D:\Project Morales\site-editor-platform-editor-production-quality" test -- packages/core/tests/supabase-content-repository.test.ts
npm test -- tests/builder-routes.test.ts tests/builder-auth.test.ts
```

**Commit (platform):** `feat(core): execute transactional content commands`

**Commit (client):** `feat(builder): expose publishing v2 routes`

## Phase 2 — Server-rendered public content and durable recovery

### Task 6: Add a server-only Next.js content entry point

**Platform files:**

- `packages/next/src/content/server/contracts.ts` (new)
- `packages/next/src/content/server/load-published-content.ts` (new)
- `packages/next/src/content/server/index.ts` (new)
- `packages/next/package.json`
- `packages/next/tests/server-published-content.test.tsx` (new)
- `packages/next/tests/server-client-boundary.test.ts` (new)

**Red tests first:**

- Registered typed regions merge checked-in fallback only after an authoritative successful read.
- Database failure never becomes an empty page or a “never published” decision.
- Global and page scopes merge from one site generation.
- Draft values never enter public output.
- The server subpath cannot be imported through the client barrel/bundle.

**Implementation:**

Create a `@reuben-williams/next/server` export for server-only loaders/accessors. Keep `packages/next/src/index.tsx` client-safe. The loader consumes injected repositories, registered stable IDs, and an injected exact-scope recovery reader; application code owns environment secrets and Vercel Blob.

**Verification:**

```powershell
npm test -- packages/next/tests/server-published-content.test.tsx packages/next/tests/server-client-boundary.test.ts
npm run typecheck
```

**Commit:** `feat(next): add server published-content loader`

### Task 7: Replace the public DOM bridge with server content

**Client files:**

- `lib/builder/server-content.ts` (new)
- `app/builder-content-provider.tsx` (new if a serializable client context boundary is required)
- `app/builder-content-bridge.tsx`
- `app/layout.tsx`
- `app/page.tsx`
- `app/[slug]/page.tsx`
- `app/news/page.tsx`
- `app/news/[slug]/page.tsx`
- `app/not-found.tsx`
- `app/privacy/page.tsx`
- `app/ui/PageTemplate.tsx`
- Header/footer/public content components that currently depend on DOM markers
- `tests/editor-server-content.test.tsx`
- `tests/builder-content-path.test.tsx`
- `tests/builder-mapping.test.tsx`
- `tests/published-posts.test.tsx`

**Red tests first:**

- Direct route HTML contains current published global/page text, links, images, metadata, and 404 content.
- Hydration leaves the same values in place and issues no public builder-content fetch.
- An authoritative read proving no override uses the checked-in fallback.
- Database failure with no valid recovery result returns the explicit unavailable path/status.
- Authenticated preview can still load draft content without exposing it publicly.

**Implementation:**

Load global content in the root layout and page content in each route/PageTemplate through the server entry point. Use the shared typed accessor rather than querying the DOM. Remove `BuilderDomContentBridge` from public layout; retain only the authenticated preview bridge if required. Ensure request-time/no-store behavior using the reviewed Next 16 server mechanism and direct non-cached repository reads.

**Verification:**

```powershell
npm test -- tests/editor-server-content.test.tsx tests/builder-content-path.test.tsx tests/builder-mapping.test.tsx tests/published-posts.test.tsx
npm run build
```

Start the production build locally and inspect response HTML before JavaScript hydration.

**Commit:** `feat(site): render published content on the server`

### Task 8: Build the Blob recovery adapter, worker, runner, and media endpoint

**Client files:**

- `lib/builder/recovery/contracts.ts` (new)
- `lib/builder/recovery/blob-store.ts` (new)
- `lib/builder/recovery/repository.ts` (new)
- `lib/builder/recovery/worker.ts` (new)
- `lib/builder/recovery/media-grant.ts` (new)
- `lib/builder/recovery/safe-log.ts` (new)
- `app/api/builder/recovery/jobs/run/route.ts` (new)
- `app/api/builder/recovery/media/[generation]/[digest]/route.ts` (new)
- `scripts/bootstrap-builder-recovery.mjs` (new)
- `package.json`
- `vercel.json`
- `.env.example` names only, if present
- `tests/builder-recovery-store.test.ts` (new)
- `tests/builder-recovery-worker.test.ts` (new)
- `tests/builder-recovery-routes.test.ts` (new)
- `tests/builder-recovery-runner.test.ts` (new)
- `tests/editor-recovery-contract.test.ts`

**Red tests first:**

- Immutable snapshots/media/generation manifests cannot overwrite an existing path.
- Latest pointer uses uncached private reads plus `ifMatch`; racing lower generation is superseded.
- Mixed global/page generations, wrong site/environment/schema, bad digest, or incomplete routes are rejected.
- Existing configured routes and every referenced historical media revision fail health until bootstrapped.
- Worker lease/fence, retry, dead-letter, maximum-lag, and safe logging behavior are deterministic.
- Recovery HTML uses only HMAC-granted application URLs; endpoint rejects expired/wrong-generation/unreferenced/oversized/tampered media.
- Successful endpoint response matches recorded MIME, length, and digest without exposing private Blob details.
- Candidate-built bootstrap exits nonzero until complete and prints only safe evidence.

**Implementation:**

Pin one exact reviewed `@vercel/blob` version with `useCache: false` and `ifMatch` support. Keep Preview and Production token names/environment resolution separate. Share worker modules between Cron and the release runner. The runner is site/environment allowlisted and requires an explicit confirmation input; it never embeds credentials in arguments or logs.

Do not provision a Blob store in this task. Tests use a deterministic in-memory/fake object-store contract.

**Verification:**

```powershell
npm test -- tests/builder-recovery-store.test.ts tests/builder-recovery-worker.test.ts tests/builder-recovery-routes.test.ts tests/builder-recovery-runner.test.ts tests/editor-recovery-contract.test.ts
npm run lint
npm run build
```

**Commit:** `feat(builder): add published snapshot recovery runtime`

## Phase 3 — Editor navigation and interaction quality

### Task 9: Make page selection activate the Pages workspace everywhere

**Platform files:**

- `packages/editor/src/shell/ResponsiveNavigation.tsx`
- `packages/editor/src/EditorShell.tsx`
- `packages/editor/src/AttachedSiteEditor.tsx`
- `packages/editor/tests/responsive-navigation.test.tsx`
- `packages/editor/tests/editor-shell-workspace-sync.test.tsx`
- `packages/editor/tests/attached-site-editor.test.tsx`

**Client files:**

- `app/admin/editor/editor-path.ts`
- `app/admin/editor/editor-client.tsx`
- `app/admin/editor/page.tsx`
- `tests/editor-page-navigation.test.tsx`
- `tests/editor-server-path.test.tsx`

**Red tests first:**

- From every non-page workspace, selecting Resources calls one semantic page action, activates `website.pages`, expands Pages, updates preview/path, and makes Resources active.
- URL serialization preserves valid unrelated parameters and records workspace/path once.
- Back, Forward, reload, and bookmark restore both values without a duplicate push.
- Invalid paths/workspaces cannot construct an arbitrary iframe request.

**Implementation:**

Expose one shared page-selection callback that updates workspace plus path. Keep the application responsible for the allowlisted site registry and browser URL/history controller. Avoid two independent state transitions that can render an intermediate workspace.

**Verification:**

```powershell
npm --prefix "D:\Project Morales\site-editor-platform-editor-production-quality" test -- packages/editor/tests/responsive-navigation.test.tsx packages/editor/tests/editor-shell-workspace-sync.test.tsx packages/editor/tests/attached-site-editor.test.tsx
npm test -- tests/editor-page-navigation.test.tsx tests/editor-server-path.test.tsx
```

**Commit (platform):** `fix(editor): activate page workspace on page selection`

**Commit (client):** `fix(editor): synchronize workspace and page URL state`

### Task 10: Add the performant draggable quick editor

**Platform files:**

- `packages/editor/src/shell/use-draggable-panel.ts` (new)
- `packages/editor/src/EditorShell.tsx`
- `packages/editor/src/shell/editor-shell.module.css`
- `packages/editor/tests/draggable-panel.test.tsx` (new)
- `packages/editor/tests/editor-shell-regression.test.tsx`
- `packages/editor/tests/responsive-editing-surfaces.test.tsx`

**Red tests first:**

- Header drag uses pointer capture and rAF-batched transform updates.
- Fields/buttons/links/close/scroll areas do not start a drag.
- Pointer cancel/lost capture/unmount terminate cleanly.
- Position clamps/reclamps within desktop/mobile viewport and persists only in session storage.
- Image resize cursors and behavior remain unchanged.

**Implementation:**

Add a keyboard-accessible labelled handle and isolated hook. Apply transform while dragging, commit the bounded position at frame/end, and use `ResizeObserver` plus viewport events to reclamp.

**Verification:**

```powershell
npm test -- packages/editor/tests/draggable-panel.test.tsx packages/editor/tests/editor-shell-regression.test.tsx packages/editor/tests/responsive-editing-surfaces.test.tsx
```

**Commit:** `feat(editor): make quick edit panel draggable`

### Task 11: Normalize editor interaction cursors and disabled behavior

**Platform files:**

- `packages/editor/src/shell/editor-shell.module.css`
- `packages/editor/src/content/HistoryWorkspace.module.css`
- Other scoped editor CSS modules identified by the failing audit
- `packages/editor/tests/interaction-cursors.test.ts` (new)

**Client files:**

- `app/globals.css` only for client-owned interactive editor surfaces
- `tests/editor-workspaces.test.tsx`

**Red tests first:**

- Enabled button/link/summary/card contracts expose the pointer affordance.
- Disabled actions are non-interactive and use the disabled cursor.
- Drag/resize controls retain specialized cursors.
- Ordinary labels/text never receive pointer styling.

**Implementation:**

Use scoped semantic selectors/classes; do not add a global `button { cursor: pointer }` rule that masks disabled or specialized controls.

**Verification:**

```powershell
npm --prefix "D:\Project Morales\site-editor-platform-editor-production-quality" test -- packages/editor/tests/interaction-cursors.test.ts
npm test -- tests/editor-workspaces.test.tsx
```

**Commit (platform):** `fix(editor): clarify interactive cursor states`

## Phase 4 — Posts, managed media, and mutation truthfulness

### Task 12: Implement deterministic draft/publish validation

**Platform files:**

- `packages/editor/src/content/PostEditor.tsx`
- `packages/editor/src/content/PostPublishingPanel.tsx`
- `packages/editor/tests/post-editor.test.tsx`
- `packages/editor/tests/posts-workspace.test.tsx`

**Client files:**

- `lib/builder/posts.ts`
- `app/api/builder/posts/[[...segments]]/route.ts`
- `tests/posts-client.test.ts`
- `tests/builder-routes.test.ts`

**Red tests first:**

- Draft requires only title; server creates deterministic slug/author/date defaults.
- Concurrent identical titles receive site-scoped numeric suffixes.
- Publish requires non-empty rich text and rejects filename-only/whitespace alt text.
- Direct API and UI enforce identical stage rules.
- First invalid field receives focus and all entered values survive a failure.

**Implementation:**

Add accessible Required/Optional indicators and field-level error descriptions. Keep collision resolution in the database/server transaction. Use authenticated actor/profile and reviewed site config fallback; store UTC plus office timezone semantics.

**Verification:**

```powershell
npm --prefix "D:\Project Morales\site-editor-platform-editor-production-quality" test -- packages/editor/tests/post-editor.test.tsx packages/editor/tests/posts-workspace.test.tsx
npm test -- tests/posts-client.test.ts tests/builder-routes.test.ts
npm run test:db
```

**Commit (platform):** `feat(editor): clarify post field requirements`

**Commit (client):** `fix(posts): enforce stage-specific post validation`

### Task 13: Wire the managed media picker and immutable references

**Platform files:**

- `packages/editor/src/content/AttachedPostsWorkspace.tsx`
- `packages/editor/src/content/PostEditor.tsx`
- `packages/editor/src/content/MediaGallery.tsx`
- `packages/editor/src/content/content-types.ts`
- `packages/editor/tests/attached-posts-workspace.test.tsx`
- `packages/editor/tests/media-gallery.test.tsx`

**Client files:**

- `app/admin/editor/editor-client.tsx`
- `lib/builder/repositories.ts`
- `lib/builder/media-client.ts`
- `app/api/builder/media/[[...segments]]/route.ts`
- `tests/media-client.test.ts`
- `tests/media-upload.test.ts`

**Red tests first:**

- Choose-from-gallery opens the same managed gallery and returns asset/revision IDs.
- Selected preview/label/alt/replace/remove state is visible and accessible.
- Signed URLs are preview-only and never persisted in a page/post version.
- Publish rejects a revision that is not replica-ready.
- Referenced current/historical objects cannot be deleted through application/RLS paths.

**Implementation:**

Pass the gallery callback through `AttachedPostsWorkspace`, extend the media projection with immutable revision identity, and connect upload completion to the recovery-replica outbox/health state. Preserve all currently loaded gallery assets.

**Verification:**

```powershell
npm --prefix "D:\Project Morales\site-editor-platform-editor-production-quality" test -- packages/editor/tests/attached-posts-workspace.test.tsx packages/editor/tests/media-gallery.test.tsx
npm test -- tests/media-client.test.ts tests/media-upload.test.ts
npm run test:db
```

**Commit (platform):** `feat(editor): connect posts to managed media`

**Commit (client):** `feat(media): persist immutable post media revisions`

### Task 14: Separate primary post success from secondary refresh failure

**Platform files:**

- `packages/editor/src/content/AttachedPostsWorkspace.tsx`
- `packages/editor/src/content/use-posts.ts`
- `packages/editor/tests/attached-posts-workspace.test.tsx`

**Client files:**

- `lib/builder/posts-client.ts`
- `tests/posts-client.test.ts`

**Red tests first:**

- Successful create/save/publish remains successful when linkable refresh fails.
- Warning names only the refresh stage and exposes retry-refresh.
- Retry-refresh cannot repeat the post command or duplicate the existing draft.
- Authorization errors remain distinguishable from validation/conflict/provider errors.

**Implementation:**

Return a primary mutation result before starting/awaiting the secondary list refresh. Model refresh warning separately and preserve command identity.

**Verification:**

```powershell
npm --prefix "D:\Project Morales\site-editor-platform-editor-production-quality" test -- packages/editor/tests/attached-posts-workspace.test.tsx
npm test -- tests/posts-client.test.ts
```

**Commit (platform):** `fix(editor): preserve successful post mutations`

**Commit (client):** `fix(posts): decouple linkable post refresh`

## Phase 5 — Complete website History

### Task 15: Build the unified bounded History API

**Platform files:**

- `packages/core/src/history.ts`
- `packages/editor/src/api/builder-api.ts`
- `packages/editor/src/AttachedSiteEditor.tsx`
- `packages/editor/tests/builder-api.test.ts`
- `packages/editor/tests/attached-site-editor.test.tsx`

**Client files:**

- `lib/builder/history.ts` (new)
- `lib/builder/repositories.ts`
- `app/api/builder/route.ts`
- `tests/editor-history.test.ts`
- `tests/builder-routes.test.ts`

**Red tests first:**

- One site-level request returns page/media/post/form/publish/restore events across paths.
- `(siteId, source, sourceEventId)` deduplicates legacy/current projections.
- Equal timestamps and concurrent inserts remain stable across keyset pages.
- Filters/search/group values are server-validated and bounded.
- One failing source returns explicit partial-source metadata without fake emptiness.
- Sensitive submission/lead/customer contents never enter the response.

**Implementation:**

Add a `history` resource/API distinct from the legacy page-scoped `audit` request. Project compatible legacy rows without rewriting them. Recompute restore permission from current role/version state.

**Verification:**

```powershell
npm --prefix "D:\Project Morales\site-editor-platform-editor-production-quality" test -- packages/editor/tests/builder-api.test.ts packages/editor/tests/attached-site-editor.test.tsx
npm test -- tests/editor-history.test.ts tests/builder-routes.test.ts
npm run test:db
```

**Commit (platform):** `feat(editor): consume unified site history`

**Commit (client):** `feat(history): expose bounded site change history`

### Task 16: Redesign History filters, summaries, and restore actions

**Platform files:**

- `packages/editor/src/content/HistoryWorkspace.tsx`
- `packages/editor/src/content/HistoryWorkspace.module.css`
- `packages/editor/tests/history-workspace.test.tsx`
- `packages/editor/tests/post-history.test.tsx`

**Red tests first:**

- Category filters cover text, media, links, sections, posts, forms, publishing/restores.
- Search/group/page/editor/date/action/item combinations remain bounded and keyboard accessible.
- Publish rows show page/version/change count/editor/time rather than missing values.
- Post lifecycle labels are distinct.
- Restore creates/uses the current capability and never trusts historical permission.
- Legacy incomplete events are labelled limited rather than filled with invented values.

**Implementation:**

Render paginated results and explicit partial-source errors. Preserve mobile layout, focus, and existing restore confirmation semantics.

**Verification:**

```powershell
npm test -- packages/editor/tests/history-workspace.test.tsx packages/editor/tests/post-history.test.tsx
```

**Commit:** `feat(editor): add complete website history navigation`

## Phase 6 — Forms and authentic live-data guidance

### Task 17: Add operational form cards and truthful growth empty states

**Platform files only if a package-owned primitive is required by a failing test:**

- `packages/editor/src/forms/FormsWorkspace.tsx`
- `packages/editor/tests/forms-workspace.test.tsx`

**Client files:**

- `app/admin/editor/editor-client.tsx`
- `app/admin/editor/live-growth-workspaces.tsx`
- `app/admin/editor/forms-guidance-workspace.tsx` (new if client-owned composition is cleaner)
- `tests/forms-attachment.test.ts`
- `tests/editor-workspaces.test.tsx`
- `tests/growth-entitlement.test.ts`

**Red tests first:**

- Contact and Newsletter cards show availability, route, collected data, consent path, destinations, and manage/open actions.
- Contact explains Submission -> identity/customer -> eligible Lead -> Overview.
- Newsletter explains pending -> confirmation -> active subscriber and never claims it creates a lead.
- Empty live workspaces say no live records and link to the controlled checklist.
- Checklist cannot autofill, autosubmit, seed, or call an outbound provider.
- Provider-disabled features remain unavailable.

**Implementation:**

Prefer client-owned workspace composition so forms/growth packages remain behaviorally unchanged. Add a shared package change only after a package-level red test proves ownership.

**Verification:**

```powershell
npm test -- tests/forms-attachment.test.ts tests/editor-workspaces.test.tsx tests/growth-entitlement.test.ts
```

If the platform package changes:

```powershell
npm --prefix "D:\Project Morales\site-editor-platform-editor-production-quality" test -- packages/editor/tests/forms-workspace.test.tsx
```

**Commit:** `feat(editor): guide authentic forms and growth testing`

## Phase 7 — Full verification and package release rehearsal

### Task 18: Run complete local and isolated verification

**Source changes:** only fixes driven by a newly failing test; add the regression before the fix.

**Platform gates:**

```powershell
npm run typecheck
npm test
npm run test:db:site:reset
npm run check:release
npm run release:pack
npm run release:rehearse
```

Run browser suites scoped to the changed editor surfaces before the full browser gate. Inspect console, failed network requests, keyboard/focus behavior, desktop/mobile overflow, iframe sizing, panel drag performance, media loading, and History pagination.

**Client gates:**

```powershell
npm run verify:platform-migrations
npm run verify:production-migrations
npm run db:reset
npm run test:db
npm test
npm run lint
npm run build
npm run test:e2e
```

Use `next start` for direct-route HTML/status probes. Confirm current published values are in response HTML before hydration and that no public DOM-content fetch occurs.

**Commit:** `test: complete editor production-quality acceptance`

### Task 19: Freeze the package dependency closure and rehearse client attachment

**Platform files:**

- Exact package manifests changed by feature work
- Metadata-only manifests required by internal exact dependencies/peers
- Release catalog/lock artifacts produced by the existing release pipeline
- Package release pipeline tests

**Actions:**

1. Generate the closure from the final reviewed manifests.
2. List every behavior-changing and metadata-only package with reason/source commit.
3. Prove one `core`, one `editor`, and one `next` runtime with no peer/nested duplicate errors.
4. Pack, but do not publish, immutable artifacts.
5. Attach those artifacts in a disposable client rehearsal and run the client gates.
6. Scan tarballs and bundle output for secrets, local paths, source-only files, or unintended packages.

**Gate:** stop and present the exact closure, versions, artifacts, test evidence, and registry commands to the user. Obtain explicit package-publication approval before `npm run release:publish`.

**Commit:** `chore(release): prepare editor quality package closure`

### Task 20: Publish the approved closure and pin the client

**Precondition:** explicit package-publication approval naming the closure/versions.

**Platform action:** publish only the approved immutable artifacts through the existing release pipeline; verify published digests and attachment rehearsal.

**Client files:**

- `package.json`
- `package-lock.json`
- Any source compatibility changes required by the exact published API, each covered by an existing red test

**Verification:**

```powershell
npm ci
npm ls @reuben-williams/core @reuben-williams/editor @reuben-williams/next
npm test
npm run lint
npm run build
```

There must be no 401/404, peer error, or nested duplicate runtime.

**Commit (platform):** `chore(release): publish approved editor quality closure`

**Commit (client):** `chore(deps): pin editor quality package release`

## Phase 8 — Isolated Preview and production handoff

### Task 21: Request and provision isolated Preview infrastructure

**Gate:** present the proposed non-production Supabase project/site, storage bucket, private Blob store, region, access mode, token/environment names, Cron plan requirement, and expected cost. Obtain explicit Preview provisioning/deployment approval.

After approval:

1. Provision/link only the Preview resources.
2. Ensure Preview cannot receive/address Production Supabase, Blob, Resend, or other provider resources.
3. Apply only the reviewed migration set to Preview after a dry run.
4. Deploy the exact verified commit/lockfile.
5. Run the candidate bootstrap against Preview and require a healthy complete generation.
6. Use controlled isolated acceptance records and remove them afterward; never touch production data.

**Preview acceptance:**

- server HTML and no stale flash on every direct route;
- draft/publish/restore plus global/page generation and recovery health;
- database outage fallback/503 and recovery image delivery;
- page selection from every workspace, refresh, Back/Forward;
- draggable panel/cursors at desktop and mobile widths;
- post validation, managed media, secondary warning, existing-draft preservation in the isolated data plane;
- complete History filters/pagination/restore;
- Forms guidance and truthful empty growth states;
- accessibility, keyboard focus, console, network, overflow, and image checks;
- cleanup and environment-isolation evidence.

**Production action:** none.

### Task 22: Prepare the production release packet and stop

Produce one review packet containing:

- application commit and Vercel Preview deployment;
- shared platform commit, exact published package closure, digests, and `npm ls` evidence;
- exact production migration filenames/checksums and linked dry-run output;
- previous-app/new-schema/new-app compatibility and rollback evidence;
- Supabase backup/PITR status and isolated restore result;
- proposed Production private Blob store name, region, access mode, product/SLA status, cost, token/env names, Cron schedule, bootstrap scope/counts, and operator command;
- read-only production smoke checklist;
- explicit statement that the existing production draft and all production content remain untouched.

**Gate:** obtain explicit production migration, Blob provisioning/bootstrap, and application promotion approval. Approval must identify the exact packet revision.

### Task 23: Execute only an explicitly approved production release

This task is intentionally not pre-authorized.

If approved later, follow the design sequence exactly:

1. Reconfirm the linked project, migration head/checksums, backup/recovery point, prior deployment, package tree, and rollback baseline.
2. Provision/connect the approved Production private Blob store.
3. Apply only the reviewed backward-compatible migration.
4. Run the exact candidate-built bootstrap command; stop unless complete route/history-media coverage and health pass.
5. Promote the exact verified application build.
6. Perform read-only smoke checks only—no Save, Publish, Restore, Upload, Archive, or form submission.
7. Record final deployment/schema/package/recovery/backup/rollback evidence.

Any later production content mutation is a separate staff-owned action naming the target, command, and expected version.

## Definition of done

- All approved design acceptance criteria are covered by automated tests and isolated browser evidence.
- Public initial HTML contains current published content with no client replacement flash.
- Publishing/restoring is transactional, concurrency-safe, idempotent, versioned, attributable, and recoverable.
- Complete route generations and every referenced historical media byte have verified recovery coverage.
- Page selection, drag behavior, cursor affordances, posts/media, History, and Forms/growth guidance behave as specified.
- No production synthetic/placeholder record exists.
- No secret, private Blob URL, sensitive constituent content, or unrelated user file enters source/artifacts/logs.
- Package closure and migrations are exact and verified.
- Preview passes in an isolated data plane.
- Production remains unchanged until the separately approved release packet is executed.
