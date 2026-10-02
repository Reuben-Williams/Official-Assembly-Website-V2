# Carousel studio and site-scoped staff access

Date: 2026-10-01
Status: Independent review passed. User approved the written specification and production implementation on October 1, 2026.
Scope: The Morales website's attached Site Editor, not a redesign of the public hero.

## 1. Approved outcome

Give staff a comprehensible, attractive Visual Studio for updating the homepage hero carousel without editing code. Add the specifically authorized staff address to this site's Editor role, without owner or provider-administration powers.

The user selected **A — Visual studio**, then approved: numbered photo slots; replacement and reordering; framing; bilingual captions and accessibility descriptions; per-photo and shared effects; desktop/mobile preview; draft/review/publish; recorded revisions and restoration; editing/publishing access for Damon with ownership and sensitive provider controls remaining with the owner.

The interactive reference is the local `carousel-layouts-v2.html` in the October 1 visualization folder. Its alternative B (gallery-first) and C (guided steps) are not part of the implementation. The prototype's localStorage, sample gallery, text-only banner surrogate, and simulated review are not production behavior.

## 2. Existing integration facts

- `app/data/community-photos.ts` defines eight approved images, bilingual captions, and framing. `app/ui/CommunityCarousel.tsx` imports that collection directly and uses a seven-second interval.
- `app/ui/HomePageView.tsx` renders the carousel; `app/page.tsx` is dynamic and already reads server-published page content. Carousel content must enter that same server-rendered page flow rather than being patched into the browser after load.
- `app/admin/editor/editor-client.tsx` registers attached workspaces, supplies media choices, and uses same-origin/CSRF-protected clients. The calendar module provides a local precedent for a separately validated, versioned domain.
- `lib/builder/history.ts` aggregates domain histories. `lib/builder/recovery/` manages environment-scoped recovery generations and verified media replicas.
- Current packages are pinned to `@reuben-williams/*` 0.3.0. Do not edit installed package files. Add a site-local, isolated carousel domain and registered workspace using supported extension points. Any necessary reusable package-source change must be reviewed against its repository instructions and released/pinned deliberately; no automatic publication of a new package profile is included here.
- The prior read-only Auth lookup found no account for the requested staff address. Recheck before provisioning. Website login has `shouldCreateUser: false`, so entering an unprovisioned email alone will not create an account.
- The currently reviewed checkout is `D:/Project Morales/morales-carousel-release`. Preserve existing `next-env.d.ts`, `AGENTS.md`, and `CLAUDE.md` changes. Check remote/main and active work before implementation; do not assume the older primary checkout is the release baseline.

## 3. Visual Studio experience

Add **Carousel** under Website, deep-linked through the existing workspace navigation. Opening it must take over the main workspace, not leave a Posts/Media overlay visible. A homepage-carousel edit shortcut may navigate to this same screen; do not introduce another independent editor.

Desktop has three areas: numbered photo slots on the left, a large true-renderer preview in the middle, and settings on the right. Tablets stack settings below the list/preview as space requires. Phones use a horizontal slot chooser followed by preview and a single-column settings panel. No control requires dragging, hover, or a precise mouse gesture. Targets are at least 44px, focus is visible, labels remain readable, and the page does not overflow horizontally.

Start with exactly the existing eight slots in their current order and appearance. This release supports replacing/reordering those eight slots, not adding/removing slots. Earlier/Later buttons are mandatory; drag reordering is optional only if it has equivalent keyboard/touch behavior. Stable photo-entry identity carries captions and settings along when reordered; slot numbers indicate current order.

Selecting a slot pauses playback and opens **This photo**. **Whole carousel** holds shared defaults. Each override explicitly says either “Use carousel setting” or “Custom”; changing a default must not overwrite custom settings. The selected slot remains selected across preview/device/language changes.

### This photo

- Media-gallery selection using the attached site's real authorized library; uploads use the existing supported media-upload pipeline. Do not invent a new bucket, accept arbitrary external image URLs, or expose service credentials.
- The picker shows usable-image status. Pending/failed publication replicas cannot be published. An unavailable picker gives Retry without losing the current image or draft.
- Replacement changes only the selected slot. Clear old photo-specific captions/descriptions and flag both languages for review; do not retain descriptions of a different photo. Do not auto-translate or infer facts. Any existing reviewed bilingual asset description can be offered for explicit reuse.
- English/Spanish caption title and caption are optional as a bilingual pair (either both languages are complete or both are omitted for that field). Accessibility descriptions are required in both languages. Label required/optional fields directly. Limit titles to 100 characters, captions to 300, and accessibility descriptions to 300. Plain text only.
- Fit: **Fill the space** or **Show the entire photo**. Focal point has explicit horizontal/vertical controls from 0 to 100 and separate desktop/mobile values. Mobile initially inherits desktop; an explicit override can be reset to inheritance. Focal-point controls are disabled with a helpful explanation when full-image fit makes them ineffective.
- Transition into the selected photo: inherit, soft fade, slide across, or no animation. Image movement: still or gentle zoom (maximum 4%, only while playing; no face generation/retouching). Display duration: inherit, 5, 7, or 10 seconds.
- Navy blending: inherit or bounded top/bottom fade overrides. Keep the current navy color. Fade controls adjust blending extent rather than reducing the caption's minimum opaque backing. Bounds are top 0–75% and bottom 30–85%; the caption backing is enforced independently for readability. Existing safe-mobile framing and portrait fit must survive initial migration.
- Reset appearance affects this entry's fit/focal point/effect/timing/fade settings only. It does not replace its photo, clear its text, reorder it, or publish. Warn before discarding unsaved changes to that entry.

### Whole carousel

- Shared transition (fade/slide/none), interval (5/7/10 seconds), transition duration (350/700/1100ms), and top/bottom navy blend controls with the same bounds.
- Seed settings reproduce current rendering and timing before changes; the new feature must not silently restyle production on installation. Where current rendering has no transition, seed “none”, not the prototype's illustrative fade default.
- Preserve still-by-default playback, explicit Play/Pause, Previous/Next, image gallery, and the moving progress line. No autoplay toggle in this release. Reduced-motion preferences disable transitions/zoom/playback animation. Manual navigation remains usable. Pause on hidden tab, gallery opening, and deliberate photo selection. Progress timing follows the effective per-entry interval; transition time is included in that interval.

## 4. Content model and module boundaries

Use a versioned `CarouselDocumentV1` with schemaVersion, a stable carousel key (`home-community`), defaults, and exactly eight uniquely identified entries. Each entry has an approved media reference with immutable revision identity, en/es text, desktop framing, optional mobile framing override, and optional effect overrides. Neutral numbers/media identity are not duplicated per language. Reject unknown fields, nonfinite/out-of-range values, duplicate entry IDs, unsupported enums, unapproved media, and incorrect collection length server-side.

Keep four independent units:

1. **Contract/validation:** pure normalization, bounded controls, effective-settings resolution, role checks, bilingual validation, and deterministic diff. No I/O or UI.
2. **Repository/service:** authenticated management reads, immutable draft/publish/restore commands, optimistic concurrency, audit records, public projection, and recovery integration. No component state.
3. **Studio UI/client:** numbered selection, media picker, form state, local preview, conflict/retry messages, and deliberate save/review/publish requests. No direct privileged database access.
4. **Shared renderer:** accepts a validated published/preview projection and locale. It does not fetch drafts or import hard-coded photos as its primary source. The public page and editor preview use this renderer so crops and motion do not diverge.

Persistence uses an additive site-scoped carousel aggregate with draft/published pointers, immutable full-document revisions, lock version, command-id ledger, and audit events, following the calendar domain's repository pattern. Do not store editable carousel documents in localStorage or overload a text/image region with unvalidated JSON. A draft save stores its complete ordered collection and is an atomic command; partial slot updates cannot expose mixed-language or partially ordered publications.

## 5. Safe editing, publishing, and recovery

- Unsaved UI changes remain in memory. Save draft persists to the server and reports success only after acknowledgment. On navigation with unsaved changes offer Save/Discard/Stay. Failed save preserves input. Session expiry offers reauthentication without pretending the draft was saved; no automatic session escalation.
- Management operations derive user/site/role from the existing verified session. Every mutation verifies allowed origin, CSRF, active membership, and session generation. Reads are private/no-store. No public API may return draft or management data.
- Every write carries the expected aggregate version and an idempotency key bound to its payload digest. Different payloads using the same key fail. A stale edit returns conflict and lets staff compare/reload; never silently replace another editor's changes.
- Review shows before/after image/order/text/framing/effect differences, media readiness, and English/Spanish desktop/mobile previews of the exact candidate revision. Publish accepts the reviewed revision and expected published/aggregate versions, never an arbitrary browser-supplied replacement document. Dirty edits invalidate prior review.
- Publishing validates the entire candidate again, verifies ready image assets and recovery readiness, then atomically advances the published pointer and writes audit evidence. Preparation failures leave the current publication unchanged. Concurrent edit/publication changes reject stale activation. No success toast until the live pointer and required durable evidence are committed.
- The homepage loads one immutable published projection server-side and passes that exact projection through hydration. Drafts do not enter public caches. With the existing dynamic route, use uncached/current published reads; invalidate any introduced tagged projection cache only after successful activation. Do not briefly show checked-in originals before applying new content in an effect.
- History adds a **Carousel** source/filter plus subcategories for image replacement, captions, order, appearance, and publishing. Record actor, time, parent/result revision IDs and useful before/after values for saves, publications, and restores. Never log signed URLs, credentials, or raw auth tokens.
- Restore creates a new draft from a previous immutable revision and requires review/publish; it never deletes newer history or silently alters the public page. Revalidate retained media and current field limits on restoration. Permission checks match draft-edit vs publish roles.
- Extend recovery generations with an explicit carousel snapshot reference and its immutable media dependencies, not a parallel untracked backup. Use a versioned manifest contract that can read existing generations without carousel data. Initial rollout bootstraps a verified current eight-photo baseline once; once a carousel-aware generation exists, a missing/failed carousel read must not fall back to older checked-in photos.
- Publication preparation captures a complete generation from expected current site versions plus the candidate carousel revision. Activation rejects a generation based on stale page/global/carousel pointers. Recovery workers must retain the carousel snapshot when rebuilding unrelated content, and carousel publishing must retain all unrelated content. Preserve prior pointer/generation on failure.
- Recovery reads the newest verified published snapshot for the same site/environment. If neither primary nor verified recovery data is available, show a bounded unavailable state for the carousel while keeping the rest of the homepage usable. Do not use a draft or silently republish the baseline. Retain historical media needed for restoration; no destructive media cleanup in this release.
- During staged rollout, enable authoring/publishing only after schema, seed, media retention, history and recovery verification pass. Older deployment compatibility must be tested. Rollback disables authoring and retains data; reverting to a build that ignores newer published carousel content is not a safe content rollback.

## 6. Permission matrix

| Role | View/preview | Edit/save/restore draft | Publish |
| --- | --- | --- | --- |
| Owner | Yes | Yes | Yes |
| Editor | Yes | Yes | Yes |
| Contributor | Yes | Yes | No |
| Viewer | Yes | No | No |

Enforce this server-side as well as in the UI. These carousel permissions do not broaden any other role. Retain existing account/session revocation and site isolation. Unauthorized media references must fail even if their identifiers are guessed.

## 7. Independent operational task: Damon's access

Authorized address: `damonyoung@dtvprods.com` (case-insensitive normalization of the user-supplied address). Site: `official-assembly-website-v2`, on the verified Official Assembly Production project. Do not grant access to other sites or infrastructure accounts.

Recheck the account and membership immediately before changes. Use the supported Supabase Auth administrative provisioning/invitation flow; never hand-insert `auth.users`, set a shared password, impersonate Damon, or mark an unverified email as verified. Create/reuse the authentic user identity, bind that identity to this site's **editor** membership, and verify readback. If provisioning succeeds but membership fails, report incomplete setup and retry the exact membership step without duplicate invitations/accounts. Do not downgrade an existing higher role or replace an existing different account without reporting the discrepancy.

The normal staff magic-link flow must remain available, including correct canonical callback/return path. A single deliberate enrollment email is in scope for this authorized staff invitation; do not enroll the address in newsletters, add it to staff broadcast-test recipients, or send campaign/provider test messages. User-facing completion must distinguish provisioned membership, invitation accepted, and actual successful login. Only Damon can complete his inbox proof; do not claim his login was tested without that evidence.

Editor access covers existing website content capabilities: pages, posts, media, alerts, calendar, forms, translations and publishing/restore as supported. Existing submission-review access stays as defined by the role. Owner-only newsletter operations/provider controls, staff management, billing, infrastructure, and CRM capabilities not already granted to editors remain restricted. This implements the user's approved **website editing and publishing** boundary, not ownership or unrestricted access to every database record.

This access task is operationally independent of the carousel release. It can be completed separately once the written scope is accepted, and must have its own completion report. Do not postpone or claim it completed merely because the carousel UI is ready.

## 8. Verification and release acceptance

1. Contract tests cover all bounds/enums, unique eight-entry identity, inherited settings, bilingual completeness, media scoping, and role matrix.
2. Repository tests cover immutable revisions, expected-version conflicts, duplicate commands, stale review rejection, retry safety, tenant isolation, revoked sessions, CSRF/origin denial, and recovery preparation/activation failures.
3. Public-render tests prove a published replacement/order/caption/effect appears in initial HTML and hydration, with no draft leakage or old-image flash. English/Spanish rendering reads the same published revision.
4. Studio browser tests exercise every slot, picker success/failure, replacement text reset, reordering, per-photo overrides vs defaults, reset boundaries, both preview sizes/languages, save failure/retry, unsaved navigation, conflict recovery, publish, history and restore.
5. Recovery tests prove all eight image dependencies and bilingual metadata survive a primary-store outage and unrelated publication. Restore and rollback use retained immutable assets, not expiring private preview URLs.
6. Capture desktop/tablet/mobile screenshots including 320px width, portrait photos and long Spanish captions. Check no cropped faces from inherited regression, caption contrast, reduced motion, keyboard reorder and gallery focus management, touch target sizes, loading failures, and page overflow.
7. Run existing type/lint/unit and relevant integration checks; inspect package/deployment/migration lineage and scoped security checks. Use nonproduction test accounts for role tests. Do not create synthetic production constituents or send newsletter messages as a carousel test.
8. Stage first; verify current approved eight-photo public appearance before any content edit. Publish the approved feature, then verify canonical production navigation, public carousel, editor access boundaries, and form rendering without submitting constituent forms. Confirm the separately provisioned staff membership without using Damon's inbox/session.
9. Report exact release/deployment evidence, measured tests, remaining device/email-login limitations, and a reversible rollback plan. Never equate an emulator check, membership readback, or invitation response with real-device testing or successful recipient login.

## 9. Non-goals and review gate

No public hero/navigation redesign; no new photos or generated media; no background AI translation; no public autoplay; no new campaign/CRM/provider privileges; no newsletter/provider changes; no arbitrary external media; no generalized page builder or new package profile release.

This specification records the approved design and operational boundary. Complete independent spec review and user review of this written document before implementation planning. No production code, migrations, memberships, or deployments are changed by committing this document.
