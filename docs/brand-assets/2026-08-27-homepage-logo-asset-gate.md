# Homepage logo asset gate

Date: 2026-08-27

Status: Activated from an owner-supplied pasted reference with documented minimal restoration

## Approved use

The user approved the official Assemblywoman Carmen T. Morales LD34 logo for:

- a fixed, full-width homepage banner immediately before the current hero; and
- the controlled 1200x630 Open Graph and Twitter/X cover.

The homepage banner will be selectable in the private Site Editor from reviewed seed assets. The social cover remains release-controlled.

## Owner-supplied reference and provenance

The owner confirmed that the artwork could only be supplied by pasting it into the conversation. The resulting `morales-ld34-banner-pasted-reference.png` is 1290x639 pixels, 334,138 bytes, with SHA-256:

`dd8ccb4d76b9c60e0a5f961534cc9d35bab16c448f6392023ad62ba261792633`

The same Assemblywoman Carmen T. Morales / LD34 branding is used by the office's public Facebook and Instagram accounts:

- <https://www.facebook.com/AssemblywomanCarmenMorales>
- <https://www.instagram.com/asw_carmenmorales/>

The pasted reference itself remains excluded from `public/`, the media picker, and metadata because it contains:

- large white screenshot margins;
- a scan-control overlay on the lower-right artwork; and
- no downloadable clean master.

## Minimal restoration record

The owner approved proceeding with the recommended restoration and production activation. The release:

1. crops only the white screenshot margins and one-pixel screenshot seams;
2. removes the pasted scan-control overlay;
3. restores only the tiny obscured lower-right portion of the final `S` using the checked-in `morales-ld34-banner-restoration-s-mask.png`;
4. preserves the supplied seal, wordmark, red accent, spacing, and color pixels everywhere outside the restoration boundary; and
5. labels the result as a restored derivative, not an original design master.

The checked-in restored master is 1290x402 PNG with SHA-256:

`a4a00633ffae3280ab81b26856660c4b0a055e787fa2a15e28a47fc64592cc09`

The reproducible preparation script validates the pasted reference digest before producing the restored master and responsive derivatives.

## Existing local media inventory

The existing `morales4assembly/` folder contains 103 raster photographs. The 2026-08-27 inventory found no vector file, named logo file, or wide brand artwork with the required official LD34 wordmark. Those photographs remain outside this brand release.

## Activated manifest

The approved manifest contains:

- desktop AVIF, 1290x402, SHA-256 `af73914e97e28d90c5bded5dd6447d07f4301f47c86b86e92a0ee1d961890dbd`;
- desktop WebP, 1290x402, SHA-256 `88453a842413fadee5b9d95dad20620750b3fd2376359950c1649441f533a42b`;
- mobile AVIF, 960x299, SHA-256 `07fd2b01dfc0c6fe675e1cc82b1670087c122ddf5dc378d8b81fbca20fabada2`;
- mobile WebP, 960x299, SHA-256 `721a1cbb5e7d64fdbd02292eaf0424411613e1064522ac1ff5cf2afd1d3103f1`; and
- social cover PNG, 1200x630, SHA-256 `3e686d2f911deba672679d00fa00a7da41643fef4db4f3ed2bb3b69f19a19f49`.

`approvedBrandAssets` is active. The build verifies every checked-in public file against the approved digest, decoded dimensions, and MIME type before Next.js compilation starts.
