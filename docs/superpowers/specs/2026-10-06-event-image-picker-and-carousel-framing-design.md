# Event image picker and complete carousel photographs

Date: 2026-10-06
Status: Conversational design approved; independent spec review passed; awaiting the user's written-spec approval.

## 1. Approved outcome and boundaries

Replace the Calendar workspace's event-image dropdown with an inline visual image picker. Repair the recently added homepage carousel photographs so their complete contents are visible on desktop and mobile. The user approved this design after declining browser mockups.

Keep the original photographs and their resolution, the eight-slide collection, first three published slides, existing hero height, navy styling, playback controls, hidden-by-default captions, bilingual accessibility descriptions, volunteer photograph, and unrelated page content. Do not edit event copy or calendar records to create test data. Do not restart Docker or WSL, change provider configuration, send email, or bypass release readiness checks.

## 2. Verified causes

- `app/admin/editor/editor-client.tsx` currently projects managed images into calendar choices containing only `mediaId` and `label`, discarding the existing authorized preview URL.
- `app/admin/editor/calendar-workspace.tsx` renders these names in a native select, so editors cannot visually identify a photograph or flyer.
- `lib/carousel/contract.ts` uses `resetCarouselAppearance` inside `replaceCarouselPhoto`; the reset selects `cover` (Fill the frame), including for replacements with different proportions.
- A read-only live check of slide four found a 2560 by 1707 photograph in a 1265 by 317 `cover` frame. Only about 38 percent of its source height is visible. This is layout cropping, not a damaged source file.
- `CommunityHero.module.css` also applies image masks and overlays in whole-image framing. The repair must keep the navy transition without fading away important parts of a complete photograph.

## 3. Event image picker

### UI and accessibility

Place an inline, searchable thumbnail grid in the existing optional Event image area. Each tile shows the complete image with `contain`, its media-library name, and an unmistakable selected state. Above the grid, show a larger uncropped preview of the current selection with its name and a Remove image button. An unselected event clearly says No image selected; images remain optional.

The grid is responsive and contained in a bounded, scrollable area so a large media collection does not overwhelm the event form. Use existing navy, white, border, focus, and spacing tokens. Tile controls are native `type="button"` buttons with accessible names and `aria-pressed`, usable with Tab and Enter/Space, with at least 44-pixel touch targets. Search is visibly labeled. Do not nest buttons or inputs inside the event-image label.

Selecting an image updates the local event draft's `mediaAssetId`, preview, and dirty state; it does not save or publish automatically. Removing an image sets that identifier to empty and remains an unsaved change until Save draft. Preserve the current draft/save/publish, version checking, validation, permissions, and recoverable deletion behavior.

### Boundaries and data flow

- Add a focused calendar image-picker component with controlled `value`, `onChange`, media choices, `disabled`, loading/error state, and a refresh callback. Keep event command and lifecycle logic in CalendarWorkspace.
- Retain `mediaId`, `label`, authorized preview `url`, and available description/dimensions from the existing managed media collection. Do not build guessed URLs or introduce an unauthenticated image endpoint.
- The picker consumes only this site's existing managed image choices. Persist the media identifier only through the existing event command contract; never persist temporary signed preview URLs in event revisions.
- Pass media loading and error status plus the existing gallery-refresh operation from EditorClient to CalendarWorkspace. Refresh does not reset event fields or the selected identifier.
- Scope the picker styles locally. No new dependency, upload workflow, provider integration, or generic gallery rewrite is required.

### Empty and failure states

Distinguish loading, an empty media library, no search results, and a failed gallery read. Offer Refresh images for retry where applicable. Preserve the existing selection on loading/read failures or when search hides its tile. If a selected identifier is absent from the latest choices, show Image preview unavailable with that identifier retained; staff can explicitly replace or remove it. Never silently clear saved media.

A failed thumbnail shows Preview unavailable and its library name rather than a broken-image icon. Its tile remains unavailable for a new selection until refreshed successfully; a previously selected image is retained. Clear failed-preview state when refresh supplies a different preview URL so renewed signed URLs can load normally. The same rule applies to a failed large preview without falsely declaring that the saved event image has been deleted. Viewer access, deleted-event editing restrictions, and in-progress command restrictions disable image mutation; searching and viewing do not grant editing permission.

## 4. Complete carousel photographs

### Replacement defaults and intentional crops

New photo replacement starts at centered `contain` (Show the whole image) on desktop; mobile inherits that complete framing unless staff explicitly set a mobile override. Clear stale framing, caption-safe behavior, and effects through the existing replacement boundary as before. Keep stable slide identity and require new bilingual accessibility text through existing validation.

Preserve the explicit Fill the frame option for staff who intentionally want a crop. Existing unrelated published revisions are not rewritten by deploying code. Keep Reset photo appearance semantics unchanged unless tests show a direct conflict with the replacement default; the default change belongs to replacement, not an unrequested global reset change.

### Rendering and effects

Render whole-image mode according to framing rather than confusing it with physical photo orientation: landscape and portrait images must both fit completely within the available stage. Reserve space for controls so the lower part of the photo is not obscured. Center the original image without stretching or content-aware editing; unused space stays navy. Retain the existing hero size and accessible mobile minimum-height behavior.

Keep the navy fades in the surrounding stage/background, but do not place an opacity mask or opaque fade over the complete photograph in whole-image mode. Existing Fill the frame slides retain their approved layered fade treatment. Apply the same rules in the public carousel and the editor's desktop/mobile preview, including when those previews use a narrow container.

Zoom must not enlarge/crop a whole-image frame at either device size, even when a stored movement preference is enabled. Preserve the stored preference and allow it to operate in explicit Fill the frame mode. Preserve optional Play, Previous/Next, gallery selection, progress indicator, timing, transitions, and reduced-motion protections.

### Existing recent slides and publication

During implementation, read the latest published carousel using the authenticated owner workflow. Identify the five recent photographs (currently slides four through eight: Connecting at the health fair, Joining in the fun, Conversations about community health, A moment with a resident, and Listening at the health fair). Set their desktop and mobile framing to centered Show the whole image, without changing media, order, captions, alt text, or unrelated appearance settings. Confirm the first three slide references and settings are unchanged.

Use normal draft/save/review/publish commands with their expected-version checks and verified recovery generation. No direct database update or immutable-revision edit. If there are pre-existing unrelated draft changes, a concurrent edit, or changed slide identities, stop the publication step and report the conflict rather than publishing somebody else's edits. This adjustment must create normal tracked history and retain the prior published revision for recovery.

## 5. Validation and release

Use test-first implementation with observed failing tests before code changes.

- Picker tests: actual image URLs and names render; thumbnail/large-preview framing is complete; search; selected highlight; selection and removal reach the existing save payload; selection remains on refresh/read failure; loading/empty/no-results states; broken images; missing selection; viewer/deleted/busy restrictions; native button keyboard behavior without accidental form submission.
- Carousel tests: replacements default to complete framing without mutating input or old immutable revisions; explicit desktop/mobile Fill options remain respected, including mixed fits; whole-image mode avoids masks, overlaid fades, and zoom cropping, including when captions are visible or legacy caption-safe flags are retained; editor preview and public component share behavior; original collection and caption/playback semantics stay intact.
- Run focused calendar and carousel suites, TypeScript and lint, followed by the broader application suite and the normal guarded production build. Report their actual scope; do not claim physical-device or provider-send certification.
- In an authenticated staged preview, visually inspect portrait and landscape photographs in desktop and mobile containers, keyboard focus, grid scrolling, real event selection without saving unrelated content, and existing calendar links. Test caption toggle and playback only as non-persistent viewing actions.
- Release through the existing staged Vercel workflow only when normal brand/newsletter readiness checks pass. Do not weaken guards to ship these UI changes. After deployment handover, publish only the approved recent-photo framing adjustment through the owner workflow and verify the current live homepage and Calendar workspace.
- Finish with a clear live-versus-pending report. Keep Docker/WSL off and preserve unrelated local files, live records, original image assets, and recovery evidence.

## 6. Acceptance

Editors can recognize and choose the event image visually without a filename dropdown. The optional image choice survives draft saving with existing permissions and safeguards. The five recent carousel photographs show their complete subjects and image edges on desktop and mobile; navy surroundings and approved navigation/playback remain intact. Future replacements begin uncropped, and deliberate crop controls still work. No unrelated event, site-content, or provider changes are included.
