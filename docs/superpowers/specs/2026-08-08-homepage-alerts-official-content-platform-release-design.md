# Homepage Alerts, Official Content, and Reusable Platform Release Design

Date: 2026-08-08  
Status: Approved design; specification pending final user review  
Website: `official-assembly-website-v2`  
Platform source: `D:\Project Morales\site-editor-platform`

## 1. Objective

Deliver two coordinated releases:

1. Expand the public homepage into a source-governed District 34 service hub with a configurable moving alerts bar, verified New Jersey Legislature information, the existing live newsletter signup, the approved external volunteer form, the official legislative contact route, and the latest published site posts.
2. Reconcile the reusable editor improvements that produced the published `0.2.4` packages, add reusable alert-management capabilities, publish the reviewed dependency closure, and upgrade this website to consume that release.

The public website is implemented and verified first. Reusable behavior is then extracted into a clean platform worktree. Morales-specific content and branding never enter the shared packages.

## 2. Approved decisions

- Keep the current first-party Resend newsletter system.
- Treat the Fireside write-your-representative route as an official legislative contact form, not a newsletter.
- Keep volunteer submissions in the existing Google Form. The website links to it and does not duplicate its personal data.
- Render a reviewed snapshot of official Legislature facts instead of making the public homepage depend on a live state API request.
- Let staff manage alert messages manually, with optional scheduling and links.
- Provide Pause, Previous, and Next alert controls; do not provide a dismiss control.
- Retain approved local site imagery. Do not copy external profile imagery.
- Extract reusable alert contracts, storage, and owner controls into the shared platform; retain the branded public alert renderer in this website.
- Use a clean worktree for platform reconciliation because the existing `main` checkout is behind `origin/main` and contains unrelated modifications.
- Do not create synthetic contact, newsletter, legislative-contact, or volunteer submissions during verification.

## 3. Authoritative sources and content governance

### 3.1 New Jersey Legislature

Canonical public page:

`https://www.njleg.state.nj.us/legislative-roster/491/assemblywoman-morales`

The page loads its roster information from the Legislature endpoint:

`https://www.njleg.state.nj.us/api/legislatorData/legislatorBio/491`

Snapshot verified on 2026-08-08:

- Name: Carmen Theresa Morales
- Legislative title: Assemblywoman
- Party label from source: D
- Legislative position: Deputy Whip
- District: 34
- District office: 152 Franklin Street, Belleville, NJ 07109
- Phone: (973) 450-0484
- Fax: (973) 450-0487
- Education:
  - B.A. Montclair State University (Speech Communications)
  - M.A.S. Fairleigh Dickinson University (Administration)
  - Ed.S., Completed Doctoral Studies ABD Seton Hall University (Education, Leadership, Management and Policy)
- Occupation: Director of Curriculum and Instruction, Essex County Schools of Technology
- Public service: Essex County College Trustee 2017-2023
- Legislative service: General Assembly 2024-present, Deputy Majority Whip 2026-present
- Committees:
  - Higher Education (AHI), Chair
  - Appropriations (AAP)
  - Science, Innovation and Technology (AST)
  - Joint Committee on the Public Schools (JPS)
- Official contact route returned by the roster source:
  `https://nj-34-assembly-morales.web.fireside21.app/forms/writeyourrep/?to=Assemblywoman%20Carmen%20Theresa%20Morales`
- Official member-vote routes:
  - By bill: `https://www.njleg.state.nj.us/legislative-roster/491/assemblywoman-morales/votes-by-bill`
  - By subject: `https://www.njleg.state.nj.us/legislative-roster/491/assemblywoman-morales/votes-by-subject`
- Sponsored bills: the state site does not expose a stable sponsor-filtered URL. The `Sponsored Bills` action therefore opens the canonical profile, whose client interface provides the sponsor-specific list. It must not link to an invented query string.

The homepage may display only approved fields from this snapshot. It must not infer policy positions, accomplishments, district services, or biographical claims not present in the official source. The visible section includes the source link and the verification date.

Ordinary editor access may change the section framing, ordering, and visibility, but not the authoritative fact values. A fact refresh requires a reviewed source update in code/data, tests, and a new verification date.

### 3.2 Volunteer form

Canonical form:

`https://docs.google.com/forms/d/e/1FAIpQLSe5hM4Idlwm4bJC55AL-Q9xlyK59bm4yiTOmaG31YbeekYhyw/viewform`

The form is titled `Assemblywoman Morales' Community Volunteers`. Its approved bilingual summary invites residents to support outreach events and connections with faith-based and small-business communities. It collects full name, phone number, email address, address/city, and availability.

Approved source summary:

> Are you passionate about giving back to your community? I’m inviting you to join my team as a volunteer and help us make a real difference in the lives of our neighbors. From supporting outreach events, to connecting with our faith-based and small business communities, your time and energy will directly benefit the people of our district. Together, we can build stronger connections and ensure every voice is heard.

> ¿Te apasiona retribuir a tu comunidad? Te invito a unirte a mi equipo como voluntario y ayudarnos a marcar una verdadera diferencia en la vida de nuestros vecinos. Desde apoyar en eventos comunitarios hasta conectar con organizaciones religiosas y pequeñas empresas, tu tiempo y energía beneficiarán directamente a las personas de nuestro distrito. Juntos, podemos fortalecer los lazos comunitarios y asegurarnos de que cada voz sea escuchada.

The website may display the supplied summary and link to the form. It does not embed, proxy, prefill, intercept, store, or synchronize volunteer responses.

### 3.3 Newsletter and legislative contact separation

- `Newsletter` means the existing first-party managed form, confirmation email, confirmed subscription, suppression, unsubscribe, provider delivery, and operations workflow.
- `Official Legislative Contact Form` means the external Fireside route returned by the official Legislature profile.
- No UI may label the Fireside route as a newsletter signup.

## 4. Public homepage information architecture

The alerts bar is global to public pages but is gated inside `RootLayout` by a server-known pathname. A root `proxy.ts` overwrites an internal request header with `request.nextUrl.pathname`; inbound callers cannot supply the trusted value. `RootLayout` reads that header and calls the alert loader only when `isPublicAlertSurface(pathname)` returns true, then places `PublicAlertController` immediately after `AppHeader` and before `main`.

The predicate uses segment-aware prefix checks. It returns false for `/admin`, `/auth`, `/api`, `/_next`, and every descendant of those prefixes; it returns true for `/`, ordinary public pages, post detail pages, newsletter confirmation, public unknown paths, and the canonical public 404. A missing, malformed, or non-absolute pathname fails closed and loads/renders no alert. Therefore `/admin/unknown`, `/auth/unknown`, and unmatched `/api/**` responses remain alert-free even when they resolve through the root 404 boundary. The gate runs before any alert query, so non-public HTML contains neither alert markup nor serialized alert projection props.

The homepage uses the following order:

1. Existing global navbar and conditional global alerts bar
3. Hero with clear actions for district-office contact, News & Updates, and newsletter signup
4. Existing concise service/access band
5. Official NJ Legislature profile section
6. `Connect with District 34` section
7. Latest published site posts
8. Remaining constituent-service guidance, consolidated to remove repeated language

### 4.1 Official profile section

The section uses a compact, readable hierarchy rather than reproducing the state page:

- Role and district summary
- District office contact card
- Biography and service facts
- Committee list
- Official actions: profile, sponsored bills, votes, and legislative contact
- Source attribution and `Verified August 8, 2026`

The section must remain understandable on a 390 px viewport, avoid dense three-column text on mobile, and preserve link labels that identify external destinations.

### 4.2 Connect with District 34

This section contains three distinct actions:

- Newsletter: render the existing `NewsletterSignupSection` and managed form projection.
- Volunteer: render the approved summary and an external `Open volunteer form` action.
- Contact: render an `Official Legislative Contact Form` action plus district-office phone fallback.

External actions open in a new tab, use `rel="noopener noreferrer"`, and include visible or accessible new-tab wording. The newsletter remains an in-site form.

### 4.3 Latest posts

The homepage renders at most three currently published site posts using the existing published-post repository and card conventions. The query is `limit: 3`, `orderBy: "displayDate"`, `orderDirection: "desc"`, and `pinnedFirst: false`; therefore `Latest` means chronological display date rather than editorial pinning. The database query must apply `ORDER BY display_date DESC, entry_id ASC` before `LIMIT 3`; the reusable repository is corrected if necessary so deterministic tie-breaking happens in SQL, not after a bounded result has already been returned. Expired posts are excluded before ordering and limiting. The section must not invent placeholder posts. Its empty state directs visitors to the official Legislature profile and district office rather than displaying mock content.

## 5. Alerts domain and behavior

### 5.1 Versioned alert-collection model

An alert item has:

```ts
type AlertItemSnapshot = {
  id: string;
  category: "news" | "office" | "urgent" | "general";
  message: string;
  link?: { href: string; label: string };
  lifecycle: "active" | "archived";
  enabled: boolean;
  startsAt?: string;
  endsAt?: string;
};

type AlertCollectionSnapshot = {
  schemaVersion: 1;
  alerts: AlertItemSnapshot[]; // array order is display order
};
```

The storage model uses immutable collection revisions:

- `builder_alert_collections`: one site-scoped row containing `draft_revision_id`, `published_revision_id`, and a monotonically increasing `lock_version`.
- `builder_alert_collection_revisions`: immutable `revision_id`, `site_id`, `revision_number`, validated snapshot, actor, and creation time.
- `builder_alert_idempotency`: site-scoped key, request hash, stored result, and creation time.
- Alert audit events are written to the existing site audit boundary with alert-specific metadata.

Every draft mutation, including create, edit, reorder, enable/disable, schedule, and archive, submits both `expectedLockVersion` and `expectedDraftRevisionId`. One transaction verifies both values, creates a new immutable draft revision, advances `draft_revision_id`, increments `lock_version`, records idempotency/audit state, and returns the new lock version. Publication performs the same dual comparison, advances `published_revision_id` to the selected draft revision, increments `lock_version`, and appends the publication audit event. Any stale lock or draft pointer returns `409 STALE_REVISION`; concurrent draft saves and reorders therefore cannot silently overwrite one another.

Creation, edits, reordering, `enabled` changes, scheduling changes, and archive changes affect the draft collection only. They do not change public output until the collection is published. Archiving sets `lifecycle: "archived"` in the draft and becomes public only through the same publication transaction. Per-alert history is derived by stable alert ID from consecutive immutable collection revisions.

Timestamps are stored as ISO-8601 instants and interpreted for staff in `America/New_York`. An end time must be later than a start time. Message text is required and bounded. Alert IDs are immutable within a site. Link URLs must use an approved `https:`, root-relative, `tel:`, or `mailto:` scheme.

Public selection rules:

- Read only the published collection revision.
- Include only `lifecycle: "active"`, `enabled` items.
- Exclude records before `startsAt` or at/after `endsAt`.
- Preserve the array order in the published snapshot; stable ID is the deterministic identity.
- Render nothing and reserve no vertical space when the result is empty.

### 5.2 Public component

`PublicAlertController` is mounted by the public root layout on every public route. It receives a no-store server projection containing `activeAlerts`, `evaluatedAt`, and `nextTransitionAt`. `PublicAlertBar` renders the first active alert in the initial HTML so no unconfigured or stale fallback flashes during hydration. When the active list is empty, the controller remains layout-neutral and schedules a boundary refresh without reserving bar space.

The server projection loader and `GET /api/public/alerts` use `Cache-Control: no-store` and the existing server-only Supabase boundary. The server calculates `nextTransitionAt` as the earliest future start or end time in the published collection. The client schedules one refresh just after that instant, refetches the projection with `cache: "no-store"`, and reschedules from the returned boundary. Window focus and `visibilitychange` perform a catch-up refresh when a throttled timer may have missed a boundary.

If a boundary refresh fails, the client immediately filters any already-rendered alerts whose `endsAt` has passed so expired content cannot remain visible. A newly scheduled alert appears only after a successful projection refresh; it is never reconstructed from draft or checked-in placeholder data. Recovery reads use the last successfully published collection revision and run the same server/client time filtering.

Behavior:

- The bar sits immediately beneath the sticky navbar.
- It advances horizontally between alerts without cloning announcements into the accessibility tree.
- Pause, Previous, and Next controls are always available when more than one alert is present.
- Movement pauses on pointer hover, keyboard focus within the bar, page visibility loss, and Pause activation.
- `prefers-reduced-motion: reduce` disables automatic movement and keeps manual controls.
- Automatic rotation uses `aria-live="off"` and never repeatedly announces timed changes. Previous/Next actions copy the newly selected alert into a separate polite status region so manual changes are announced once.
- One alert renders statically with no unnecessary navigation controls.
- Touch targets are at least 44 by 44 CSS pixels, focus is visible, and no viewport creates horizontal page overflow.

Pause state has explicit precedence. `prefers-reduced-motion` permanently disables autoplay for the current media-query state. A visitor-activated Pause sets `userPaused` and only the visitor's Resume action clears it. Hover, focus, and document visibility are transient suspension flags; clearing a transient flag may resume autoplay only when reduced motion is false and `userPaused` is false.

### 5.3 Owner experience

The editor exposes an `Alerts` workspace rather than requiring selection inside the preview. Authorized staff can:

- Create a draft alert
- Edit category, message, link, schedule, and enabled state
- Reorder alerts
- Preview current and scheduled visibility
- Publish or archive an alert
- Review alert-specific history

Invalid records remain drafts. Publishing fails closed with field-specific errors.

Capability matrix:

- `viewer`: `alerts.read`
- `contributor`: `alerts.read`, `alerts.create`, `alerts.editDraft`
- `editor`: contributor capabilities plus `alerts.reorder`, `alerts.publish`, and `alerts.archive`
- `owner`: every alert capability through the normal owner capability expansion

Create, update, reorder, publish, and archive commands are site-scoped, idempotent, and audited. Reordering sends the complete ordered stable-ID list plus `expectedLockVersion` and `expectedDraftRevisionId`, then creates a new immutable draft revision transactionally. A replay with the same idempotency key and identical request hash returns the stored result. Reusing a key with a different request hash returns `409 IDEMPOTENCY_MISMATCH` and performs no mutation.

## 6. Storage and server boundaries

One canonical, additive platform migration defines the alert tables, indexes, RLS, functions, capability grants, and audit integration. It is authored first in the clean platform worktree with a fixed timestamped filename and checksum, then copied byte-for-byte into this website's deployable migration lineage. The website must not create a separately named site-local equivalent.

When the later package release ships, its manifest contains that same migration identity and checksum. Attachment checks treat the already-applied version as adopted and skip execution only when the recorded version and checksum match. A missing record, divergent checksum, or partially present object fails closed and requires reconciliation; `IF NOT EXISTS` is not used to conceal drift. Existing production alert data therefore remains in the same canonical tables and needs no copy or destructive cutover.

Alerts use dedicated collection repositories and commands. They do not weaken the existing post-only table constraint or reuse post-only validation.

Required boundaries:

- Browser clients have no direct table or mutation-RPC grants. `GET /api/public/alerts` is unauthenticated but returns published active projections only through the trusted server loader.
- Editor routes require the existing authenticated site session, active membership, and the exact alert capability listed above.
- Drafts, audit metadata, actor IDs, and archived records never enter public HTML.
- RLS denies anonymous table access, denies authenticated access outside the member's site, and preserves owner/editor/contributor/viewer capability differences. Cross-site reads and mutations are database-tested.
- Published changes generate content history events categorized as `alerts`.
- Each audit event records `site_id`, `actor_id`, `action`, affected stable alert IDs, `before_revision_id`, `after_revision_id`, idempotency key, human summary, and timestamp. Public projections omit these fields.
- Server-only credentials never enter client bundles.
- The last successfully published alert projection remains available through the dedicated immutable recovery artifact defined below when authoritative content storage is temporarily unavailable.

No cron is required merely to activate or expire alerts. No-store server reads plus the boundary timer and catch-up refresh make schedule transitions correct for both new requests and already-open pages.

### 6.1 Alert recovery artifact

The existing page-region recovery generation does not implicitly cover alerts. The alert capability adds a separate site-scoped immutable recovery artifact and latest pointer:

- Artifact path: `{environment}/{siteKey}/alerts/revisions/{revisionNumber}-{digest}.json`
- Artifact payload: schema version, site key, published revision ID/number, publication time, complete published alert collection snapshot, and canonical SHA-256 digest
- Latest pointer: site key, environment, published revision ID/number, artifact path, digest, and pointer update time

The alert publication transaction inserts a durable recovery-outbox job containing the site ID, published revision ID/number, and expected digest. A fenced worker reads that exact immutable revision, verifies its digest, writes the immutable artifact, and compare-and-swaps the latest pointer only when the new revision number is greater. Retries are idempotent; an older worker cannot replace a newer pointer.

The public loader reads authoritative storage first. On authoritative failure it reads the latest pointer without cache, validates environment, site key, schema version, revision identity, and artifact digest, then runs the normal schedule filter and `nextTransitionAt` calculation. If artifact production is delayed or dead-lettered, the last validated published artifact remains the fallback; newly published alerts wait for recovery catch-up, while expired alerts are still removed by time filtering. Artifact failure does not roll back a successful authoritative publication, but it creates a visible degraded-recovery operations state and retry/dead-letter record. No draft revision or checked-in alert is ever used as recovery content.

## 7. Editable and protected homepage regions

New stable homepage regions cover:

- Section ordering and visibility
- Profile-section framing text
- Connect-section framing text
- Volunteer section framing and CTA display label
- Legislative-contact section framing and CTA display label
- Latest-posts framing text and collection placement

Official fact values, the approved volunteer summary, the volunteer destination, the Fireside destination, vote destinations, sponsored-bills behavior, source link, and verification date are rendered from the protected source snapshot and are not registered as ordinary text/link regions. Changing any of them requires the reviewed source-refresh workflow and tests.

The alert collection is managed through the Alerts workspace. It is not encoded as a fixed number of generic text slots.

## 8. Newsletter invariants

This project does not replace the live newsletter system. The homepage reuses the same approved form projection and endpoints as `/news` and `/newsletter`.

The following behavior remains unchanged:

- The Turnstile widget may acquire or refresh a token independently while the form is open. On submit, native browser validation and client field validation run before the handler reads or checks that current token.
- Only after field validation passes does the handler require a valid current token; a missing or expired token produces the existing verification-needed state and no network submission.
- With a valid token, the client sends one form request. The server independently validates the payload, Turnstile token, rate limit, idempotency key, form revision, and consent before accepting the pending request.
- A request is pending until the recipient completes double opt-in.
- Confirmed contacts synchronize through the approved Resend boundary.
- Suppressions and unsubscribe remain effective.
- Existing rate-limit and idempotency controls remain in force.
- Newsletter failures cannot be reported as successful subscriptions.

Tests must demonstrate that adding the homepage instance does not duplicate a submission event, bypass verification, or alter consent wording.

## 9. Reusable package extraction

### 9.1 Baseline reconciliation

As verified on 2026-08-08, the latest GitHub Packages versions for `core`, `content`, `editor`, `forms`, `next`, `growth-leads`, `growth-customers`, `growth-dashboard`, and `cli` are `0.2.4`.

The platform branch `origin/codex/editor-production-quality` contains current `origin/main` plus the reusable editor changes for:

- Page selection activating the page workspace and preview
- Draggable quick-edit panel
- Pointer-state clarity
- Required/optional post guidance
- Managed-media selection in posts
- Successful post mutation state
- Unified complete history
- Versioned and atomic content publication
- Authoritative server content loading
- Private media import/finalization contracts

The existing local platform `main` checkout is not a safe release surface because it is behind remote main and contains unrelated changes. Create a clean worktree from the reusable branch, confirm its ancestry again, and reconcile published `0.2.4` tarballs with source before adding alert work.

### 9.2 Package boundary

- `@reuben-williams/core`: alert primitives, permissions, commands, lifecycle rules, active selection, history category, and site configuration contracts.
- `@reuben-williams/content`: alert snapshot validation, public projection, repository interfaces, ordering, and scheduling query behavior.
- `@reuben-williams/editor`: Alerts workspace, form validation, scheduling controls, reordering, lifecycle actions, responsive states, and history presentation.
- `@reuben-williams/next`: server repositories, route-handler helpers, public projection loader, cache-boundary calculation, and client/server export protection.
- `@reuben-williams/cli`: source inspection, attachment planning, migration/compatibility checks, and release verification for alert capability.
- Supabase assets: additive schema, RPC/command support, indexes, RLS, audit, and database tests.

The canonical alert migration is created in this clean platform branch before any website database application. Its timestamped identity and SHA-256 checksum are reserved in the platform migration manifest. The website receives the exact same bytes and records the same version in its Supabase migration history. The later package attachment check recognizes that identical applied version rather than generating or applying another migration.

`@reuben-williams/forms` and growth packages are unchanged unless the verified dependency closure requires version-aligned publication. The release plan must state the exact changed packages and dependency closure before publishing.

The public visual component remains site-owned. Shared packages expose behavior and owner controls without imposing Morales styling or content.

### 9.3 Publication gates

Before package publication:

- Reconcile source against the installed/published `0.2.4` artifacts.
- Run affected unit, integration, database, browser, and package-contract tests.
- Run the complete platform check required by the release tooling.
- Run package packing and clean-client attachment rehearsal.
- Confirm no token or credential is present in a tarball, repository diff, log, or generated documentation.
- Publish only after the release version and package list are explicitly approved.
- Verify each published package resolves from GitHub Packages and can be installed by a clean client.
- Upgrade this website from exact package versions, rebuild it, and rerun website regressions.

The platform work is pushed to a reviewable branch and pull request. It does not overwrite `main` directly.

## 10. Failure handling

- Invalid or unsafe alerts cannot publish and never enter public projections.
- A storage read failure uses the approved published-content recovery boundary; it does not silently substitute synthetic alerts.
- An empty active-alert result produces no bar.
- External form unavailability does not block homepage rendering; district office contact remains visible.
- A missing official profile snapshot fails build/tests rather than falling back to invented biography.
- A failed newsletter request remains a truthful error and cannot be mistaken for confirmation.
- Package reconciliation stops on source/artifact drift until the difference is explained and tested.
- Release tooling stops on failed tests, missing migration checks, secret findings, package-authentication failures, or an unexpected dependency closure.

## 11. Verification

### 11.1 Website automated coverage

- Authoritative source snapshot and source-attribution contract
- Protected-fact exclusion from ordinary editable regions
- Server-known pathname-gate coverage for public pages and public 404s, segment-aware admin/auth/API exclusions including unknown descendants, inbound-header overwrite, and missing-header fail-closed behavior
- Homepage section ordering and responsive markup
- Official profile, official contact, volunteer, newsletter, and latest-post rendering
- Deterministic latest-post SQL ordering before limit, expiry filtering, and no placeholder posts when the published collection is empty
- Alert schema, safe URL rules, deterministic ordering, schedule boundaries, and time-zone presentation
- Immutable draft/published collection revisions, atomic pointer publication, stale-version rejection, collection-level reorder concurrency, and idempotency mismatch behavior
- Role/capability matrix, anonymous table denial, cross-site RLS denial, and omission of draft/audit fields from public projections
- Canonical migration checksum adoption and failure on divergent or partially applied schema state
- Alert recovery outbox, immutable artifact digest/identity validation, fenced latest-pointer advancement, lag fallback, retry, and dead-letter behavior
- Server-rendered initial alert and no stale checked-in fallback flash
- No-store projection reads, next-boundary refresh, missed-timer catch-up, expired-alert removal after refresh failure, and future-alert activation after recovery
- Non-live automatic rotation, polite manual announcements, explicit Pause precedence, Previous, Next, focus suspension, visibility suspension, reduced motion, and single-alert behavior
- Editor authorization, validation, concurrency, idempotency, lifecycle, reordering, and audit history
- Newsletter form reuse with field validation before token inspection, no request without a current token, and no consent, server Turnstile, rate-limit, or idempotency regressions
- External link security and accessible new-tab labels

### 11.2 Browser coverage

Verify desktop and true 390 px mobile behavior for:

- Homepage with zero, one, and multiple active alerts
- Long alert copy and long external link labels
- Reduced-motion mode
- Keyboard-only navigation and focus order
- Homepage newsletter form without submitting synthetic data
- Official profile and Connect sections
- Latest-post empty and populated states using controlled test data outside production
- No horizontal overflow, hidden controls, console errors, failed first-party requests, or broken images

### 11.3 Full regressions

Run the website's full tests, source lint, production build, and deployment preflight. Recheck editor Pages navigation, Posts, Media, Forms, History, Submissions, Overview, Leads, Customers, the 404 editor page, Contact, `/news`, `/newsletter`, and newsletter confirmation routes.

Run the platform's unit, type, database, browser, package release, package rehearsal, compatibility, and secret gates in proportion to the changed dependency closure.

## 12. Rollout

1. Create a clean platform worktree and reconcile the reusable editor branch with `0.2.4` source/artifacts.
2. Author the canonical alert schema migration, reserve its identity/checksum, and copy it byte-for-byte into the website migration lineage. Do not publish packages yet.
3. Implement the website feature behind tests using the canonical schema contract.
4. Apply the canonical migration in a verified website environment.
5. Deploy a protected preview.
6. Complete desktop and mobile visual review.
7. Promote the exact reviewed website deployment to production.
8. Verify live homepage, alert states, official links, external form links, and the newsletter renderer without creating synthetic submissions.
9. Complete the reusable package extraction and run platform/package gates.
10. Obtain explicit release-version/package-list approval.
11. Publish and verify the package release.
12. Upgrade the website to the new exact package versions, deploy a preview, and rerun regressions.
13. Promote the package-backed website deployment after review.

## 13. Non-goals

- Scraping the Legislature page on every public request
- Copying or hosting the Legislature's profile image
- Recreating or proxying the Google volunteer form
- Treating Fireside as a newsletter provider
- Replacing the current Resend newsletter lifecycle
- Importing historical Legislature data, bills, votes, or committee schedules into local storage
- Automatically converting every published post into an alert
- Dismissible alerts or uncontrolled auto-scrolling text
- Synthetic production submissions
- Direct mutation of the dirty platform checkout or direct overwrite of platform `main`
- Adding unrelated bookings, messaging, campaigns, AI, or provider features to this release

## 14. Acceptance criteria

The work is complete only when:

- Staff can create, edit, schedule, order, publish, archive, and audit alerts through the editor.
- The public bar is conditional, accessible, responsive, source-correct, and free of stale first-paint content.
- The homepage includes the approved official profile, newsletter, volunteer, legislative-contact, and latest-post sections without unsupported claims or placeholder records.
- Newsletter behavior is unchanged and remains fully operational.
- Official and external links point to the reviewed canonical destinations.
- Desktop/mobile browser QA and full website tests/build pass.
- The reusable editor improvements and alert capability exist on a reviewable current platform branch.
- The exact package dependency closure passes platform, database, package, clean-install, and secret gates.
- The published release installs successfully and this website passes again while consuming it.
- No unrelated local files or changes are overwritten, committed, or published.
