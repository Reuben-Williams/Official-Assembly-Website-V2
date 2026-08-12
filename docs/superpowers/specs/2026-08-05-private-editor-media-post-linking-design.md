# Private Editor Media, Post Linking, and Status Header Design

Date: 2026-08-05
Status: Approved design

## Objective

Restore the missing production editor workflows without weakening the existing live-data and provider boundaries:

1. Import every JPEG currently in `morales4assembly/` into the private editor Media gallery.
2. Let an editor link an editable text, rich-text, image, icon, or link region to a published post.
3. Give published posts a valid public detail route so editor-created links cannot point to a missing page.
4. Move the operational availability notice and session-revocation action out of the narrow content inspector into a compact editor-wide header.

The media source currently contains 103 unique JPEG files totaling approximately 16.1 MB. The import mechanism must remain reusable; it must not hard-code the count or filenames.

## User-visible success criteria

- The private Media workspace contains all 103 selected source images after one folder or multi-file import.
- Repeating the same import reports the existing files as skipped and creates no duplicate assets or revisions.
- Each selected source digest maps to exactly one site-scoped logical asset; media that existed before the import remains unchanged.
- Bytes matching media that existed before the digest migration resolve to that existing logical asset after a trusted private backfill; they are not imported again.
- The images are not copied into `public/`, committed to Git, embedded in the Vercel build, or exposed through permanent public URLs.
- An authorized editor can still upload an individual supported image later.
- Imported images retain their original filenames as private source labels. No caption or alt text is invented.
- Before an imported image can be saved into public page content, the editor requires reviewed, non-empty alt text.
- After a post is published, it appears in the Links inspector and can be applied to a compatible selected region.
- Draft, scheduled, archived, expired, or otherwise unavailable posts cannot become public page link targets.
- With no published posts, the Links inspector explains the state and directs the user to the Posts workspace.
- Every generated post link resolves to a public, published post detail page; missing, draft, archived, or expired posts return the public 404 behavior.
- The operational status is readable at desktop and mobile widths without occupying the editing inspector.
- Batch selection, progress, errors, retry, and completion are usable with a keyboard and announced to assistive technology.
- No email, SMS, AI, survey, or other unconfigured provider work is activated by this release.
- No synthetic or placeholder records are inserted.

## Existing system constraints

- `EditorClient` already hosts `AttachedSiteEditor` and `AttachedPostsWorkspace`.
- The editor package already accepts `linkablePosts`, supports saving `postEntryId` with an editable region link, and exposes a `globalHeader` registration slot.
- The client currently does not pass `linkablePosts`; therefore the existing-post selector cannot appear.
- The operational notice is passed as `AttachedSiteEditor` children. The editor renders those children in the content inspector, which caused the narrow yellow layout.
- The normalized private media model uses `builder_media_assets`, `builder_media_revisions`, and the non-public `builder-media` bucket.
- The current production schema does not store a media digest or upload-plan state, so an additive shared-platform migration is required before import.
- The HTTP editor client lists media but does not currently implement `uploadMedia`.
- The installed Media workspace supports a single-file upload callback only. A small additive editor-package release is required for a first-class batch-import control and progress reporting inside that workspace.
- Posts are stored in `builder_entries` and `builder_entry_versions`, but the public site does not currently render those published records.
- The live post schema exposes `builder_entries.first_published_at` plus version-level `display_date` and `expires_at`; all three participate in public availability checks.

## Chosen architecture

### 1. Private media import

The Media workspace will gain an additive batch-import interface in `@reuben-williams/editor`. The platform change must preserve the existing single-file `onUpload` API and add a separate batch callback so existing clients are unaffected.

#### Existing-media digest backfill and go/no-go gate

The additive migration first creates the private canonical digest-identity, inventory-receipt, plan, and manifest structures plus a nullable revision-to-identity reference, but it does not enable upload endpoints. A private server-side inventory then streams every existing `builder_media_revisions` object from the non-public bucket, computes SHA-256 from the stored bytes, verifies the stored object is readable and matches its recorded type/size/dimensions, creates or reuses the one identity for that site/digest/asset, and links the revision without replacing or publicly exposing the object.

The inventory maps a same-site digest to its logical asset. Repeated identical revisions of the same asset are not a logical conflict. The following conditions block import activation and produce a private go/no-go report:

- a referenced object is missing or unreadable;
- stored bytes fail the allowlisted image verification contract;
- recorded metadata cannot be reconciled with trusted bytes;
- the same digest belongs to different logical assets for the same site;
- any existing revision remains uninventoried.

These failures are never auto-fixed by deletion, overwrite, merge, archive, or relabeling. The report identifies the affected private asset/revision IDs and requires a separately reviewed non-destructive reconciliation decision. After a clean inventory or approved reconciliation, the platform records a versioned successful inventory receipt, installs/enables the site-scoped digest uniqueness rule, and only then enables planning and finalization. A receipt is current only when its inventory/schema version matches the installed contract and no revision is missing a trusted identity or was added outside the verified pipeline after the receipt cutoff. A site without a current successful receipt fails closed. Production with zero existing media still records a successful empty-baseline receipt.

The client repository will provide the production implementation:

- A visible `Import images` control accepts a folder where supported or a multi-file selection elsewhere.
- The browser performs a convenience preflight for each selected file. These values are untrusted hints and never replace server verification:
  - JPEG MIME type and extension for this initial source import.
  - configured per-file and aggregate size limits;
  - decodable image dimensions;
  - SHA-256 digest computed from the actual bytes.
- The UI presents the selected, valid, rejected, already-present, archived-match, uploaded, and failed counts before and during import.
- Upload concurrency is bounded to avoid exhausting browser, network, or storage resources.
- A failed file can be retried without restarting successful files.
- The owner-only batch control is rendered only for the owner role. Other authorized roles retain the single-file control allowed by `media.upload` and see a truthful explanation that folder import is owner-only; they never receive a working hidden batch control.
- File selection and retry controls are keyboard operable. Aggregate progress uses a polite live region and a native progress element or equivalent semantics. Per-file errors name and associate with the affected file, status does not rely on color alone, and focus moves to the summary after validation or upload failures. Folder selection has an accessible multi-file fallback.

The browser must not send image bodies through a Vercel application route. Instead:

1. The browser sends a bounded JSON batch-planning request containing source filename, byte size, MIME type, dimensions, and claimed SHA-256 digest. The server creates one batch/manifest identity for the whole selection and binds every item to it.
2. The server authenticates the private editor session, applies the operation's role rule, verifies same-origin and CSRF protections, and resolves the provisioned site ID and user ID from the session rather than from client input.
3. The server requires a current successful existing-media inventory receipt, enforces all batch, file, site/user quota, and issuance-rate limits, and binds the canonical request payload to its idempotency key. Reusing that key with a different payload returns a conflict.
4. The server checks every revision for the site-scoped digest identity, including archived assets. An active match returns `skipped`. An archived match returns `archived` and is not duplicated or automatically restored; restoration remains a separate explicit lifecycle action.
5. For a new digest, the server creates an unsigned upload-plan record in a non-exposed private schema. The plan binds batch ID, plan ID, site, user, operation kind, claimed digest, expected byte size/type/dimensions, safe source label, immutable server-generated object key, idempotency key, request fingerprint, manifest expiry, and state. Planning the manifest does not issue all upload capabilities at once.
6. The browser requests capabilities just in time for the next bounded upload window. After rechecking plan, role, batch, remaining manifest lifetime, active-capability, and issuance-rate limits, the server returns only the plan ID, predetermined object path, and Supabase signed upload token scoped to that new path. Upload uses no upsert and cannot replace any existing object.
7. The browser uploads the file directly to the private `builder-media` bucket using that token, then calls a bounded JSON finalization endpoint with the opaque plan ID and matching idempotency key.
8. Finalization loads the plan server-side, verifies the same site/user/operation binding, downloads or streams the stored object from private Storage, and computes a trusted SHA-256 digest from its actual bytes. It also verifies actual byte size, allowlisted format-specific magic/signature, successful image decoding, MIME type, and decoded width/height against the plan. The source-folder batch operation permits JPEG only; separately allowed single-file formats receive their own signature/decoder tests.
9. A mismatch moves the plan to `rejected`, exposes no gallery record, and quarantines or deletes only that plan's never-finalized immutable object. It never modifies an existing media object.
10. A valid finalization transaction creates the canonical digest identity plus normalized asset and revision, stores the verified dimensions, marks the winning plan finalized, and returns the gallery asset. Canonical identity uniqueness on `(site_id, sha256)` decides concurrent races. A verified losing plan resolves the canonical identity, returns that existing gallery asset, creates no asset or revision, and becomes terminal `deduplicated`.
11. The editor refreshes the Media list after each completed batch.

Signed upload tokens are capabilities and must only be issued after authorization. They must be scoped to one predetermined new object key, never logged, and allowed to expire normally. Gallery previews continue to use short-lived signed read URLs. The service-role or secret key remains server-only.

The existing single-file `uploadMedia`/`onUpload` flow is wired through the same planning, signed-upload, trusted verification, and finalization pipeline. It keeps the existing `media.upload` capability rule instead of inheriting the owner-only batch restriction. Batch and single-file operations use distinct operation identifiers in authorization and idempotency records.

#### Idempotency and object identity

The durable deduplication identity is a canonical site-scoped content-identity record keyed by `(site_id, sha256)`, where `sha256` is the trusted digest computed by the inventory or finalization service. Each identity maps that digest to exactly one logical media asset. Multiple revisions of that same asset may reference the same identity, so identical historical revisions remain representable; the same digest may not map to two different assets. The immutable object key is server-generated and plan-scoped under the resolved site prefix; it never uses or trusts the original filename and is never uploaded with upsert. Original filenames remain metadata labels only and are normalized to a safe display string.

Planning and finalization requests carry request-specific idempotency keys and canonical request fingerprints. The additive platform migration creates the canonical digest-identity table with unique `(site_id, sha256)` and a revision-to-identity reference constrained to the same site and media asset. It does not place a unique `(site_id, sha256)` constraint directly on revision rows. Upload plans, content identities, inventory receipts, and import-batch manifests live in a non-exposed private schema with no `anon`, `authenticated`, or `PUBLIC` access.

An upload that reaches Storage but never finalizes is not shown in the gallery. Retrying the same plan and payload validates the already-uploaded immutable object and resumes the `planned -> verified -> finalized` transition. A different plan never overwrites that object. If a concurrent valid plan finalized the same digest first, the later transaction becomes `deduplicated`, returns the existing logical asset, owns no media revision, releases its plan/capability quotas, and retains ownership only of its unreferenced duplicate object until private cleanup after capability expiry plus the safety interval. Cleanup never targets the canonical object's winning plan or revision and is not exposed as a destructive editor action in this release.

Each batch writes a private import manifest containing its selected claimed digests and source labels, trusted finalized digests and metadata, pre-import asset/revision baseline identifiers, outcomes, and timestamps. The manifest is not placed in `public/`, the Git repository, browser storage, or analytics. It provides the release evidence that every selected digest appears exactly once and that unrelated pre-existing assets were unchanged.

#### Server-enforced resource bounds

The UI may enforce stricter presentation limits, but the server is authoritative. The initial production contract is:

- one file: at most 10 MiB of claimed and verified bytes;
- one image: width and height each at most 8,192 pixels and at most 40 megapixels after trusted decode;
- one batch: at most 250 files and at most 250 MiB of claimed and verified aggregate bytes;
- active batches: one owner batch per site at a time;
- planned items: at most 250 active batch plans for that site plus at most 8 active single-file plans per user;
- unexpired signed upload capabilities: at most 8 per site and user at a time;
- signed capability issuance: at most 300 new tokens per rolling hour per site and per user;
- unsigned batch manifest lifetime: 24 hours;
- signed plan/finalization lifetime: two hours from capability issuance, matching the current Supabase signed-upload validity window;
- issuance cutoff: no capability is issued unless at least two hours remain before the manifest expires, so a signed plan never outlives its manifest;
- cleanup eligibility: no earlier than capability expiry plus a 15-minute safety interval.

Planning rejects an invalid claimed type, size, dimensions, file count, aggregate size, stale inventory receipt, quota, or rate limit before creating or returning an upload capability. Finalization re-enforces actual per-file limits and atomically checks the manifest's accumulated trusted byte total before exposing the asset. If actual bytes or dimensions exceed a limit, the plan is rejected and the plan-owned object follows private cleanup; it cannot consume a media record.

The expiry and quota state machine is explicit:

- An unsigned plan is active only until finalized as a skip/archived outcome, cancelled, or its 24-hour manifest expires. Manifest expiry moves remaining unsigned plans to `expired`, immediately releases their active-plan and one-active-batch quota, and schedules no object cleanup because no upload capability or object existed.
- Capability issuance moves one unsigned plan to `capability_issued` with `capability_expires_at = issued_at + 2 hours`. Issuance inside the manifest's final two hours is rejected without a token; issuance exactly at the cutoff may expire at the same instant as the manifest.
- A batch with no remaining unsigned work but one or more unexpired signed plans is `draining` and continues to hold the one-active-batch quota until those plans finalize, become deduplicated, reject, or expire. Because issuance cannot outlive the manifest, all signed plans are terminal by manifest expiry.
- Finalized, deduplicated, skipped, archived-match, rejected, cancelled-unsigned, and expired plans stop counting toward active-plan quotas immediately. A signed capability stops counting toward the active-capability quota when it finalizes, becomes deduplicated, rejects, or reaches `capability_expires_at`; the rolling issuance counter is not refunded.
- The batch releases its one-active-batch quota as soon as every plan is terminal, or at manifest expiry after all remaining plans are marked expired.
- Cancelling a batch immediately cancels and releases unsigned plans but cannot revoke signed tokens. The batch remains `draining` until issued capabilities finalize, become deduplicated, reject, or expire.

An internal cleanup operation considers only an expired, rejected, or `deduplicated` signed plan for which Storage confirms that a plan-owned object was actually uploaded and no finalized revision references it. After capability expiry plus the 15-minute safety interval, it removes at most 100 such objects per invocation. For `deduplicated`, cleanup verifies again that the object key is the losing plan's key, differs from the canonical revision object, and has no revision reference. Unsigned plans and signed plans with no stored object require no object cleanup. Cleanup retains non-sensitive plan/manifest audit outcomes, never touches a finalized revision or canonical object, and is not callable from the public site or editor UI.

#### Labels and alt text

`label` stores the source filename for provenance. Imported gallery previews use empty alt text because the private thumbnail itself does not establish a truthful public description. Selecting an imported asset for a public editable image must leave the region alt field empty and block Save draft until the editor enters reviewed alt text. This prevents the filename from becoming false or inaccessible public content.

### 2. Post linking and public post routes

`EditorClient` will own one shared post-list state:

- Load the list through the existing live posts client on editor start.
- Extend the authenticated list response with server-derived site ID, active published version ID, `firstPublishedAt`, published-version `displayDate`, `expiresAt`, and an availability reason.
- Map each item to the editor package's `LinkablePost` contract. Only a currently available item receives effective status `published`; future or otherwise unavailable items remain visible only as disabled context where the package supports it.
- Use `/news/<encoded-slug>` as the href.
- Pass the list to `AttachedSiteEditor.linkablePosts`.
- Refresh it through `AttachedPostsWorkspace.onPostsChange` after create, save, publish, archive, or restore operations.
- Schedule a refresh at the nearest future `firstPublishedAt`, `displayDate`, or `expiresAt` boundary so eligibility changes without a workspace mutation.

One shared pure availability predicate is the authority for editor targets, server-side link saves, the public detail route, and the News list. Given the expected provisioned site and database/request time, it returns available only when all conditions hold:

- the record belongs to the exact expected site;
- `content_type` is `post`;
- entry status is `published`;
- an active published version exists and is the version being evaluated;
- `first_published_at` is non-null and not in the future;
- the active published version's `display_date` is not in the future;
- the active published version's `expires_at` is null or greater than now.

Draft, scheduled/future, archived, expired, cross-site, or version-mismatched entries may be displayed for context but remain disabled. Immediately before saving an editable value containing `postEntryId`, the secured builder mutation resolves that post for the same site and re-runs the shared predicate. This server check prevents a stale browser selection from linking a post that became unavailable after the list loaded.

When no eligible post exists, the Links inspector must render an explicit empty state instead of hiding the entire post-linking area. Its action changes the active workspace to `website.posts`; it does not manufacture a draft or fill any post fields with placeholder content.

A public `news/[slug]` route will query by the provisioned site and exact normalized slug, then apply that same shared availability predicate.

The route renders only the active published snapshot. Draft versions are never read for public display. The body is validated with the installed content schema and rendered as structured React elements; raw stored HTML is not injected. Supported links are normalized, external links receive safe attributes, and unknown invalid nodes fail closed. Post metadata uses the stored title, excerpt, author, display date, taxonomies, SEO fields, and reviewed featured-image metadata.

The detail route and News list perform these exact site/status/version/time checks at request time with uncached, no-store data access. They do not use a cache that can survive archive, scheduling, republish, or expiry. A post archive must become unavailable on the next request, a future-dated published version must remain unavailable until `display_date`, and an expiry crossing must return 404 without requiring a new deployment or scheduled invalidation.

The existing News landing page will replace the statement that site-managed posts are unavailable with a live list only when published records exist. When there are none, it retains an honest, non-placeholder empty state and the existing verified public-resource guidance.

### 3. Editor-wide operational status header

The existing notice is removed from the `AttachedSiteEditor` children slot. `BuilderShellRegistration.globalHeader` will render a dedicated client component above the workspace.

The collapsed header shows concise, truthful states:

- `Live production data`
- `Providers unavailable`
- `Survey unavailable`

An expandable `Details` disclosure contains the complete operational explanation:

- contact and newsletter use approved managed-form templates;
- posts use the live content store;
- survey remains unavailable until separately provisioned;
- dashboard, submissions, leads, and customers use live production storage;
- no synthetic or placeholder records are loaded;
- email, SMS, and AI actions remain unavailable because providers are not configured.

`Sign out and revoke editor session` remains visible at the end of the header. During the request it is disabled and announces progress. Failure leaves the editor session active and exposes a readable error; success redirects to `/admin/login` as it does now.

At narrow widths the status chips wrap, the details disclosure occupies its own row, and the sign-out control remains at least 44 CSS pixels tall. The header must not reduce the preview or inspector to unusable widths.

## API and authorization boundaries

The media upload endpoints reuse the existing builder request-authentication primitives rather than creating a second session model.

- Read/list media: existing authorized editor roles with `preview.read`.
- Single media upload: roles allowed by the existing `media.upload` capability, using the common verified upload pipeline.
- Batch folder import: owner only for this production rollout, enforced in both control rendering and the server route.
- Planning and finalization: POST JSON, same-origin required, CSRF required, no-store responses, bounded request size, strict property allowlist, and idempotency key required.
- Site ID, user ID, and object-key prefix: derived server-side from the verified session.
- Upload plan: private, expiring, operation-scoped, bound to one immutable object key and one canonical request fingerprint.
- Import readiness: a current successful private existing-media inventory receipt is required before any upload capability is issued.
- File types: allowlisted. The initial folder import accepts JPEG only; the reusable single-file flow may retain the platform's separately tested PNG/WebP/GIF support.
- File authority: browser metadata is advisory; only server-computed hash, decoded dimensions, byte size, and signature/type verification can produce a visible media revision.
- Resource authority: file, dimension, pixel, batch count/bytes, active-plan, active-capability, issuance-rate, expiry, and cleanup limits are all enforced server-side.
- Signed tokens and secret keys: never returned in logs, errors, analytics, or persisted client storage.

The database and Storage policies remain defense in depth. The application server performs explicit site and role authorization even when a privileged server client is required to issue signed upload tokens or finalize records.

## Error handling and recovery

- Session expired or revoked: stop the import, preserve the on-screen per-file report, and require sign-in.
- CSRF or origin rejection: upload planning/finalization makes no database change and returns a specific authorization error.
- Invalid claimed type or claimed planning limit: reject before requesting a signed token. Invalid or undecodable actual bytes are rejected authoritatively at finalization.
- Existing-media inventory missing or stale: fail closed and issue no upload capability.
- Existing-media inventory has a missing/unreadable object or cross-asset digest conflict: block activation and require a reviewed non-destructive reconciliation.
- Batch, file, active-plan, active-capability, or issuance-rate limit exceeded: return a specific limit response and issue no upload capability.
- Manifest has less than two hours remaining: refuse new capability issuance without shortening or extending the manifest; the operator may start a new batch after the current one becomes terminal.
- Active duplicate digest: return the existing asset as skipped; this is a successful idempotent outcome.
- Archived duplicate digest: return an archived-match outcome without creating or restoring anything.
- Idempotency key reused with a different canonical payload: return a conflict and create no plan or asset.
- Signed upload expired: request a fresh plan for that file, then retry.
- Storage upload failed: no media record becomes visible.
- Stored bytes do not match the plan: reject the plan, expose no media record, and quarantine or delete only the plan-owned unreferenced object.
- Finalization conflict: fetch the existing digest record and return it if it matches; otherwise return a conflict without overwriting another asset.
- Concurrent verified digest winner already exists: return the canonical asset as a successful `deduplicated` outcome, create no revision for the losing plan, and defer only its unreferenced object to safe cleanup.
- Interrupted finalization: retry the same plan and payload through its explicit state machine; never infer success only because an object exists.
- Expired unfinalized plan: refuse finalization, retain a truthful status, and make only its unreferenced plan-owned object eligible for bounded private cleanup after the safety interval.
- Expired unsigned manifest/plan: release its active quotas immediately and perform no object cleanup.
- Gallery refresh failed after completed uploads: retain the completion report and offer Refresh gallery rather than re-uploading files.
- Posts list unavailable: Posts continues to report its service error, and the Links inspector does not offer stale targets.
- Public post invalid or unavailable: return 404 without leaking draft or internal status information.
- Status-header sign-out failed: show an inline error and re-enable the action.

## Testing strategy

Implementation follows test-driven development: add a focused failing test before each behavior change.

### Unit and contract tests

- Media preflight accepts valid JPEGs and rejects invalid MIME, extension, dimensions, size, and malformed metadata.
- Existing-media inventory streams private objects, computes trusted digests, records a successful zero-media receipt, and maps an import matching a pre-migration asset to the existing logical asset without a new asset or revision.
- Existing-media inventory blocks activation for missing/unreadable objects, invalid bytes/metadata, uninventoried revisions, or a same-site digest shared by different logical assets; it performs no destructive automatic reconciliation.
- Backfill permits two identical revisions of one media asset to reference one canonical identity, while the same digest across two logical assets blocks the go/no-go receipt.
- Object-key helpers are server-generated, immutable, site/plan-scoped, and path-safe.
- Import planning returns new versus skipped outcomes and never trusts a client-supplied site/user/object key.
- Trusted finalization rejects a valid plan followed by tampered bytes, a digest mismatch, invalid JPEG signature/decode, size mismatch, type mismatch, or dimension mismatch.
- Repeated and concurrent planning/finalization remains idempotent; idempotency-key reuse with a different payload returns a conflict.
- Active matches skip, archived matches report archived without duplication, an interrupted plan resumes through explicit states, and concurrent valid plans converge on one logical asset without overwriting objects. The losing plan becomes `deduplicated`, returns the canonical asset, and creates no revision.
- Single-file upload succeeds through the common pipeline for a `media.upload` role and rejects invalid files or unauthorized roles.
- Media mapping preserves source label and does not turn it into imported alt text.
- Public editable-image saving rejects an empty reviewed alt value for imported media.
- Post-list mapping produces canonical `/news/<slug>` hrefs and refreshes after workspace mutations.
- The shared post-availability predicate rejects cross-site, non-post, draft, archived, missing/mismatched active version, future `first_published_at`, future `display_date`, and elapsed `expires_at` inputs for both editor and public consumers.
- Future `first_published_at` or `display_date` targets remain disabled; a scheduled boundary refresh can enable them, an expiry boundary refresh makes them ineligible, and the secured save rejects a stale target that became unavailable before mutation.
- Zero-post Links UI renders the Posts-workspace action.
- Public post parsing rejects drafts, archived entries, future-scheduled entries/versions, expired entries, invalid snapshots, and unknown unsafe body content.
- Operational header renders truthful collapsed and expanded copy plus sign-out states.
- Batch controls render only for owners, while other authorized upload roles retain single-file upload and receive a truthful batch-access explanation.
- Batch progress exposes labelled aggregate progress, filename-associated per-file errors, non-color-only states, keyboard retry, predictable focus after failure, and an accessible folder/multi-file fallback.
- Server limit logic enforces 10 MiB/file, 8,192 pixels/side, 40 megapixels, 250 files/batch, 250 MiB/batch, one active site batch, planned-item/capability quotas, 300 token issuances/hour, plan expiry, and cleanup eligibility independent of the browser.

### Route tests

- Upload planning and finalization reject missing session, revoked generation, disallowed role, cross-origin request, invalid CSRF, oversized body, unknown properties, missing idempotency, and invalid file metadata.
- Planning without a current successful inventory receipt returns no capability.
- Planning rejects each exceeded server bound: file bytes, width, height, pixel count, file count, aggregate claimed bytes, active batch, active single plans, active capabilities, and issuance rate. The rejected response includes no signed token or object capability.
- A successful plan is site-scoped and returns only the minimum upload capability.
- Finalization reads the plan-owned private object and verifies its actual bytes, signature/decode, trusted digest, size, type, and dimensions before exposing the asset.
- Finalization rejects actual per-file or aggregate verified limits even when the claimed planning metadata passed.
- Manifest-expiry tests expire unsigned plans without object cleanup, immediately release their plan/batch quotas, and refuse finalization.
- Capability issuance in the manifest's final two hours returns no token; issuance exactly at the two-hour cutoff expires with the manifest.
- Draining/cancellation tests hold batch quota while signed plans remain live, release plan/capability/batch quotas at their defined terminal transitions, and do not refund the rolling issuance counter.
- Cleanup tests wait through capability expiry plus the safety interval, process at most 100 expired/rejected/deduplicated plan-owned objects that Storage confirms were uploaded and remain unreferenced, ignore unsigned/no-object plans, and never delete finalized media.
- A concurrent-finalization test proves one canonical identity, logical asset, and revision remain; the winning canonical object is preserved; the losing plan returns that asset with `deduplicated`; and only the losing unreferenced object is removed after its cleanup gate.
- Public post route and News list use no-store request-time checks, serve exactly an active currently available published snapshot, and return 404 or omit it for every unavailable state.
- A request immediately after archive does not receive a cached post; a future `display_date` remains unavailable; crossing `expires_at` becomes unavailable on the next request.
- Builder link mutations re-run the shared availability predicate and reject a post that is cross-site, future, archived, expired, or no longer the active published version.
- Existing content, posts, growth, and session route contracts remain passing.

### Build and browser verification

- Run the repository test suite, lint, and production build.
- Validate authenticated editor behavior on desktop and mobile widths.
- Capture the private pre-import asset/revision baseline and private source digest manifest. Import the actual 103-file source set and confirm every selected digest has exactly one site-scoped logical asset while all unrelated baseline assets/revisions are unchanged.
- Repeat the import and confirm 103 skips with no logical-asset or revision increase.
- Open representative portrait, landscape, and square images from the gallery and verify signed previews load without console or network errors.
- Confirm public requests cannot fetch the private object keys without a valid signed URL.
- Confirm the import changes only private upload-plan/manifest and media records; it creates no page draft, published-page, post, or public media reference.
- Create and publish a real post, link selected text to it, publish the page, and verify the public link and post route.
- Archive the post and verify the public route becomes unavailable and the editor target becomes ineligible.
- Confirm Pages accordion navigation changes the preview path and loads the editable version.
- Confirm the status header layout, disclosure, and sign-out action at desktop and mobile widths.
- Verify owner and non-owner Media views plus keyboard selection/retry, progress announcements, error associations, focus recovery, and multi-file fallback.
- Inspect browser console, failed requests, page overflow, loading overlays, and direct/deep routes.

## Rollout sequence

1. Add and test the additive editor-package Media workspace batch interface, accessible progress/role states, and zero-post link empty state.
2. Add and verify the additive shared-platform schema for canonical site-scoped digest identities, nullable revision-to-identity references, private upload plans/import manifests/inventory receipts, grants/RLS, plan-state transitions, server quotas, and cleanup. Run the private existing-media inventory/backfill, stop on any unreadable object or cross-asset digest conflict, record the go/no-go receipt, then enable canonical identity uniqueness and upload capability issuance only after a clean result. Run database security/performance advisors before packaging the migration.
3. Publish a pinned private package version and update this client lockfile through authenticated GitHub Packages access.
4. Add the common single/batch media planning, signed upload, trusted-byte finalization client/routes, plus the status header.
5. Add the public no-store published-post repository, renderer, detail route, News list integration, and editor linkable-post synchronization.
6. Run local automated and browser verification.
7. Record the current production deployment identifier, application commit, lockfile digest, and installed private package versions as the rollback baseline.
8. Deploy the pinned application/package build to a Vercel preview and complete unauthenticated public-route plus authenticated editor desktop/mobile verification there. No production import occurs from preview.
9. Promote or freshly deploy the exact verified build to production using existing secret-safe package authentication, then run authenticated production smoke tests before selecting files.
10. Capture the private pre-import media baseline and create the private 103-file source digest manifest. Import the selected `morales4assembly/` images only after production upload smoke tests pass.
11. Verify every manifest digest has exactly one logical asset, unrelated baseline assets are unchanged, import created no public content references, and previews remain private.
12. Re-run the same manifest as the idempotency check and record 103 skips with no logical-asset or revision increase.

Code rollback redeploys the recorded prior production deployment or reverts the application and pinned package/lockfile to the recorded baseline. Approved imported media remains in the private production store and is not deleted as part of code rollback. Additive database changes are retained and rolled forward if a correction is required; no destructive schema rollback or media deletion is part of this release procedure.

Production data mutations are limited to the explicitly selected real image assets and any real post the authorized operator chooses to create. The release does not seed demonstration content.

## Non-goals

- Making the imported source folder or bucket public.
- Committing the source images to the client repository.
- Generating captions, alt text, posts, leads, customers, submissions, or other placeholder records.
- Activating email, SMS, AI, survey, scheduling, or unconfigured provider actions.
- Permanent media deletion, bulk public placement, automatic page replacement, image optimization/transcoding, or facial/content classification.
- Creating draft posts automatically from selected page text.

## Documentation references

- Supabase JavaScript `createSignedUploadUrl`: <https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl>
- Supabase JavaScript `uploadToSignedUrl`: <https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl>
- Supabase private bucket serving: <https://supabase.com/docs/guides/storage/serving/downloads>
