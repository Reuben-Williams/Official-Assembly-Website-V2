# Approved release implementation plan

The user approved both written designs. Implement in the existing release
checkout, preserving unrelated changes and the staged editor repairs.

1. Add failing Press Releases tests: reserved slug, category query, bilingual
   empty/error rendering and navigable News disclosure/mobile children.
2. Implement the published-only page, existing cards and staff category hint.
   Audit all restorable post slugs before activating its static route.
3. Add failing isolated database and worker tests for team notices: immutable
   cutoff/payload, safe generic content, leased claims, stale workers, duplicate
   sends, deadline, signed receipt binding, grants and site isolation.
4. Implement a service-only ledger and RPCs alongside (not replacing) in-app
   notifications. Use the existing verified sender and domain-scoped credential;
   store fixed recipient and policy, no form payload. Keep delivery disabled.
5. Integrate recognized evidence into provider inventory, Auth SMTP exclusions
   and the verified webhook path before enabling any sends. Add bounded private
   cron and owner status counts.
6. Run focused and full tests, type checks, lint and desktop/mobile interaction
   checks. Apply the additive migration only after isolated tests pass. Verify
   production grants and schema readback. No Docker/WSL restart.
7. Stage the combined production build and pass unchanged newsletter readiness.
   Activate a persisted future-event cutoff, excluding old/test records, only
   after the combined code is ready. Promote the exact tested artifact, verify
   canonical aliases/apex redirect, public page, authorized editor and logs.
8. Do not insert fake public posts or send unsolicited mail. Report configured
   delivery separately from proven inbox arrival. Preserve a rollback deployment
   and disable-only recovery for staff notices.
