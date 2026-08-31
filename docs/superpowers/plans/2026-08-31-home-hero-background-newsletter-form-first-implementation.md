# Homepage Hero Background and Newsletter Form-First Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-30-home-hero-background-newsletter-form-first-design.md`

**Scope:** Homepage hero presentation, dedicated `/newsletter` composition, and the bounded Site Editor layout contract

**Release rule:** No production push or deployment until the settled desktop and mobile views receive explicit visual approval

## Phase 1 — Lock the regression contract

1. Update `tests/home-brand-banner.test.tsx` so it initially fails unless the approved banner:
   - remains mapped to `media.home-brand-banner` with its verified responsive sources and localized accessible text;
   - uses a non-landmark wrapper;
   - renders inside the homepage hero, before the foreground grid; and
   - no longer renders as a separate strip before the hero.
2. Add `tests/home-hero-background-styles.test.ts` with source-level assertions that the background, overlays, dark text treatment, action states, and stacking rules are scoped beneath `.home-hero`, while the generic `.hero` treatment remains available to other pages.
3. Add a small contrast utility and focused unit test only if needed to make the approved default, hover, focus-visible, and visited color pairs objectively testable. Require WCAG AA ratios from the design specification.
4. Extend `tests/newsletter-public.test.tsx` so it initially fails unless `/newsletter` has:
   - one first `form` section;
   - `newsletter.form.title` as the page's only `h1`;
   - the managed form immediately after the compact heading block;
   - no newsletter hero/supporting `ImagePanel`;
   - no duplicated form-card eyebrow or `h3`; and
   - the existing live endpoint, Turnstile, consent, privacy, and truthful unavailable behavior.
5. Add live and unavailable accessibility cases proving that the first section supplies the accessible name for exactly one `role="form"` or one `role="group"`, while the live fieldset legend still names its controls.
6. Extend `tests/builder-mapping.test.tsx` and add `tests/newsletter-layout.test.ts` so they fail until the former `newsletter.hero.*`/CTA regions are absent from the active mapping and `newsletter.sections` normalizes to `form → features → supporting → secondary`, without losing retained IDs.
7. Preserve or add a generic-page regression case proving non-newsletter `PageTemplate` routes still render their current hero and supporting images.
8. Run the focused tests and record the expected red state before implementation:

   ```powershell
   npx vitest run tests/home-brand-banner.test.tsx tests/home-hero-background-styles.test.ts tests/newsletter-public.test.tsx tests/newsletter-layout.test.ts tests/builder-mapping.test.tsx
   ```

## Phase 2 — Place the approved brand artwork behind the homepage hero

1. Change `app/ui/HomepageBrandBanner.tsx` from an unheaded `<section>` to a non-landmark media `<div>`, preserving the builder attributes, manifest enforcement, responsive AVIF/WebP sources, localized accessible text, and priority loading.
2. Move `HomepageBrandBanner` in `app/ui/HomePageView.tsx` into the existing hero before `.hero-grid`, and add the homepage-only `.home-hero` modifier. Keep the hero's stable builder item ID, section ordering, copy regions, actions, and District Office image panel unchanged.
3. Replace the document-flow banner rules in `app/globals.css` with a homepage-only positioned media layer:
   - approved navy fallback;
   - centered, undistorted artwork without `cover` cropping;
   - a uniform navy veil;
   - a stronger directional scrim behind copy;
   - foreground stacking for copy and the District Office panel; and
   - responsive mobile-source behavior with no horizontal overflow.
4. Scope white copy and primary/secondary action states entirely beneath `.home-hero`. Do not change shared hero styles or the Open Graph/Twitter image.
5. Run the homepage and generic-page tests until green before refactoring.

## Phase 3 — Introduce the bounded newsletter page view

1. Add `app/ui/NewsletterPageView.tsx` and delegate only the `newsletter` slug to it from `app/ui/PageTemplate.tsx`. Leave every other generic page on the current path.
2. Add a pure `lib/builder/newsletter-layout.ts` normalizer that:
   - pins `form` first;
   - retains configured `features`, `supporting`, and optional `secondary` once each;
   - ignores the retired `hero` item and unknown/duplicate values; and
   - supplies the stable fallback order when the region is missing or invalid.
3. Render the normalized sections in the newsletter-only view. The first section must contain, in order:
   - `newsletter.form.eyebrow`;
   - `newsletter.form.title` as the single `h1` with a stable DOM ID;
   - the optional `newsletter.form.body`; and
   - `newsletter.form` containing `ResidentForm` directly.
4. Render the retained cards and supporting explanatory content below the form without an `ImagePanel`. Omit `secondary` when it has no configured content.
5. Do not call `NewsletterSignupSection` from the dedicated page. Keep that reusable component unchanged for any other placement that still uses it.

## Phase 4 — Add the form-first presentation and accessibility contract

1. Extend `app/ui/ResidentForms.tsx` with a narrowly typed `newsletter-page-first` presentation option plus the heading ID used for `aria-labelledby`.
2. In that mode, suppress `PublicFormCard`'s duplicate eyebrow and `h3` in both ready and unavailable states while keeping the required-field guidance adjacent to the controls.
3. In the ready state, wrap the managed form once with `role="form"` and `aria-labelledby` pointing to the newsletter `h1`. Do not add a second name to the nested native form; preserve its fieldset legend.
4. In the unavailable state, use `role="group"` with the same accessible name and retain the existing announced fallback/status copy.
5. Keep contact and survey presentations unchanged, including their endpoints and headings.
6. Run the focused newsletter and form-style tests until green.

## Phase 5 — Enforce the Site Editor layout without discarding history

1. Update `builder.config.ts` to retire active `newsletter.hero.*` and newsletter hero CTA mappings while keeping `newsletter.sections`, `newsletter.form.*`, `newsletter.form`, retained card/supporting regions, and all non-newsletter mappings.
2. Compose the existing `normalizeEditableValue` hook in `app/api/builder/route.ts` so edits to `/newsletter` + `newsletter.sections` pass through the form-first normalizer after protected-brand validation. This prevents later editor reorder actions from moving the form below other content.
3. Extend publish validation so a newsletter draft cannot publish a non-normalized section order, while leaving all other paths unchanged.
4. Add a dry-run-first, idempotent migration command under `scripts/` that uses the repository's versioned content-command pathway to:
   - read the exact current newsletter draft and published version IDs;
   - show the proposed normalized `newsletter.sections` value and retired live-region keys;
   - create a new draft/version instead of updating `builder_published_pages` directly;
   - publish only with matching expected version IDs and an explicit `--apply` flag; and
   - preserve the prior published version and its history as the rollback source.
5. Add script/unit tests for no-op replay, stale-version rejection, retained-region preservation, and the absence of direct production-row mutation.
6. Do not change the Supabase schema, newsletter provider resources, credentials, subscriber data, consent, or delivery behavior.

## Phase 6 — Reconcile bilingual and editor-facing contracts

1. Update the bilingual inventory expectations so `newsletter.form.*` remains the authoritative English/Spanish heading contract and the retired hero regions are not presented as live gaps.
2. Regenerate only repository-managed localization/review artifacts using the existing deterministic scripts; do not hand-edit generated evidence.
3. Verify the editor preview can still select `media.home-brand-banner`, the newsletter first section, its three copy regions, and the managed form.
4. Confirm history shows the versioned newsletter layout transition and still exposes the prior version for review/restore.

## Phase 7 — Full automated verification

Run the focused checks first, then the repository gates:

```powershell
npx vitest run tests/home-brand-banner.test.tsx tests/home-hero-background-styles.test.ts tests/newsletter-public.test.tsx tests/newsletter-layout.test.ts tests/builder-mapping.test.tsx tests/public-form-styles.test.ts
npm test
npm run lint
npx tsc --noEmit
node --conditions=react-server --import tsx scripts/verify-brand-assets.mjs
node scripts/verify-platform-migration-checksums.mjs
node scripts/verify-production-migration-lineage.mjs
npm run build
```

If the versioned content migration has an apply mode, run its dry-run during verification. Do not use `--apply` against production until the code, diff, and visual evidence are approved.

## Phase 8 — Settled responsive and interaction review

1. Extend `scripts/verify-homepage-brand-visual.mjs` to cover 1280×800, 768×1024, and 390×844 and assert the banner is inside the hero, uses the expected responsive source, and creates no overflow.
2. Run the production build locally and capture settled screenshots at all three sizes for `/` and `/newsletter`.
3. Homepage checklist:
   - seal, `MORALES`, and `LD34` remain recognizable;
   - copy and every link state remain readable;
   - the District Office image panel stays foregrounded;
   - no crop, distortion, flash, or horizontal overflow; and
   - the banner region remains selectable in the editor preview.
4. Newsletter checklist:
   - compact title and form appear in the first viewport;
   - no photo appears;
   - no duplicate signup introduction appears;
   - fields, consent, privacy link, Turnstile, and fallback fit without overflow; and
   - keyboard and screen-reader order follow the visual order.
5. Check direct/deep routes, English/Spanish rendering, images, browser console, and network failures.
6. Present the desktop, tablet, and mobile evidence to the user and wait for explicit visual approval.

## Phase 9 — Versioned content transition and production release

1. After visual approval, inspect the exact diff and stage only the approved source, tests, deterministic artifacts, migration command, and migration evidence. Preserve `artifacts/` and `client-website-setup-operator-walkthrough.md` untouched unless separately requested.
2. Run the newsletter layout migration in dry-run mode against production and compare the reported expected version IDs with the current live state.
3. Apply the bounded versioned transition once, then confirm the new newsletter history entry and rollback source before pushing application code.
4. Commit the scoped release, push the approved branch/main flow, and wait for the Vercel deployment to settle.
5. Re-run canonical-domain smoke checks on `/`, `/newsletter`, editor preview, banner assets, and the newsletter unavailable/ready presentation without creating subscriber records or sending email.
6. Confirm the Open Graph/Twitter cover, newsletter provider resources, consent, and double-opt-in flow are unchanged.

## Stop conditions

- Stop before applying content if the production draft/published version IDs differ from the dry-run evidence.
- Stop before deployment if any approved brand asset falls outside the verified manifest.
- Stop before deployment if homepage contrast, responsive recognizability, form-first order, bilingual completeness, generic-page regressions, console/network health, or editor selectability fails.
- Stop before deployment until the user explicitly approves the settled desktop and mobile visuals.
