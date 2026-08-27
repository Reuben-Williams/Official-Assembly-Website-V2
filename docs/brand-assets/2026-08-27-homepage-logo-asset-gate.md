# Homepage logo asset gate

Date: 2026-08-27

Status: Waiting for the clean official asset folder

## Approved use

The user approved the official Assemblywoman Carmen T. Morales LD34 logo for:

- a fixed, full-width homepage banner immediately before the current hero; and
- the controlled 1200x630 Open Graph and Twitter/X cover.

The homepage banner will be selectable in the private Site Editor from reviewed seed assets. The social cover remains release-controlled.

## Reference-only attachment

The conversation attachment `codex-clipboard-2b3787e9-1ea8-41cb-a4c7-0f77a12d4cde.png` is 1290x639 pixels, 334,138 bytes, with SHA-256:

`dd8ccb4d76b9c60e0a5f961534cc9d35bab16c448f6392023ad62ba261792633`

It is excluded from `public/`, the media picker, derivatives, and metadata because it contains:

- large white screenshot margins;
- a scan-control overlay on the lower-right artwork; and
- no clean-source provenance suitable for lossless responsive derivatives.

No derivative may contain that attachment's digest or bytes.

## Existing local media inventory

The existing `morales4assembly/` folder contains 103 raster photographs. The 2026-08-27 inventory found no vector file, named logo file, or wide brand artwork with the required official LD34 wordmark. Those photographs remain outside this brand release.

## Activation requirements

Activation requires all of the following:

1. Receive the owner-supplied official asset folder.
2. Inventory and compare any logo variants without guessing which is canonical.
3. Select the clean highest-fidelity approved source, preferring SVG, PDF, or EPS, then a transparent high-resolution raster.
4. Record the source filename, dimensions, format, SHA-256 digest, and approval context.
5. Generate and visually review desktop/mobile AVIF and WebP banner pairs plus one 1200x630 PNG social cover.
6. Populate the checked-in approved manifest and render map.
7. Pass exact file digest, decoded dimension, MIME, responsive browser, editor, bilingual metadata, and production checks.

Until those requirements pass, `approvedBrandAssets` remains `null`; the implementation renders no placeholder banner and publishes no provisional social cover.
