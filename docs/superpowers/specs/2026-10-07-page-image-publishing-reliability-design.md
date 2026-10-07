# Reliable page-image publishing and clear draft status

## Outcome and scope

Damon can select a gallery photo, save it as a private draft, and explicitly publish it. The published photo must remain usable after the gallery preview link expires. The editor must explain which saved changes are not live yet. Saving a draft must never publish it automatically.

The user approved repairing image handling and clarifying draft/published status before Damon retries. This document is the written-spec review checkpoint; implementation and release have not occurred.

### Workflow tasks

- [x] Inspect current permissions, content history, image handling, and release workspace.
- [x] Establish the cause and obtain approval for the recommended repair.
- [x] Write the bounded design.
- [ ] Complete independent spec review.
- [ ] Obtain user review of this written spec.
- [ ] Create the implementation plan, implement with regression tests, and verify the release.

## Verified problem

The October 7 audit found that Damon has the site owner role. His recent page-image commands were successful draft saves, with no corresponding page-image publish command. His separate successful event publishes are not affected by this finding.

The News draft contains `DSC02485.jpg` as a one-hour signed Supabase Storage URL. That URL has expired, but its original object and immutable media revision still exist, with a ready recovery replica. The page save/publish path currently stores image URLs unchanged and does not retain page-version media references. The gallery picker also loses media identifiers when constructing the editable image value. Publishing alone therefore does not repair the expired URL.

The existing carousel uses immutable revision references and fresh delivery URLs. Page photos need equivalent durability without depending on a photo also being published in the carousel.

## Recommended approach and alternatives

Use a site-local, server-validated permanent media reference for page photos and a small publication-status panel in the existing editor. This preserves the private media bucket, staff workflow, package versions, and approved page design.

Renewing signed URLs whenever a page loads would still leave expiring URLs in versions and recovery artifacts. Making the media bucket public would change the privacy boundary unnecessarily. A new reusable editor package release is also unnecessary for this website-scoped repair.

## Image reference contract

For managed page images, persist the existing editable image shape with a canonical `mediaId` and a same-origin `src` containing the exact immutable revision, for example `/api/builder/media/<revisionId>`. Keep alt text and supported image-link metadata intact. The revision in the route is authoritative only after a server lookup confirms that it belongs to that media asset and this site. No shared-package type changes or edits to installed packages are required.

Static, approved local images keep their existing paths. Other already-supported image values keep their existing behavior; this repair does not add arbitrary remote-image hosts or remote fetching. Malformed managed-media references fail explicitly instead of being silently treated as external images.

### Normalization boundary

A focused page-media resolver accepts an editable image and resolves it against the site's media records. It supports both canonical references and legacy signed URLs from the exact configured Supabase origin and private `builder-media` bucket. For legacy URLs it resolves the complete decoded object key to the site's immutable revision. It does not infer an asset ID from a UUID in the storage path, trust token claims, or fetch the submitted URL.

Expired preview tokens are irrelevant to that lookup. A same-site, unarchived asset and an exact retained revision must exist. Ambiguous, missing, cross-site, unsupported-MIME, or mismatched references return a useful editor error. New selections use a ready replica before publication. Previously retained historical revisions remain restorable under the existing history rules, even if the asset is later archived from new selection.

Normalize images at draft save, publish, and restore boundaries. A publish normalizes the complete saved global/page snapshots, not just the currently selected field, so Damon's existing News draft can be repaired without choosing another photo. A restore creates a new canonical version; old immutable history entries are not rewritten. Draft reads may project fresh short-lived preview URLs for authenticated staff, but those delivery URLs must not be saved into canonical versions.

Authorization and CSRF checks occur before media lookup or signing. The existing owner/editor operation permissions and session-generation checks remain authoritative.

## Atomic publication, history, and recovery

Keep the existing content-command transaction, expected-version checks, idempotency, and global-plus-current-page publish semantics. Within that transaction, every managed image in a new version records its exact asset/revision/region/alt in `builder_page_version_media`. Validate same-site membership and publication readiness before changing published pointers; if any image fails, publish nothing and preserve the saved draft.

An additive migration integrates page-media retention with new save, publish, and restore versions. It must not weaken RLS, allow anonymous writes, rewrite previous snapshots, or remove carousel-generation retention. Database changes are tested without restarting Docker/WSL.

Complete-generation recovery then includes these page images through the existing retention table. Recovery lookup must match the exact immutable revision encoded in the canonical reference, not just the asset ID. Two versions of one asset must not cause recovery to return the wrong photo. Legacy media-ID-only recovery is accepted only when its reference is unambiguous in the verified manifest.

Read-only compatibility conversion can resolve legacy URLs for preview. Durable conversion happens through normal, audited save/publish/restore commands. The repair will not publish or overwrite Damon's current drafts as a release step.

## Public and private delivery

The new same-origin public image route accepts a valid revision ID and serves a freshly resolved delivery URL or verified image bytes only when that exact revision is referenced by the site's currently published global/page content. It must not authorize access merely because the revision exists, appears in a private draft, appears only in history, or is published in the carousel.

Private draft preview remains authenticated and site-scoped. The bucket stays private. Public and private delivery responses use explicit cache/privacy headers; private preview is no-store. Test the real Next image rendering path, including redirects or byte serving, rather than assuming the optimizer will accept it. Do not log, persist, or expose signed tokens in status responses.

The public route fails closed for unreferenced/cross-site media and unavailable publication evidence. The established verified-recovery reader remains the fallback during a primary content outage; it does not use an unrestricted storage endpoint. Previously delivered public images cannot be recalled from visitors' caches, but this endpoint must not newly expose drafts.

## Editor status UX

Use a supported site-local attached-client wrapper and the editor's global-header extension for a compact page-editing status panel. No page redesign or new package release is included.

- Saved differences: **Saved draft — not visible on the live site.** Guidance: **Save draft, then Publish to update the live website.**
- After a confirmed publish with matching readback: **Published — the saved changes are live.**
- Failed or uncertain status read: **Publication status could not be verified. Refresh before publishing.** Do not claim success.
- Failed save/publish: show the server's safe, actionable error; retain the user's saved draft and do not display a false completion state.

The panel reports saved server state, not unsaved input fields. Clearly label it accordingly, preserve the editor's existing dirty-field behavior, and never imply that clicking Publish saves an unsaved quick-edit field. The workflow remains choose/edit → Save draft → Publish.

An authenticated, no-store status read compares normalized semantic global/page values, not only version IDs or expiring delivery URLs. Existing brand/newletter protections and registered-region filtering remain applied. Re-fetch after mutations and navigation; discard responses for an older selected page. On refresh the panel must reflect the stored state rather than an earlier optimistic success message.

Because a page publish includes saved shared/global changes, show a notice when such changes are pending. Do not imply that only one selected image will be published. Preserve the existing separate carousel review/publish workflow, with consistent saved-draft wording where a site-local label is available.

## Preserved decisions and exclusions

- Keep the official state headshot pinned on the homepage.
- Do not change the volunteer photo, other approved photo placements, carousel composition/effects, captions, navigation, calendar, or newsletter configuration.
- Do not change Damon's owner membership or impersonate his account.
- Do not automatically publish editorial drafts, send emails, rotate keys, open a public bucket, or restart WSL/Docker.
- Do not alter existing immutable history to conceal the expiring URL; retain the audit trail.

## Acceptance and release checks

Write a failing reproduction test for the expired legacy gallery URL before implementing the resolver. Cover trusted-origin/key validation, deduplicated object paths, exact revision selection, same-site checks, archived selection rules, preserved alt/link metadata, and static-image compatibility. No test fixture contains a real signed token.

Exercise transaction retention, idempotent retries, stale-version rejection, atomic failure, restore, and complete-generation recovery with two revisions of one asset. Verify that a published page photo need not also appear in the carousel, and that draft-only and cross-site revisions cannot be obtained anonymously. Check signing/storage outages fail safely.

Test the editor status on initial load, save, publish, failure, refresh, rapid page navigation, shared pending changes, and expired preview-link renewal. Status tests must distinguish unsaved input from a saved draft and confirm that Save draft never publishes. Check desktop and narrow mobile layouts, both site locales, and the actual Next image path after simulated preview expiry.

Run focused tests, types, lint, and the release build/readiness checks. Validate a disposable local or properly isolated staging workflow; a preview connected to the production database is not disposable. If owner-session browser validation is needed, request sign-in and report its coverage accurately.

Release only the reviewed repair through the existing release worktree and confirm the production alias is Ready. Perform read-only production checks of routes, image delivery, protected headshot, and saved publication state. Do not publish a test photo or Damon's existing draft as part of these checks. Hand Damon the explicit Save draft → Publish steps after the repair is confirmed live, or state any remaining verification limitation.
