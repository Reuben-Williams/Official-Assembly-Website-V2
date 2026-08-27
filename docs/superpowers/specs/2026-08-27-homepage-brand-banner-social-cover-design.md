# Homepage Brand Banner and Social Cover Design

Date: 2026-08-27

Status: Approved design; specification under review

Website: `official-assembly-website-v2`

## 1. Objective

Make the official Assemblywoman Carmen T. Morales LD34 logo the first homepage content visitors see and the cover image used when the website is shared.

The global navbar and any active site-alert bar remain before page content. Immediately after them, the homepage renders a full-width official brand banner. The existing constituent-services hero remains directly below the banner with its heading, actions, and portrait unchanged.

The homepage banner is editable through the private Site Editor. The social-sharing cover is pinned to a separately approved, checked-in brand asset so an ordinary page edit cannot silently change the website's shared identity.

## 2. Approved decisions

- Use a full-width logo banner above the current homepage hero.
- Keep the current hero content and portrait directly below the banner.
- Keep the brand banner fixed as the first homepage section; staff may replace its image but may not reorder it below another section.
- Let authorized staff update the homepage banner through the Site Editor.
- Keep the Open Graph and Twitter/X cover controlled separately from the editable banner.
- Derive all public files from the clean original asset supplied in the forthcoming official asset folder.
- Do not publish the attached 1290x639 screenshot. It contains large white margins and a scan-control overlay and is reference material only.
- Preserve the supplied logo without redrawing the seal, wordmark, typography, colors, or LD34 treatment.
- Use the same official logo on English and Spanish pages as reviewed language-neutral brand artwork. Localize its accessible text.

## 3. Source-asset gate and provenance

Implementation is asset-gated. Before any logo file enters `public/` or production storage:

1. Inventory the supplied asset folder without assuming every file is public or current.
2. Identify the official logo source with the best available fidelity, preferring vector artwork (`SVG`, `PDF`, or `EPS`) and then a transparent, high-resolution raster.
3. Record the source filename, dimensions, format, digest, and the user-provided approval context.
4. Compare duplicate logo variants and surface meaningful differences instead of guessing which is canonical.
5. Obtain confirmation if the folder contains conflicting official, campaign, district-office, or outdated marks.
6. Retain the source unchanged and derive optimized public variants reproducibly.

No screenshot controls, messaging UI, white screenshot canvas, unapproved crop, metadata, or unrelated folder assets may enter a derivative.

The asset gate produces a checked-in `ApprovedBrandAssetManifest` before implementation can pass:

```ts
type ApprovedBrandAssetManifestEntry = Readonly<{
  id: string;
  sourceDigest: string;
  publicPath: `/brand/${string}`;
  mimeType: "image/avif" | "image/webp" | "image/png";
  width: number;
  height: number;
  purpose: "homepage_banner" | "social_cover";
  approvedBy: string;
  approvedAt: string;
}>;
```

The manifest binds every selectable or published file to its reviewed source, exact public path, dimensions, format, purpose, and approval evidence. Banner derivatives use `/brand/morales-ld34-banner-*`; the social derivative uses `/brand/morales-ld34-social-cover.png`. A repository check verifies each path exists and its decoded dimensions, MIME type, and digest match the manifest. If the clean source cannot produce a sharp reviewed derivative at the required display size without upscaling, asset selection stops for user review.

## 4. Homepage banner contract

### 4.1 Placement and hierarchy

The banner renders before, and outside, the existing reorderable `home.sections` collection. Global navigation and eligible alerts remain outside the homepage component and retain their current behavior. This placement enforces the required order without inventing a pinned-item capability in the generic sections editor.

The homepage order begins:

1. Fixed `HomepageBrandBanner`
2. Existing reorderable `home.sections` collection, beginning with its current `hero`
3. Existing homepage sections in their current approved order

The banner is not represented as a `data-builder-item-id` inside `home.sections`; therefore section-order data cannot move, hide, or delete it. The current hero continues to own `home.hero.*` and `media.hero`; the new banner uses a distinct media identity and never overloads the portrait region.

### 4.2 Rendering

The banner is full bleed across the viewport. Its approved navy field reaches both viewport edges with no screenshot-white margins. The internal logo artwork remains inside responsive safe margins and is never cropped, stretched, recolored, or covered by controls.

Derived banner files include appropriate desktop and mobile resolutions. If the official folder contains an approved mobile or stacked composition, use it at the reviewed breakpoint. Otherwise, use the same complete horizontal artwork with `object-fit: contain`; do not invent a stacked redesign.

The implementation reserves intrinsic space to prevent layout shift. The banner image is the homepage's primary eager image and receives the framework's high-priority loading treatment. The existing hero portrait becomes normally loaded when it is below the initial viewport so the page does not compete for two large priority images.

Motion is not added. The brand should appear immediately and remain stable.

### 4.3 Accessibility and localization

The banner is an informative brand image, not an empty background. Its accessible text is application-owned and resolved from fixed locale keys independent of the selected manifest image:

- English: `Assemblywoman Carmen T. Morales — Legislative District 34`
- Spanish: `Asambleísta Carmen T. Morales — Distrito Legislativo 34`

The official artwork itself is an approved language-neutral brand asset even though its wordmark is English. Switching locale must not fetch a different unapproved logo or create duplicate announcements. The banner is not a heading and does not replace the existing semantic `h1` in the constituent-services hero.

The generic editable image `alt` value is not authoritative for this region. Save and publication normalization set it to the canonical English catalog value, while public rendering selects the English or Spanish application-owned value. Staff choose artwork; they do not bypass bilingual review by editing this brand image's accessible name.

## 5. Site Editor contract

Register one new stable page-local editable image region:

- Region ID: `media.home-brand-banner`
- Kind: image
- Page: `/`
- Label: `Homepage official brand banner`
- Allowed source: `purpose: "homepage_banner"` entries from `ApprovedBrandAssetManifest`

The checked-in approved banner is the authoritative fallback when no kind-correct published override exists. Approved manifest banner entries are also projected into the private media picker as `source: "seed"` assets with stable `/brand/...` paths; private uploaded assets and their expiring signed preview URLs are not eligible for this region. The existing image editor may display the choices, but the server—not the browser—enforces manifest membership.

The editor preview must show the banner in its fixed first position. An authorized replacement saves the existing image value shape using the stable manifest `publicPath` and canonical English alt, then follows the existing draft, preview, publish, audit, and history workflow.

Banner-specific save and publication validation resolve the submitted `src` to exactly one `homepage_banner` manifest entry, revalidate the checked-in file against the manifest, and normalize the alt value. Unknown URLs, upload signed URLs, purpose mismatches, missing files, and manifest mismatches are rejected. A rejected candidate does not replace the last valid published banner. Restoring history creates a new reviewed draft under the existing restoration rules and can publish only if its path remains in the current approved manifest.

Changing `media.home-brand-banner` does not change the social-sharing cover.

## 6. Social-sharing cover contract

Create a separately reviewed 1200x630 social cover derived from the same official source logo. The logo is centered within platform-safe margins on its approved navy background. The derivative contains no extra slogan, page-specific headline, screenshot chrome, animation, or white outer canvas.

Define exact localized social-cover alt values:

- English: `Official logo of Assemblywoman Carmen T. Morales, Legislative District 34`
- Spanish: `Logotipo oficial de la asambleísta Carmen T. Morales, Distrito Legislativo 34`

A shared server-only metadata helper receives the resolved route title, description, locale, and canonical URL, then returns one complete metadata object containing:

- Open Graph `images`
- Twitter/X `summary_large_image`

The Open Graph image entry contains the absolute production URL, width `1200`, height `630`, and locale-specific alt. The Twitter/X image entry uses the same absolute URL and locale-specific alt. The helper copies the route's already-resolved title and description into document, Open Graph, and Twitter metadata so social-image configuration cannot freeze every shared route to the homepage title.

Every public `generateMetadata` path, including the homepage, standard pages, news index, published post routes, confirmation, privacy, and 404 behavior where supported, composes through this helper. No route relies on implicit nested metadata inheritance. A future route-specific cover must supply a separately approved manifest entry through the same helper. Existing localized titles and descriptions remain dynamic and locale-aware.

The social cover is a checked-in controlled asset rather than a normal page-editor field. Updating it requires an explicit reviewed brand release so an editor cannot unintentionally change the image shown in messages or social posts. Third-party platforms may cache earlier metadata; deployment verification distinguishes correct live metadata from external cache refresh timing.

## 7. Components and data flow

The implementation keeps responsibilities separate:

1. A checked-in brand manifest owns approved paths, digests, formats, intrinsic dimensions, purposes, and approval evidence.
2. A small homepage brand-banner component owns responsive rendering, editor attributes, locale-aware application-owned accessible text, and fallback resolution.
3. The homepage owns fixed placement before the existing `home.sections` collection.
4. The builder mapping registers `media.home-brand-banner`; a banner validator restricts its existing image value to manifest seed assets while the existing content workflow owns drafts/history.
5. A shared server-only metadata helper composes route-specific titles/descriptions with the controlled social-cover image and localized image alt.
6. An asset preparation record owns provenance and derivative commands; application code never embeds the supplied screenshot.

Public rendering flow:

1. Load the authoritative published homepage content.
2. Resolve a kind-correct banner override whose path still matches the approved manifest, or the checked-in fallback.
3. Resolve accessible text for the selected locale.
4. Render the fixed banner before the existing hero.
5. Generate route metadata with the controlled absolute social-cover URL.

## 8. Failure handling

- Before the clean source asset is approved, make no production visual change.
- If an editor candidate is invalid, keep the previous published banner and report the exact validation problem privately.
- If no published override exists, render the checked-in approved fallback.
- The build fails if a checked-in brand file does not match its manifest, preventing a known-broken asset release. A later external network failure leaves the stable navy banner field and accessible text available; it never substitutes the screenshot or an unrelated gallery image.
- If social metadata is valid on the live response but a third-party service shows an older card, treat it as external cache state rather than republishing arbitrary variants.
- If supplied assets conflict, stop asset selection and request a canonical choice.

## 9. Verification

### 9.1 Automated coverage

- Homepage markup places `brand-banner` before `hero` and keeps all existing sections in order.
- `HomepageBrandBanner` renders before and outside the `home.sections` region, so section-order data cannot reorder, hide, or remove it.
- Manifest seed assets appear in the private picker with stable public paths; upload signed URLs do not qualify.
- A kind-correct, manifest-approved published editor override renders; missing, wrong-kind, unknown-path, or purpose-mismatched content uses the approved fallback or is rejected before publication as applicable.
- Banner save/publish validation rejects non-manifest paths and normalizes alt ownership.
- English and Spanish application-owned accessible text resolve exactly and no duplicate heading is introduced.
- The banner and current hero retain distinct stable media region IDs.
- Root and deep-route metadata preserve their route-specific localized title and description while containing the absolute 1200x630 Open Graph image, localized image alt, and Twitter/X large-image card.
- The checked-in asset inventory contains no reference to the screenshot path or digest.
- Build output contains no broken, local-only, or credential-bearing metadata URL.

### 9.2 Browser and visual coverage

Verify settled English and Spanish rendering at minimum:

- 390x844 portrait mobile
- 667x390 short landscape
- 1280x800 desktop

For each relevant viewport, confirm the complete logo is visible, the navy field is full width, the artwork is not cropped or distorted, no horizontal overflow occurs, the navbar/alert layers remain usable, the existing hero follows immediately, and the page has no layout jump after load.

Verify the editor preview and published homepage separately. Confirm the network has no failed first-party asset requests and the console has no application errors.

Inspect production HTML for `og:image`, dimensions, alt text, `twitter:card`, and `twitter:image`. Check at least one messaging/social-preview debugger where access is available, while treating provider caches as external state.

### 9.3 Approval and release gates

- User confirms the canonical source logo from the forthcoming folder.
- User approves desktop and mobile banner renders.
- User approves the exact 1200x630 social cover.
- Focused tests, full relevant test suite, lint, production build, and protected preview pass.
- Production deploy is verified on the custom domain before the release is called complete.
- No unrelated local file or unapproved folder asset is committed.

## 10. Non-goals

- Redrawing or modernizing the official logo
- Publishing the attached screenshot
- Removing or replacing the current constituent-services hero
- Making the social cover change automatically with ordinary page edits
- Adding animation, video, a carousel, or marketing copy to the banner
- Reordering global navigation or alerts behind the banner
- Automatically publishing every asset in the forthcoming folder
- Changing the existing bilingual architecture beyond the banner's accessible text

## 11. Acceptance criteria

The change is complete only when:

- The approved official Morales LD34 logo is the first homepage content after global navigation and eligible alerts.
- The current constituent-services hero remains immediately below it.
- Authorized staff can replace the banner through the Site Editor without moving or deleting its position.
- The last valid banner remains recoverable through existing history behavior.
- Shared links advertise the approved main assemblywoman logo through valid absolute Open Graph and Twitter/X metadata.
- The logo remains complete, undistorted, responsive, accessible, and visually approved on mobile and desktop.
- The screenshot and unrelated assets never enter production.
