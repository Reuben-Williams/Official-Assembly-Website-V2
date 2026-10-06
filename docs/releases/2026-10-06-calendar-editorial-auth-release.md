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

- 147 test files / 771 application tests passed on Next.js 16.3.8.
- Type checking, implementation lint, newsletter boundary checks and exact local migration checks passed.
- Ten isolated PostgreSQL accounting tests include rolling limits, delayed transaction acceptance, full receipt rejection, atomic rollback, immutable evidence and fenced recovery. These tests do not use production records or Docker/WSL.
- Next.js and its matching lint package were patched from 16.3.0 to 16.3.8 after checking official security advisories. The dependency audit no longer reports critical findings; 32 moderate and 16 high findings remain outside this narrowly scoped patch.
- Supabase advisors retain existing public-post/authenticated-operation warnings and informational RLS-without-policies notices. The new service-only tables deliberately have no public policies; no new callable privileged function is exposed.
- Docker/WSL are stopped; VmmemWSL was verified absent.

## Release gate

Staging and live promotion are pending. Use the normal, unchanged read-only production newsletter preflight. Do not disable deployment protection or assign the live domain until checks pass. Do not create a test event, submission, audience member or send a verification email.

Keep the historical evidence and audit during rollback. The former code does not understand the new delivery policy and may re-block inventory; never erase evidence or bypass readiness to simulate the former state.
