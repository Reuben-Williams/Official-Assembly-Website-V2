# Official Assembly Website V2 - Local Attachment Receipt

Date: 2026-08-05 (America/New_York)

Status: **BLOCKED - local attachment implemented, local acceptance not complete**

This receipt is intentionally not a pass receipt. The website attachment builds
and its repository checks pass, but the selected package handoff does not
provide the site-local Supabase migration history or the installation
worker/entitlement-cache implementation required by its own checker. Dependency
security findings also remain open.

## Repository and reviewed baseline

- Repository: `https://github.com/Reuben-Williams/Official-Assembly-Website-V2.git`
- Working directory: `D:\Project Morales\Official Assembly Website V2`
- Branch: `main`
- Baseline/tested commit: `c0e0cf859d05c42f1b71ab89b74b953adb956263`
- State: uncommitted local attachment changes; nothing staged, committed, or pushed
- Pre-existing user file preserved and excluded from attachment scope:
  `client-website-setup-operator-walkthrough.md`

## Gate A and CLI evidence

- Inspection review ID:
  `d05273365964eebcf9b384a2f91c4a5807ddd2252df014fabfd8ee0a26778cb9`
- Approved mapping/plan digest:
  `8ac51126c06fd549ea5bb6849c8ef3388610aca6f2845f71422be44f881d179d`
- Source patch ID:
  `5e809c5c0d74fb929b5f579ade88cbd589bbc8a5f352caa5a4c5ed2bad23c429`
- Initial apply receipt ID:
  `d8c8186e2bd61905dc1255576fceb06476ba5d0a34b3d84dace2c23ccefd2b55`
- CLI stages `inspect`, `plan`, `patch`, and `apply`: passed.
- CLI aggregate `verify`: not passed. The pass-only evidence schema requires
  receipts for `npm run build` with runner `builder-cli` and
  `npm run test:responsive-smoke` with runner `playwright`. The selected
  release does not supply either runner, and this repository did not previously
  have the responsive-smoke script. No synthetic pass receipt was fabricated.
- The initial apply receipt predates required post-apply fixes for session-cookie
  module separation, CSP nonce hydration, the static CLI-readable builder
  config, and package compatibility. Its source hashes are therefore not a
  final-state verification receipt.

## Package provenance

Direct packages are pinned exactly:

- `@reuben-williams/core@0.1.0`
- `@reuben-williams/editor@0.1.0`
- `@reuben-williams/forms@0.1.0`
- `@reuben-williams/next@0.1.0`
- development-only `@reuben-williams/cli@0.1.0`

Complete installed private-package closure:

- `@reuben-williams/canonical-json@0.1.0`
- `@reuben-williams/cli@0.1.0`
- `@reuben-williams/content@0.1.0`
- `@reuben-williams/core@0.1.0`
- `@reuben-williams/editor@0.1.0`
- `@reuben-williams/entitlements@0.1.0`
- `@reuben-williams/feature-registry@0.1.0`
- `@reuben-williams/forms@0.1.0`
- `@reuben-williams/growth-core@0.1.0`
- `@reuben-williams/growth-customers@0.1.0`
- `@reuben-williams/growth-dashboard@0.1.0`
- `@reuben-williams/growth-leads@0.1.0`
- `@reuben-williams/next@0.1.0`

The lockfile records exact resolved versions and integrity values. GitHub
Packages authentication was verified through the operator's user-level npm
login. The repository `.npmrc` contains only the private scope registry; no
token value is tracked.

The published editor package resolves TipTap packages inconsistently unless the
website supplies the release's runtime dependencies. The attachment therefore
pins the required TipTap family to `3.28.0` and uses npm overrides to keep one
compatible tree. React remains on `19.2.7`; Next remains on `16.2.11`.

## Local attachment implemented

- Static, CLI-readable `builder.config.ts` for all 10 approved public routes.
- Stable builder IDs on real text, link, image, navigation, collection, section,
  and form elements; responsive instances share canonical region IDs.
- Public published-content bridge and preview-selection bridge.
- Protected `/admin/login` and `/admin/editor` routes using
  `AttachedSiteEditor`.
- Protected builder content/session APIs with origin, signed session, CSRF,
  authorization, revocation-generation, no-store, request-size, and stale-write
  controls.
- Supabase SSR browser/server/admin clients and a stable-site-key content
  adapter for draft, publish, rollback, history/audit, and media records.
- Approved contact and newsletter form definitions, published projection,
  Turnstile boundary, server-only ingestion, and fail-closed public fallback.
- Survey form and posts remain truthfully unavailable.
- Static GitHub Pages deployment was replaced by a manual validation-only
  workflow because this attachment requires a server runtime.
- CSP nonce handling and hydration were verified after making the root layout
  request-aware.

## Commands and outcomes

| Command/check | Outcome |
| --- | --- |
| `npm test` | PASS - 7 files, 24 tests |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS - Next 16.2.11, webpack, 13 generated route entries |
| Private package closure | PASS - all installed `@reuben-williams/*` packages are exactly 0.1.0 |
| TipTap closure | PASS - one 3.28.0 tree |
| Secret-value scan | PASS - zero token, JWT, or private-key value matches in repository source |
| `builder check --project .` | BLOCKED - missing local Supabase server values, installation worker, and entitlement snapshot cache |
| `npm audit --omit=dev` | BLOCKED - 3 high findings through Next/PostCSS/sharp |
| Full `npm audit` | BLOCKED - 4 high findings, including one development dependency finding |
| Local Supabase reset/pgTAP/lint/RLS/grants/Auth/Storage/advisors | BLOCKED - no `supabase/config.toml`, migrations, or database tests are shipped in this website or selected package tarballs |

Final builder-check output:

```text
[env.missing.supabase.url] SUPABASE_URL is required for the Supabase adapter.
[env.missing.supabase.serviceRole] SUPABASE_SERVICE_ROLE_KEY is required on server-only editor routes.
[COMMAND_WORKER_MISSING] A versioned installation command worker must be wired into the site.
[SNAPSHOT_CACHE_MISSING] A local entitlement snapshot cache must be wired into the site.
```

Docker Desktop reported `running`, and the repository-local Supabase CLI is
`2.111.0`. No local stack was initialized because there is no approved schema
history to reset. No migrations were invented or copied from platform source.
After evidence collection, the local Next server was stopped and Docker Desktop
was returned to its original stopped/unavailable state.

Migration head: **none available or applied**. The module manifest declares a
required forms schema level of `2`; that declaration is not an applied
migration head.

## Browser evidence

Local server port: `3107` during the checks.

- Public routes `/`, `/about`, `/resources`, `/news`,
  `/community`, `/voting`, `/contact`, `/newsletter`, `/survey`,
  and `/social`: HTTP 200.
- `/admin/login`: HTTP 200.
- Anonymous `/admin/editor`: HTTP 307 to
  `/admin/login?returnTo=%2Fadmin%2Feditor`.
- Builder/forms APIs: fail closed with HTTP 503 when local Supabase values are
  absent.
- Security headers observed: CSP, Referrer-Policy, X-Content-Type-Options,
  X-Frame-Options, Permissions-Policy, and Cross-Origin-Opener-Policy.
- Width 390 (browser inner width 375): no horizontal overflow, no broken images,
  91 builder regions, content bridge ready.
- Width 768 (browser inner width 753): no horizontal overflow, no broken images,
  91 builder regions.
- Width 1280 (browser inner width 1265): no horizontal overflow, no broken
  images, 91 builder regions.
- Contact route: published bridge ready, managed form unavailable exactly once,
  no false working form, verified phone links present, no overflow.
- Survey route: zero form elements and an explicit unavailable state.
- Hydration: language toggle changed `html[lang]` to `es` and rendered the
  Spanish heading; no fallback flash was observed after the CSP nonce fix.
- Screenshot references: none captured; checks were assertion-based in the
  local browser session.

Durable draft/publish/anonymous refresh/rollback/history/media and live form
submission could not be browser-accepted without the missing local database
schema. Unit coverage confirms stale revision returns HTTP 409 and session
authorization/revocation behavior, but this is not a substitute for database
acceptance.

## Unsupported adapters and unresolved production blockers

1. The selected package release/handoff does not deliver the Supabase migrations,
   pgTAP tests, RLS/grant policy set, Storage policy set, or applied schema head
   needed for local acceptance.
2. The required `createInstallationWorker` and
   `createEntitlementSnapshotCache` contracts cannot be wired truthfully
   without the installation command store/schema and approved installation
   handoff.
3. The CLI's aggregate evidence contract cannot consume the actual build and
   in-app browser evidence produced here without falsely labeling their runners.
4. `npm audit --omit=dev` reports three high production findings. npm reports
   the available remediation through Next `16.3.0`; that public framework
   update requires separate compatibility approval and verification.
5. Posts are unavailable in this attachment. Survey form ingestion is
   unavailable because no approved survey template was selected. Growth
   entitlements and providers are not activated.

## Human-only prerequisites before another acceptance attempt

1. Publish or provide the exact selected-release handoff containing the approved
   site-local schema/migrations, tests, command store, worker version, and
   entitlement snapshot-cache wiring; alternatively correct the manifest if
   those contracts are not required for `core.website`.
2. Make Docker's engine responsive, initialize only from that approved schema,
   and provide synthetic local environment values outside Git.
3. Approve or reject the Next `16.3.0` security update after package
   compatibility review.
4. Provide a genuine production-build evidence runner and a repository
   `test:responsive-smoke` runner compatible with the CLI's verify schema.
5. Rerun apply/verify so the final source hashes include the required
   post-apply fixes.

## Files changed by the attachment

- Platform/config: `.builder/**`, `.env.example`, `.npmrc`,
  `builder.config.ts`, `next.config.mjs`, `package.json`,
  `package-lock.json`, `proxy.ts`, `next-env.d.ts`,
  `.github/workflows/github-pages.yml`.
- Admin/auth/API: `app/admin/**`, `app/auth/**`, `app/api/builder/**`,
  `app/api/forms/**`, `app/builder-content-bridge.tsx`.
- Public site: `app/data/site.ts`, `app/globals.css`,
  `app/i18n/translations.ts`, `app/layout.tsx`, `app/page.tsx`, and
  `app/ui/{AppFooter,AppHeader,Cards,ImagePanel,LanguageToggle,PageTemplate,ResidentForms}.tsx`.
- Site-local runtime: `lib/builder/**`,
  `lib/supabase/{client,server,admin}.ts`.
- Verification: `tests/builder-auth.test.ts`,
  `tests/builder-mapping.test.tsx`, `tests/builder-routes.test.ts`,
  `tests/forms-attachment.test.ts`,
  `tests/i18n-builder-bridge.test.tsx`, `tests/server-only.ts`, and
  `vitest.config.ts`.
- This receipt: `docs/attachment/official-assembly-local-acceptance-2026-08-05.md`.

## Rollback

No remote rollback is necessary because no remote state changed.

The CLI reversal artifact is
`.builder/onboarding/reversal-5e809c5c0d74fb929b5f579ade88cbd589bbc8a5f352caa5a4c5ed2bad23c429.json`,
but it covers only the initial apply and predates the required post-apply
fixes. Do not apply it blindly. The safest rollback is an explicitly approved,
path-scoped rollback of the files listed above, preserving the pre-existing
walkthrough, or a fresh worktree at baseline commit
`c0e0cf859d05c42f1b71ab89b74b953adb956263`.

## Confirmed non-actions

- No package access was granted or changed.
- No hosted secret was entered.
- No hosted Vercel or Supabase resource was created or modified.
- No database was linked, migrated, reset remotely, or populated.
- No Store or Installation was registered.
- No installation exchange token was issued or consumed.
- No hosting handoff was confirmed or cleaned up.
- No entitlement or bundle was assigned or provisioned.
- No email, SMS, AI, payment, booking, reminder, or other provider was activated.
- No real owner was invited.
- No Preview or Production deployment occurred.
- No real customer or constituent data was imported.
- No commit, push, pull request, or workflow dispatch occurred.

STOP: operator review is required. A new explicit approval naming the exact
target and action is required before any hosted or production step.
