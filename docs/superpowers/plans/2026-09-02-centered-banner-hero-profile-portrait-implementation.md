# Centered Banner Hero and Official Profile Portrait Implementation Plan

Date: 2026-09-02

Design authority: `docs/superpowers/specs/2026-09-02-centered-banner-hero-profile-portrait-design.md`

Release target: `main` → Vercel production

Rollback point: commit `935f0c0364959692ac4d8eb106281b73e417f64a`, deployment `dpl_2EnbLR1wLYUWkmrbAr18C7acKvBM`

## 1. Establish the red tests

Update the homepage, brand-asset, professional-media, builder-mapping, localization, and protected-value tests before editing production code.

The failing assertions must prove:

- the hero renders editable copy, the protected banner, then the action dock;
- no District Office image remains in the hero;
- four actions render and Volunteer uses the immutable canonical external URL;
- the official profile immediately follows the hero, with statistics after the complete profile;
- the approved single-person portrait follows the identity band through a unique homepage region/instance;
- banner sources are 2580×804 and 1920×598 and use digest cache tokens in rendered URLs;
- the professional-media manifest records both uses of the reused portrait;
- invalid Volunteer destinations and homepage portrait selections normalize safely for save/publish/restore; and
- new visible strings have English/Spanish coverage.

Run the targeted tests and retain the expected failure output.

## 2. Produce fidelity-safe banner derivatives

Attempt the requested Higgsfield MCP capability only if a callable deterministic sandbox/media surface is present. Do not use image generation for the official seal, wordmark, or embedded copy.

If the MCP surface is unavailable, use the checked-in Sharp dependency to produce deterministic 2× AVIF/WebP derivatives in place from the currently approved same-format sources. Keep the existing filenames, set ID, picker path, aspect ratio, and source identity.

Then:

- measure output dimensions;
- calculate SHA-256 digests;
- update `lib/brand/approved-assets.ts`;
- append digest-derived query tokens only when rendering public `src`/`srcSet` values; and
- run `scripts/verify-brand-assets.mjs`.

Do not stage temporary or source-analysis output.

## 3. Protect the new editor contracts

Add bounded helpers for:

- `home.hero.volunteer-cta`: label-editable, destination locked to `districtConnections.volunteer.href`;
- `media.professional.home-official-portrait`: only the approved single-person portrait may be selected; and
- snapshot validation for save, publish, and restore.

Compose these helpers with the existing protected-brand and newsletter normalization hooks in `app/api/builder/route.ts`.

Update `builder.config.ts` so the Volunteer link and homepage portrait are visible to the Site Editor with durable semantic IDs.

## 4. Implement the homepage composition

In `HomePageView`:

- remove the hero `ImagePanel`;
- render a centered introduction, flow-positioned `HomepageBrandBanner`, and four-action dock;
- keep Contact, News, and Newsletter region IDs unchanged;
- add the protected Volunteer region/label;
- render `OfficialProfileSection` immediately after the hero; and
- move the unchanged statistics band after the official profile.

In `HomepageBrandBanner`, preserve the manifest-controlled responsive picture, builder attributes, locale-aware alt text, and priority loading while switching from background-layer behavior to document flow and adding digest cache tokens.

In `OfficialProfileSection`, render the new homepage portrait region directly after the identity band using the reused approved single-person derivatives and exact bilingual caption.

## 5. Implement the editorial visual system

Use a restrained civic-editorial direction:

- navy atmospheric hero;
- centered copy with strong type hierarchy;
- large uncropped banner card;
- elevated action dock with a clear primary action and external-link affordance;
- immediate light-surface transition into the official record;
- wide portrait card with reviewed focal positioning; and
- responsive one-column controls at 390px and 320px.

Preserve 44px targets, pointer cursors, keyboard focus, reduced-motion behavior, and WCAG AA contrast. Scope all hero changes to the homepage modifier so generic page heroes do not change.

## 6. Verify locally

Run in this order:

1. targeted Vitest tests;
2. `npm test`;
3. `npx tsc --noEmit`;
4. `npm run lint`;
5. `node --conditions=react-server --import tsx scripts/verify-brand-assets.mjs`;
6. professional-media tests/verification;
7. `npm run build`;
8. local Playwright/browser checks at 1280×800, 768×1024, 390×844, and 320×700; and
9. React/Next quality review of all edited TSX files.

Browser evidence must cover DOM order, current image source, decoded/natural dimensions, all four actions, English/Spanish rendering, unique editor instances, keyboard focus, no broken images, no console/runtime errors attributable to the release, and no horizontal overflow.

Do not submit the newsletter or external Volunteer form.

## 7. Release and verify production

- Confirm only scoped changes plus the already approved design/plan documents are staged.
- Commit the implementation and push `main`.
- Wait for the Vercel production deployment associated with the pushed commit.
- Verify the canonical and `www` aliases, public homepage at all four viewports, English/Spanish state, editor login redirect, image responses, four CTA destinations, HTTP 5xx absence, and fresh runtime logs.
- Use `domcontentloaded` plus bounded settling for browser checks.
- If any required live gate fails, roll the aliases back to `dpl_2EnbLR1wLYUWkmrbAr18C7acKvBM` and report the release as unsuccessful.
- Report the new commit, deployment ID/URL, test counts, visual/asset evidence, and any disclosed Higgsfield limitation only after every gate passes.
