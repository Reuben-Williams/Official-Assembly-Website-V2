# Editor session and image-upload repair — staged verification

## Release state

- Repair commit: `e09831f2288d070321e3739a67514dc03a73d61b`.
- Production-target candidate: `dpl_CWJGWNcKtgjG792MWMug2RmBrzux`.
- Candidate URL: https://assemblywomanmorales-l5vzivec5-rubydags-projects.vercel.app
- Candidate is Ready. Custom production domains have not been reassigned.
- Current canonical deployment at verification:
  `dpl_8rvDXMTiYSFggm5pDgv58Wzg7Ke1`.
- Preserve the existing apex-to-www 308 redirect during final promotion.

The user asked for the completed work to go live together. Press Releases and
team notices have reviewed written designs, but are not implemented or active.
Written-design review by the user is pending. This candidate is the editor repair
only; do not report a completed combined launch or team email delivery.

## Implemented behavior

Expired editor sessions show a sign-in prompt without discarding unsaved work.
Gallery entries use authorized media endpoints instead of one-hour storage URLs.
Single-image PNG and WebP uploads are converted to validated JPEG at original
dimensions, with progress and visible failure/success messages. Saves are blocked
while an upload is pending. GIF receives an explicit unsupported-format message.
Batch imports retain their existing JPEG-only contract.

## Automated and local browser evidence

- Full automated suite: 163 files, 859 passing tests.
- Final focused regression run: 8 files, 35 passing tests.
- Type checking passed; scoped lint passed with no warnings; diff check passed.
- Real published EditorShell and the new safety frame were tested at
  1440×1000 and 390×844 with isolated, mocked upload endpoints.
- Browser conversion of a real 300×500 PNG produced JPEG bytes, preserved
  dimensions, updated Selected Image, blocked Save during upload, and retained
  the selected image through session recovery. No page errors in that fixture.
- Fixture screenshots are in
  `C:\Users\Anoth\AppData\Local\Temp\morales-editor-qa-20261007`:
  `upload-desktop.png`, `signin-desktop.png`, `signin-mobile.png`.

This is not a real production upload, a publication under Damon's account, or an
inbox-delivery test. No real form test submission or email was sent.

## Staged production evidence

- Production build and unchanged strict newsletter readiness gate passed:
  ready/steady, 17 provider emails accounted for, zero eligible audience.
- Protected candidate accessed through normal existing Vercel authentication.
- Anonymous editor-session health request returned 401 AUTH_REQUIRED.
- Anonymous private media-preview request returned 404 without exposing data.
- Staged homepage rendered, Next photo advanced from slide 1 to slide 2, and
  the new selected slide loaded successfully. Official portrait loaded.
- Captured application error logs were empty after excluding the identified
  Turnstile hostname error.

The candidate's temporary Vercel hostname is not authorized for the production
Turnstile widget (110200). Cloudflare documents that code as “Domain not
authorized.” No CAPTCHA controls were bypassed and no production hostname policy
was weakened. Public form behavior must be rechecked on the canonical domain
after the combined release; preview visibility is not a successful submission.

Reference: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/

## Remaining release checks

Implement the reviewed features after the user reviews the written designs.
Run the added database/mail classification tests and a fresh combined build.
Before activation audit reserved Press Releases slugs, verify notification
cutoff/evidence configuration, and keep historical test submissions excluded.
Promote the exact final candidate and verify both canonical aliases, redirect,
fresh authorized gallery/Submissions views, and newsletter readiness. Do not
claim Gmail Inbox placement from provider acceptance or mail-server delivery.
