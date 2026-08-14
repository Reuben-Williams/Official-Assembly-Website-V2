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

`AppHeader` remains a server component so desktop navigation, builder-managed labels, and bilingual content continue to render in the initial HTML. A focused client component owns only mobile interaction state. The server resolves the ordered mobile link descriptors and passes serializable slug, href, label, and builder metadata into that client boundary.

The client component renders the trigger in the header and portals an always-mounted-after-hydration overlay to `document.body`. Portaling prevents sticky-header filters or stacking contexts from constraining the fixed overlay. Closed state uses inert, non-focusable, visually hidden overlay content instead of unmounting, so both opening and closing transitions can complete. The drawer uses existing site colors, typography, border tokens, and spacing.

The mobile drawer intentionally depends on hydration for interaction. Desktop navigation and footer navigation remain server-rendered discovery paths, and `renderToStaticMarkup(<AppHeader locale="es" />)` remains document-safe, but the specification does not claim that the mobile drawer is operable when JavaScript is disabled. This is an explicit replacement of the current native `<details>` fallback.

The drawer contains:

- an office identity heading;
- a dedicated close button;
- the complete public navigation list;
- a visually prominent treatment for the existing Contact destination, without rendering a duplicate Contact action;
- enough internal scrolling for short landscape screens and long Spanish labels.

The existing language selector stays visible in the header while the drawer is closed. The modal backdrop and focus containment intentionally make it unavailable while the drawer is open; visitors close the drawer before changing language.

## Interaction and Accessibility

- The trigger exposes `aria-expanded` and `aria-controls` and has a localized accessible label.
- The panel is `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` by its visible navigation heading. Its nested `<nav>` has its own localized label. Decorative icons and the backdrop are hidden from assistive technology, and pointer interaction outside the drawer is blocked.
- Opening moves focus to the close button.
- Tab and Shift+Tab cycle within the drawer while it is open.
- Escape, the backdrop, the close button, or an unmodified internal-link activation closes the drawer. Clicking inside the drawer never dismisses it through backdrop bubbling. Modified or new-tab link activation leaves the current drawer open.
- Close button, Escape, and backdrop dismissal restore focus to the trigger. Link activation, pathname change, browser Back/Forward, desktop-breakpoint change, and unmount close without attempting to focus a hidden or obsolete trigger.
- Body scrolling is locked while the drawer is open. The implementation preserves the existing inline overflow and padding styles, compensates for removed scrollbar width, preserves scroll position, and restores the exact original styles. Setup and cleanup are idempotent under React Strict Mode, route changes, unmount, and breakpoint changes.
- `usePathname()` owns current-route matching inside the mobile component. `/` matches only Home; a trailing slash is normalized; same-origin internal paths are eligible; builder-managed absolute/external URLs are never current; and `/news/[slug]` marks News & Updates current. `aria-current="page"` applies only to mobile drawer links, leaving desktop output unchanged.
- The drawer and backdrop animate with a short, restrained transition. `prefers-reduced-motion: reduce` removes that transition.
- The overlay uses a layer above the current header (`z-index: 50`) while the skip link moves above the modal layer when focused. This preserves keyboard escape from repeated navigation without allowing ordinary page interaction through the backdrop.

## Responsive Behavior

The drawer is full height and `min(88vw, 24rem)` wide on phones, leaving a visible backdrop edge. At wider tablet widths it remains capped at 24rem. The navigation surface has its own vertical scrolling and safe-area padding. Opening it does not alter header dimensions, cause horizontal overflow, change main-content position, or shift the page when the scrollbar disappears.

Mobile behavior applies at the existing `max-width: 920px` boundary; desktop behavior begins at 921px and remains visually unchanged. A synchronized `matchMedia("(min-width: 921px)")` listener closes the drawer without focus restoration and removes scroll locking when the viewport crosses into desktop width. The listener is removed on unmount.

## Content and Localization

Catalog behavior is exact and testable:

| Key | English | Spanish | Use |
| --- | --- | --- | --- |
| `global.header.open-menu` | `Open menu` | `Abrir menú` | Reuse for the closed trigger |
| `global.header.mobile-navigation` | `Mobile navigation` | `Navegación móvil` | Reuse for the visible heading and nested navigation label |
| `global.header.close-menu` | `Close menu` | `Cerrar menú` | Add for the close button and open trigger state |

No menu description is added. The office heading reuses the builder-resolved `global.header.brand` value rather than adding static catalog copy.

Builder-managed navigation labels remain the source for destination names. The server-to-client descriptor conversion preserves the `global.navigation` section order, overridden hrefs and labels, item IDs, `data-builder-region`, `data-builder-kind`, and the distinct `mobile` builder instance. Contact remains one builder-managed destination and receives prominent styling in place; it is not duplicated.

## Testing

Automated tests must prove:

- the mobile panel is implemented as a fixed dialog/drawer rather than normal-flow `<details>` content;
- trigger state and accessible names are correct in English and Spanish;
- opening, closing, Escape, backdrop click, and link click work;
- clicking inside the panel does not dismiss it, and modified/new-tab link activation does not close the current document's drawer;
- focus enters the drawer, is trapped, and returns to the trigger;
- body scroll locking, scrollbar compensation, preserved scroll position, and exact style restoration work under close, route change, breakpoint change, Strict Mode, and unmount;
- exact route, Home, trailing-slash, external builder href, and post-detail matching produce the intended mobile-only `aria-current="page"` behavior;
- pathname changes and Back/Forward close without focus races, and all listeners are cleaned up;
- a non-empty `BuilderServerContent` fixture preserves mobile order, overridden labels/hrefs, region metadata, item IDs, and the single Contact destination through the client boundary;
- mobile CSS fixes the drawer to the viewport and does not change desktop navigation;
- reduced-motion CSS disables drawer transitions.

Browser checks compare header height, main-content position, scroll position, and `scrollWidth <= clientWidth` before opening, while open, and after closing. Verification also includes focused component tests, the full test suite, lint, production build, and checks at phone, short-landscape, tablet, and desktop widths for keyboard control, console errors, active routes, long Spanish labels, and internal panel scrolling.

## Release Boundary

`AppHeader` is mounted by the root layout on public, `/admin`, and `/auth` routes, so the corrected mobile drawer behaves consistently wherever that shared header appears. Regression checks cover a public route plus `/admin/login` and `/auth/callback`. The release does not alter editor workspace navigation, page content, routes, builder storage, forms, growth data, or provider configuration.
