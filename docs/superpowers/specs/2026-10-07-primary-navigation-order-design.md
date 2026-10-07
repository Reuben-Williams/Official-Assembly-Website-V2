# Primary navigation order correction

## Approved direction and scope

The owner explicitly requests Home, About, Resources, Events, News, Voting, in that order. Existing standing approval covers implementation and production release of this bounded correction. This supersedes the older meeting-release decision not to add Events to primary navigation. No new design choice is needed.

## Behavior

- Desktop primary navigation uses exactly the six requested destinations by default.
- Mobile primary navigation uses the same six destinations in the same order, followed by the existing emphasized Contact utility link. Header language and Contact Office actions remain unchanged.
- Community, newsletter, survey, and social pages remain intact and accessible through existing non-primary links. No page or content is deleted.
- English and Spanish labels continue using the existing localization catalog; News stays compact.
- Previously published custom navigation order, labels, and links remain authoritative. A read-only production check found no published global.navigation value, so no migration or compatibility rewrite is required.
- Events link and label receive stable global builder-region registration so staff can edit them like other primary links.
- Preserve navy styling, 44px action heights, single-line header layout, responsive breakpoint, drawer focus handling, and reduced-motion behavior.

## Implementation and verification plan

1. Add failing component tests for exact desktop/mobile order in both languages, exclusion of Community from default primary navigation, and registration of editable Events regions. Retain existing custom-order and accessibility tests.
2. Build the default list from an explicit ordered sequence rather than filtering the page catalog. Append Contact only to the default mobile list; do not append it to a published custom list.
3. Add the two Events navigation regions to builder.config.ts. No schema, provider, credential, email, or database writes.
4. Run focused navigation/config tests, full unit suite, TypeScript, and lint. Stage a production-environment build without changing the live domain; the existing newsletter readiness guard must pass.
5. Verify staged header and Events route, then release the tested build and push only scoped commits. Verify the final canonical domain, both languages, desktop and narrow mobile navigation, link activation, console health, and no horizontal overflow.

## Recovery and limits

The previous production deployment remains available for rollback. Preserve unrelated dirty/untracked files and the protected official headshot. Browser checks are scoped to navigation, not a retest of every form or physical mobile device. Do not restart Docker or WSL.
