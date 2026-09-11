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

## Release blocked; public site unchanged

Staged production deployment `dpl_oLUEP25nMP7erK9jrDuCFVqMm9rV` used `vercel deploy --prod --skip-domain --yes`. It failed before the Next.js build at the unchanged newsletter preflight: `manual_attestation_missing`. All 21 other provider categories passed. Do not disable the newsletter or bypass this check.

The owner needs to review the Resend dashboard, then record **Confirm dashboard review** in the staff editor's Forms / newsletter operations panel, followed by **Run provider inventory**. This records an owner assertion and must not be fabricated by an agent.

The canonical homepage was verified HTTP 200 with the old banner and without the new carousel. Its aliases remain on deployment `dpl_2HwbmD4w8kGa8NcUSTesb4rWxq1A` (commit `160b27f`). No domain promotion, provider writes, form submissions, or email sends occurred.

## Resume after owner review

Use this isolated `codex/community-carousel-release` worktree, not the original dirty checkout. Retain the separate pre-existing card-action test changes in that original checkout.

1. Recheck tests as needed and create a new production-target deployment with `--skip-domain`; keep the production newsletter preflight intact.
2. Verify the actual rendered Next.js page on desktop, tablet, and mobile, including English/Spanish, all portraits, gallery keyboard/focus behavior, Play/Pause and progress, reduced motion, real header/alert height, service buttons, and newsletter navigation. Local rendering is blocked by deliberately absent published-content credentials; do not replace them with synthetic content.
3. Check short-screen/enlarged-text flow for clipping or overlap before promotion. Update layout if visual QA identifies a mismatch with the approved demo.
4. Commit any QA fixes, deploy the final exact commit, then promote only the verified deployment and repeat canonical-domain checks. Push the scoped release to the repository without overwriting unrelated main-checkout changes.

Rendered production QA and the final promotion have **not** been completed yet.
