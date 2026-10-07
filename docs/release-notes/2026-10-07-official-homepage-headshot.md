# Official homepage headshot restoration

The user requested that the homepage representative portrait return to the official state headshot and supplied the red-jacket portrait as the approved reference on October 7, 2026. Visual comparison confirmed that this is the existing approved Legislature source, `content/media-source/professional/home-official-portrait.jpg`.

## Scope and cause

The October editorial manifest was routing both About and the homepage portrait to DSC01789. Remove only the homepage placement from that override. Restore the existing official portrait's manifest placement and explicit full-frame dimensions and Spanish accessibility description. The existing protected homepage portrait rendering continues to ignore incompatible stored replacements.

No photo is generated, cropped, or newly upscaled. Existing responsive derivatives are reused; their source is 250 by 364 pixels. About keeps DSC01789, and the carousel, volunteer photograph, Constituent guidance photograph, News image, navigation, roles, forms, provider settings, and production content records are unchanged by this correction.

## Verification

- Regression tests failed on the October override before the correction.
- Focused media, page, protected-value, and editor-mapping tests: 51 passed.
- Full application tests: 799 passed, with four workers and a 15-second per-test limit.
- TypeScript and focused ESLint checks passed.
- Production release still requires the existing brand/newsletter build checks, staged rendering, and final canonical-domain verification.

Pre-release production rollback point: commit `6e6c104c990637318ab03b6c7dfec3324c095c65`, deployment `dpl_4BLn4QrhLAWQJyGukfkfP4dTRPST`.
