# Calendar editor usability extension

## Decision and alternatives

Use recoverable Delete event and optional Spanish with English fallback. Permanent deletion would lose recovery and history; mandatory translation continues blocking event publication. Automatic translation alone would risk unreviewed official wording. An optional suggestion-and-confirm flow complements fallback without becoming a publishing dependency.

## Recoverable deletion

Rename the existing archive lifecycle action to Delete event in the staff UI. A confirmation dialog names the event, explains that it disappears from the public calendar and subscription feed, and states that its revisions and history remain recoverable. Cancel and Escape perform no command. Confirm invokes the existing authorized, version-checked archive command; no hard-delete endpoint or permission changes. A Deleted events group offers Restore to Drafts, never automatic republication. Calendar copies already imported into a personal calendar cannot be removed by this website; subscription refresh timing belongs to the calendar app.

## Optional Spanish and truthful fallback

Spanish title, description, and link label are optional. English title/description and the existing dates, office-hosted/public-approved confirmations, location, and media checks remain mandatory for publication. An English action label is required if an action URL is supplied. Empty Spanish stays empty in stored revisions; it is not replaced with copied English or marked translated.

A shared field resolver returns text, actual language, and whether fallback was used. Spanish public pages, staff preview, Google Calendar links, and ICS downloads use original English for each missing Spanish field. Public cards visibly explain when event information is available in English, with language attributes on fallback content. Existing bilingual events are unchanged.

## Optional automatic translation

The editor offers Suggest Spanish separately from Save/Publish. It is unavailable with an explanation when no provider is configured. When configured, staff must confirm sending only the current English title, description, and action label to Google Cloud Translation. Dates, contacts, location, authentication, and other records are not sent. Suggestions appear in a review dialog and never overwrite fields automatically. Staff may edit suggestions and explicitly apply them to the unsaved draft, or cancel. Applying does not save or publish. English edits or event selection changes invalidate pending suggestions. Existing Spanish text must never be silently overwritten.

Use a server-only provider adapter with a bounded request timeout, authenticated calendar-edit authorization, existing origin/CSRF checks, strict text length validation, no-store responses, safe errors, and no secret or draft-text logging. Provider availability is reported without exposing credentials. Google Cloud Translation is an optional externally configured provider, not enabled or purchased by this change.

## Boundaries and database

Keep the existing command/revision/history structure. Replace only the SQL publishability predicate to permit zero-length Spanish within existing upper bounds; preserve grants, English validation, office approval, ownership, and media validation. Do not rewrite old event revisions. Public single-event RPC response handling is a separate bug fix with zero/one/multiple-event regressions; do not create a second production event as a workaround.

## Verification and release

Tests cover English-only publication, partial/full Spanish, missing English rejection, action labels, field language/fallback, Google/ICS output, delete cancel/confirm/error/restore and role restrictions, translation unavailable/provider failure/review/apply/stale response, and one-event RPC rendering. No synthetic production events or newsletter sends. Stage without assigning the live domain, run newsletter readiness and responsive checks, then promote only a successful build. Preserve first three hero photos; caption visibility and approved replacement photos are separate already-authorized work.
