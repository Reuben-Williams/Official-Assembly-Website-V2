# Carousel Studio A release checks

## Scope

Site-local Studio A, eight immutable photo slots, shared public/preview rendering, English/Spanish metadata, reviewed publication, media backups, history and restore-as-draft. Existing published photographs are preserved during activation. Private 0.3.0 packages are not republished.

The requested additional account was provisioned with site-scoped Editor membership; no invitation was sent and recipient login remains untested.

## Completed before staging

- Production build compiled, type checked and generated all routes successfully.
- Full application suite: 134 files / 680 tests passed before the final media-inventory addition; focused added checks cover that addition.
- Isolated PostgreSQL database: 56 checks passed, including RLS, revoked membership, stale versions, full-generation preparation, immutable history, restore and owner-only initialization. No production test records.
- Isolated Chromium harness: all eight authentic photos loaded; 320, 390, 768, 1280 and 1600 pixel layouts had no horizontal overflow; reduced motion stops/disables playback; replacement clears descriptions; all four language/device reviews are required.
- Browser baseline import verified eight JPEGs at original dimensions and exact baseline descriptions, ordering and effects.
- Existing media inventory was found expired. An owner-authenticated verification endpoint now checks actual bytes, dimensions, canonical identities, conflicts and membership before recording seven-day evidence. It changes no source images and fails closed on mismatches.
- Migration dry run selects only `20261002025302_carousel_studio.sql`.

## Deployment procedure

Apply the one additive migration. Stage a production-environment deployment with `--skip-domain`. Require production newsletter preflight and staged checks. Promote only the checked artifact. Under the verified owner session, initialize the existing eight-photo baseline through Carousel Studio; verify the canonical homepage and immutable recovery generation afterward.

Before initial activation, authoritative database evidence that no carousel-aware generation ever existed permits the original public renderer. After activation, primary and recovery failures yield a bounded unavailable message, never old checked-in content.

## Rollback boundary

Before carousel activation, the previous production deployment remains a safe rollback target; additive tables may remain unused. After activation, do not roll back to a renderer/worker that lacks carousel-aware recovery support. Prefer a corrected forward release, or restore an earlier carousel revision as a new reviewed draft. Never delete immutable revisions, command receipts, media, or recovery artifacts as rollback cleanup.

## Remaining verification at this checkpoint

Production build/preflight, canonical owner activation and post-deployment checks. Physical-device testing and the invited Editor's personal sign-in are not represented by automated browser checks.
