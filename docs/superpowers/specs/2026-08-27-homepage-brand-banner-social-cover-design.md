# Homepage Brand Banner and Social Cover Design

Date: 2026-08-27

Status: Approved and activated with the 2026-08-27 pasted-reference restoration amendment

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
- Derive all public files from the checked-in restored master approved after the owner confirmed that only a pasted copy was available.
- Do not publish the raw 1290x639 pasted screenshot. It contains large white margins and a scan-control overlay and remains provenance evidence only.
- Preserve the supplied seal, wordmark, typography, colors, and LD34 treatment outside the tightly bounded scan-control removal; restore only the obscured lower-right portion of the final `S`.
- Use the same official logo on English and Spanish pages as reviewed language-neutral brand artwork. Localize its accessible text.

## 3. Source-asset gate and provenance

Implementation remains asset-gated. For the approved 2026-08-27 pasted-reference release:

1. Retain the owner-supplied pasted reference unchanged and record its dimensions, format, digest, and approval context.
2. Confirm the same Assemblywoman Carmen T. Morales / LD34 brand treatment against the office's public Facebook and Instagram accounts.
3. Reject the first automated restoration because it changed the seal and typography beyond the approved boundary.
4. Use a checked-in restoration mask only for the portion hidden by the scan control; crop the white screenshot canvas and preserve all other supplied artwork.
5. Record the restored-master digest separately from the unchanged pasted-reference digest.
6. Derive optimized public variants reproducibly from the restored master.

A future clean vector or high-resolution original may replace this release through the same reviewed manifest process; it must not silently supersede the approved restored master.

No screenshot controls, messaging UI, white screenshot canvas, unapproved crop, metadata, or unrelated folder assets may enter a derivative.

The asset gate produces a checked-in `ApprovedBrandAssetManifest` before implementation can pass:

```ts
type ApprovedBrandAssetManifestEntry = Readonly<{
  id: string;
  sourceSha256: string;
  publicSha256: string;
  publicPath: `/brand/${string}`;
  mimeType: "image/avif" | "image/webp" | "image/png";
  width: number;
  height: number;
  purpose: "homepage_banner" | "social_cover";
  variant:
    | "banner_desktop_avif"
    | "banner_desktop_webp"
    | "banner_mobile_avif"
    | "banner_mobile_webp"
    | "social_1200x630_png";
  approvedBy: string;
  approvedAt: string;
}>;

type ApprovedBrandRenderMap = Readonly<{
  banner: {
    mobileMaxWidthPx: 620;
    fallbackBannerSetId: string;
    sets: ReadonlyArray<{
      id: string;
      pickerPublicPath: `/brand/${string}`;
      desktop: { avifId: string; webpId: string };
      mobile: { avifId: string; webpId: string };
    }>;
  };
  socialCoverId: string;
}>;
```

The manifest binds every selectable or published file to its reviewed source digest, exact derivative digest, public path, dimensions, format, purpose, variant, and approval evidence. SHA-256 values are lowercase 64-character hexadecimal strings, and `approvedAt` is an RFC 3339 UTC timestamp. Banner derivatives use `/brand/morales-ld34-banner-*`; the social derivative uses `/brand/morales-ld34-social-cover.png`.

The render map is reviewed with the derivatives and is the only authority for responsive art direction. Each approved banner set owns all four derivative IDs and one stable `pickerPublicPath`, which must equal that set's desktop WebP public path. Only the representative picker path is exposed to the Site Editor. Selecting or restoring that one path deterministically selects its complete responsive set; individual mobile or format derivatives are never independent editor choices.

The 620px value is a banner-specific art-direction breakpoint chosen for the legibility of this wide brand artwork in the required 390px portrait and 667px landscape reviews. It is independent of the navigation drawer's 920px breakpoint and may change only with another responsive visual review. If no distinct mobile composition is approved, the mobile IDs still point to separately optimized complete horizontal derivatives of the same artwork; the implementation never invents a stacked redesign.

A repository check verifies that every mapped ID exists, has the required purpose and variant, banner-set IDs and representative picker paths are unique, each banner set contains exactly one ID for each required banner variant, each representative picker path matches its desktop WebP entry, the fallback set exists, and the social ID resolves to the 1200x630 social entry. It verifies that each checked-in public file's lowercase hexadecimal SHA-256 digest, decoded dimensions, and MIME type match the manifest. It also verifies that every source SHA-256 in the manifest is present in the asset-preparation record. If the clean source cannot produce a sharp reviewed derivative at the required display size without upscaling, asset selection stops for user review.

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

Derived banner files include the reviewed desktop and mobile AVIF/WebP pairs named by the banner set selected through `ApprovedBrandRenderMap`. A `<picture>` source changes to that set's mapped mobile pair at `(max-width: 620px)` and otherwise uses that set's mapped desktop pair. If the official folder contains an approved mobile or stacked composition, it may become the mapped mobile pair. Otherwise, both pairs preserve the same complete horizontal artwork with `object-fit: contain`; do not invent a stacked redesign.

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
- Allowed source: representative `pickerPublicPath` values from approved banner sets in `ApprovedBrandRenderMap`

The checked-in fallback banner set is authoritative when no kind-correct published override exists. One representative asset per approved banner set is projected into the private media picker as a `source: "seed"` asset using the set's stable `pickerPublicPath`; the other format and mobile derivatives remain hidden implementation assets. Private uploaded assets and their expiring signed preview URLs are not eligible for this region. The existing image editor may display the choices, but the server—not the browser—enforces render-map membership.

The editor preview must show the banner in its fixed first position. An authorized replacement saves the existing image value shape using the stable manifest `publicPath` and canonical English alt, then follows the existing draft, preview, publish, audit, and history workflow.

One pure server-side `validateHomeBrandBannerValue` rule is reused by draft save, publication, history restoration, and public fallback resolution. File loading, decoding, and hashing happen once in the manifest-verification boundary, which passes an immutable verified manifest snapshot into the pure validator. The validator resolves the submitted `src` to exactly one banner set through its representative picker path, requires all four derivatives in that set to be present in the verified snapshot, and normalizes the stored value to the representative path plus canonical English alt. Unknown URLs, non-representative derivative paths, upload signed URLs, purpose or variant mismatches, incomplete sets, missing files, and manifest mismatches are rejected. A rejected candidate does not replace the last valid published banner.

History restoration preserves the editor's existing immediate rollback behavior. Before executing a restore that contains `media.home-brand-banner`, the server loads the candidate source version and runs the same validator. If its banner is no longer in the current approved manifest, the whole restore is rejected and the current published version remains unchanged; otherwise the existing restore command proceeds and publishes its rollback version as it does today. This design does not add a new restoration draft workflow.

Changing `media.home-brand-banner` does not change the social-sharing cover.

## 6. Social-sharing cover contract

Create a separately reviewed 1200x630 social cover derived from the same official source logo. The logo is centered within platform-safe margins on its approved navy background. The derivative contains no extra slogan, page-specific headline, screenshot chrome, animation, or white outer canvas.

Define exact localized social-cover alt values:

- English: `Official logo of Assemblywoman Carmen T. Morales, Legislative District 34`
- Spanish: `Logotipo oficial de la asambleísta Carmen T. Morales, Distrito Legislativo 34`

A shared server-only metadata helper receives the route's complete base `Metadata` object plus separately resolved plain social title, social description, locale, and optional canonical URL. It returns the base object augmented with:

- Open Graph `images`
- Twitter/X `summary_large_image`

The Open Graph image entry contains the absolute production URL, width `1200`, height `630`, and locale-specific alt. The Twitter/X image entry uses the same absolute URL and locale-specific alt. The helper preserves every unrelated base field, including title templates, `metadataBase`, alternates, canonical URLs, robots directives, referrer policy, and existing Open Graph/Twitter fields. It replaces only the controlled social title, description, image, image alt, and card type, and adds the optional social URL when supplied. The resolved plain social title is passed separately so a document title template is neither flattened nor applied twice.

Every public metadata path, including the homepage, standard pages, news index, published post routes, confirmation, privacy, and 404 behavior where supported, composes its existing metadata through this helper. No route relies on implicit nested metadata inheritance for the controlled social cover. A future route-specific cover must supply a separately approved manifest entry through the same helper. Existing localized titles and descriptions remain dynamic and locale-aware; published-post canonical and robots values and newsletter-confirmation `noindex`, `nofollow`, and `no-referrer` guarantees remain unchanged.

The social cover is a checked-in controlled asset rather than a normal page-editor field. Updating it requires an explicit reviewed brand release so an editor cannot unintentionally change the image shown in messages or social posts. Third-party platforms may cache earlier metadata; deployment verification distinguishes correct live metadata from external cache refresh timing.

## 7. Components and data flow

The implementation keeps responsibilities separate:

1. A checked-in brand manifest owns approved paths, digests, formats, intrinsic dimensions, purposes, and approval evidence.
2. A small homepage brand-banner component owns responsive rendering, editor attributes, locale-aware application-owned accessible text, and fallback resolution.
3. The homepage owns fixed placement before the existing `home.sections` collection.
4. The builder mapping registers `media.home-brand-banner`; one pure banner validator restricts its existing image value to mapped manifest seed assets across save, publish, restore, and fallback resolution while the existing content workflow owns drafts/history.
5. A shared server-only metadata helper augments each route's complete metadata with the controlled social-cover image and localized image alt without dropping route-specific SEO or privacy fields.
6. An asset preparation record owns provenance and derivative commands; application code never embeds the supplied screenshot.

Public rendering flow:

1. Load the authoritative published homepage content.
2. Resolve a kind-correct banner override whose representative path still maps to a complete approved banner set, or use the checked-in fallback set.
3. Resolve accessible text for the selected locale.
4. Render the fixed banner before the existing hero.
5. Generate route metadata with the controlled absolute social-cover URL.

## 8. Failure handling

- Before a source or restored master passes the manifest gate, make no production visual change.
- If an editor candidate is invalid, keep the previous published banner and report the exact validation problem privately.
- If no published override exists, render the checked-in approved fallback.
- The build fails if a checked-in brand file does not match its manifest, preventing a known-broken asset release. A later external network failure leaves the stable navy banner field and accessible text available; it never substitutes the screenshot or an unrelated gallery image.
- If social metadata is valid on the live response but a third-party service shows an older card, treat it as external cache state rather than republishing arbitrary variants.
- If supplied assets conflict, stop asset selection and request a canonical choice.

## 9. Verification

### 9.1 Automated coverage

- Homepage markup places `brand-banner` before `hero` and keeps all existing sections in order.
- `HomepageBrandBanner` renders before and outside the `home.sections` region, so section-order data cannot reorder, hide, or remove it.
- Exactly one representative seed asset per approved banner set appears in the private picker; individual mobile/format derivatives and upload signed URLs do not qualify.
- Saving one representative path deterministically renders its complete desktop/mobile AVIF/WebP set in preview, public output, and restored history.
- A kind-correct, manifest-approved published editor override renders; missing, wrong-kind, unknown-path, or purpose-mismatched content uses the approved fallback or is rejected before publication as applicable.
- Banner save/publish validation rejects non-manifest paths and normalizes alt ownership.
- Banner history restore reuses the same validator, rejects an obsolete manifest path atomically, and otherwise preserves the existing immediate rollback publication behavior.
- English and Spanish application-owned accessible text resolve exactly and no duplicate heading is introduced.
- The banner and current hero retain distinct stable media region IDs.
- Root and deep-route metadata preserve their route-specific localized title and description, root title template, post canonical/robots values, and confirmation `noindex`/`nofollow`/`no-referrer` values while containing the absolute 1200x630 Open Graph image, localized image alt, and Twitter/X large-image card.
- Metadata tests confirm route titles receive the existing suffix exactly once.
- The public asset inventory contains neither the raw screenshot bytes nor its digest; the private provenance record retains both intentionally.
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
