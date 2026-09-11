# Approved community carousel release checkpoint

The owner approved Concept C v5 (readable captions and larger controls) for production on September 10, 2026. This release replaces only the homepage hero composition; existing published hero text, links, banner selection, official profile, forms, and provider settings remain intact.

## Approved collection

The eight WebP files in `public/images/community-carousel/` are unchanged copies of the reviewed assets: existing-site `community.webp`, followed by the owner's Drive display previews DSC09235, DSC09857, DSC09902, DSC09911, DSC09944, DSC00096, and DSC00098. These are authentic photographs, not generated images or original-resolution downloads. DSC09911 and DSC09944 remain consecutive separate slides. Captions describe visible activity and do not invent event dates, names, or outcomes. English and Spanish captions and controls are checked in together in `app/data/community-photos.ts`.

## Verification completed

- 570 tests across 120 files passed (`vitest run --maxWorkers=4 --testTimeout=15000`). The longer timeout accommodates the existing brand verification subprocess on Windows.
- TypeScript completed without errors.
- Targeted ESLint completed without errors or warnings after the image test-double cleanup.
- Existing homepage ordering tests and the visual-verification script now reflect banner, carousel, and service copy order.
- All eight files were checked for actual dimensions; portraits are 1066 × 1600 and use contained framing.

## Initial attempt (resolved)

Staged production deployment `dpl_oLUEP25nMP7erK9jrDuCFVqMm9rV` used `vercel deploy --prod --skip-domain --yes`. It failed before the Next.js build at the unchanged newsletter preflight: `manual_attestation_missing`. All 21 other provider categories passed. Do not disable the newsletter or bypass this check.

The owner needs to review the Resend dashboard, then record **Confirm dashboard review** in the staff editor's Forms / newsletter operations panel, followed by **Run provider inventory**. This records an owner assertion and must not be fabricated by an agent.

The canonical homepage was verified HTTP 200 with the old banner and without the new carousel. Its aliases remain on deployment `dpl_2HwbmD4w8kGa8NcUSTesb4rWxq1A` (commit `160b27f`). No domain promotion, provider writes, form submissions, or email sends occurred.

## Staged QA and production promotion

On September 10, 2026 (Eastern time), the owner recorded the dashboard review. A read-only database check confirmed the review was current; the scheduled worker also matched the recent owner sign-in email to sent and delivered receipts. A fresh build passed the unchanged steady-mode newsletter preflight across all categories. The audit grid in an already-open editor can remain stale because recording a review refreshes status, not the separately stored inventory result.

Production-target deployment `dpl_4nbAKuowd4pQ8E7r8JaDX8dukifc` was staged with `--skip-domain` from application commit `434e9630f5c139d125a3ea1d57679aaac3f5108d`. Next.js built successfully (59 seconds). The deployment was promoted only after rendered QA, and the canonical homepage was then confirmed to display the new carousel.

Rendered checks covered 1440x900, 1280x720, 768x1024, 390x844, and 320x700 viewports. The normal desktop hero ends at the viewport boundary; shorter and narrow screens allow vertical page scrolling so service actions remain inside the section rather than being clipped. No horizontal overflow was found. All eight gallery images loaded. Portraits use contained framing; wide photographs retain the approved cover framing and navy fades. Manual next/previous, consecutive DSC09911/DSC09944 slides, optional playback, moving progress line, gallery selection, Escape dismissal, and focus return were verified. New carousel captions and controls switched to Spanish. Existing published labels and provider settings were not rewritten by this release.

The canonical newsletter CTA navigated to the working signup route and displayed its required fields and consent notice. No form was submitted and no email delivery or broadcast was initiated for this visual release. Production readiness checks are not an end-to-end send test. The protected deployment hostname produced a Turnstile host error during staging; the canonical-domain check did not reproduce that error. A widget cleanup warning on client navigation was observed and is outside the carousel change. Reduced-motion behavior is covered by automated tests; an OS-level reduced-motion browser check was not performed.

The isolated worktree preserves unrelated edits in the original checkout. The previous production deployment `dpl_2HwbmD4w8kGa8NcUSTesb4rWxq1A` remains the rollback reference. No database migrations, provider configuration changes, synthetic records, or outbound sends were performed.
