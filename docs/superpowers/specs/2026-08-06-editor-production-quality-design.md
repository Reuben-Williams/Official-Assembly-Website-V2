# Production-Quality Site Editor Design

**Status:** Approved design, pending independent specification review

**Approved by:** User on 2026-08-06

**Production website:** `https://www.assemblywomanmorales.com/`

**Client repository:** `D:\Project Morales\Official Assembly Website V2`

**Shared platform repository:** `D:\Project Morales\site-editor-platform`

## Purpose

Make the private Site Editor behave like a dependable production content system rather than a client-side overlay. Published content must be present in the first server response, page navigation must always restore the page editor as the active workspace, post and media actions must be understandable and reliable, website history must be complete and useful, and staff must be able to learn the forms and growth workspaces using authentic live activity only.

This design coordinates changes across the client application, the shared private editor packages, and the existing Supabase persistence layer. It does not enable SMS, AI, survey, or any external provider that is not separately configured and approved.

## User-visible success criteria

- Refreshing a public page renders the current published content in the initial HTML. The checked-in fallback cannot flash before the published version appears.
- Publishing a page creates an immutable, attributable version and updates the public route without requiring a source commit or Vercel deployment for each content change.
- Selecting any entry inside the Pages accordion switches the main workspace back to the page editor, updates the preview and active-page state, and keeps the URL and Back/Forward behavior synchronized.
- The image quick-edit panel can be dragged smoothly, remains within the viewport, and no longer obscures important editor controls.
- Enabled interactive controls consistently show an appropriate pointer, drag, or resize cursor; disabled controls remain visibly and behaviorally disabled.
- Post fields clearly identify required and optional values. A draft can be saved with only a title; publishing enforces the complete publishing contract.
- The post media picker opens the same private gallery shown in Media, returns a managed media revision, and shows the selected image and alt-text state.
- A successful post mutation remains successful even if a secondary linkable-post refresh fails.
- History represents all supported website changes across pages rather than only the currently selected page, with useful type, page, editor, date, action, and item filters.
- Forms and growth workspaces explain how authentic records enter the system and guide staff through a deliberate live test without generating, seeding, or automatically submitting synthetic data.
- Submissions, leads, customers, and dashboard metrics remain real production records only.

## Existing-system findings

The design is based on repository and production-read observations made before approval:

- The public layout first renders checked-in content and mounts `BuilderDomContentBridge`, which fetches published content in a client effect and mutates the DOM. This causes the visible old-content flash.
- The client editor page callback updates `currentPath`, but a child page selection in the installed shared navigation does not also activate the Pages workspace. A non-page workspace can therefore remain over the newly selected page.
- The current page-navigation regression test begins inside `website.pages`, so it does not cover the reported Posts-to-Resources transition.
- The floating region editor is fixed to a computed anchor position and has no drag behavior.
- The post editor exposes a media button, but the attached posts workspace does not supply its media callback.
- Existing server validation requires fields that the post UI describes as optional for drafts.
- The existing production draft was created successfully during the reported failed attempt. The client then treated a failed secondary linkable-post refresh as if the primary save had failed.
- Page audit rows contain before/after data, while the current History request is scoped to the selected path and does not merge post events into a complete site history.
- Contact and newsletter forms already use real production ingestion paths. Empty growth workspaces are truthful, but they do not teach staff how to create and trace an authentic test interaction.

These findings localize the work. They are not permission to edit installed `node_modules`, delete the existing draft, create test constituents, or mutate production during implementation.

## Considered approaches

### 1. Client-side masking and local UI patches

Hide the public page until the existing content bridge finishes, force the workspace to Pages in the client app, and patch post and history behavior only in this repository.

This is the smallest apparent change, but it would replace the stale flash with a blank/loading flash, leave content absent from initial HTML, duplicate shared editor behavior in one client, and preserve ambiguous data contracts. Rejected.

### 2. Source commits and Vercel deployments for every publish

Convert each editor publish into generated source changes, a Git commit, and a new Vercel deployment.

This would make Git an additional backup, but publishing would become slow and failure-prone, would require broad repository/deployment credentials inside the content system, and would conflate application releases with ordinary staff content edits. Rejected.

### 3. Server-rendered Supabase publishing with a focused shared-package release

Load published content on the server for public routes, retain immutable versions and audits in Supabase, fix reusable editor interactions in the shared package, and keep client-specific orchestration in this application. Invalidate the affected route after publish without deploying application code.

This directly fixes initial rendering, preserves a fast editorial workflow, and keeps reusable behavior in its proper package boundary. Chosen.

## Architecture

### 1. Published-content rendering, versioning, and recovery

One server-only loader reads the global and normalized page snapshots and produces a validated typed region map. Root layout, Header, Footer, public route components, `generateMetadata`, the editable 404, and authenticated preview all use one server-compatible region accessor. The loader accepts only registered stable region IDs whose stored kind matches the site registry. The public DOM-mutation bridge is removed; a browser bridge may remain only inside the authenticated draft preview where its access and lifecycle are explicit.

Public content reads are dynamic and `no-store`. The initial server response therefore contains the current published snapshot, and route invalidation is an optimization rather than the freshness authority. Checked-in values are merged per region only after a successful authoritative read proves that the region has no published override. A database error can never be interpreted as "never published," so checked-in content cannot silently replace current production content during an outage.

The named last-known-good recovery source is a private, production-only Vercel Blob store called the **Published Snapshot Recovery Store**. Each successful publish transaction creates one monotonic `siteGenerationId` that binds the exact global version and active page version for every configured route, then appends a durable database outbox command for that generation. Readers select one immutable generation through one latest-pointer object and never assemble independently advanced global and page manifests.

A protected Vercel Cron route runs the recovery worker at least once per minute; the publish path may also trigger the same idempotent worker after commit as a latency optimization. The worker claims a database lease with a fencing token, retries with bounded exponential backoff, and dead-letters with an operational alert after the reviewed attempt limit. Recovery lag over five minutes marks the site `recovery_degraded` in the editor and fails the recovery-health probe until the generation is complete.

The pre-promotion bootstrap has a reviewed server-only release runner built from the exact verified application candidate and importing the same recovery-worker modules as the Cron route. After the approved migration and Blob provisioning, an authorized operator invokes the documented package script with production credentials supplied through the release environment outside source control. The runner is site/environment allowlisted, emits no secrets or private object URLs, and exits nonzero until route snapshots, the immutable generation manifest, latest pointer, historical media replicas, lease/fence state, and recovery-health checks pass. Its exact command, candidate commit, safe input identifiers, generation, object counts/digests, and result are retained as release evidence. Promotion cannot precede a successful run.

For one committed generation, the worker writes or verifies every route's full effective snapshot and every referenced media replica, then writes one immutable generation-manifest object. Snapshot, media, and generation-manifest objects use fresh deterministic paths containing schema, site, generation/revision, and content digest; they are immutable and cannot be overwritten. Only after all of those objects validate does the worker advance the site's small latest-pointer object with `allowOverwrite: true` and `ifMatch` against the ETag obtained by an uncached private read. A precondition failure causes another uncached read: a lower generation is marked superseded, while an unresolved conflict is retried under a new fence. The first latest pointer is created only by the fenced bootstrap/single-writer path.

The immutable generation manifest binds schema version, environment, site, generation, originating `commandId`, global version, every route/page version, every snapshot digest, and the required media-replica digests. The latest pointer binds that generation-manifest path and digest. Latest-pointer reads use private `get(..., { access: "private", useCache: false })` through one exactly pinned and tested `@vercel/blob` version that supports consistent uncached reads and conditional writes. Immutable generation, snapshot, and media objects may use ordinary private reads only after their paths/digests are selected through the validated pointer/manifest chain.

The snapshot contains typed public values and immutable managed-media references/object keys, never draft data, signed URLs, credentials, or sensitive constituent information. An idempotent, explicit-approval-gated bootstrap/reconciliation exports every currently published configured route and referenced historical media revision before recovery readiness can pass. Its health probe proves full configured-route coverage, exact generation consistency, complete media-replica coverage, manifest/object integrity, worker lease/fence health, maximum lag, retry/dead-letter state, and environment isolation.

On an authoritative-read failure, the loader may serve only a schema-valid, integrity-valid recovery artifact selected through the uncached latest pointer and its immutable generation manifest for the exact environment, site, and registered route. It records safe recovery telemetry and identifies the immutable generation/version being served. If no valid complete artifact exists, the route returns a truthful `503`; it does not infer missing overrides or show checked-in content as current. Production cannot launch this contract until the Blob store, environment isolation, bootstrap, Cron worker, integrity validation, failure alerts, and outage tests are configured. Preview uses a separate Blob store/token and can never read the production manifest.

Recovery HTML renders replicated media through a server-only recovery-media endpoint. The loader issues a short-lived opaque grant bound by an application HMAC to environment, site, immutable generation, route, replica digest, and expiry; it never signs or exposes a Blob URL. The endpoint validates the grant, loads that immutable generation manifest, accepts only a replica referenced by that exact route snapshot, fetches the private Blob with server credentials, verifies the bounded object's recorded MIME type, byte length, and content digest before responding, and streams it with `nosniff` plus a private bounded cache policy. It rejects an expired or malformed grant and any unknown, wrong-environment, wrong-generation, wrong-route, tampered, oversized, or unreferenced replica. Grant values are redacted from application logs. Blob credentials, storage keys, signed URLs, and raw private Blob URLs are never exposed to the browser.

Every save, publish, and restore command carries a generated `commandId`, an `idempotencyKey`, a canonical payload digest, `expectedDraftVersionId`, and nullable `expectedPublishedVersionId`. For a composite command, those expected identifiers are supplied per scope. One database transaction locks the affected site/scope pointers, compares both expected identifiers, inserts the immutable result with `parentVersionId` and any `sourceVersionId`, advances the active pointer, writes the normalized audit event, and appends any recovery/invalidation outbox commands.

Replaying the same idempotency key and identical digest returns the original result. Reusing a key with a different digest conflicts. A stale draft or published identifier returns `409 STALE_REVISION` without writing. The editor preserves local input and offers compare/reload rather than overwriting a newer publish.

Global content is a distinct publish scope. If a page publish includes pending global changes, the UI identifies the page and global scopes and submits one composite command with both sets of expected identifiers; the database commit is atomic across those scopes. A global pointer change invalidates every configured public route and metadata surface. A page-only change invalidates only that normalized route and its affected metadata. Restore follows the same scoped command, conflict, and audit rules and never silently overwrites or discards the current draft.

If the transaction fails, no partial published state is visible. If a post-commit recovery export or route invalidation fails, the publish remains successful and the editor shows a stage-specific warning plus a retry that replays only the failed outbox command; it must not repeat the content mutation. A fresh direct request still performs the authoritative `no-store` read.

Page and post versions are retained indefinitely by default. A separate owner-only retention operation may be designed later, with explicit review and audit; ordinary editors cannot prune history.

Before any production migration or application promotion, release verification records actual Supabase backup/PITR coverage, captures a pre-change recovery point, and tests the restore procedure in isolation. If the current plan does not provide the required recovery objective, production readiness remains incomplete until an approved independent encrypted export and isolated restore procedure are working. The Published Snapshot Recovery Store improves read availability; it does not replace database backup/PITR for drafts, audits, authorization, or historical versions.

### 2. Page selection and main-workspace ownership

Page selection is a shared shell action, not only a path change. Selecting any configured page from any current workspace performs one atomic navigation transition:

1. Validate the requested page against the configured page registry.
2. Activate `website.pages` as the main workspace.
3. Keep the Pages accordion expanded.
4. Update the selected path and reset selections that belong to the previous preview.
5. Remount or navigate the iframe to the selected editable route.
6. Update `workspace` and `path` in the editor URL while preserving unrelated valid parameters.
7. Push one browser-history entry when the effective workspace/path pair changes.

Back, Forward, reload, and a bookmarked editor URL restore both the workspace and page. Invalid workspace/path combinations resolve to a safe configured page without constructing an arbitrary iframe or builder request. Re-selecting the active page does not add duplicate browser history.

The shared `@reuben-williams/editor` navigation owns the semantic page-selection callback. This application owns validation against its site config, URL serialization, and the controlled current workspace/path. The regression test must begin in Posts (and parameterize other non-page workspaces) before selecting a page, because a Pages-to-Pages test cannot prove the reported behavior.

### 3. Draggable quick editor and interaction affordances

The floating quick-edit panel gains a dedicated drag handle in its header. Dragging uses Pointer Events, pointer capture, and `requestAnimationFrame`-batched transforms to avoid render work on every pointer move. The panel:

- starts at the existing context-aware position;
- is clamped to the editor viewport with a small safe margin;
- remains usable at desktop and mobile editor widths;
- reclamps after viewport or panel-size changes;
- remembers its last position for the current authenticated editor session;
- stops dragging on pointer up, pointer cancel, lost capture, or component unmount; and
- never starts a drag from form fields, buttons, links, scrollable content, or the close control.

Keyboard users keep a predictable non-drag interaction path. The handle has an accessible name and the panel retains sensible focus order. Drag state must not select underlying preview text or interfere with image resizing.

A scoped editor interaction contract applies `cursor: pointer` to enabled buttons, links, clickable cards, accordion summaries, and equivalent controls. Disabled actions use `not-allowed` or the established disabled cursor. Drag handles use `grab`/`grabbing`; resize controls keep their directional resize cursors. The change is limited to interactive editor surfaces and does not make ordinary text appear clickable.

### 4. Post editing and managed media

Post fields display a visible `Required` or `Optional` indicator next to the label and use matching accessible descriptions. Validation is stage-specific.

Saving a draft requires:

- title.

On first draft save, the server canonicalizes the title to a slug and resolves collisions transactionally under the site-scoped unique constraint using deterministic numeric suffixes (`slug`, `slug-2`, `slug-3`). It captures the authenticated actor ID, uses that profile's approved display name, and uses the reviewed site-config office name only when the profile has no approved display name. It records the server timestamp in UTC while retaining `America/New_York` as the office display timezone. Staff can override the editable slug, author display value, and display date subject to the same server validation. Other fields remain optional for a draft.

Publishing requires:

- title;
- valid unique slug;
- a semantically non-empty rich-text body;
- author;
- display date; and
- non-whitespace reviewed alt text when a featured image is selected; filename-only alt text is invalid.

Validation identifies the exact field and reason, moves focus to the first invalid field, preserves every entered value, and does not turn a provider or permission failure into a validation error.

The media button opens a shared picker backed by the same private managed gallery as the Media workspace. A selection returns both the stable media asset ID and immutable revision ID, plus the display metadata required by the post. The post editor renders a preview, selected filename/label, alt-text state, replace action, and remove action. Page/post versions persist managed media only as `(assetId, revisionId)` and never store an expiring signed preview URL.

The server resolves delivery information from the immutable revision at render time. Revision rows and underlying Supabase Storage objects are delete-restricted while referenced by any active or historical page/post version; archiving only removes an asset from normal selection. A restore validates every referenced revision and object inside the transaction and fails without advancing an active pointer if any required object is unavailable.

Because Supabase database backups/PITR cover Storage metadata but not object bytes, every referenced managed-media revision also has an independently verified immutable byte replica in the Published Snapshot Recovery Store, keyed by revision and content digest. The replica records and verifies byte length, MIME type, and digest. A media revision is not `backup_ready`, a publish cannot reference it, and a latest pointer cannot advance to a generation until every referenced replica is verified. Production bootstrap covers every current and historical referenced revision, not only new uploads.

Application and RLS deletion paths deny deletion of referenced objects. The operator runbook separately restricts and audits Dashboard, service-role, and S3-compatible deletion paths that bypass application checks. The recovery drill restores database metadata and media bytes together and proves that an old page/post version resolves the same verified object digest.

Primary mutations and secondary refreshes have separate outcomes. After create, update, save-draft, publish, archive, or restore succeeds, a failure while refreshing linkable posts produces a non-blocking warning and retry control. The UI must not report that the post action was unauthorized or failed, and retries must not create a duplicate post. The existing production draft is preserved and used for regression verification only with explicit staff interaction.

### 5. Complete website history

History becomes a site-level read model over all supported website content events. It merges normalized events from page versions/audits, managed-media changes, post lifecycle events, form-definition changes, publishes, and restores. It does not place submission bodies, constituent contact details, lead notes, or customer records in website history.

The normalized contract is `HistoryEventV1`. Every event contains:

- source, source event ID, globally stable event ID, and site ID;
- category and action;
- page/path or owning workspace;
- stable target/item/region IDs and human-readable label;
- actor ID plus the captured display label suitable for staff display;
- server timestamp;
- parent, source, and resulting immutable version/revision IDs where applicable;
- structured before/after summary; and
- redaction/provenance metadata.

`(siteId, source, sourceEventId)` is unique. Queries use descending keyset pagination with a bounded server-controlled limit and an opaque cursor over `(createdAt, source, sourceEventId)`, so equal timestamps and new writes cannot reorder or duplicate previously returned rows. Search, filters, and grouping execute server-side. A partial source failure is returned as explicit per-source metadata while available sources remain visible. Restore capability is recomputed from the signed-in role and current-version state; it is never trusted from a historical payload.

The supported category filters are:

- Text and rich text;
- Images and media;
- Links;
- Sections and layout;
- Posts;
- Forms; and
- Publishing and restores.

Staff can also search and group by page, editor, date, action, and item. A publish event shows the page, version, number of included changes, editor, and time. It cannot appear as `Updated Selected area` with `No recorded value`. Post events distinguish create, update, save draft, publish, archive, and restore. Removing a word and adding it back are two separate events even when the final value matches the starting value.

New writes use the normalized event contract transactionally. Existing compatible audit records are projected into the same read model without destructive rewriting. Legacy events with incomplete data are labelled honestly as limited legacy records; the UI does not invent before/after values.

Restore creates a new immutable version and a new restore event. It never deletes or rewinds the historical record in place.

### 6. Forms and authentic live-data guidance

The Forms workspace becomes an operational landing page for Contact and Newsletter. Each form card shows:

- current availability and provider/readiness status;
- the public route or preview action;
- what information it collects;
- the consent behavior;
- which internal workspaces receive the resulting records; and
- a manage/open action appropriate to the staff role.

The Contact data path is explained as:

```text
Deliberate public contact submission
  -> Submissions record
  -> contact/customer identity
  -> Lead when the configured ingestion contract allows it
  -> Overview counts update
```

The Newsletter path is explained separately:

```text
Deliberate newsletter signup
  -> pending subscription with consent evidence
  -> confirmation email
  -> active subscriber only after confirmation
```

A newsletter signup does not become a lead merely to populate a dashboard.

Empty Submissions, Overview, Leads, and Customers screens explicitly say that no live records exist yet and link to a guided testing checklist. The checklist asks the staff member to choose their own controlled, authentic contact information, review the public consent wording, submit the real form deliberately, and trace the resulting records. It never fills fields, submits automatically, creates placeholders, seeds the database, or triggers an outbound email without the staff member's deliberate action.

Existing newsletter readiness, confirmation, recipient, provider-validation, and staff-test controls remain authoritative. This release does not bypass them or activate unrelated provider features.

## Package and repository boundaries

The feature-change candidates are:

- `@reuben-williams/core` for shared content, version, audit, or type contracts that cannot remain adapter-local;
- `@reuben-williams/editor` for page-selection semantics, draggable quick edit, interaction cursors, post editor indicators, media picker integration, and unified history UI; and
- `@reuben-williams/next` for server-rendered Next.js content integration and framework-specific invalidation/preview hooks.

The actual publish set is frozen only after generating the internal dependency closure from the reviewed platform commit. Every installed package with an exact dependency or peer dependency on a bumped internal package must either participate in the coordinated release or receive an independently reviewed compatible manifest change. Forms and growth behavior remains out of scope, but a metadata-only closure release is permitted when required to prevent duplicate `core`/`editor` runtimes or peer conflicts. A candidate with no source or manifest change is not versioned merely because it appeared in the initial design list.

Before publication, the release records the full closure, versions, source commit, and reason for each package. Client acceptance proves `npm ls @reuben-williams/core @reuben-williams/editor @reuben-williams/next` has one reviewed version of each, no peer errors, and no nested duplicate runtime copies. A broader package publish without dependency evidence remains prohibited.

The existing `D:\Project Morales\site-editor-platform` checkout has unrelated edits and is behind its remote. Implementation must preserve it. Fetch current refs and create a separate clean worktree or isolated clone from the reviewed upstream commit; do not reset, overwrite, or stage the user's existing changes. Shared-package tests and versioning occur in that isolated branch. The client then pins the reviewed published versions and updates its lockfile.

Installed `node_modules` is evidence for diagnosis only and is never edited as source.

The unrelated untracked `client-website-setup-operator-walkthrough.md` remains outside all commits and release scope.

## Data and security requirements

- All database changes are additive reviewed Supabase migrations created through the normal migration workflow.
- Before a production database mutation, verify the exact linked Supabase project, remote migration head, local checksums, and the existing production-lineage contract. Run `npm run verify:production-migrations` and a linked dry run; the dry run must contain only explicitly approved filenames. Stop for any unrelated pending, reordered, modified, or remote-only migration. Optional platform migrations never enter the deployable chain incidentally.
- Site scope and staff role are enforced in the database or trusted server boundary, not only hidden in the UI.
- New functions use explicit grants and a restricted search path. Any `SECURITY DEFINER` function has the smallest reviewed authority necessary.
- The browser receives no service-role key, provider secret, raw internal audit payload, or cross-site record.
- Writes that create a version, active snapshot, audit event, and durable post-commit outbox commands use the command identity, expected identifiers, digest, locks, and replay rules defined above.
- Immutable version and media-revision identifiers use database constraints rather than UI assumptions.
- Media revision rows and storage objects cannot be hard-deleted while referenced by any current or historical version.
- Production migrations receive isolated database/pgTAP coverage and security-advisor review before release.
- No migration or test inserts synthetic production submissions, leads, customers, subscribers, posts, or page versions.

## Error handling

Errors identify the failed stage and preserve completed work:

- **Validation failed:** identify fields; write nothing.
- **Authorization failed:** state that the requested action is unavailable to the signed-in role; preserve the draft in the editor.
- **Revision conflict:** return `409 STALE_REVISION`, retain local input, identify the conflicting scope, and offer a controlled reload/compare path.
- **Primary save/publish failed:** keep all input and provide a retry tied to the same command identity.
- **Primary mutation succeeded, refresh failed:** report success plus a non-blocking refresh warning; do not repeat the mutation.
- **Recovery export or route invalidation failed after publish:** retain the successful version, retry only the fenced outbox command, and provide a direct public refresh check.
- **Media metadata/revision unavailable:** keep the post fields, leave the prior selection intact, and do not save a guessed URL.
- **History projection partially unavailable:** show available event categories plus a scoped error; do not replace the list with invented emptiness.
- **External provider unavailable:** keep provider-dependent actions visibly unavailable and explain why; never simulate success.

Logs include command/event IDs and safe stage metadata, but exclude content secrets, constituent data, email addresses, confirmation tokens, provider credentials, and service-role material.

## Test-driven implementation strategy

Every behavior change begins with a focused failing test that reproduces the current defect. The minimum regression set is:

### Public rendering and publishing

- Published text, link, and image data are present in the initial server HTML for direct requests.
- Hydration does not replace the current published value with checked-in fallback content.
- After a successful authoritative read, a region with no published override uses the reviewed checked-in fallback.
- Save, publish, composite global/page publish, and restore create the expected immutable versions, pointer transitions, audits, and outbox commands atomically.
- Simultaneous publish/restore races reject stale expected identifiers without partial writes.
- Same-key/same-digest replay returns the original result; same-key/different-digest replay conflicts.
- A global change fans invalidation out to every registered route and metadata surface; a page-only change targets its normalized route.
- A post-commit recovery-export or invalidation failure cannot turn a successful publish into a duplicate write.
- A direct HTML request after invalidation failure still reads the current authoritative version.
- Database outage tests cover a valid last-known-good recovery generation, invalid/tampered/wrong-scope artifacts, mixed global/page rejection, uncached manifest reads, conditional-write races, stale worker fencing/supersession, bootstrap coverage, maximum-lag/dead-letter health, and the truthful `503` when no complete valid recovery generation exists.
- Recovery-page integration fetches the outage HTML and every referenced recovery image, verifies status/MIME/length/digest, and rejects a wrong-generation, wrong-route, oversized, tampered, or unreferenced replica without exposing a private Blob URL or credential.
- Draft content is absent from public responses.
- Site and role isolation deny cross-site reads/writes.

### Navigation and interaction

- From Posts, Media, History, Forms, Submissions, Overview, Leads, and Customers, selecting Resources activates `website.pages` and displays the Resources editor preview.
- The URL records both workspace and path; reload and Back/Forward restore both.
- Invalid URL state cannot produce an arbitrary iframe request.
- The draggable panel uses pointer capture, stays within bounds, reclamps on resize, and does not begin dragging from its controls.
- Cursor rules distinguish enabled, disabled, drag, and resize controls.

### Posts and media

- Draft save accepts title-only input and creates default slug, author, and date.
- Concurrent identical titles receive deterministic site-scoped slug suffixes, and the direct API enforces the same default/validation rules as the client.
- Publish rejects each missing or semantically empty required field with exact field feedback, including filename-only image alt text.
- A selected featured image stores its managed media and revision IDs and requires alt text for publish.
- The post media button opens the real gallery callback and returns a previewable choice.
- Expired preview URLs do not affect saved versions; an old-version restore resolves the immutable media revision.
- Hard deletion of a referenced revision/object is denied, publishing rejects an unreplicated revision, and restore fails atomically when either the source object or verified byte replica is unavailable.
- Replica tests compare bytes, length, MIME type, and digest and restore both database metadata and historical media bytes in an isolated recovery drill.
- A successful primary save remains a success when linkable-post refresh fails.
- A retry after secondary failure does not duplicate the post.

### History

- Site-level history returns events for multiple pages without depending on `currentPath`.
- Page, media, post, form, publish, and restore events normalize to the supported categories.
- Two sequential inverse text changes remain two events.
- Publish and post lifecycle rows have meaningful summaries and versions.
- Filters/search/grouping operate together with bounded server-side keyset pagination and do not expose constituent contents.
- Cursor tests cover equal timestamps, new concurrent events, page boundaries, stable provenance IDs, and per-source partial failure.
- Restore creates a new version/event and preserves prior history.

### Forms and growth guidance

- Empty live workspaces show truthful zero-record guidance rather than demo data.
- The Contact and Newsletter cards describe their distinct real data paths.
- The guided checklist cannot auto-fill, auto-submit, or create a server record.
- Provider-disabled states remain unavailable and do not invoke outbound work.
- Existing authentic records, when present, continue to populate the correct live workspaces.

## Verification and release

### Automated gates

- Tests for every behavior-changing candidate and every metadata-only dependency-closure package pass in the isolated platform worktree.
- The client package-resolution tests prove the recorded pinned closure, one reviewed `core`/`editor`/`next` runtime, no nested duplicates, no peer errors, and no package-registry authorization error.
- Client unit, route, integration, accessibility, lint, typecheck, and production-build checks pass.
- Additive migrations pass isolated database and pgTAP tests.
- Supabase database and security advisors are reviewed; new findings are resolved or explicitly documented before release.
- Schema compatibility passes for the previous application against the additive schema, the exact new application against that schema, and rollback to the previous application while retaining the additive schema.
- The production-lineage verifier and linked dry run contain exactly the explicitly approved migration filenames and no optional/unrelated SQL.
- Recovery tests pin one reviewed `@vercel/blob` version and prove uncached private manifest reads, conditional `ifMatch` updates, immutable object paths, single-generation global/page consistency, bootstrap/reconciliation coverage, private-replica delivery, media-byte replicas, worker fencing/retries/dead-letter alerts, release-runner failure/success exits, and Preview/Production store isolation.
- Static/source scans find no secret values, service-role exposure, synthetic production records, or accidental inclusion of the unrelated walkthrough file.

### Preview acceptance

Preview uses a separately identified non-production Supabase project, site installation, Auth configuration, storage bucket, and Published Snapshot Recovery Store. It never receives production Supabase, Blob, or provider credentials and cannot address production site records. Mutating acceptance data is created and cleaned up only in that isolated environment.

At desktop and mobile editor widths, verify:

- direct public routes and hard refresh show current content with no stale flash;
- authenticated preview, draft save, publish, and version restore;
- page selection from every main workspace plus refresh and Back/Forward;
- draggable-panel bounds, focus behavior, scrolling, image resize, and performance;
- enabled/disabled/drag/resize cursors;
- draft and publish validation, existing-draft preservation, managed media selection, and secondary-refresh warning;
- global History filters, grouping, summaries, and restore;
- Forms instructions and truthful empty growth states;
- keyboard navigation, visible focus, responsive overflow, image loading, and readable errors; and
- no unexpected console errors, failed network requests, or secret-bearing payloads.

### Production sequence

1. Record the current application deployment, commit, lockfile digest, installed private package versions, exact linked Supabase project, remote migration head, local checksums, and current storage configuration as rollback evidence.
2. Verify backup/PITR or the approved encrypted-export coverage, capture a pre-change recovery point, and prove the restore procedure in isolation before any production mutation.
3. Create and verify additive database migrations in an isolated non-production Supabase project. Run the production-lineage verifier and linked dry run, and stop unless the proposed production set contains exactly the explicitly approved filenames.
4. Build and test the reviewed feature candidates plus generated internal dependency closure in a clean platform worktree. Use workspace/packed artifacts for development verification.
5. Present the exact package closure, versions, source commit, and registry changes and obtain explicit package-publication approval. Publish only that closure, pin it in the client, and verify the installed dependency tree.
6. Provision only the isolated Preview Published Snapshot Recovery Store and deploy the exact client, package lockfile, and migrations to the non-production Preview data plane.
7. Complete automated and authenticated Preview acceptance, including outage/recovery, migration compatibility, and cleanup evidence.
8. Present the complete Preview evidence, exact production database/application changes, and proposed Production Blob store name, private access mode, region, authentication method, current product-status/SLA considerations, cost implications, environment-variable changes, media/bootstrap scope, and reconciliation operation to the user. Obtain explicit production-release and storage-provisioning approval.
9. Only after that approval, provision/connect the Production private store and re-run linked-project, migration-lineage, checksum, dry-run, backup/recovery, and rollback-baseline checks. Apply only the reviewed backward-compatible production migration, invoke the candidate-built server-only recovery runner to perform the approved current-route and historical-media bootstrap, retain its command/commit/result evidence, require a healthy complete generation, and then promote the exact verified application build.
10. Run read-only production smoke checks on initial HTML/version identifiers, authentication, editor navigation, History, Posts, Media, Forms, growth projections, responsive behavior, console, network, and overflow. Do not Save, Publish, Restore, Upload, Archive, or submit any form.
11. Record the final deployment, schema head, package tree, recovery-store health, backup/PITR evidence, and rollback evidence.

Any production content mutation is a separate staff-owned action requiring explicit authorization that names the target scope, command type, and expected version. The existing production draft remains untouched by default.

No production deployment, package publication, migration, content mutation, or authentic form submission is authorized merely by approval of this design.

## Rollback and recovery

- Application regression: promote the recorded previous Vercel deployment and restore the previous pinned lockfile/package set in source.
- Shared-package regression: publish a forward-fix or pin the recorded prior versions; never overwrite an existing package version.
- Additive migration regression: disable new readers/writers through the application compatibility path. Do not drop tables or erase versions/audits as an emergency rollback.
- Content regression: restore the desired immutable version, creating a new published version and restore audit event.
- Cache/invalidation regression: keep dynamic direct server reads authoritative while invalidation is repaired; use only an integrity-valid exact-scope recovery artifact during a database outage.
- Provider regression: keep the affected provider feature disabled; unrelated editor, content, and live-data reads remain available.

Rollback never deletes constituent data, page history, post history, media revisions, consent evidence, or the existing production draft.

## Non-goals

- Git commits or Vercel deployments for each routine content publish.
- Synthetic, seeded, placeholder, or auto-submitted production records.
- Adding fake data solely to make dashboard, submissions, leads, or customers look populated.
- Enabling SMS, AI, survey, or unconfigured provider actions.
- Moving sensitive constituent contents into website change history.
- Deleting or changing the existing production draft without deliberate staff action.
- Redesigning the public website's visual identity.
- Editing installed `node_modules` as source.
- Publishing every available private package.
- Claiming backup, provider, or production readiness without verification evidence.

## Recovery-provider references

- [Vercel Blob consistent private reads](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage)
- [Vercel Blob immutable-object, conditional-write, caching, and cost guidance](https://vercel.com/docs/vercel-blob)
- [Supabase database backup scope, including the Storage-object exclusion](https://supabase.com/docs/guides/platform/backups)
- [Supabase Storage object deletion behavior](https://supabase.com/docs/guides/storage/management/delete-objects)

## Acceptance criteria

The release is complete only when:

- public initial HTML contains current published content and no old-content flash is observable;
- publishing is transactional, versioned, attributable, route-fresh, and recoverable;
- page selection always restores the page editor from every other workspace and survives browser navigation;
- the quick editor is performant, draggable, bounded, accessible, and does not hide necessary controls;
- interaction cursors are consistent and truthful;
- post draft/publish requirements, managed media, errors, and secondary refresh outcomes behave exactly as specified;
- site-level History covers all approved website event categories with meaningful summaries and filters;
- forms and growth workspaces teach authentic live testing without generating any record;
- package, application, database, security, accessibility, responsive, direct-route, console, network, and overflow checks pass;
- backup/recovery coverage includes the database, current and historical media bytes, complete route generations, a tested restore, and recorded health evidence;
- no secrets or sensitive constituent content are exposed; and
- the user separately approves the verified production release.
