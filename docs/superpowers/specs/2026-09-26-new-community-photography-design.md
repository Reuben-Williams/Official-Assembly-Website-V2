# September 26 community photography refresh

## Decision and scope

The user approved the recommended placement plan with “Proceed,” then approved this written specification with “Approved spec” on September 26, 2026. This is a photo-and-caption update, not a layout redesign or a newsletter/provider change.

Use five authentic originals from the user-supplied Google Drive folder `1tFoxvxB6N9v1H5wMUHRi_OgdOw-wt66_`, named Puerto Rican Parade 2026, Photos subfolder `1AOqwDGv_Lzu_YpW8WSTn2UN7RU_8TreS`. The inspected originals and source inventory are retained at `D:/Project Morales/photo-review-september26/`. Folder naming supplies provenance, not proof of specific participants' roles or an exact event date.

## Exact placements

| Surface | New original | Change |
| --- | --- | --- |
| Homepage carousel, slide 1 | DSC09013.jpg | Replace the old opening flag/group photograph with the new street group photograph |
| Homepage carousel, slide 7 | DSC09399.jpg | Replace the outdoor office-table photograph with Morales walking beside a man under an umbrella |
| Community, main image | DSC09418.jpg | Morales smiling and waving |
| Community, supporting image | DSC09192.jpg | Group posing for a selfie |
| Social, main image | DSC09212.jpg | Morales and a woman smiling together |

Keep eight slides total. Slides 2 (stadium) and 3 (backpacks), including their files, captions, crops and order, remain unchanged. Slides 4 (gymnasium group), 5 (greeting a child), 6 (certificate in the chamber), and 8 (chamber group) also remain unchanged. The new first-slide approval supersedes only the first-slide preservation constraint in the September 14 spec; all other retained-photo constraints remain.

Keep the official About portrait, homepage volunteer office group, Social supporting photo, all other page photos, photo-free newsletter and confirmation surfaces, and the original archives. Cultural content in authentic photographs must not be erased or retouched. Two nonconsecutive new carousel photos give the new collection visibility without replacing the mixed-event sequence.

## Media pipeline and integration

Extend the existing approved community-editorial collection and its reproducible preparation script. Retain byte-identical originals, source filenames and Drive file URLs, SHA-256 hashes, dimensions, approval date, bilingual alt/caption text and actual placements in the manifest. Update old assets' placement records when replaced; do not delete them. Do not misdate the earlier assets' approvals when adding the September 26 selections.

Generate aspect-ratio-preserving WebP derivatives with the current 1600px desktop and 800px mobile maximum long edges, quality 88, and no enlargement. No generative reconstruction, compositing or new identity inference. Refuse mismatched original hashes rather than overwriting an approved source.

Update only carousel records 1 and 7 in `app/data/community-photos.ts`, and the three page mappings in `app/data/editorial-media.ts`. Preserve region IDs, component interfaces and custom published editor overrides. Do not expand retired-source substitution globally or mutate production editor records. If a custom published override prevents an approved new photo from appearing, report the specific conflict rather than silently erasing it.

Keep the navy fades, hero height/layout, one-image-per-slide presentation, still-by-default playback, Previous/Next, optional Play/Pause, gallery, progress indicator, keyboard focus handling and reduced-motion behavior. Page portraits use the existing full-frame presentation. Landscape framing must keep Morales's head visible on mobile and desktop; prefer containment or a per-image focal position within the existing interface if cover cropping fails. DSC09418 has a hand partly outside the original frame; do not imply missing source content can be restored.

## Text and accessibility

Write factual English and Spanish captions/alt text describing visible activity: group photograph on a street, walking together under an umbrella, waving, group selfie, and sharing a smile. Do not call people volunteers, constituents or officials, or invent achievements, dates or locations. Change both language records alongside each photograph so the previous image's description cannot persist accidentally. Maintain current keyboard labels and caption contrast.

## Verification and release boundaries

1. Add failing regression tests for the five placements and eight-slide sequence. Pin the unchanged records and asset hashes, especially stadium and backpacks; retain provenance, original-hash, derivative and override-preservation checks.
2. Generate assets through the established script and implement the scoped mapping/text changes. Run focused media, carousel, page and editor tests, then lint, TypeScript, brand checks and the full suite. Report unrelated failures accurately instead of weakening gates.
3. Inspect the changed surfaces at 320px, 768px and 1440px in English and Spanish. Verify complete heads, photo loading, no overflow, readable captions, first-slide selection, all eight gallery entries, Previous/Next, Play/Pause and progress. Retain existing form/newsletter/navigation smoke checks without sending messages or creating records.
4. Use the existing protected preview and production readiness/build gates. Do not disable protection, change providers or run recovery actions to unblock a photo release. If credentials or a readiness failure block release, keep changes staged and report the actual blocker.
5. Publish one scoped release only after checks pass. Wait for the canonical deployment to settle before fresh-context production QA, avoiding overlapping deployment/alias changes. Recheck changed surfaces and existing controls on the canonical site. Preserve the previous deployment and source commit as rollback references; do not claim launch until verified.

Browser emulation is not physical-device testing, and form rendering/readiness does not establish email delivery. No external emails, subscriptions, staff sessions or database records are created by the photo QA.

## Implementation plan boundary

After written review, implement in this order: regression expectations; source-governed derivative generation; bilingual mappings; focused/full checks; preview visual review; scoped production release and settled-deployment checks. The writing-plans skill is not available in this session, so a bounded step-by-step plan will be recorded using the existing repository conventions rather than assuming an unavailable skill ran.
