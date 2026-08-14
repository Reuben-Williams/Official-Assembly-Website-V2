# Mobile Off-Canvas Navigation Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-14-mobile-off-canvas-navigation-design.md`  
**Scope:** Public shared header mobile navigation only

## Phase 1 — Regression contract

1. Add a focused component test for the mobile navigation client island covering accessible dialog semantics, initial closed state, open/close state, backdrop and inside-panel clicks, Escape, focus containment, focus restoration, body scroll locking, route changes, and the 921px breakpoint.
2. Add route-matching unit cases for Home, trailing slashes, queries/fragments, same-origin absolute hrefs, cross-origin hrefs, and `/news/[slug]`.
3. Extend server header tests with non-empty builder content and exact English/Spanish labels and metadata.
4. Add source/CSS assertions proving the mobile surface is viewport-fixed, outside normal header flow, reduced-motion safe, and non-regressive for desktop navigation.
5. Run the focused tests and confirm they fail only because the drawer implementation is absent.

## Phase 2 — Minimal implementation

1. Add exact `global.header.close-menu` English and Spanish catalog entries.
2. Extract a server-side mobile descriptor resolver that preserves builder order, overrides, and editing metadata.
3. Add a client `MobileNavigation` component with body portal, modal semantics, focus containment, close reasons, pathname matching, breakpoint cleanup, and scrollbar-compensated scroll locking.
4. Replace the normal-flow mobile `<details>` markup in `AppHeader` with the client component while leaving desktop rendering unchanged.
5. Add scoped off-canvas, backdrop, active-route, contact-emphasis, short-screen scrolling, and reduced-motion CSS.
6. Run focused tests until green, then refactor only within the new component boundary.

## Phase 3 — Verification

1. Run the complete test suite and lint.
2. Run the production build and package/migration lineage checks already required by the repository.
3. Launch the production build locally and verify at phone, short-landscape, tablet, and desktop widths.
4. Confirm header height, main-content position, scroll position, and horizontal overflow before/open/closed.
5. Verify mouse, touch, keyboard, Spanish copy, current-route state, Back/Forward closure, `/admin/login`, and mocked/authenticated editor-header behavior.
6. Check console and network output for errors.

## Phase 4 — Release

1. Review the exact diff and ensure the unrelated walkthrough file is excluded.
2. Commit and push the scoped branch.
3. Open a pull request, wait for checks, merge after green, and verify the resulting Vercel production deployment.
4. Re-run production smoke checks on the canonical domain without creating or modifying visitor, form, growth, editor, or newsletter data.
