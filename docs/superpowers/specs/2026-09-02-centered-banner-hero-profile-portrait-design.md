# Centered Banner Hero and Official Profile Portrait Design

Date: 2026-09-02

Status: Design approved in conversation; independent specification review approved; pending final written-spec approval

Website: `official-assembly-website-v2`

## 1. Objective

Rebuild the homepage opening so the approved Assemblywoman Carmen T. Morales LD34 banner—not a competing photograph—is the visual centerpiece. Reorganize the existing verified hero copy and add the approved external volunteer action in a modern, responsive action dock.

Make the official New Jersey Legislature profile the immediate next substantive section. Place an authentic, approved single-person image of Assemblywoman Morales directly below the identity band that contains her title, name, leadership role, district, and office phone number.

Release the complete change to production in one deployment and verify the public website, private Site Editor contract, bilingual behavior, responsive layout, and asset delivery before reporting it live.

## 2. Approved decisions

### 2.1 Hero composition

- Remove the existing District Office `ImagePanel` from the homepage hero.
- Preserve the existing editable hero regions and exact checked-in fallback copy:
  - `home.hero.eyebrow` — `New Jersey General Assembly - District 34`;
  - `home.hero.title` — `District 34 Constituent Services and Community Updates`;
  - `home.hero.body` — the existing constituent-services description;
  - the existing Contact, News, and Newsletter link regions.
- Present the copy as a compact centered introduction above the official banner.
- Render the banner as a document-flow centerpiece, not a full-section background and not an independently reorderable section.
- Place an action dock directly below the banner:
  1. `Contact the Office` as the primary internal action;
  2. `News & Updates` as an internal secondary action;
  3. `Get the Newsletter` as an internal secondary action; and
  4. `Volunteer` as an external action using the canonical Google Form URL already stored in `app/data/district-connections.ts`.
- The Volunteer action must visibly indicate that it opens an external site/new tab, include localized accessible context, and use `target="_blank"` plus `rel="noopener noreferrer"`.
- `districtConnections.volunteer.href` is the immutable canonical destination. The Site Editor may edit only the Volunteer label; it may not replace the destination, even with another syntactically safe URL. Save, publish, restore, and migration normalization must all force the canonical destination.
- Keep the banner region stable as `media.home-brand-banner`, protected by the approved-brand manifest and editable through the Site Editor only to another approved banner set.
- Do not change the Open Graph/Twitter social cover.

### 2.2 Hero-to-profile flow

- Move the standalone statistics band to immediately after the complete `OfficialProfileSection`, so the Legislature profile follows the hero immediately and the statistics remain present with their existing stable IDs and editor-backed content.
- Normalize the homepage's two pinned opening items as `hero → official-profile`. No section-order value may place statistics or any other section between them. The statistics item remains reorderable only after this pinned opening pair.
- Use a coordinated navy-to-light surface transition so the two sections read as a continuous opening narrative while retaining distinct semantic `<section>` landmarks.
- Preserve the existing home section stable IDs and ordering behavior for all sections that remain active.

### 2.3 Official profile portrait

- Keep the existing official-profile heading, verified facts, identity band, official links, source date, and stable section ID.
- Directly after the identity band, render the approved single-person State House portrait currently registered as `media.professional.about-primary`.
- Use the responsive approved derivatives already backed by the professional-media manifest; do not generate or substitute a synthetic portrait.
- Add the distinct homepage region `media.professional.home-official-portrait`, with `professional-about-primary` as its exact approved fallback. Update the professional-media manifest schema and tests so the same authoritative asset records both consumers: `/about` primary media and `/` official-profile portrait.
- Restrict save, publish, restore, and picker selection for `media.professional.home-official-portrait` to the allowlist of approved single-person Morales portraits. For this release the allowlist contains only `professional-about-primary`; an invalid or missing override resolves to that exact approved fallback.
- Register a unique homepage editor instance for the new canonical region, consistent with the responsive/editor contract used elsewhere. Editing the homepage portrait must not silently change the `/about` placement.
- Present the portrait in a wide editorial card with a restrained caption and focal treatment that keeps Morales clearly visible on desktop and mobile.
- Use the exact application-owned caption `Assemblywoman Carmen Morales at the New Jersey State House` and Spanish caption `La asambleísta Carmen Morales en la Casa del Estado de Nueva Jersey`.
- Follow the portrait with the existing fact cards, official actions, and source line.

## 3. Banner fidelity and high-density asset contract

The current approved banner derivatives are 1290×402 (desktop) and 960×299 (mobile). The new responsive set targets 2580×804 (desktop) and 1920×598 (mobile) so the banner has a 2× density source at its maximum rendered size.

The official seal, `ASSEMBLYWOMAN CARMEN T.`, `MORALES`, and `LD34` artwork are authoritative and cannot be redrawn, rewritten, recolored, reflowed, or approximated.

The Higgsfield capability is limited to a fidelity-safe workflow:

- first prefer deterministic high-quality resampling of the approved raster through the Higgsfield sandbox/media workflow if that MCP surface is available;
- never ask an image model to recreate the seal, wordmark, or embedded text;
- reject any generated/restored candidate that changes spelling, glyph shapes, seal geometry, palette, layout, or aspect ratio;
- if the Higgsfield runtime is unavailable or cannot preserve exact artwork, produce deterministic local high-density derivatives from the same approved source and disclose that this increases pixel density without inventing new source detail.

The final AVIF/WebP derivatives must be generated from one common approved source, added to the approved-brand manifest with exact dimensions and SHA-256 digests, and verified before use. No output is represented as vector artwork or newly recovered detail.

The new derivatives replace the current approved files at their existing stable paths:

- `/brand/morales-ld34-banner-desktop.avif`;
- `/brand/morales-ld34-banner-desktop.webp`;
- `/brand/morales-ld34-banner-mobile.avif`; and
- `/brand/morales-ld34-banner-mobile.webp`.

Keep the stable set ID `morales.ld34.official.2026-08-27` and its existing picker path. Update only the manifest dimensions and public-file SHA-256 digests for the higher-density derivatives. Existing draft, published, and history values therefore remain valid in both the new deployment and the recorded rollback deployment; no production builder-content migration or history rewrite is authorized or required.

To prevent stale browser/CDN reuse while preserving the stable editor value, rendered `src` and `srcSet` URLs append a deterministic cache token derived from the corresponding manifest `publicSha256` value. Stored editor values, picker registration, and filesystem verification continue using the unqueried stable path. A rollback deployment emits the prior digest token and serves its prior same-path asset, so rollback requires no data downgrade.

## 4. Component and data architecture

### 4.1 Homepage hero

`HomePageView` retains the hero as the first `home.sections` item. `HomepageBrandBanner` changes from an absolutely positioned background layer into a flow-positioned media card inside the hero, between the copy block and action dock.

The homepage hero receives a bounded inner shell with this DOM order:

1. editable eyebrow;
2. editable `h1`;
3. editable lead paragraph;
4. protected responsive banner region; and
5. four-action dock.

The three existing internal actions keep their stable link-region IDs. Add one new semantic builder link region, `home.hero.volunteer-cta`. Its label is editable; its destination always comes from `districtConnections.volunteer.href`. The private editor mapping exposes the label and read-only destination, while protected-value normalization enforces the canonical URL during save, publish, and restore.

### 4.2 Banner component

`HomepageBrandBanner` retains:

- `data-builder-region="media.home-brand-banner"`;
- `data-builder-kind="image"`;
- approved-set resolution and safe fallback behavior;
- locale-aware alt text;
- AVIF and WebP responsive sources;
- priority loading; and
- the representative editor media-picker path.

Its root remains a non-landmark `<div>` because the hero owns the section landmark and heading. The component becomes a bordered media surface with an intrinsic aspect ratio, no crop, and no overlay that obscures the official artwork.

### 4.3 Profile image reuse

`OfficialProfileSection` imports `ImagePanel` or an equivalent manifest-backed responsive image renderer and uses a new `professional-home-official` image definition whose fallback derivatives are those of `professional-about-primary` and whose region is `media.professional.home-official-portrait`. The rendered image must preserve the region's approved English/Spanish alt text and exact localized caption. The instance identifier must be unique to the homepage official-profile placement.

## 5. Visual system

### 5.1 Hero

- Background: official deep navy with restrained tonal gradients only.
- Introduction: centered, max-width constrained, with the gold eyebrow, white headline, and high-contrast cool-white body copy.
- Banner: full-width within the site container, with generous clear space, a subtle border, and a controlled shadow. It remains the largest visual element above the fold.
- Action dock: a rounded elevated surface that may overlap the lower banner edge slightly on larger screens, while remaining a normal stacked block on small screens.
- Primary action: white/gold high-contrast treatment.
- Secondary actions: navy/light outline treatments with clear hover and focus states.
- External Volunteer action: visually peer to the secondary actions and marked with an external-link icon.

### 5.2 Official profile

- Begin immediately after the hero on the existing light official-record surface.
- Preserve the identity band as the anchor.
- Portrait: wide editorial card directly below the band, using `object-fit: cover` with reviewed focal positioning; rounded corners, restrained shadow, and no decorative filters.
- Fact cards and actions retain their existing hierarchy below the portrait.

## 6. Responsive behavior

- Desktop: centered text, full-width banner card, one-row action dock when space permits, wide portrait below the identity band.
- Tablet: banner remains uncropped; actions wrap predictably; the profile heading and fact cards use their existing single-column transition where necessary.
- Mobile: use the approved mobile banner derivative, stack all four actions as full-width 44px-or-taller targets, retain unbroken headline hierarchy, and use a portrait crop that keeps Morales visible without horizontal overflow.
- The hero must not create a viewport-height trap or push all actionable content below the first screen unnecessarily.
- Reduced-motion behavior remains unchanged; the banner is static.

## 7. Accessibility, localization, and editor requirements

- Preserve a single homepage `h1` and logical heading order.
- All interactive targets must have visible hover, focus-visible, active, and disabled behavior as applicable, plus pointer cursors.
- Meet WCAG AA contrast for hero copy and every action state.
- Preserve locale-aware hero copy and image alt text.
- Add application-owned Spanish strings for the Volunteer label and external-link context.
- Do not depend on third-party machine translation for this release.
- Preserve the banner and portrait Site Editor region mappings, history tracking, approved-media checks, and safe link parsing.
- Do not alter forms, newsletter delivery, leads/customers, alerts, auth, provider resources, database schemas, or existing production builder-content/history records.

## 8. Failure behavior

- A missing file, digest mismatch, invalid dimension, or inconsistent approved-brand/professional-media manifest is a build-time release blocker; the deployment must not be promoted.
- An invalid or disallowed Site Editor selection is a runtime content condition: normalize an invalid banner selection to the stable approved set, and normalize an invalid portrait selection to the approved single-person fallback. Never render an unapproved candidate.
- An actual production asset-request failure, undecodable image, or wrong `currentSrc`/natural size is a failed live release check and triggers rollback; it is not masked as a successful runtime fallback.
- If the external Volunteer URL fails safe-link validation, do not render an unsafe link.
- A Higgsfield-generated or restored asset that changes any official mark or text is rejected and never committed or deployed.
- Record `935f0c0364959692ac4d8eb106281b73e417f64a` / `dpl_2EnbLR1wLYUWkmrbAr18C7acKvBM` as the pre-release production rollback point. If the live hero, portrait, protected editor mapping, accessibility, bilingual, responsive, asset, or runtime checks fail, restore that deployment alias and do not report the new release live.
- Production is not reported live unless the deployment alias resolves to the intended commit and every live asset/status check passes.

## 9. Test and release contract

### 9.1 Test-first coverage

Before implementation, add failing tests that prove:

- the homepage hero no longer renders the District Office `ImagePanel`;
- the hero DOM order is copy → banner → four-action dock;
- the Volunteer action uses the canonical external URL and new-tab security attributes, and save/publish/restore reject or normalize destination drift while retaining label edits;
- the statistics band follows the complete official-profile section, and no stored section order can interrupt hero-to-profile adjacency;
- the official profile renders the approved single-person responsive portrait immediately after the identity band;
- the professional-media manifest records both authorized consumers and the homepage portrait region accepts only approved single-person assets;
- banner component/manifest tests expect the in-place 2× dimensions/files, preserve the stable picker path and set ID, and append per-file digest cache tokens only to rendered URLs;
- editor mapping, Spanish strings, alt text, and safe-link behavior remain intact; and
- scoped styles do not alter generic page heroes.

### 9.2 Local verification

Run:

- targeted Vitest tests for homepage structure, approved assets, localization, editor mapping, and professional media;
- the full application test suite;
- TypeScript and lint checks;
- the approved-brand and professional-media verification scripts;
- the production build;
- local browser E2E at desktop, tablet, and mobile sizes; and
- direct asset requests for every new banner derivative and reused portrait source.

Visual assertions must confirm recognizable seal/wordmark/LD34 artwork, unaltered banner composition, clear hierarchy, visible Morales portrait, functional CTA destinations, keyboard focus, no broken images, and no horizontal overflow. Asset assertions must inspect each live `<picture>` element's `currentSrc`, decoded state, natural dimensions, and unique homepage builder instance.

### 9.3 Production release and verification

- Commit only the scoped homepage, asset, manifest, localization, test, and documentation changes.
- Preserve unrelated user-owned untracked files.
- Push the approved commit to `main` and verify the corresponding Vercel production deployment.
- Confirm the canonical and `www` domains resolve the intended deployment.
- Run settled live checks with `domcontentloaded` plus bounded settling rather than an unbounded `networkidle` wait.
- Verify desktop 1280×800, tablet 768×1024, mobile 390×844, and constrained mobile 320×700.
- Verify English and Spanish homepage states, all four actions, editor login redirect preservation, banner/portrait requests, console/runtime errors, 5xx responses, and horizontal overflow.
- Do not submit the live newsletter or volunteer forms during production QA because that would create real external side effects.

## 10. Out of scope

- Redrawing or vectorizing the official seal or Morales wordmark.
- Creating a synthetic image of Assemblywoman Morales.
- Changing official biography facts or Legislature links.
- Redesigning non-homepage routes.
- Changing provider credentials, newsletter behavior, form schemas, or production data.
- Publishing a new Site Editor package release.
