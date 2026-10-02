# Carousel Studio A release checks

## Scope

Site-local Studio A, eight immutable photo slots, shared public/preview rendering, English/Spanish metadata, reviewed publication, media backups, history and restore-as-draft. Existing published photographs are preserved during activation. Private 0.3.0 packages are not republished.

The requested additional account was provisioned with site-scoped Editor membership; no invitation was sent and recipient login remains untested.

## Completed before staging

- Production build compiled, type checked and generated all routes successfully.
- Final full application suite: 135 files / 687 tests passed with two workers. The unrestricted parallel run had one 5-second navigation-test timeout; the bounded rerun passed without increasing the timeout or weakening assertions.
- Isolated PostgreSQL database: 56 checks passed, including RLS, revoked membership, stale versions, full-generation preparation, immutable history, restore and owner-only initialization. No production test records.
- Isolated Chromium harness: all eight authentic photos loaded; 320, 390, 768, 1280 and 1600 pixel layouts had no horizontal overflow; reduced motion stops/disables playback; replacement clears descriptions; all four language/device reviews are required.
- Browser baseline import verified eight JPEGs at original dimensions and exact baseline descriptions, ordering and effects.
- Existing media inventory was found expired. An owner-authenticated verification endpoint now checks actual bytes, dimensions, canonical identities, conflicts and membership before recording seven-day evidence. It changes no source images and fails closed on mismatches.
- Both reviewed migrations are applied: `20261002025302_carousel_studio.sql` and `20261002035726_fix_media_claim_required_description.sql`. The latter fixes an existing upload function that inserted a media asset without its required description; a four-check isolated SQL regression fails before the repair and passes afterward. No production test records were created.

## Deployment procedure

Stage a production-environment deployment with `--skip-domain`. Require production newsletter preflight and staged checks. Promote only the checked artifact. Under the verified owner session, initialize the existing eight-photo baseline through Carousel Studio; verify the canonical homepage and immutable recovery generation afterward.

Production deployment `dpl_2VHqzcZukj1jMsB5DQ99hgr3SXFt` was promoted with the upload repair and server-resolved initial workspace. Its production build and newsletter readiness check passed. Anonymous Carousel API access returns 401 with no-store. Canonical owner navigation opens Carousel directly after a refresh. All eight baseline uploads finalized; activation is withheld until the normal recovery worker verifies all eight replicas.

Before initial activation, authoritative database evidence that no carousel-aware generation ever existed permits the original public renderer. After activation, primary and recovery failures yield a bounded unavailable message, never old checked-in content.

## Rollback boundary

Before carousel activation, the previous production deployment remains a safe rollback target; additive tables may remain unused. After activation, do not roll back to a renderer/worker that lacks carousel-aware recovery support. Prefer a corrected forward release, or restore an earlier carousel revision as a new reviewed draft. Never delete immutable revisions, command receipts, media, or recovery artifacts as rollback cleanup.

## Production activation completed October 2

- Source commit `0bbe238` deployed as `dpl_EapboJv3WDP9hthmjKxzoJkS59eX`, with the canonical production domains attached and newsletter preflight ready.
- Owner-authenticated initialization succeeded: enabled carousel version 1, immutable revision `f458749a-0103-40ff-8f18-7d7e16b0b9a1`, exactly one bootstrap audit event.
- Full-site generation 4 includes all 12 configured routes and the exact carousel revision. Its recovery job completed without errors. All eight carousel photos have verified backups.
- Registered the already-live Events route with migration `20261002041414_register_events_recovery_route.sql`. The normal owner content command versions its existing fallback only; private drafts and the global published version remain untouched. Five isolated SQL checks passed.
- Production storage exposed a generic duplicate-object response. Immutable artifact writes now verify/reuse exact bytes and reject conflicts; ambiguous responses require exact durable readback. The latest-pointer conditional update is unchanged.
- Final full suite after the storage repair: 136 files / 696 tests passed. All 65 isolated SQL checks passed. The final preview-label correction also passed its focused UI regression.
- Production owner UI: direct Carousel workspace, all eight slots, managed image picker, whole-carousel controls, English/Spanish desktop/mobile previews verified. Public gallery loaded all eight managed image endpoints; homepage had no horizontal overflow at the tested browser width.
- Additional Editor membership rechecked; recipient has not completed personal email verification. No test email or synthetic constituent record was created.

## Verification limits

Physical-device testing and the additional Editor's personal sign-in are not represented by automated browser checks. The authenticated browser's screenshot capture timed out; production UI interactions were verified through its visible DOM, and a public production gallery screenshot was saved separately.

## Staff handoff

Open Staff Portal, then **Carousel**. Select one of the eight photo slots. **This photo** controls that image, bilingual descriptions, desktop/mobile framing and optional effect overrides. **Whole carousel** controls shared transition, timing and fade settings. Save the draft, review English and Spanish on desktop and mobile, then publish. Drafts do not change the public site. History records image, caption, order, appearance and publication changes; restoration creates a draft for review, never an unreviewed public replacement.

`damonyoung@dtvprods.com` has site-scoped Editor membership. Use the existing email-link sign-in form with that address; no shared password or owner-level provider access is needed. The recipient must complete their own sign-in. No invitation or test email was sent during provisioning.
