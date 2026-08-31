# Homepage Hero Background and Newsletter Form-First Design

Date: 2026-08-30

Status: Approved in conversation; independent review revision 1

Website: `official-assembly-website-v2`

## 1. Objective

Make the approved Assemblywoman Carmen T. Morales LD34 banner the background of the homepage section headed “District 34 Constituent Services and Community Updates,” while keeping the artwork clearly recognizable and all foreground text highly readable.

Make the dedicated newsletter page immediately useful by removing its photography and placing a compact page title directly above the live newsletter form in the first section visitors encounter.

These are presentation changes only. They do not alter the approved banner asset provenance, the Site Editor image-region contract, newsletter consent language, double opt-in behavior, provider configuration, or social-sharing image.

## 2. Approved decisions

### Homepage

- Remove the separate full-width banner strip above the homepage hero.
- Render the same approved responsive banner set as a full-section background layer inside the existing homepage hero.
- Keep the artwork clearly recognizable, not a faint watermark.
- Preserve maximum text readability with a navy veil across the artwork and a stronger directional scrim behind the copy.
- Keep the existing District Office image panel in the foreground.
- Preserve the existing hero eyebrow, title, body, links, section ID, ordering behavior, editor regions, and English/Spanish content.
- Keep `media.home-brand-banner` editable through the private Site Editor and continue resolving it only through the verified approved-brand manifest.
- Do not change the Open Graph or Twitter/X social cover.

### Newsletter page

- Do not render a hero photo or supporting photo on `/newsletter`.
- Use a dedicated compact first section containing the existing editable newsletter eyebrow/title/body treatment, followed immediately by the live newsletter form.
- The title remains first for document hierarchy and orientation; the form is the first substantive interactive content.
- Keep the form’s existing Turnstile verification, approved consent wording, confirmation guidance, privacy link, translations, unavailable fallback, and submission endpoint.
- Move secondary newsletter resources and explanatory content below the form.
- Do not change the layout of other `PageTemplate` routes.

## 3. Homepage architecture

### 3.1 Component placement

`HomepageBrandBanner` moves from before `home.sections` into the existing hero, before the foreground `.hero-grid`. The hero remains the first item of the reorderable `home.sections` collection. The banner component changes its current unheaded `<section>` root to a non-landmark positioned `<div>` so the implementation does not nest one sectioning landmark inside another without a heading. The non-landmark wrapper retains:

- `data-builder-region="media.home-brand-banner"`;
- `data-builder-kind="image"`;
- the verified responsive AVIF/WebP source set;
- the current locale-aware accessible text;
- the representative editor picker path and approved fallback behavior; and
- priority loading because it remains above the fold.

The component becomes a positioned media layer rather than a document-flow strip. Its wrapper and picture fill the hero, sit below foreground content, ignore public pointer input, and remain selectable through the editor’s registered region mapping. The responsive image keeps its locale-aware accessible text; the wrapper does not add a second landmark or accessible name.

### 3.2 Artwork treatment

The hero uses the existing approved navy as its fallback background. The responsive image is centered near the top and scaled without distorting the seal or wordmark. The implementation must avoid a `cover` crop that removes the seal, the `MORALES` wordmark, or `LD34`; unused vertical space may remain navy.

Two non-destructive overlay layers protect readability:

1. a moderate uniform navy veil preserves the artwork as a recognizable background rather than a competing foreground graphic; and
2. a stronger left-to-right gradient sits behind the primary copy and controls, easing toward the artwork-facing side.

The homepage hero receives a dedicated modifier such as `.home-hero`. Overlay, white text, eyebrow, lead, primary-link, and secondary-link rules are scoped beneath that modifier. Shared `.hero`, `.eyebrow`, `.lead`, `.cta-link`, and `.secondary-link` defaults remain unchanged so generic `PageTemplate` routes retain their current light treatment. Primary and secondary homepage actions must meet WCAG AA contrast in default, hover, focus, and visited states. The existing District Office image panel remains opaque and above the background layer.

### 3.3 Responsive behavior

- Desktop and tablet use the approved desktop derivative; the full brand composition must remain recognizable at the settled review viewport.
- At the existing brand-art breakpoint, mobile uses the approved mobile derivative.
- Mobile content stacks in the current order, with the scrim strengthened as needed behind copy and controls.
- The image remains undistorted and does not create horizontal scrolling.
- Reduced-motion behavior is unchanged because the hero background is static.

## 4. Newsletter page architecture

### 4.1 Dedicated rendering branch

`PageTemplate` retains the generic route rendering for all non-newsletter pages. The `newsletter` slug delegates to a bounded `NewsletterPageView` (or equivalently isolated newsletter-only component) so its form-first composition does not accumulate fragile conditionals throughout the generic template.

The newsletter page order becomes:

1. one first section with compact newsletter copy and, immediately after it, the managed live form or its truthful unavailable fallback;
2. existing newsletter resource cards and supporting explanatory content, without photography; and
3. any configured secondary cards.

The first section owns stable item ID `form` and renders the existing `newsletter.form.eyebrow`, `newsletter.form.title`, and `newsletter.form.body` regions as one compact heading block. `newsletter.form.title` is promoted from `h2` to the page’s single `h1`; `newsletter.form.eyebrow` remains its eyebrow; and `newsletter.form.body` is the optional one-sentence explanation. The `newsletter.form` managed-form region follows that block immediately in the same section. The dedicated page does not call the current two-column `NewsletterSignupSection`; it renders `ResidentForm` directly inside the bounded newsletter view using a dedicated `newsletter-page-first` presentation mode.

That presentation mode suppresses `PublicFormCard`’s duplicate visual eyebrow and `<h3>` header for both the live form and the unavailable fallback. The first-section `h1` supplies page context; the managed form’s existing fieldset legend remains the form’s accessible name. The required-fields guidance remains adjacent to the controls. The unavailable fallback is contained by the same first section and associated with its heading, so it does not introduce an orphaned or skipped heading. No `h1 → h3` skip or second signup introduction is permitted.

The former `newsletter.hero.*` and newsletter hero CTA regions are retired from the active `/newsletter` render and builder mapping. Their persisted versions and history remain intact, but they are no longer presented as editable live regions. A versioned builder-content migration records the layout transition and makes `newsletter.form.*` the authoritative compact heading contract. No runtime fallback reads both the old hero and form regions, avoiding ambiguous or duplicated copy.

No `ImagePanel` is rendered for the newsletter hero or newsletter supporting section. Existing image regions remain registered for other pages and are not deleted from shared page data.

### 4.2 Content and editing

`newsletter.sections` remains the page-level sections region. The migration publishes the normalized stable order `form → features → supporting → secondary` (omitting `secondary` when absent) and removes the former `hero` item from the active order. The form item is pinned first by the newsletter view; any later editor reorder command is normalized so `form` cannot move below another item. The existing `features`, `supporting`, and `secondary` item IDs remain stable, preserving editor selection and history for the content that continues to render.

The page must preserve one clear `h1`, correct heading order below it, keyboard order that reaches the form before secondary resources, and English/Spanish rendering for all application-owned strings.

## 5. Failure and fallback behavior

- Missing or invalid brand assets preserve the current safe behavior: no unapproved image is rendered, and the hero remains readable against its navy fallback.
- A rejected Site Editor banner candidate cannot replace the last valid published approved banner.
- If newsletter configuration or provider readiness is unavailable, the first section still renders the compact title and the truthful existing unavailable fallback; it does not reintroduce a photo or leave a blank hero.
- The layout does not catch, mask, or rewrite newsletter submission errors.

## 6. Verification

### Automated checks

- Update the homepage structural test to prove the brand banner uses a non-landmark wrapper inside the hero and before the foreground grid, with no separate pre-hero banner strip.
- Preserve responsive source, approved-manifest, locale-aware alt, and Site Editor region tests.
- Add a newsletter-page composition test proving one first section contains `newsletter.form.title` as the single `h1`, followed immediately by `newsletter.form`, with no duplicate newsletter intro and no newsletter `ImagePanel`.
- Add live and unavailable-state tests for `newsletter-page-first` presentation: no public-form-card eyebrow or `h3`, one accessible managed-form legend in the live state, and fallback content associated with the first-section heading.
- Add builder mapping and migration tests proving the old newsletter hero regions are retired, `newsletter.form.*` remains authoritative, and `newsletter.sections` normalizes to the stable form-first order without losing retained item IDs.
- Confirm other generic pages still render their hero and supporting images.
- Add a scoped-style regression test proving the dark background and white interaction styles require the homepage modifier and do not match generic page heroes.
- Run targeted Vitest tests, TypeScript, ESLint, the brand-asset verifier, and a production build.
- Add measurable contrast assertions for hero copy and primary/secondary link states. Default, hover, focus-visible, and visited foreground/background pairs must each meet WCAG AA: at least 4.5:1 for normal text and 3:1 for large text and non-text control boundaries.

### Responsive visual review

Review the settled page at minimum at:

- desktop: 1280×800; and
- tablet/breakpoint-adjacent: 768×1024; and
- mobile: 390×844.

For the homepage, confirm the seal, `MORALES` wordmark, and `LD34` remain recognizable; foreground copy and controls remain readable; the District Office image panel is not obscured; the editor region remains selectable; and there is no horizontal overflow.

For `/newsletter`, confirm the compact title and form appear in the first viewport, no photo is present, fields and Turnstile controls fit without overflow, and keyboard focus order follows the visual order.

Production deployment remains gated on explicit desktop and mobile visual approval.

## 7. Out of scope

- Changing the approved banner files or social cover.
- Changing newsletter provider credentials, Resend resources, Supabase schema, consent, double opt-in, confirmation delivery, or subscriber data.
- Redesigning contact, survey, news, or other generic pages.
- Removing the homepage District Office image panel.
- Adding motion, parallax, or animation to the banner background.
