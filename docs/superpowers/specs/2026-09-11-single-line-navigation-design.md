# Single-line navy navigation

## Approved direction

The user requested News instead of News & Updates in the navbar, equal-height Contact Office and language buttons, and no two-line navbar text. Continue the previously authorized staged production workflow. Keep the existing navy color, 75px overall header, routes, editor metadata, accessibility, and page headings.

## Design

- Use News / Noticias for the built-in header navigation label, including the mobile drawer. Recognize legacy published default labels without overwriting stored content; preserve genuinely custom editor labels and links. Do not rename page headings, hero calls to action, or footer labels.
- Give header Contact Office and language controls the same 44px border-box height, centered single-line text, and intrinsic width. Keep the current visual hierarchy and focus rings.
- Keep all header text on one line. The brand icon stays 44px; the brand text may ellipsize when space is constrained, retaining its full accessible name.
- Widen only the header container to a maximum 1440px with 24px side gutters (12px on narrow phones). Other content containers are unchanged.
- Use the existing accessible mobile drawer at widths up to 1200px. Synchronize CSS visibility with its JavaScript desktop-close breakpoint at 1201px. Do not change unrelated 920px page layout breakpoints.

This is preferred to reducing the font size, squeezing the actions, or allowing a second row. The existing drawer already provides an accessible alternative when the full row has insufficient room.

## Implementation and verification

1. Add failing regression tests for compact English/Spanish default labels, legacy published values, equal control heights, non-wrapping layout, and synchronized drawer breakpoints. Preserve existing custom-label tests.
2. Update AppHeader, the public copy catalog, header-scoped styles, and the drawer breakpoint only.
3. Run focused and full tests plus targeted lint. Build a protected production-target deployment without moving the live domain.
4. Verify actual desktop, breakpoint-adjacent, tablet, and phone rendering in English and Spanish: single-line labels, equal 44px controls, no horizontal overflow, menu open/close and resize cleanup, unchanged hero height/color.
5. Promote the verified deployment, push the scoped commits without force, and repeat checks on the canonical domain. No database, provider, email, form submission, package, or authentication changes.

The writing-plans skill is unavailable in this environment; the bounded implementation sequence above is the fallback. Existing blanket approval covers this refinement; no additional design-choice interruption is needed.
