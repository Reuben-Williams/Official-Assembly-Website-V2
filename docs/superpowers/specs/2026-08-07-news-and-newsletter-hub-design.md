# News and Newsletter Hub Design

**Date:** 2026-08-07  
**Status:** Approved design direction; complete implementation-planning input
**Project:** Official Assembly Website V2

## Objective

Make `/news` the public **News & Updates** hub by keeping published office posts there and adding the live newsletter signup to the same page. Keep `/newsletter` as the dedicated signup, consent, privacy, and confirmation route. In the private editor, label the routes **News & Updates** and **Newsletter signup** so staff can distinguish their purposes.

## Approved approach

Use one shared newsletter-signup section in two public locations:

1. `/news` remains the canonical feed for published legislative and district updates. The newsletter signup appears below the published-post list.
2. `/newsletter` remains a direct, bookmarkable signup route with its current page introduction, consent context, privacy links, and confirmation flow.
3. Both locations render the same `ResidentForm({ type: "newsletter" })` readiness and security path. There is no second submission endpoint and no duplicated provider integration.
4. The public and editor labels become:
   - public `/news` navigation: **News & Updates**
   - private-editor `/news`: **News & Updates**
   - private-editor `/newsletter`: **Newsletter signup**

The public `/newsletter` navigation label remains **Newsletter**, and its metadata title remains unchanged.

This preserves the distinction between editorial content and subscription administration while making signup convenient on the page residents are most likely to visit for updates.

## Alternatives considered

### Link from News to Newsletter only

This would be the smallest change but would add friction and would not satisfy the approved request to make News the combined updates hub.

### Redirect Newsletter to News

This would remove a route, but it would weaken the clarity of the consent and confirmation journey, invalidate existing links, and make the editor less clear. The dedicated route is useful for email links, privacy references, and direct campaigns.

### Duplicate the newsletter form implementation

This would allow independent markup but would create two readiness, Turnstile, consent, and error-handling paths. That duplication is unnecessary and increases the risk that one signup surface behaves differently from the other.

## User experience

### `/news`

The existing page hero, resource cards, and supporting content remain editable and unchanged. The published-post feed remains the primary content. Immediately after the feed, a muted signup section displays:

- Eyebrow: `Email Updates`
- Heading: `Get News & Updates by email`
- Introductory copy explaining that signup uses explicit email confirmation
- The live managed newsletter form, including its consent text, Turnstile verification, privacy links, readiness messages, and truthful fallback state
- A link to the dedicated `/newsletter` page for residents who want the full signup and privacy context

### `/newsletter`

The route remains fully accessible and editable. It continues to display the dedicated page hero and newsletter details, followed by the same managed signup form. Confirmation links and `/newsletter/confirm` behavior do not change.

### Navigation and editor

- The public desktop and mobile navigation label for `/news` is **News & Updates**.
- The private editor Pages accordion label for `/news` is **News & Updates**.
- The private editor Pages accordion label for `/newsletter` is **Newsletter signup**.
- The public `/newsletter` route and its public navigation label **Newsletter** are retained. Changing only its editor label does not change the URL, `navLabel`, or metadata-title fallback.

## Component boundaries

### Shared `NewsletterSignupSection`

A server component owns the section layout and calls `ResidentForm({ type: "newsletter" })`. Its input contract is:

```ts
type NewsletterSignupSectionProps = {
  content: BuilderServerContent;
  regions: {
    eyebrow: string;
    title: string;
    body: string;
    form: string;
  };
  fallback: {
    eyebrow: string;
    title: string;
    body: string;
  };
  showDedicatedPageLink: boolean;
};
```

The News instance sets `showDedicatedPageLink` to `true`; the dedicated Newsletter instance sets it to `false`.

The component does not call Resend, Supabase, or Turnstile directly. `ResidentForm` remains the only public newsletter readiness and form-selection boundary.

### Dedicated page integration

`PageTemplate` replaces only the existing newsletter branch with the shared component. Its conditional rendering boundary is explicit:

- When `slug === "newsletter"`, render exactly one `NewsletterSignupSection` and do not render the existing generic form-section markup.
- When `slug === "contact"` or `slug === "survey"`, keep the existing generic form-section markup and `ResidentForm` behavior unchanged.
- For every other slug, render neither form path.

The dedicated Newsletter instance preserves the existing published region IDs:

- `global.template.form-eyebrow`
- `global.template.form-title`
- `global.template.form-body`
- `newsletter.form`

Keeping these identifiers avoids orphaning or resetting already-published editor content.

### News integration

`app/news/page.tsx` renders the shared section after `PublishedPostList`. It uses new News-scoped editable regions:

- `news.newsletter.eyebrow`
- `news.newsletter.title`
- `news.newsletter.body`
- `news.newsletter.form`

These regions are added to the `/news` entry in `builder.config.ts`, which makes the embedded section independently editable without changing the dedicated newsletter page's published copy.

## Data and security behavior

- Both signup surfaces post to the existing `/api/forms/newsletter-signup` path selected by the approved managed-form projection.
- The existing Supabase-backed form revision, public newsletter readiness checks, explicit consent, double opt-in confirmation, and Resend provider boundary remain authoritative.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is used only in the client-visible Turnstile widget. `TURNSTILE_SECRET_KEY` remains server-only.
- If either Turnstile key, an approved form revision, public readiness, or provider configuration is unavailable, both surfaces fail closed and show the existing truthful alternative instead of an operational form.
- The change does not import synthetic contacts, send a newsletter, activate a provider, or alter subscriber records.

## Editing and history

The new News signup copy uses News-scoped region IDs, so changes are attributed to `/news` and appear in editor history as text or form-section changes. The dedicated newsletter page retains its existing identifiers and history continuity. Page-label changes affect navigation in the editor but do not rewrite stored content revisions.

## Error handling and edge cases

- With no published posts, `/news` still shows the existing empty-feed state followed by the signup section.
- When the newsletter is temporarily unavailable, `/news` and `/newsletter` show the same fail-closed status and district-office fallback.
- A missing or type-mismatched builder region uses the existing `builderText` fallback and does not bypass readiness checks. A total published-content and recovery outage continues to raise `BuilderPublishedContentUnavailableError`; broad route-outage recovery is outside this release.
- A published edit on the dedicated newsletter page does not silently alter the News signup copy; the two text surfaces are intentionally independent while sharing submission behavior.
- A failure of the published-post query continues to fail the `/news` request through the existing route error boundary. Adding a separate feed-error state is outside this presentation/navigation release and the signup is not promised during a total News data-request failure.
- All links and forms retain keyboard focus, pointer affordances, and responsive containment at 390px.

## Test-first acceptance criteria

1. A new unit/render test fails until `/news` contains the managed newsletter form region and the existing newsletter submission action when readiness is mocked as available.
2. A builder-mapping test fails until `/news` declares all four `news.newsletter.*` regions and the two editor labels are updated.
3. A site-data test fails until the public `/news` label is **News & Updates**, while the public `/newsletter` label remains **Newsletter**.
4. Regression tests prove `/newsletter` renders exactly one signup section and that contact and survey rendering behavior is unchanged.
5. Existing newsletter tests continue to prove `/newsletter` is direct, private-data-safe, and fail-closed when readiness is unavailable.
6. Browser QA proves:
   - `/news` shows posts first and signup afterward;
   - `/newsletter` remains directly accessible;
   - both surfaces show a functional live form once readiness and Turnstile are available;
   - the Pages accordion shows the revised labels;
   - desktop and 390px layouts have no horizontal overflow;
   - there are no relevant console errors or failed form/config requests.
7. Production verification confirms the canonical domain serves the changed labels and both signup surfaces after a fresh Vercel deployment. The already-configured production Turnstile variables are a release prerequisite and will be incorporated by that deployment; this design does not create or modify them.

## Release prerequisites

- The separately approved newsletter-readiness activation remains authoritative and must report ready before live-form QA can pass.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` must already exist for the Vercel Production environment.
- This release reads those settings but does not expose the secret, alter their values, activate Resend resources, or change newsletter readiness records.

## Release scope

The release changes only the shared signup presentation, News page composition, route labels, editor region declarations, and their tests/documentation. It does not send a broadcast, create test contacts, modify provider resources, change database schemas, or remove any route.
