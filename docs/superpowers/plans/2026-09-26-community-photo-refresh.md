# Approved photography implementation plan

Written spec approved by the user on September 26, 2026. Scope: five photo placements, no redesign or provider changes.

1. Update `tests/community-carousel-integrity.test.ts`, `tests/community-editorial-assets.test.ts`, and `tests/editorial-public-pages.test.tsx` for the approved new first/seventh slides and Community/Social images. Watch the scoped tests fail on current mappings. Keep stadium/backpack records and bytes pinned.
2. Extend `scripts/prepare-community-editorial-media.mjs` with five source hashes and bilingual descriptions. Import verified originals using a dedicated source-root argument, retaining the earlier collection and its approval date. Regenerate the manifest and responsive WebP files; preserve retired assets with empty public placements.
3. Update only the approved carousel records and page image mappings. Confirm all custom override and unchanged page tests remain green.
4. Run focused tests, then `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --testTimeout=15000 --hookTimeout=15000`, `npm run lint`, TypeScript without emit/incremental state, and existing brand/readiness/build checks.
5. Build a production-target deployment with domains unassigned. Use the existing external Playwright photo QA scripts (Browser plugin absent) against the protected preview at 320/768/1440 pixels, English and Spanish. Inspect new first/seventh slides and full-frame Community/Social portraits; exercise gallery and playback without submitting forms.
6. Commit only scoped files, push the verified fast-forward to main, wait for its canonical production deployment to settle, then repeat checks with fresh browser contexts. Do not promote a competing artifact during the Git-triggered deployment.
7. Report deployment identity and checks accurately. Keep previous production deployment/source as rollback references; preserve unrelated `next-env.d.ts`, AGENTS.md and CLAUDE.md work.

## Bounded visual correction

Staging screenshots at 320px showed the new walking photo's faces behind the longer Spanish caption. Add a per-photo `mobileFraming` opt-in to the two new landscape records and reserve 125px below their image area only at widths up to 600px. Keep the six retained slides and all desktop/tablet layout unchanged. Regression tests must assert that only slides 1 and 7 opt in, alongside rendered screenshot checks.

Local Windows fork-based test startup was slow; the identical suite ran using `--pool=threads`. No test assertions or timeouts were weakened. Preview-only Cloudflare error 110200 denotes an unauthorized temporary hostname; preserve this evidence separately from application errors and verify the canonical hostname after launch. Do not alter CAPTCHA settings.
