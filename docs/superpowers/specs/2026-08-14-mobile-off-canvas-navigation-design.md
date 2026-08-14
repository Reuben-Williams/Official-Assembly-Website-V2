# Mobile Off-Canvas Navigation Design

**Date:** August 14, 2026  
**Status:** Approved under the owner's standing instruction to accept recommended decisions

## Objective

Replace the public site's mobile navigation expansion with a modern, accessible off-canvas drawer. Opening navigation must never increase the navbar height or move page content. Desktop navigation and builder-managed navigation content remain unchanged.

## Root Cause

`AppHeader` currently renders a `<details class="mobile-menu">` inside the flex-based `.nav-shell`. Its `.mobile-panel` participates in normal document flow. When the details element opens, the panel increases the details and header height, stretching the navbar instead of presenting a separate mobile navigation surface.

## Considered Approaches

### 1. Right-side off-canvas drawer — selected

A fixed drawer slides in from the right over a fixed backdrop. This preserves page context, comfortably fits all public destinations, and matches familiar mobile navigation behavior.

### 2. Full-screen navigation overlay

This offers maximum focus but is visually heavier than necessary for a civic information site and obscures all page context.

### 3. Anchored dropdown panel

This is the smallest structural change, but the site's full mobile navigation is too long for a compact popover. It would also remain close to the current layout-coupled behavior.

## Component Design

`AppHeader` remains a server component so builder-managed labels and bilingual content continue to render in the initial HTML. A focused client component owns only mobile interaction state and receives the server-rendered navigation links as children.

The client component renders the trigger in the header and, when open, portals the backdrop and drawer to `document.body`. Portaling prevents sticky-header filters or stacking contexts from constraining the fixed overlay. The drawer uses existing site colors, typography, border tokens, and spacing.

The drawer contains:

- an office identity heading;
- a dedicated close button;
- the complete public navigation list;
- a visually prominent Contact Office action;
- enough internal scrolling for short landscape screens and long Spanish labels.

The existing language selector stays visible in the header so visitors can change language before or after opening navigation.

## Interaction and Accessibility

- The trigger exposes `aria-expanded` and `aria-controls` and has a localized accessible label.
- Opening moves focus to the close button.
- Tab and Shift+Tab cycle within the drawer while it is open.
- Escape, the backdrop, the close button, or any internal link closes the drawer.
- Closing restores focus to the trigger unless navigation has already moved the document.
- Body scrolling is locked while the drawer is open and restored exactly when it closes or unmounts.
- The current internal route receives `aria-current="page"`.
- The drawer and backdrop animate with a short, restrained transition. `prefers-reduced-motion: reduce` removes that transition.
- The overlay sits below the skip link but above the public header and page content.

## Responsive Behavior

The drawer is full height and `min(88vw, 24rem)` wide on phones, leaving a visible backdrop edge. At wider tablet widths it remains capped at 24rem. The navigation surface has its own vertical scrolling and safe-area padding. Opening it does not alter header dimensions, cause horizontal overflow, or shift the page.

Desktop behavior above the existing 920px breakpoint is unchanged. If the viewport crosses into desktop width while the drawer is open, the drawer closes and scroll locking is removed.

## Content and Localization

New visible and accessible labels are added to both English and Spanish catalogs with exact key parity:

- close menu;
- navigation heading;
- optional menu description.

Builder-managed navigation labels remain the source for destination names. The contact action continues to use the existing builder-managed contact link and bilingual application label.

## Testing

Automated tests must prove:

- the mobile panel is implemented as a fixed dialog/drawer rather than normal-flow `<details>` content;
- trigger state and accessible names are correct in English and Spanish;
- opening, closing, Escape, backdrop click, and link click work;
- focus enters the drawer, is trapped, and returns to the trigger;
- body scroll locking is applied and cleaned up;
- the current route exposes `aria-current="page"`;
- mobile CSS fixes the drawer to the viewport and does not change desktop navigation;
- reduced-motion CSS disables drawer transitions.

Verification includes focused component tests, the full test suite, lint, production build, and browser checks at phone, tablet, and desktop widths for overflow, keyboard control, console errors, and page-content movement.

## Release Boundary

This release changes only public mobile header navigation behavior and its required bilingual labels/tests. It does not alter editor navigation, page content, routes, builder storage, forms, growth data, or provider configuration.
