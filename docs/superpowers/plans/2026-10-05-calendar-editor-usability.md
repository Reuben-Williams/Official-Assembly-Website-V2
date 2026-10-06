# Calendar editor implementation plan

The writing-plans skill is not available in this session; this focused plan follows the approved design directly.

1. Add failing tests for English-only publication, whitespace/partial fallback, safe deletion confirmation/restore, and optional translation readiness/review.
2. Add a shared field-language resolver; use it in public cards, staff preview, Google event links, and ICS output. Relax only Spanish publish requirements in TypeScript and the existing SQL predicate.
3. Expose existing archive/restore commands through recoverable Delete event / Deleted events controls. Prevent deletion of unsaved changes; use a keyboard-accessible confirmation dialog.
4. Add an optional server-only Google Cloud Translation adapter, auth/origin/CSRF checked suggestion endpoint, bounded input/output/timeouts, and a separate consent/review/apply component with stale-form protection. Disabled provider remains truthfully unavailable.
5. Add the independent-audit regression joining the one-event repository response to loader and home/agenda renderers. Remove the specifically requested photo/trust section from About and Resources with a regression test.
6. Run focused and full application tests, type/lint checks, verify migration lineage, and apply only the additive/backward-compatible predicate migration. Do not restart WSL/Docker or create production events.
7. Stage Vercel without live-domain assignment, verify newsletter readiness, calendar/download and responsive UI. Promote only after passing. Publish the backed-up eight-slide carousel draft with captions off; verify production and record release evidence.

## October 6 checkpoint

- Implemented calendar links/feed, the single-event array fix, recoverable deletion, optional Spanish with field-specific English fallback, and a consent/review/apply translation UI. Automatic translation remains unconfigured.
- Added the approved DSC01789 portrait to About and the homepage, replaced the Constituent guidance image with DSC02321, and retained the volunteer image. Removed the requested About/Resources supporting section. Global photo captions default to hidden and follow the published Carousel Studio toggle.
- Full application suite: 140 files, 720 tests passed. Type checking and focused implementation lint passed. No Docker/WSL restart or production event creation/deletion was used for testing.
- Caption-visibility migration is applied. Optional-Spanish predicate migration remains pending. The saved eight-slide carousel draft is not published.
- Production staging is blocked by the existing newsletter readiness guard, specifically `transactional_emails:unmapped_email_history`. Owner-login evidence has matched sent and delivered receipts; provider email metadata still needs read-only inspection. Resend sign-in is required. Do not bypass the guard or claim this release is live.
- Separately, the requested Damon membership upgrade is verified live as owner, session generation 2, with a membership-role-change audit. A fresh sign-in is required; this does not depend on deployment.

### Read-only email-history diagnosis

Resend metadata and the inventory evidence repository confirm five currently unmapped authentication deliveries. Each has exactly one matched `email.sent` and one matched `email.delivered` receipt in `resend-team-production`, with no broadcast ID:

- Damon sign-in: `01a10f46-0578-7ea0-bb40-9b0a67302246`.
- Damon sign-in: `01a10f42-92f2-7c6a-92d7-af4105f4f749`.
- Damon sign-in: `01a10466-178c-721d-8b68-48cc14ca8238`.
- Damon email confirmation: `01a0fb38-5f40-755d-ada4-e820dd4fc50b`.
- Existing owner sign-in: `01a0fb38-b3bc-7d96-9065-8fe8ef2a7b9e`.

The sender is the configured Morales `no-reply` mailbox. Both recipients have existing, confirmed Supabase accounts and site-owner membership today. Delivery does not prove that any specific link was redeemed. The callback queues the owner-login evidence workflow, whose role/subject/occurrence checks do not account for ordinary non-owner sign-ins, signup confirmation, or unredeemed sign-in requests. Existing completed owner evidence remains valid. Do not manufacture owner-login occurrences or call delivery a successful login.

Next authorization needed: a narrowly scoped, audited authentication-delivery reconciliation and a durable tracking fix. This changes the evidence policy beyond the old eleven-message initial-history approval. No new reconciliation, provider setting change, outbound email, optional-Spanish migration, or deployment promotion was performed during this diagnosis.

### Authentication-delivery repair design checkpoint

The owner subsequently approved the five-message reconciliation and durable tracking repair. The focused design is committed at `docs/superpowers/specs/2026-10-06-staff-auth-delivery-evidence-design.md` (latest design commit `4e4fb40`) and passed independent spec review after clarifying interrupted sends, uncertainty, accounting retries/fencing, complete receipt revalidation and the pre-deployment management execution path. All five messages were rechecked read-only: one matched sent receipt, one matched delivered receipt and zero unexpected receipts each.

The brainstorming skill's written-spec user-review gate is pending. No authentication-delivery schema, evidence write, provider mutation or deployment promotion has occurred. After written-spec approval, create the focused implementation plan, implement with failing tests first, and resume the existing bundled release sequence without bypassing the newsletter guard.
