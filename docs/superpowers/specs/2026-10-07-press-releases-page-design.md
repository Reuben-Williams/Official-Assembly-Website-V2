# Press Releases under News

## User-facing design

Add a dedicated `/news/press-releases` page using the established navy/cream,
mobile-first site design, with English and Spanish navigation and static copy.
It appears under News in desktop and mobile navigation, alongside All News.
Keep the exact primary order: Home, About, Resources, Events, News, Voting.

Use existing staff Posts, not a second publishing system. A post belongs to this
page when its category key is `press-releases`. A clear editor hint explains that
category. Publish remains required; drafts and archived or expired content are
never included. Existing English/Spanish publishing rules remain authoritative.

## Page and navigation behavior

The page queries only published, unexpired posts in that category using the
existing site-scoped content repository. Entries link to the normal `/news/slug`
detail pages. Show a truthful bilingual empty state when there are no releases;
do not create sample releases. If the data source fails, show an unavailable
state rather than claiming there are no releases.

News remains a navigable top-level link. Its adjacent disclosure button opens
the submenu by click, touch or keyboard; it is not hover-only. Support Escape,
outside click, visible focus and correct expanded state. The mobile menu uses
the same children without changing its existing full-height drawer behavior.

Reserve `press-releases` from new post slugs so a post cannot be hidden by the
new static route. Check existing published/draft slugs before activation; if
that slug is already in use, retain its content and resolve the conflict before
launch rather than silently replacing it.

## Verification and release

Test category filtering, no draft exposure, reserved-slug validation, both
locales, empty/error states, metadata/canonical links and desktop/mobile keyboard
navigation. Use a local fixture to test a published release without inserting
fake production content. Stage and verify the production candidate, then promote
the same tested build. No newsletter, media, hero or resident data changes are
included in this feature.
