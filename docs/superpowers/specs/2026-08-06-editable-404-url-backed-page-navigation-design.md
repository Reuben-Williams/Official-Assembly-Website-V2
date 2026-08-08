# Editable 404 Page and URL-Backed Editor Navigation Design

Date: 2026-08-06
Status: Approved design

## Objective

Add a real public 404 response whose visible content can be edited through the private Site Editor, and make every Pages-accordion selection reliably switch the editable preview. The selected editor page must also survive refresh, support bookmarking, and participate in browser Back and Forward navigation.

## User-visible success criteria

- Any unknown public URL renders a branded page-not-found view with HTTP status 404.
- The Pages accordion contains one non-navigation entry labelled `404 - Page not found` at the canonical editor path `/404`.
- The 404 eyebrow, heading, explanation, image, primary link, and secondary link can be selected, saved as drafts, published, and restored through history like other page regions.
- The 404 page is not added to the public header or footer navigation.
- Published 404 edits appear on every unknown public URL; a mistyped URL does not create a new independent content record.
- Clicking any page inside the open Pages accordion immediately updates the iframe, active-page styling, and `Editing ...` label.
- The editor URL records the selection as `?path=<page path>` while preserving unrelated parameters such as `workspace`.
- Reloading or bookmarking the editor restores the selected page.
- Browser Back and Forward restore earlier page selections without reloading the entire editor shell.
- Invalid, malformed, or no-longer-registered `path` values safely fall back to `/` and never make the preview request an arbitrary URL.

## Existing system constraints

- The application currently has no `app/not-found.tsx`; missing routes use Next.js's default not-found output.
- `builder.config.ts` is the source of the editor Pages accordion and currently has no `/404` entry.
- `EditorClient` owns `currentPath` in React state and passes it with `onPageChange` to `AttachedSiteEditor`.
- The installed editor package already renders page entries as progressively enhanced links, invokes `onPageChange`, keys the iframe by `currentPath`, and uses `currentPath` to construct the iframe URL.
- The existing client test only proves that a helper returns a callback; it does not render a selection, observe a state transition, inspect the iframe URL, or exercise browser history.
- `BuilderDomContentBridge` normally uses `window.location.pathname` as its content-record path. For an actual missing URL such as `/mistyped-page`, that default would load `/mistyped-page` rather than the canonical editable `/404` record.
- Root layout already supplies the shared public header, footer, and builder bridges, so the custom not-found component should provide only the page-specific main content.

## Considered approaches

### 1. React-state-only patch

Keep page choice solely in `useState` and add another callback test. This is the smallest change, but it closely matches the current implementation, would not survive refresh, and would not address the missing integration coverage that allowed the reported failure. Rejected.

### 2. URL-backed controlled preview

Keep the iframe controlled by React while treating a validated `path` query parameter as durable navigation state. Page selection updates both React and `history.pushState`; `popstate` restores prior selections. Add an integration-level regression test that observes the iframe. Chosen.

### 3. Full editor reload per page

Allow every page link to navigate the entire editor document to a new query string. This is robust but slower and discards transient shell state, selections, and workspace context. Retain only as the progressive-enhancement behavior when JavaScript is unavailable; do not use it as the primary interaction.

## Chosen architecture

### 1. Canonical editable 404 view

Add `app/not-found.tsx` and a small reusable 404 presentation component. The route uses normal Next.js not-found semantics, so both `/404` and arbitrary unknown routes render the custom view with a 404 status rather than introducing a public 200-status `/404` page.

The view uses restrained, factual fallback content:

- eyebrow: `Page not found`;
- heading: `We couldn't find that page.`;
- explanation that the page may have moved or the address may be incorrect;
- a primary link to Home;
- a secondary link to Resources;
- an existing approved site image, with reviewed fallback alt text.

The page root carries a canonical builder-content marker for `/404`. Its editable DOM regions are:

- `404.hero.eyebrow` as text;
- `404.hero.title` as text;
- `404.hero.body` as text;
- `404.hero.image` as image;
- `404.hero.primary-cta` as link;
- `404.hero.secondary-cta` as link.

The component retains semantic heading order, visible keyboard focus, useful link text, and a responsive layout. The root layout's globally editable header and footer remain present.

Register `/404` in `builder.config.ts` with label `404 - Page not found` and the exact regions above. Do not add a `PageContent` item to the public `pages` navigation catalog and do not add `/404` to any header/footer link list.

### 2. Canonical 404 content resolution

Extend the site-local `BuilderContentBridge` into a route-reactive resolver keyed by Next.js `usePathname()`. On every initial render or App Router pathname change, the resolver enters a pending state for that exact route, withholds `BuilderDomContentBridge`, and uses a layout effect after the new route DOM commits to read the application-owned canonical marker. It then records `{ routePath, contentPath }` and mounts a keyed `BuilderDomContentBridge` only when the resolved `routePath` still equals the current pathname. A stale result from a superseded route is discarded.

The existing DOM bridge aborts its fetch during effect cleanup. Withholding the bridge while path resolution is pending and keying the resolved bridge by route/content path ensures an old known-page or 404 request cannot remain active or apply its content to the next route's DOM. The resolver passes `/404` when the committed not-found marker is present and the actual pathname otherwise.

This produces two deliberate identities:

- the HTTP/request path remains the visitor's unknown URL, preserving correct address-bar and 404 behavior;
- the content-record path is always `/404`, so one reviewed draft and published version controls every not-found view.

The private editor selects `/404`, previews `/404?builderPreview=1`, saves page regions under `/404`, and publishes `/404`. A public request for `/anything-missing` renders the same component and applies the published `/404` regions. Global regions continue to resolve through the platform's existing global-content record.

The canonical-path override is limited to the exact allowlisted `/404` value on a rendered marker owned by the application. Query parameters and user-supplied unknown path segments cannot choose an arbitrary builder record. Direct-load and known-to-unknown-to-known navigation tests must prove that no visitor-specific unknown path is ever requested from the builder service, that stale requests are aborted, and that 404 content is never applied to a known page.

### 3. URL-backed page selection

Replace the bare `setCurrentPath` callback with a small, testable navigation controller in `EditorClient`. `app/admin/editor/page.tsx` receives the server-side `searchParams`, validates the single `path` value against `site.pages` with a shared pure resolver, and passes a required `initialPath` to `EditorClient`. The editor initializes `useState(initialPath)` and does not mount first with `/` when a valid bookmark selects another page. An array-valued, malformed, external, or unregistered value resolves to `/` server-side.

At initialization:

1. The server reads and validates the `path` query parameter before rendering the editor client.
2. It normalizes the candidate using the same path rules as the editor package.
3. It accepts the candidate only when it exactly matches a configured `site.pages` path.
4. It passes the validated page or `/` as `initialPath`, so the first audit request and iframe use the correct path.
5. After hydration, the client canonicalizes an invalid value with `history.replaceState` without disturbing other query parameters.

When the Pages accordion or an internal preview link selects a configured page:

1. Validate and normalize the requested path against `site.pages`.
2. Clear any selection state tied to the old iframe through the editor package's existing remount behavior.
3. Set `currentPath`, causing the `Editing ...` label, active page, data requests, and keyed iframe source to update.
4. Preserve all existing query parameters and set only `path`.
5. Use `history.pushState` when the effective page changes; repeated selection of the active page creates no duplicate history entry.

Register a `popstate` listener while the editor is mounted. It re-runs the same validated query-to-path resolver and updates React state without pushing another entry. Remove the listener on unmount. The client never derives an iframe or builder request from an unvalidated raw query value.

The existing anchor `href` remains intact as a no-JavaScript/full-reload fallback. The enhanced click continues to prevent the reload only when the controlled callback is available.

### 4. Defect localization and package boundary

Implementation begins with a failing site-level integration test that reproduces the reported behavior using the installed package. The test must click a rendered Pages entry and assert the editor's controlled path and iframe URL change.

- If the failure is in `EditorClient` URL/state ownership, fix it only in this client repository.
- If the callback is demonstrably lost inside the installed editor package, add the smallest failing package test and package fix in the platform repository, publish one pinned private package version, and update this client's lockfile.
- Do not publish a new private package merely because the client test was previously shallow.

## Data flow

```text
Pages click or preview navigation
  -> validate requested path against builder.config pages
  -> update EditorClient currentPath
  -> preserve query parameters and push ?path=...
  -> AttachedSiteEditor receives the new controlled path
  -> audit/media draft reads use the new page path
  -> iframe remounts at the selected editable route

Unknown public URL
  -> Next.js renders app/not-found.tsx with HTTP 404
  -> not-found view declares canonical builder path /404
  -> BuilderDomContentBridge loads published /404 regions
  -> visitor keeps the originally requested URL and receives the shared edited 404 content
```

## Error handling and recovery

- Invalid editor `path`: resolve it to Home on the server, replace it with the safe Home selection after hydration, and never mount an iframe or issue a builder request for the invalid value.
- Removed page bookmarked in an older URL: fall back to Home while preserving unrelated parameters.
- Repeated selection of the active page: make no history entry and leave the current iframe stable.
- Back or Forward resolves an invalid historical value: apply the same Home fallback without starting a push-state loop.
- Builder draft/published content unavailable: retain the component's factual fallback 404 copy and let the existing editor service error remain visible.
- Editable 404 image unavailable: retain the checked-in fallback image and alt text; never render an invented or broken placeholder.
- Package integration test fails before the callback reaches the host: stop and repair the package boundary before changing unrelated site state.

## Testing strategy

Implementation follows test-driven development: each behavior change begins with a focused failing test.

### Unit and contract tests

- `builder.config.ts` includes exactly one `/404` page and the six declared editable regions.
- Public navigation data does not include a visible 404 destination.
- The not-found view renders all editable region identifiers, canonical `/404` marker, one `h1`, and useful fallback links/image alt text.
- Canonical builder-path resolution returns `/404` only for the application-owned marker and returns the real pathname for normal pages.
- Server and client query parsing share one resolver that accepts every configured page, normalizes trailing slashes consistently, and rejects external, array-valued, malformed, unknown, query-bearing, or hash-bearing values.
- Query updates preserve `workspace` and unrelated parameters.
- Selecting the active page does not create a duplicate history entry.
- `popstate` updates current state without calling `pushState`.
- The route-reactive builder-content resolver withholds the DOM bridge while unresolved, discards a stale route result, accepts only the exact `/404` marker, and keys the bridge by resolved route/content path.

### Editor integration regression

- Render the editor host with the installed package, open Pages, click About, and assert:
  - the callback reaches the host;
  - `Editing /about` is shown;
  - About has `aria-current=page`;
  - the iframe `src` contains `/about` and the builder-preview parameters;
  - the editor address contains `path=%2Fabout`;
  - existing parameters are preserved.
- Click 404 and assert the iframe loads `/404` in editable preview mode.
- Dispatch Back and Forward navigation and assert the iframe follows the historical path.
- Reload from a bookmarked `?path=%2F404` URL and assert the first iframe and first page-scoped builder request use `/404`, with no intermediate Home request.
- Load an invalid bookmarked path and assert the first iframe and first page-scoped builder request use Home, with no intermediate request for the malformed value.
- Navigate known -> unknown -> known in the public App Router and assert the builder requests only the known route, `/404`, and the next known route in order; stale requests are aborted and 404 content is never applied to known-page DOM.

### Route, build, and browser verification

- Against `next build` plus `next start`, a random single-segment miss, random nested miss, unavailable dynamic-news route, and `/404` must each return HTTP 404 and render the branded fallback. This is a blocking architecture and deployment gate, not an informational assertion.
- Treat globally unmatched routes and matched dynamic routes as separate status gates. If a globally unmatched single- or multi-segment URL returns 200, do not deploy: enable the installed Next.js `experimental.globalNotFound` fallback and add `app/global-not-found.tsx` as a complete document using the same not-found presentation, required global styles/font setup, public header/footer, and builder bridges.
- `global-not-found.tsx` is not a fallback for a matched route such as `/news/[slug]` that later calls `notFound()`. Keep that availability decision ahead of returned JSX and any route-level `loading.tsx` or Suspense streaming boundary. If the production-build probe still returns a soft 200, add a narrow Node-runtime `proxy.ts` matcher for `/news/:slug` that reuses the exact public post-availability predicate. An unavailable post receives a status-404 `NextResponse.rewrite` to the canonical 404 renderer while preserving the visitor's original URL; available posts continue to the existing route. The proxy must exclude the `/news` index and application/API assets, perform no mutation, use no cache, and expose no draft or internal status detail.
- Re-run the status, body, canonical-content, editor-preview, accessibility, known-route, available-post, unavailable-post, and proxy-error regression tests after either fallback. A provider or availability-check failure must return the route's explicit service-error behavior rather than falsely classifying a potentially available post as missing. Shipping remains blocked until globally unmatched and matched-unavailable categories both produce true 404 responses.
- Published `/404` region content appears on a different unknown URL.
- Known routes continue to return their existing successful statuses.
- Run the repository test suite, lint, and production build.
- In an authenticated editor session, verify Pages selection, active styling, iframe navigation, refresh persistence, Back/Forward, draft save, publish, and history restore at desktop and mobile widths.
- Verify the production site's random missing route, direct `/404`, console, network failures, overflow, image loading, and keyboard focus.

## Rollout and rollback

1. Add failing site tests for the missing 404 contract and real page-selection integration.
2. Implement the custom 404 component, builder registration, and canonical content-path bridge.
3. Implement validated URL-backed navigation and Back/Forward synchronization.
4. If and only if the integration test proves a package defect, repair and publish the smallest pinned private package update before updating this application.
5. Run automated tests, lint, production build, local `next start` HTTP-status probes, and browser verification. Stop if any missing route is not a true 404; apply the globally unmatched or matched-dynamic fallback specified for that category before continuing.
6. Record the current production Vercel deployment identifier, application commit, lockfile digest, and installed private package versions as the explicit rollback baseline.
7. Deploy the exact verified application and pinned lockfile to a Vercel preview, then verify public 404 behavior and authenticated editor navigation.
8. Promote the verified build to production and repeat the focused smoke checks.

Code rollback redeploys the recorded prior Vercel deployment or reverts the application and any pinned package update to the recorded baseline. Published `/404` content is retained as normal editor history; rollback does not delete production content records.

## Non-goals

- Adding 404 to the public header or footer navigation.
- Returning HTTP 200 for missing pages.
- Creating a separate editable record for every unknown URL.
- Allowing arbitrary query parameters to select builder content records or iframe destinations.
- Redesigning normal public pages, the editor shell, posts, media, growth modules, forms, or provider integrations.
- Inserting synthetic or placeholder production records.
