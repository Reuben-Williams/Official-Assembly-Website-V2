# September Meeting Action Release Design

Date: 2026-09-01

Status: Approved in conversation; independent review revision 1

Website: `official-assembly-website-v2`

Authority: `D:\Project Morales\Morales_Meeting_Action_Sheet_September_2026.pdf`

## 1. Objective

Deliver the approved September 2026 meeting actions as one coordinated public production launch, while preserving the existing live newsletter, forms, leads, customers, private Site Editor, bilingual publishing, official branding, and government-content safeguards.

The release adds a public and editor-managed events calendar, updates the education presentation, removes the birth field, makes the featured resource flyer replaceable, promotes the approved volunteer form, routes voting visitors to official Essex County Clerk resources, and refreshes supporting photography from approved professional albums.

The same tested release candidate is promoted once to production. No action-sheet item is released publicly ahead of the coordinated launch. Production is considered complete only after the settled deployment passes the post-launch verification in this specification.

## 2. Content authority and approved decisions

The September Meeting Action Sheet replaces the previously supplied Website Project Brief as the meeting reference for this release. It is an internal action list, not blanket authorization to publish incomplete event notes or infer public facts.

Approved decisions:

- Present the education wording exactly as `EDS / EDD` and remove the birth field entirely. Do not add a school, completion status, date, or degree expansion that the action sheet does not state.
- Retain the existing onsite newsletter and its current double-opt-in flow as the only newsletter signup system.
- Omit an external Fireside newsletter link because no verified destination exists. Do not display a placeholder, disabled control, or "coming soon" link.
- Add an editor-managed event calendar, but publish no initial meeting-sheet event. The September entries lack the complete public, hosted-by-office, location, and approval evidence required by this design.
- Show a truthful, accessible empty state until staff publishes a complete event.
- Use the approved public Google volunteer form as the Community volunteer destination:
  `https://docs.google.com/forms/d/e/1FAIpQLSe5hM4Idlwm4bJC55AL-Q9xlyK59bm4yiTOmaG31YbeekYhyw/viewform`.
- Use the official Essex County Clerk website as the primary local voting authority. Preserve clearly labeled State of New Jersey election resources as secondary statewide destinations.
- Use only locally stored, approved professional photographs. Do not hotlink Google Photos or expose personal query parameters, opaque share identifiers, or album-internal asset URLs in public code or evidence.
- Preserve the existing homepage Morales LD34 brand art, social-sharing image, visual system, and public navigation density.

## 3. Chosen architecture

### 3.1 Editor-native integration

Use a site-scoped calendar domain and a locally registered `website.calendar` workspace inside the existing `AttachedSiteEditor` shell. This follows the current registration pattern used by Alerts, Bilingual Readiness, Submissions, and Growth workspaces without requiring a new platform-package release.

The calendar is not modeled as Posts. Events have different validation, time, expiration, location, publication, and homepage-query semantics. Posts remain news content and cannot silently become the source of event data.

The calendar implementation is divided into independently testable units:

- `lib/calendar/contract`: canonical event input/output types, normalization, publication rules, and public-safe projections;
- `lib/calendar/repository`: server-side read/write interface scoped by `siteId`;
- Supabase adapter and additive migration: durable storage, constraints, authorization, and audit writes;
- protected builder calendar API: authenticated, CSRF-protected CRUD and status transitions;
- editor calendar client/workspace: form presentation, validation feedback, preview, publish, unpublish, and archive controls;
- public event query: published, office-hosted, date-eligible records only;
- public calendar components: homepage summary, `/events` agenda, empty state, and unavailable state.

### 3.2 Existing editor integration

Register `website.calendar` in the local editor `BuilderShellRegistration`, the server-side workspace allowlist, and deep-link handling. Assign it to the Website group and use an appropriate calendar icon.

The workspace must preserve the current editor authentication, `owner | editor | contributor | viewer` roles, CSRF token flow, and session-revocation behavior. Viewers may read calendar records. Contributors may create and edit drafts. Editors and owners may publish, unpublish, and archive. No role may bypass validation.

The workspace exposes three explicit lists: Drafts, Published, and Archived. Each event entity appears in exactly one primary list:

- Archived contains every entity whose lifecycle state is archived, regardless of retained revision pointers.
- Published contains every active entity with a published revision pointer. When its draft pointer references a different revision, the row shows an `Unpublished changes` badge and opens the pending draft for editing while continuing to identify the live revision.
- Drafts contains every active entity without a published revision pointer.

Expired published events remain in Published with a visible `Past` status; they are not mixed into the public upcoming query. This single-list rule prevents duplicate rows and prevents pending work on a published event from being hidden.

## 4. Calendar data and behavior

### 4.1 Event record

Use an additive, site-scoped calendar table compatible with the deployed schema after lineage verification. If the existing `builder_calendar_items` table is present and contract-compatible, extend it additively; otherwise add a bounded site-specific table. Never drop, rename, or reinterpret a production column in this release.

The storage contract separates a stable event entity from immutable revisions. The event entity includes:

- immutable event ID;
- `site_id`;
- lifecycle state `active | archived`;
- optional draft revision pointer;
- optional published revision pointer;
- creator/updater identity;
- created, updated, published, and archived timestamps; and
- monotonic command version used for optimistic concurrency.

Each immutable event revision includes:

- immutable revision ID and parent revision ID;
- event ID and `site_id`;
- English title and Spanish title;
- English description and Spanish description;
- start timestamp;
- optional end timestamp;
- fixed display timezone `America/New_York`;
- location name;
- location address;
- optional safe HTTPS information or registration URL;
- English and Spanish link labels when a URL exists;
- optional managed-media asset reference;
- explicit `public_approved` confirmation;
- explicit `hosted_by_office` confirmation;
- author identity and creation timestamp.

An end timestamp must be later than its start. The public projection never returns member IDs, draft content, internal notes, or revision metadata.

### 4.2 Publication rules

Publishing is rejected unless:

- the draft revision separately confirms `public_approved = true` and `hosted_by_office = true`;
- English and Spanish titles and descriptions are present;
- start date/time, location name, and location address are present;
- the end date/time, when supplied, is valid;
- any external URL is HTTPS and passes the canonical public-link contract in Section 7.1;
- both link labels are present when a URL is supplied;
- any selected media asset is ready and belongs to this site;
- the actor has editor or owner permission; and
- the submitted version matches the current stored version.

Proper names and addresses may be identical in both locales. The system must not invent translations; staff explicitly supplies or approves each translatable value.

All status changes use explicit commands with these transitions:

- `create_draft`: creates an active event and its first draft revision;
- `save_draft`: appends an immutable draft revision and advances the draft pointer. When an event is already published, the existing published pointer remains unchanged until a later publish;
- `publish`: validates the current draft and atomically advances the published pointer to it. The draft pointer may continue to reference that revision until another draft edit is saved;
- `unpublish`: clears the published pointer, preserves every revision, and leaves the event active as a draft;
- `archive`: clears the published pointer and changes an active draft or published event to archived;
- `restore_to_draft`: changes an archived event to active with its latest revision as the draft pointer and no published pointer.

Only `create_draft` and `save_draft` append content revisions. `publish`, `unpublish`, `archive`, and `restore_to_draft` change entity pointers or lifecycle state without cloning unchanged content. Every command still appends a normalized History event.

Only editors and owners may publish, unpublish, archive, or restore. Contributors may create and save drafts. Viewers are read-only. Archived events cannot be edited until restored. There is no hard-delete command.

Draft revisions never appear publicly. A public event is eligible only when its entity is active, it has a published revision, that revision has both approval confirmations, and its computed `effective_end` is strictly later than the query instant. `effective_end` is the supplied end timestamp or, when no end exists, the end of the start date in `America/New_York`. This keeps a no-end event visible throughout its local event day and removes it immediately after that day.

Public queries include both future and currently occurring events. They sort deterministically by start timestamp ascending and event ID ascending. Past events remain visible to authorized staff and in History. Archiving removes an event from public queries without deleting its revisions or audit trail.

### 4.3 Public calendar

Add `/events` as a public, editor-listed page. It uses an accessible chronological agenda rather than a dense month grid. This is the canonical public events view on desktop and mobile.

The homepage adds an `Upcoming Community Events` section after Latest News & Updates and before the final guidance section. It shows at most the next three eligible events and links to `/events`.

Each public event exposes date, time, location, description, optional managed image, and optional official action link. Machine-readable `<time>` values use valid ISO timestamps. Visible dates and times use the selected English or Spanish locale and `America/New_York`.

Do not add Events to the primary navbar in this release. Link to it from the homepage calendar, Community, News, and the Site Editor Pages list.

Render distinct states:

- empty: no upcoming public events, with a neutral message and district-office/news path;
- unavailable: the event service could not be read, with a truthful temporary-unavailability message;
- populated: eligible future and currently occurring events only.

An unavailable read must never be converted to the empty state. Public event content is server-rendered so visitors do not see checked-in or stale event content flash before the authoritative read resolves. Homepage and `/events` calendar reads use the existing dynamic server-rendering posture and an explicit no-store repository read; publication never depends on a static build or delayed client hydration.

## 5. Page-by-page changes

### 5.1 Homepage

- Preserve the current hero background treatment, official banner, calls to action, District Office image panel, newsletter connection card, and News & Updates behavior.
- Add the calendar summary at the approved position after Latest News & Updates.
- Register stable regions for the section eyebrow, title, empty-state copy, unavailable-state copy, and section-level ordering.
- Keep event records themselves in the calendar workspace rather than creating an unbounded set of static builder regions.

### 5.2 Events

- Add `/events` to `builder.config.ts` and the editor Pages accordion.
- Give the page one clear `h1`, a concise explanation, the upcoming agenda, and the same empty/unavailable distinction as the homepage.
- Do not expose archived or past events publicly in this release.
- Do not publish meeting-sheet events merely because they appear in the internal action list.

### 5.3 Official profile

- Remove `born` from the public profile type and render path, rather than hiding only its year with CSS.
- Replace the current third education entry with the exact public string `EDS / EDD`.
- Preserve the current office, occupation, public service, legislative service, committees, and official NJ Legislature action links.
- Record in source comments and tests that the meeting action sheet is the user-approved override for these two fields even though the external NJ Legislature profile may not yet match.

### 5.4 Resources

- Add a `Current District Resource` block immediately after the page introduction.
- Use stable image region `media.current-resource-flyer` and bounded text/link regions for bilingual title, description, alternative text, and optional destination.
- Replacing the featured flyer updates the published region reference; it does not delete the prior Media revision or History evidence.
- When no current flyer is approved, show a neutral no-current-resource message rather than an outdated image.

### 5.5 Community

- Add a prominent `Community Volunteer Portal` section near the top of the page.
- State that the approved Google form opens in a new tab and is operated externally.
- Keep the existing English and Spanish volunteer explanation and external-link accessibility cue.
- Do not embed the Google form or imply its submissions are stored in the site's Submissions, Leads, or Customers workspaces.

### 5.6 Voting

Use these official Essex County Clerk destinations as primary local resources:

- election hub: `https://www.essexclerk.com/Election`;
- forms: `https://www.essexclerk.com/Forms`;
- voter registration: `https://www.essexclerk.com/Services/5`;
- vote by mail: `https://www.essexclerk.com/Services/6`;
- sample ballots: `https://www.essexclerk.com/Services/30`.

Retain official State of New Jersey registration and voter-information destinations as secondary statewide resources. Labels must distinguish County Clerk and statewide responsibilities without making legal or deadline claims copied into local content.

### 5.7 Newsletter

- Preserve the current form-first `/newsletter` layout, homepage signup, Turnstile, approved consent language, confirmation flow, Resend provider boundary, privacy link, unsubscribe behavior, and lead/customer ingestion.
- Remove or avoid any external Fireside newsletter presentation.
- Preserve the existing official Fireside `Write Your Representative` link only where it is truthfully labeled as a legislative contact form; it is not a newsletter link.

### 5.8 Photography

Select supporting photographs from approved accessible albums using the following order of priority:

1. officeholder clearly visible and in focus;
2. event or setting clearly connected to official/community work;
3. sufficient resolution for the intended desktop and mobile crop;
4. no sensitive personal information or inappropriate bystander focus;
5. no duplicate composition already used prominently on another page.

Create a new `content/approved-professional-media.json` manifest; no general professional-photo manifest currently exists. Copy each of the five selected highest-quality originals into a tracked non-public source directory at `content/media-source/professional/`, and exclude that directory from the Vercel deployment bundle. Store optimized responsive derivatives in `public/`. This makes clean-checkout checksum verification independent of the currently ignored source collections while keeping full-resolution sources off the public deployment. Every imported public derivative must have one manifest entry containing:

- stable asset ID;
- approved source collection label;
- sanitized local source path;
- acquisition date;
- SHA-256 checksum of the local source;
- public desktop and mobile derivative paths;
- intrinsic dimensions;
- intended page and region;
- English and Spanish alternative text; and
- approval state.

Candidate sources are limited to the already supplied local `asw_carmenmorales/` and `morales4assembly/` collections plus highest-quality authorized downloads from the approved accessible `Statehouse` and `2025 PR Flag Raising Belleville` shared albums. A third shared album may be used only if its files become accessible without transmitting or storing the personal email and opaque URL parameters present in the earlier share URL.

The release manifest must resolve these five bounded placements before deployment: Home supporting image, About primary image, News supporting image, Community primary image, and Resources supporting image. Statehouse imagery is preferred for Home, About, and News; Puerto Rican flag-raising/community imagery is preferred for Community and Resources. Each exact selected source file, checksum, derivative, crop, and page mapping is committed in the manifest. Tests read that committed inventory, recompute checksums, and fail on unmanifested or missing derivatives. If all five placements cannot be populated with suitable approved images, the release gate fails rather than substituting an unapproved image.

Do not record personal email parameters, opaque share tokens, or individual Google Photos delivery URLs.

Refresh supporting imagery on Home, About, Resources, News, and Community without replacing the official homepage brand art or social cover. Use meaningful locale-aware alternative text. Decorative crops use empty alternative text only when the same image conveys no additional information.

## 6. History, concurrency, and recovery

Write categorized site-level History events for runtime editor mutations:

- calendar draft creation and edits;
- event publication, unpublication, and archival;
- featured flyer replacement and restoration;
- supporting image replacement;
- volunteer and voting destination changes made through registered editor regions.

Extend the local History contract additively with source `calendar` and category `events`. The migration extends the latest `builder_history_events_v1` source/category checks and adds nullable calendar event/revision foreign keys. Extend `HISTORY_SOURCES`, `HISTORY_CATEGORIES`, query parsing, readers, filters, cursor tests, and editor labels in the same release.

Every calendar command runs as one database transaction that performs its command-specific entity/revision work and inserts one normalized History event. A failed validation, stale version, or failed History insert rolls back the entire command. The calendar History reader reads normalized rows from `builder_history_events_v1`; it does not reconstruct events from unrelated tables.

History version semantics are explicit:

- `create_draft`: source revision is null and result revision is the new draft;
- `save_draft`: source revision is the prior draft and result revision is the appended draft;
- `publish`: source revision is the prior published revision or null and result revision is the selected current draft;
- `unpublish`: source revision is the former published revision and result revision is null;
- `archive`: source and result revision both identify the latest retained content revision because the content is unchanged while lifecycle state changes; and
- `restore_to_draft`: source and result revision both identify the restored latest content revision because the content is unchanged while lifecycle state changes.

Global History marks calendar restore as unavailable with the reason that event recovery is performed through the Calendar workspace's explicit `restore_to_draft` command. This avoids teaching the existing page-only restore endpoint a second mutation protocol.

Calendar mutations use optimistic concurrency. A stale editor version receives a conflict response and must refresh before overwriting a newer record.

History records must identify the event or region, action, actor, timestamp, source/result version, and page/workspace. They must not contain user session tokens, private form responses, provider secrets, or unnecessary external asset identifiers.

The initial profile, volunteer, voting, and checked-in media changes are deployment-time code/content changes, not editor mutations. Their immutable source is the Git commit and production deployment evidence; the release does not fabricate a staff actor or insert retrospective History events. Subsequent edits through registered regions use the existing page/media History paths.

Featured media remains recoverable through existing Media revision and page History behavior. Calendar rows are archived rather than hard-deleted from the UI.

## 7. Security, accessibility, localization, and performance

### 7.1 Security

- Authenticate every calendar-management request with the existing builder session.
- Require the existing CSRF token on mutations.
- Enforce role and site scope on the server; client controls are not authorization.
- Apply row-level policies or service-role-only repository access consistent with existing builder repositories.
- Add one canonical `lib/public-links/safe-public-url.ts` contract and use it for calendar URLs and the new government/volunteer links. It accepts absolute HTTPS URLs only, rejects credentials, IP literals, non-default ports, normalized serialized URLs longer than 2,048 characters, and hosts outside a checked-in allowlist, and returns the normalized URL. The database uses the same 2,048-character maximum. The initial allowlist contains `www.essexclerk.com`, `www.nj.gov`, `www.njleg.state.nj.us`, `docs.google.com`, and the existing Morales Fireside contact host. New event-registration hosts require a reviewed code change; editor roles cannot bypass the allowlist. The application does not follow or server-fetch submitted event URLs. Public anchors use `noopener noreferrer` where a new tab is used.
- Validate normalized URLs, text lengths, timestamps, IDs, media ownership, and status transitions server-side.
- Never expose Supabase service credentials or Resend credentials to the browser.
- Do not alter unrelated provider resources or send outbound email as part of calendar operations.

### 7.2 Accessibility

- Use a single `h1` on `/events` and ordered headings thereafter.
- Use lists/articles for event agendas, semantic `<time>` elements, descriptive link text, visible keyboard focus, and sufficiently sized controls.
- Do not depend on color alone for draft/published/archived or empty/unavailable states.
- Announce editor save/publish results without stealing focus.
- Keep external-link warnings available to screen readers.
- Meet WCAG AA contrast for text, controls, focus states, status chips, and image overlays.
- Preserve reduced-motion behavior and horizontal-overflow protections.

### 7.3 Localization

- Add English/Spanish catalog coverage for all new application-owned copy.
- Render event content from the explicitly stored locale fields.
- Keep document title, metadata, empty states, unavailable states, link labels, image alternative text, calendar dates, and editor validation guidance localized.
- Add completeness tests that fail when a new public string lacks Spanish coverage.

### 7.4 Performance

- Server-render the next-three-event homepage query and the `/events` agenda.
- Query only published date-eligible records required for each view.
- Avoid shipping calendar management code to public routes.
- Optimize imported images and provide accurate responsive dimensions.
- Prevent layout shift by reserving image space and keep public event components bounded.

## 8. Database and deployment sequence

This is one public launch, not one indivisible command. Safety steps may occur before promotion without exposing partial features.

1. Confirm the working tree and preserve unrelated user-owned files.
2. Add failing tests for the approved contracts before implementation.
3. Implement the additive migration file plus repository, API, editor, page, media, localization, and History changes.
4. Reset the repository's local Supabase stack so it applies the new migration from a clean lineage, then run database and mutating lifecycle tests against those isolated fixtures.
5. Run the full local production build and isolated verification, including calendar publish/unpublish flows.
6. Build one Vercel preview release candidate from the final commit. The preview must not receive production service-role credentials. If no dedicated preview Supabase project is configured, preview verification is read-only and mutation coverage remains the tested local production build against local Supabase.
7. Verify production migration lineage against the exact tested migration set and take a secure pre-change schema/data backup or provider-supported restore point. Do not commit backups or secrets.
8. Apply the exact locally tested additive migration to production while the existing application remains compatible with both the old and extended schema.
9. Verify the production migration version, constraints, functions, and permissions. Stop without promoting code if this verification fails.
10. Promote the exact tested Vercel deployment once to production.
11. Run the production verification below against settled content and logs.
12. Report the deployment identifier, commit, migration evidence, tests, routes, and any truthfully unavailable check.

Do not deploy a code path that requires a migration not yet present. Do not remove old schema in this release.

## 9. Verification

### 9.1 Automated gates

- Calendar contract tests: normalization, timezone, end-after-start, URL safety, bilingual requirements, hosted/public confirmation, status transitions, and public projection.
- Repository tests: site isolation, published-only public queries, ongoing/future eligibility, exact cutoff behavior, end-of-local-day fallback, deterministic tie ordering, unavailable read, no-store freshness, version conflicts, and archive retention.
- API tests: authentication, CSRF, roles, validation, site scope, safe errors, and no secret/private-field leakage.
- Editor tests: registration/deep link, role-dependent controls, required/optional indicators, validation messaging, save draft, publish, unpublish, archive, History, and media selection.
- Public component tests: next-three homepage list, `/events` agenda, empty state, unavailable state, semantic time values, heading order, and locale output.
- Profile tests: no birth field or `Born:` label and exact `EDS / EDD` presentation.
- Resource tests: stable featured-flyer identity, no-current-resource fallback, replacement, and restoration behavior.
- Community tests: approved volunteer destination and explicit external-form language.
- Voting tests: official Essex County Clerk destinations and separate statewide resources.
- Newsletter regression tests: onsite form-first rendering, no external Fireside newsletter link, consent, Turnstile boundary, confirmation, and lead/customer ingestion unchanged.
- Media tests: exact committed manifest membership and five page mappings, local paths, recomputed checksums, dimensions, alternative text, and no Google Photos hotlinks or sensitive URL parameters.
- Public-link tests: HTTPS normalization, allowlisted hosts, credential/IP/port rejection, exactly 2,048 characters accepted, 2,049 characters rejected, no server fetch, and correct external-anchor attributes.
- Localization tests: English/Spanish completeness and correct document metadata.
- Run targeted Vitest suites, full `npm test`, `npm run lint`, production-readiness scripts, `npm run build`, database tests, migration checksum/lineage checks, and local E2E.

### 9.2 Preview verification

Use the reset local Supabase environment to exercise a complete event draft -> publish -> public render -> edit-while-published -> republish -> unpublish -> archive -> restore-to-draft lifecycle. Test editor flyer replacement and restoration, History atomicity, English/Spanish, authorization boundaries, URL rejection, and failure states without writing synthetic records to production. Repeat read-only rendering and routing checks on the exact Vercel preview deployment; use a dedicated preview Supabase project for remote mutation tests only when it is demonstrably isolated from production.

Review settled layouts at minimum at:

- 1440 x 900 desktop;
- 1280 x 800 desktop;
- 768 x 1024 tablet;
- 390 x 844 mobile; and
- 320 x 700 narrow mobile.

Verify keyboard navigation, focus order, landmarks, accessible names, contrast, reduced motion, image loading, direct/deep routes, network/console errors, and horizontal overflow.

### 9.3 Production verification

After promotion:

- request `/`, `/events`, `/about`, `/resources`, `/community`, `/voting`, `/newsletter`, and editor deep links directly;
- require successful HTTP responses, canonical metadata, social metadata, and required image assets;
- confirm calendar empty/unavailable semantics and that the public query returns no draft revisions;
- open the production Calendar workspace, verify authenticated read access and client-side required-field guidance, and leave without saving a record;
- verify the current featured-flyer region, Media revision evidence, and History read paths without replacing production content;
- verify English/Spanish navigation, page content, calendar states, forms, document titles, and editor-managed strings;
- verify newsletter rendering, configuration, health endpoints, and existing delivery evidence. Perform a live confirmation only when an already approved staff member intentionally submits their real address during the launch check; otherwise report live-send verification as unavailable rather than inventing an address;
- verify contact/newsletter ingestion through existing authentic production records and read-only dashboard/API evidence. Do not create synthetic production submissions, leads, or customers;
- inspect settled Vercel runtime logs and Supabase errors for first-party failures;
- repeat responsive and accessibility checks against the production domain.

No synthetic event, submission, lead, or customer record is written to production. The first public event lifecycle is completed only when staff supplies a real, fully approved event.

## 10. Rollback and failure policy

Rollback triggers include first-party 5xx responses, broken editor authentication, draft leakage, incorrect event dates/timezone, newsletter regression, form-ingestion regression, lost media, unsafe links, critical accessibility failures, or material desktop/mobile overflow.

Rollback uses Vercel's prior production deployment. Database changes remain additive and compatible with that prior deployment. Disable public calendar reads through the bounded integration or revert the application deployment; do not destructively roll back data migrations or delete History.

If a production verification step cannot be performed because an approved staff recipient, authentic existing record, provider feature, or real event is unavailable, report the check as unavailable. Do not replace it with synthetic production data or claim success.

## 11. Out of scope

- Publishing the incomplete September 20, September 23, September 30, or panel notes as public events.
- Creating or guessing a Fireside newsletter URL.
- Replacing the onsite newsletter provider or consent model.
- Embedding the external Google volunteer form or ingesting its responses into this site's database.
- Adding Events to the primary navbar.
- Adding event registration, ticketing, payments, attendance, reminders, calendar-provider synchronization, recurring-event rules, or map-provider embeds.
- Expanding `EDS / EDD` or claiming degree completion beyond the approved wording.
- Releasing a shared Site Editor Platform package solely for this client-specific calendar workspace.
- Deleting prior media, page versions, calendar History, form records, leads, customers, or newsletter subscribers.

## 12. Acceptance criteria

The release is accepted only when:

- all approved action-sheet website changes in this specification are present in the single production deployment;
- the public site shows no birth field and shows exact `EDS / EDD` wording;
- the calendar and `/events` page truthfully show no upcoming public events until staff publishes one;
- the editor can manage bilingual calendar drafts and enforce publication rules;
- the featured resource flyer can be replaced and restored without code deployment;
- Community prominently links the approved volunteer form;
- Voting prioritizes official Essex County Clerk resources;
- the onsite newsletter remains functional with no external Fireside newsletter link;
- refreshed photographs are locally hosted, approved, optimized, translated where required, and provenance-recorded;
- History and authorization cover every new runtime editor mutation, while the initial checked-in changes are traceable to the Git commit and deployment;
- all automated, preview, responsive, accessibility, localization, and production gates pass or are explicitly reported as unavailable under this specification; and
- the production deployment, commit, verification evidence, and rollback posture are reported to the user.
