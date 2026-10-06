# Calendar, editorial and staff delivery release

## Scope

- Google Calendar links, Apple/ICS downloads and a public subscription feed.
- Fix a public calendar containing exactly one upcoming event.
- Recoverable event deletion and restore to drafts; optional Spanish with field-level English fallback.
- Optional, consented and reviewed Spanish suggestions. No translation provider is configured or activated by this release.
- Image captions hidden by default, with an editor display toggle and retained alt text.
- Approved DSC01789 portrait and constituent-guidance photograph; remove the supporting block from About and Resources.
- Preserve the homepage volunteer photograph and the first three carousel slots; publish the reviewed eight-slot collection only after compatible code is live.
- Tracked, limited staff sign-in requests and separate immutable delivery evidence. Delivery is not login completion or newsletter consent.

## Evidence recorded before deployment

The approved exact-five historical manifest passed the metadata-only production reader and the independent database reconstruction with the same digest. All five were atomically recorded with one `staff_auth.history_reconciled` audit under `owner_approved_management_operation`. Existing owner-login proof, newsletter safeguards, provider resources and credentials were not changed. No message was sent for this repair.

The three new tables have RLS enabled, no anon/authenticated table access, and no public access to the new privileged functions. New schema and optional-Spanish migrations were applied through the authenticated management connection; local filenames match the actual migration ledger versions.

## Verification before staging

- Final rerun: 148 test files / 772 application tests passed on Next.js 16.3.8.
- Type checking, implementation lint, newsletter boundary checks and exact local migration checks passed.
- Ten isolated PostgreSQL accounting tests include rolling limits, delayed transaction acceptance, full receipt rejection, atomic rollback, immutable evidence and fenced recovery. These tests do not use production records or Docker/WSL.
- Next.js and its matching lint package were patched from 16.3.0 to 16.3.8 after checking official security advisories. The dependency audit no longer reports critical findings; 32 moderate and 16 high findings remain outside this narrowly scoped patch.
- Supabase advisors retain existing public-post/authenticated-operation warnings and informational RLS-without-policies notices. The new service-only tables deliberately have no public policies; no new callable privileged function is exposed.
- Docker/WSL are stopped; VmmemWSL was verified absent.

## Production release and live verification

- Staged deployment `dpl_EpntNVA672XCSA4vQdzp7tCPyhEi` passed the unchanged production newsletter preflight, protected-preview checks and public visual checks before promotion.
- Final deployment `dpl_FfgYT3zKzwqrbQWk3aETe7eU3meg` includes the focused Carousel Studio preview repair. Its normal build reported `newsletterPreflight: ready`, compiled successfully, and was promoted to the canonical production website.
- Live provider inventory reports all 22 policy categories satisfied. Provider activation is active, Auth SMTP proofs are complete, and the owner's dashboard review is current. Ten existing transactional deliveries are accounted for. No new email or public form submission was generated for verification.
- Carousel revision `3d81f962-8f3c-4cbd-8245-94edc80df321` was reviewed in desktop/mobile English/Spanish and published under the owner session. The editor confirmed both the live publication and its verified recovery copy. Database readback confirms draft and publication match at version 5 and the first three entries are exactly unchanged from the previous approved publication.
- The approved final five carousel slots use the Health Fair/Backpack Drive collection, with retained accessible descriptions. Slots 4, 6 and 8 use desktop vertical focus 20%, 30% and 35%, respectively, and uncropped mobile framing. The homepage volunteer image was preserved.
- A live preview issue was reproduced: focusing a control inside a transformed frame scrolled its hidden overflow by 178 pixels and clipped heads. The preview now uses non-scrollable clipping; a regression test failed before the fix and passed afterward. Live DOM readback confirms zero internal scroll and `overflow: clip` after selecting a slide.
- Public checks covered English/Spanish desktop and 390px mobile layouts for Home, About, Resources, Events, Contact and Newsletter. No horizontal overflow was observed. The About and homepage portrait use DSC01789; the constituent-guidance image uses DSC02321; removed About/Resources blocks are absent. Visible photo captions are hidden by default and accessible alt text remains.
- Google event links, individual Apple/ICS downloads and the Spanish subscription feed were checked with real published events. Anonymous editor-calendar access is denied. Exactly-one-event rendering is covered by focused automated tests; production currently has two upcoming events, so no fake event was created to force a single-event live check.
- The live calendar editor shows optional Spanish fields, deletion controls, deleted events and restore-to-drafts controls. Destructive deletion/restoration was tested in isolation, not by changing production events. Automatic translation remains truthfully unconfigured; English fallback works without it.
- Final focused lint and TypeScript checks passed. Docker/WSL remain stopped; none of the validation restarted them.

## Verification limits and rollback

Browser checks used desktop/mobile-sized browser viewports, not physical devices. No unsolicited sign-in, confirmation or broadcast email was sent. No production consent, event or subscriber record was fabricated. Existing staff-authored event copy was preserved and should be reviewed by staff before circulation. This website release does not publish a new reusable platform package version.

Keep the historical evidence and audit during rollback. The former code does not understand the new delivery policy and may re-block inventory; never erase evidence or bypass readiness to simulate the former state.
