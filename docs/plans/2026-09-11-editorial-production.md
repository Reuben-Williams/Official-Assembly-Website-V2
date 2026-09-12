# Approved editorial B production release

The owner approved the B homepage and companion page previews on September 11, 2026 and requested production deployment with mobile-first verification. This document records that approved scope; it does not introduce another approval gate.

## Visual contract

- Retain the existing navy navbar, homepage hero, authentic carousel, captions, controls, alerts, and bilingual toggle.
- Below the hero, apply warm ivory surfaces, navy Georgia display headings, Public Sans body text, fine dividers, restrained corners, generous responsive spacing, and at least 44px primary interaction targets.
- Homepage: editorial portrait-led official profile; actions inside the office, biography, education, and committees cards; live news/events; prominent real newsletter signup and community invitation.
- About: official portrait and source-governed facts. Resources: clear directory and existing editable current-resource flyer. Community: authentic media and approved volunteer link. Voting: voting symbol and official county/state links. News: live posts immediately following the introduction. Contact: real intake before resource cards. Newsletter: compact title immediately followed by the real form, no photo. Events: real agenda, truthful empty/unavailable state.
- Supporting public detail, privacy, survey, and 404 pages inherit the same readable, responsive language. Administration, forms editor, and authentication retain their existing behavior and visual isolation.

## Functional contract

Keep published builder values and stable region identifiers, SSR localization, SEO/social metadata, safe official URLs, staff authorization, live published posts/events, managed form projections, consent, Turnstile, double opt-in, provider readiness and durable delivery unchanged. Do not copy preview-only form placeholders, fake events, or nonfunctional filters. Do not mutate production resident records or send test email without an explicitly scoped recipient test. No package upgrades, migrations, provider setting changes, or platform source vendoring.

## Implementation and verification

1. Add regression tests for public layout markers, contact/news ordering, portrait/symbol choices, localized content and card-owned actions. Observe failures first.
2. Implement scoped public editorial styles and limited server-component composition changes. Preserve the hero module and client interaction components.
3. Run focused and full tests, lint, type checks and production build including the existing read-only newsletter readiness guard.
4. Inspect the built site in browser at narrow mobile, tablet and desktop sizes; verify all public routes, overflow, menu/carousel, English/Spanish, form rendering and validation, resource and staff links. No synthetic production submissions.
5. Stage a production-configured deployment without assigning public domains, inspect it, then promote only after checks pass. Verify the canonical production routes and key interactions again. Preserve deployment dpl_6FmM8mV4LLHnEXgK3tTdnTEBx99A (commit 905bfb3) as rollback baseline.

## Release boundaries

Worktree: D:/Project Morales/morales-carousel-release. Existing untracked AGENTS.md/CLAUDE.md and generated next-env.d.ts changes belong to the user and are excluded. Do not alter the original checkout's unrelated changes. A provider readiness failure is a release blocker, not permission to bypass a safeguard. Report actual test/deployment evidence and any untested external email delivery honestly.
