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

## 4. Homepage banner contract

### 4.1 Placement and hierarchy

The banner is the first child of the homepage content composition, before the existing `hero` item. Global navigation and eligible alerts remain outside that composition and retain their current behavior.

The homepage order begins:

1. `brand-banner`
2. `hero`
3. Existing homepage sections in their current approved order

`brand-banner` is required and pinned. The `home.sections` editor may expose its presence but cannot move, hide, or delete it. The current hero continues to own `home.hero.*` and `media.hero`; the new banner uses a distinct media identity and never overloads the portrait region.

### 4.2 Rendering

The banner is full bleed across the viewport. Its approved navy field reaches both viewport edges with no screenshot-white margins. The internal logo artwork remains inside responsive safe margins and is never cropped, stretched, recolored, or covered by controls.

Derived banner files include appropriate desktop and mobile resolutions. If the official folder contains an approved mobile or stacked composition, use it at the reviewed breakpoint. Otherwise, use the same complete horizontal artwork with `object-fit: contain`; do not invent a stacked redesign.

The implementation reserves intrinsic space to prevent layout shift. The banner image is the homepage's primary eager image and receives the framework's high-priority loading treatment. The existing hero portrait becomes normally loaded when it is below the initial viewport so the page does not compete for two large priority images.

Motion is not added. The brand should appear immediately and remain stable.

### 4.3 Accessibility and localization

The banner is an informative brand image, not an empty background. Its accessible text is resolved through the existing locale system:

- English: `Assemblywoman Carmen T. Morales — Legislative District 34`
- Spanish: `Asambleísta Carmen T. Morales — Distrito Legislativo 34`

The official artwork itself is an approved language-neutral brand asset even though its wordmark is English. Switching locale must not fetch a different unapproved logo or create duplicate announcements. The banner is not a heading and does not replace the existing semantic `h1` in the constituent-services hero.

## 5. Site Editor contract

Register one new stable editable image region:

- Region ID: `media.home-brand-banner`
- Kind: image
- Page: `/`
- Label: `Homepage official brand banner`
- Allowed source: approved private media-gallery assets promoted through the existing publication boundary

The checked-in approved banner is the authoritative fallback when no kind-correct published override exists. The editor preview must show the banner in its fixed first position. An authorized replacement follows the existing draft, preview, publish, audit, and history workflow.

Publication validation rejects missing files, unsupported formats, dimensions below the approved minimum, unsafe or unapproved source URLs, and absent localized accessible text. A rejected candidate does not replace the last valid published banner. Restoring history creates a new reviewed draft under the existing restoration rules.

Changing `media.home-brand-banner` does not change the social-sharing cover.

## 6. Social-sharing cover contract

Create a separately reviewed 1200x630 social cover derived from the same official source logo. The logo is centered within platform-safe margins on its approved navy background. The derivative contains no extra slogan, page-specific headline, screenshot chrome, animation, or white outer canvas.

The root metadata defines absolute production URLs for:

- Open Graph `images`
- Twitter/X `summary_large_image`

Every public route inherits the approved brand cover unless a future route-specific cover receives its own design and approval. Existing localized titles and descriptions remain dynamic and locale-aware; this change supplies the missing image metadata without replacing those values.

The social cover is a checked-in controlled asset rather than a normal page-editor field. Updating it requires an explicit reviewed brand release so an editor cannot unintentionally change the image shown in messages or social posts. Third-party platforms may cache earlier metadata; deployment verification distinguishes correct live metadata from external cache refresh timing.

## 7. Components and data flow

The implementation keeps responsibilities separate:

1. A small homepage brand-banner component owns responsive rendering, editor attributes, locale-aware accessible text, and fallback resolution.
2. The homepage composition owns fixed placement immediately before the existing hero.
3. The builder mapping registers `media.home-brand-banner` and delegates draft/history behavior to the existing media workflow.
4. The root metadata layer owns the controlled social-cover URL and dimensions.
5. An asset preparation record owns provenance and derivative commands; application code never embeds the supplied screenshot.

Public rendering flow:

1. Load the authoritative published homepage content.
2. Resolve a kind-correct approved banner override or the checked-in fallback.
3. Resolve accessible text for the selected locale.
4. Render the fixed banner before the existing hero.
5. Generate route metadata with the controlled absolute social-cover URL.

## 8. Failure handling

- Before the clean source asset is approved, make no production visual change.
- If an editor candidate is invalid, keep the previous published banner and report the exact validation problem privately.
- If no published override exists, render the checked-in approved fallback.
- If the public banner request fails unexpectedly, preserve the rest of the homepage and expose the failure to application observability; never substitute the screenshot or an unrelated gallery image.
- If social metadata is valid on the live response but a third-party service shows an older card, treat it as external cache state rather than republishing arbitrary variants.
- If supplied assets conflict, stop asset selection and request a canonical choice.

## 9. Verification

### 9.1 Automated coverage

- Homepage markup places `brand-banner` before `hero` and keeps all existing sections in order.
- The brand banner cannot be reordered, hidden, or removed through section-order data.
- A kind-correct published editor override renders; missing or wrong-kind content uses the approved fallback.
- English and Spanish accessible text resolve exactly and no duplicate heading is introduced.
- The banner and current hero retain distinct stable media region IDs.
- Root and deep-route metadata contain an absolute 1200x630 Open Graph image and Twitter/X large-image card.
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
