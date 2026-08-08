# District Newsletter operations runbook

Updated: August 6, 2026

This runbook covers the live District Newsletter for the Office of Assemblywoman Carmen Morales. Supabase is the system of record for submissions, consent, confirmation, subscriber state, and audit evidence. Resend provides transactional confirmation delivery, Contacts, the dedicated Segment and Topic, verified webhooks, and dashboard Broadcast composition.

The application never creates, updates, schedules, or sends a Resend Broadcast. Final composition and sending remain deliberate Resend-dashboard actions. No Production Segment Broadcast is sent during activation.

## Fixed production contract

- Canonical site: `https://www.assemblywomanmorales.com`
- Confirmation and contact URL origin: `https://www.assemblywomanmorales.com`
- Webhook: `https://www.assemblywomanmorales.com/api/webhooks/resend`
- Sender: `Office of Assemblywoman Carmen Morales <newsletter@updates.assemblywomanmorales.com>`
- Office address: `152 Franklin Street, Belleville, NJ 07109`
- Office phone: `(973) 450-0484`
- Newsletter policy/template version: `marketing-v1`
- Delivery model: explicit double opt-in
- Broadcast model: Resend dashboard, dedicated Segment, dedicated default-opt-out Topic, application validation and after-the-fact audit

## Current audited baseline

The rollback target recorded before this release is Vercel deployment `dpl_333Wr1T7whJ16LQPnorMjR6MF45A`, created August 6, 2026 at 12:17:46 EDT and promoted to `assemblywomanmorales.vercel.app`, `assemblywomanmorales.com`, and `www.assemblywomanmorales.com`.

At the August 6 audit:

- Vercel project `assemblywomanmorales` is linked locally.
- The legacy combined `RESEND_API_KEY` variable was removed from Preview and Production on August 6, 2026. Vercel removed both scopes together when Preview containment was applied. No Resend credential is currently present in Vercel; revoke the old key in Resend after confirming it has no other approved consumer.
- The required purpose-specific newsletter variables are not yet present.
- `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, Supabase browser/server variables, and existing builder variables are present.
- The local checkout is not linked or authenticated to the remote Supabase project. A Supabase owner must run `supabase login` and `supabase link --project-ref <project-ref>` before remote migration review or application.
- The exact privacy and consent wording below still requires human approval before enablement.
- Disabled Preview deployment `dpl_5m1YdV87Avg98DBGFgHMf8bSc3QF` passed the direct newsletter, privacy, confirmation, and protected Forms route checks.

Never record API keys, confirmation key material, subscriber addresses, message bodies, raw webhook payloads, or full recipient lists in release evidence.

## Environment variables

Production-only Sensitive variables:

- `RESEND_SEND_API_KEY`: Resend Sending-access key restricted to the verified newsletter sending domain.
- `RESEND_MANAGEMENT_API_KEY`: separate Full-access key for server-side Contact/Topic/Segment reads and mutations plus read-only Broadcast inspection.
- `RESEND_WEBHOOK_SECRET`: signing secret for the production webhook.
- `RESEND_NEWSLETTER_SEGMENT_ID`: UUID of the dedicated District Newsletter Segment.
- `RESEND_NEWSLETTER_TOPIC_ID`: UUID of the dedicated, default-opt-out District Newsletter Topic.
- `NEWSLETTER_CONFIRMATION_KEYRING`: JSON object whose values are independently generated base64url keys of at least 32 random bytes.
- `NEWSLETTER_CONFIRMATION_ACTIVE_KEY_ID`: key ID present in the keyring.
- `NEWSLETTER_TEST_RECIPIENTS`: JSON array of one to 25 authorized real staff inboxes.

Production configuration:

- `NEWSLETTER_EMAIL_ENABLED=false` during deployment, database work, provider setup, and acceptance.
- `NEXT_PUBLIC_SITE_URL=https://www.assemblywomanmorales.com`.

Preview must contain no Production Resend credential, Segment ID, Topic ID, webhook secret, production confirmation keyring, or staff recipient list. Keep `NEWSLETTER_EMAIL_ENABLED=false` in Preview and use application/provider fakes plus an isolated local database for testing.

Add secret values interactively or through stdin so they never enter shell history:

```powershell
npx vercel env add RESEND_SEND_API_KEY production --sensitive
npx vercel env add RESEND_MANAGEMENT_API_KEY production --sensitive
npx vercel env add RESEND_WEBHOOK_SECRET production --sensitive
npx vercel env add RESEND_NEWSLETTER_SEGMENT_ID production --sensitive
npx vercel env add RESEND_NEWSLETTER_TOPIC_ID production --sensitive
npx vercel env add NEWSLETTER_CONFIRMATION_KEYRING production --sensitive
npx vercel env add NEWSLETTER_CONFIRMATION_ACTIVE_KEY_ID production --sensitive
npx vercel env add NEWSLETTER_TEST_RECIPIENTS production --sensitive
npx vercel env add NEWSLETTER_EMAIL_ENABLED production --value false --yes
```

Verify the legacy variable remains absent without printing any value:

```powershell
npx vercel env ls
```

After the two replacements are installed and a disabled deployment is healthy, revoke the old key in Resend after confirming it has no other approved consumer.

Every environment-variable change requires a fresh deployment.

## Exact privacy and consent review gate

The public privacy notice is at `/privacy`. The active newsletter form must render this context immediately before the fields:

> Submitting this form creates a pending District Newsletter confirmation request. You are not subscribed until you confirm using the email sent to your inbox.

> Review how the office and Resend handle newsletter information in the privacy notice. Every District Newsletter includes an unsubscribe link.

The managed form revision must use template `local-business.newsletter-signup` version `1.0.0`, policy version `marketing-v1`, and this exact required-checkbox label:

> I agree to receive District Newsletter emails from the Office of Assemblywoman Carmen Morales. I understand that submitting this form is a confirmation request, that I am not subscribed until I confirm by email, and that I can unsubscribe at any time.

Its inline success copy must be:

> Check your inbox to continue. Your request is pending, and you are not subscribed unless you complete the confirmation step.

Before enablement, an authorized reviewer must approve the notice and these exact strings, publish the managed form revision, and verify the rendered page contains the privacy link before the submit button.

## Disabled-first deployment

1. Keep `NEWSLETTER_EMAIL_ENABLED=false` in Production and Preview.
2. Run `npm run test:newsletter`, `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e`.
3. Confirm `node scripts/check-newsletter-boundaries.mjs` passes.
4. Deploy a Preview without Production Resend credentials. Verify `/newsletter`, `/newsletter/confirm`, `/privacy`, and `/admin/editor?workspace=website.forms` directly at desktop and 390px.
5. Confirm Preview renders the phone/contact fallback and cannot create a signup.
6. Deploy the verified revision to Production while disabled.
7. Verify `/api/newsletter/jobs/run` remains protected by `CRON_SECRET` and `/api/webhooks/resend` returns unavailable until its secret is installed.

## Database migration gate

1. Run `npm run verify:production-migrations`. This pins the exact production lineage and rejects extra SQL files in the deployable directory.
2. Treat `supabase/optional-platform-migrations` as provenance-only. Those modules are not approved for this production database and must not be moved into `supabase/migrations` without a separate review.
3. Authenticate and link the Supabase CLI as a project owner.
4. Run `npx supabase migration list --linked` and compare remote/local history.
5. Stop on any missing, reordered, or remote-only migration. Do not repair history or push through a mismatch without review.
6. Review the additive diff with `npx supabase db push --linked --dry-run`.
7. Apply with `npx supabase db push --linked` only after the dry run contains exactly the three reviewed newsletter migrations.
8. Run remote database lint/advisors, verify every newsletter table has RLS, and verify browser roles have no newsletter-table privileges.
9. Confirm the service-role-only RPC grants and non-mutating public readiness RPC.
10. Run the site installation/reconciliation workflow, then publish the exact managed newsletter form revision from the privacy gate.

Do not reset, squash, drop, or destructively roll back the remote database. Corrections are additive roll-forward migrations.

## Resend setup

1. Keep the verified sending subdomain `updates.assemblywomanmorales.com` healthy.
2. Create a dedicated District Newsletter Segment. Do not reuse an unrelated Segment.
3. Create a dedicated District Newsletter Topic whose default is opt out. Contact existence alone is never consent.
4. Create the purpose-specific Sending and Full-access keys described above.
5. Register the production webhook URL and subscribe to the email, Contact, and suppression events required by the implementation.
6. Store the webhook signing secret in Vercel and redeploy while disabled.
7. Configure only authorized real staff inboxes in the server-side allowlist. Never accept test recipients from a browser request.
8. Run the complete Broadcast inventory audit. Activation requires zero unexpected scheduled, queued, or sent Broadcasts and no unrelated resources in the dedicated sending scope.

## Enablement and authentic acceptance

1. Confirm migrations, form revision, privacy approval, sender, Segment, Topic, webhook, key separation, and full inventory audit are complete.
2. Set `NEWSLETTER_EMAIL_ENABLED=true` only in Production and redeploy.
3. Submit one authentic signup using an authorized real inbox. Do not use synthetic or placeholder data.
4. Verify the public response says the request is pending and sends no active-subscription claim.
5. Deliberately open the confirmation link, verify the fragment disappears, and click **Confirm subscription**.
6. Verify the site-local record, consent evidence, Resend Contact ID, explicit Topic opt-in, Segment membership, confirmation delivery evidence, and verified webhook receipt without copying PII into the release log.
7. In Staff Portal > Forms, confirm live status, zero incidents, and the authentic audience count.
8. Create one unscheduled Resend draft with the fixed sender, production Segment and Topic, no Reply-To, unsubscribe placeholder/footer, office address, office phone, and contact URL.
9. Run **Run activation check** with that Broadcast ID.
10. Run **Open staff test window**, then use Resend to send a test only to the configured staff allowlist.
11. Wait for the confirmed exact-digest staff-test observation and the required recheck period. The Broadcast must remain an unscheduled draft.
12. Run **Validate newsletter**. The approval expires after ten minutes and does not send anything.
13. Do not click the final Production Segment Send during activation. The first real newsletter is a separate authorized operational action.

## Routine sending

1. Compose or review the existing Resend draft.
2. Ensure every message contains the unsubscribe mechanism, office address, phone, and contact URL.
3. Run activation check, allowlisted staff test, exact-digest confirmation, and final validation.
4. Resolve every open incident before proceeding.
5. Final sending in Resend must occur within the ten-minute validation window and requires the separate human authorization for that newsletter.
6. Record only deployment ID, Broadcast ID, safe digest abbreviation, readiness revision, audience count, validation ID, send time, and safe outcome codes.

## Disablement, rollback, and incidents

Immediate application containment:

```powershell
npx vercel env add NEWSLETTER_EMAIL_ENABLED production --value false --force --yes
npx vercel --prod
```

Disablement blocks new confirmation delivery, Contact mutation, mutating reconciliation, and validation. Verified webhook processing plus read-only Contact and Broadcast audits remain available so withdrawal and incident evidence are not lost.

For a scheduled Broadcast, cancel it in Resend immediately. A queued or sent email cannot be recalled. Restrict provider team members and, if necessary, use the Resend Leave Team containment fallback. Rotate compromised keys, update Vercel, redeploy, and complete a full inventory audit.

Application rollback promotes the recorded prior deployment:

```powershell
npx vercel promote dpl_333Wr1T7whJ16LQPnorMjR6MF45A --yes
```

Database changes remain in place. Existing subscribers, consent, withdrawal, suppression, receipts, and incident evidence are preserved. Recovery from a Broadcast incident requires the two-operator database recovery procedure and a fresh full audit; never close or delete evidence merely to unlock validation.

## Release evidence checklist

- Git commit and promoted Vercel deployment ID
- rollback deployment ID
- migration versions and dry-run/application output
- database lint/advisor result and RLS/grant verification
- Segment, Topic, and webhook identifiers only
- fixed sender and sending-domain status
- privacy/consent reviewer and approved revision ID
- authentic signup/confirmation safe receipt identifiers
- Contact/Topic/Segment verification without PII
- staff-test observation, safe digest abbreviation, readiness revision, and audit completion
- zero open incidents
- confirmation that no Production Segment Broadcast was sent during activation
