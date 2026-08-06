# Live Newsletter and Resend Integration Design

**Status:** Approved design, pending independent specification review and implementation planning

**Approved by:** User on 2026-08-06

**Production website:** `https://www.assemblywomanmorales.com/`

**Sending domain:** `updates.assemblywomanmorales.com`

**Site key:** `official-assembly-website-v2`

## Purpose

Launch a real district-newsletter signup and delivery workflow without synthetic records, unconfirmed recipients, or simulated provider success. Residents use the website's existing managed newsletter form. The website and Supabase preserve consent and subscriber state; Resend sends confirmation messages and provides the staff-facing Broadcast editor for newsletters.

This design amends only the email portion of the approved production staff-portal design. SMS, AI, survey, and generic editor messaging actions remain unavailable. Adding a Resend credential does not activate those unrelated provider features.

## Confirmed Infrastructure

The following infrastructure was verified on 2026-08-06 before this design was written:

- `assemblywomanmorales.com` resolves to Vercel and permanently redirects to `https://www.assemblywomanmorales.com/`.
- `https://www.assemblywomanmorales.com/` serves the production site over HTTPS.
- Resend reports `updates.assemblywomanmorales.com` as verified with GoDaddy-managed DNS in the North Virginia region.
- Vercel lists `RESEND_API_KEY` as a Sensitive variable for Production and Preview.

Infrastructure readiness is not application readiness. Production newsletter collection remains disabled until the application, database, privacy notice, Resend Segment, webhook, and verification gates in this document pass.

## Goals

- Collect authentic newsletter requests through the existing managed form, Turnstile, same-origin checks, rate limits, and explicit marketing-email consent.
- Require double opt-in before a resident becomes eligible for marketing Broadcasts.
- Keep consent and subscription history in site-scoped production storage.
- Mirror confirmed, eligible subscribers into a dedicated Resend Segment.
- Let staff compose, preview, test, schedule, and send newsletters from Resend's no-code Broadcast editor.
- Include a working unsubscribe mechanism in every marketing Broadcast.
- Reconcile provider unsubscribes, hard bounces, complaints, failures, and suppressions into the site-local subscriber state.
- Make every external side effect idempotent or safe to repeat.
- Keep production free of synthetic, sample, seeded, and placeholder subscribers.

## Non-goals

- No editor-embedded campaign composer or send button in this release.
- No automatic campaign content generation.
- No SMS, AI, survey, or generic outbound messaging activation.
- No import of historical contacts without separately reviewed consent evidence.
- No automatic subscription from contact-form submissions, customer records, leads, staff-created records, or email addresses gathered for another purpose.
- No purchase, rental, scraping, or enrichment of email lists.
- No claim that provider acceptance proves inbox delivery.
- No inbound mailbox or monitored Reply-To address unless one is separately provisioned and approved.

## Approaches Considered

### 1. Double opt-in with site-local consent and Resend Broadcasts — selected

The website records the request as pending, sends a transactional confirmation message, and activates the subscription only after the resident deliberately confirms. Confirmed contacts are synchronized to a dedicated Resend Segment. Staff sends marketing newsletters from the Resend dashboard.

This has more implementation work than single opt-in, but it provides the clearest proof that the submitted address belongs to a person who wants the newsletter. It also keeps the existing editor submission/customer history aligned with the delivery provider.

### 2. Immediate single opt-in — rejected

The website would add every accepted form submission to Resend immediately. This creates less friction but is more vulnerable to mistyped addresses, unwanted signups, bots, complaints, and list-quality damage.

### 3. Resend-hosted or Resend-only signup — rejected

This would bypass the existing managed form, Turnstile policy, site-local submission receipt, consent evidence, Customers view, and retention workflow. It is operationally simple but breaks the approved system-of-record boundary.

## System of Record and Provider Boundary

Supabase is authoritative for:

- the immutable managed-form receipt;
- the canonical site-local person/customer reference;
- the captured marketing-email consent evidence and policy version;
- pending, confirmed, active, withdrawn, and provider-suppressed subscriber state;
- confirmation generations, expiry, and consumption;
- provider synchronization attempts and outcomes; and
- verified webhook receipts and audit events.

Resend is authoritative for:

- provider Contact identifiers;
- the operational District Newsletter Segment;
- Broadcast drafts, tests, schedules, sends, and provider delivery events;
- Resend's global unsubscribe and suppression enforcement; and
- provider message identifiers.

The public browser never calls Resend. All Resend API access is server-only. Provider-specific code is isolated behind a small newsletter delivery adapter rather than embedded in public components or the shared editor core.

The private editor may display subscription and delivery facts supplied by the site-local database, but it does not gain a campaign send control in this release. Staff opens Resend directly to compose and send Broadcasts.

## Resend Configuration

An authorized operator creates one Resend Segment named **District Newsletter**. Its identifier is stored in Vercel as `RESEND_NEWSLETTER_SEGMENT_ID`.

The fixed sender identity is:

`Office of Assemblywoman Morales <newsletter@updates.assemblywomanmorales.com>`

No Reply-To address is configured until a real monitored office mailbox is provisioned. Confirmation messages and Broadcasts must state that the sending address is not monitored and link to the official website contact route. Marketing Broadcasts also include the verified district-office postal address already present in site configuration.

The Resend production webhook endpoint is:

`https://www.assemblywomanmorales.com/api/webhooks/resend`

The webhook observes only the events needed for this release:

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.failed`
- `email.bounced`
- `email.complained`
- `email.suppressed`
- `contact.updated`

Open and click tracking are not required for activation and are not copied into the constituent system of record. This minimizes unnecessary behavioral data.

## Public Signup Flow

1. The resident opens `/newsletter` and sees the published managed form plus the approved privacy notice and marketing-consent language.
2. The form submits to the existing `POST /api/forms/newsletter-signup` endpoint.
3. The existing package route enforces a published compatible form revision, same-origin policy, body limits, Turnstile, request and identity rate limits, request fingerprinting, and explicit consent evidence.
4. The existing strict Supabase ingestion transaction stores the immutable form receipt, creates or matches the site-local customer identity, and records marketing-email consent without creating a lead.
5. On an accepted or replayed newsletter receipt, a site-local RPC atomically creates or reuses the pending subscription and enqueues exactly one confirmation-delivery job for the current confirmation generation.
6. The public response says that the request was received and that a confirmation link will arrive shortly. It does not say the address is subscribed or that the email has been delivered.
7. A best-effort inline worker may claim the new job immediately. A protected scheduled worker retries jobs that remain pending.

The base form receipt is not rolled back because Resend is temporarily unavailable. Instead, the durable confirmation job remains retryable. A provider outage cannot erase valid consent evidence or produce a false active subscription.

Repeated form submissions use the existing form idempotency contract. Replayed receipts do not create duplicate subscriptions. A fresh authentic request from a previously withdrawn subscriber may create a new confirmation generation only when it carries new approved consent evidence.

## Double Opt-in Confirmation

### Confirmation token

The application creates a signed, opaque confirmation token containing only:

- version;
- site identifier;
- subscription identifier;
- confirmation generation;
- random confirmation nonce;
- issued-at time;
- expiry time; and
- signing-key identifier.

The token is authenticated with a server-only HMAC secret of at least 32 random bytes. It contains no email address, name, message content, or consent text. The database stores the nonce and generation but never stores the usable signed token. Workers can regenerate the same signed token from the durable subscription record.

Tokens expire after 48 hours. Starting a new confirmation generation invalidates every older link. Successful confirmation consumes the generation exactly once. A replay after success renders a harmless already-confirmed result and performs no duplicate provider operation.

### Link-scanner safety

The emailed link opens `GET /newsletter/confirm?token=...`. GET validates enough information to render the confirmation screen but performs no subscription mutation. The resident must select an explicit **Confirm subscription** button, which sends a same-origin POST to `POST /api/newsletter/confirm`.

This prevents common email-security scanners from activating a subscription merely by inspecting the link.

### Confirmation mutation

The confirmation POST verifies:

- token signature, version, key identifier, site, and expiry;
- the current stored nonce and generation;
- pending status and active consent;
- same-origin request headers;
- bounded request size and rate limits; and
- single-use database consumption.

The database atomically changes the subscription from `pending_confirmation` to `confirmed_pending_provider` and enqueues a Resend Contact synchronization job. The browser never receives the canonical customer record or provider credential.

After the Resend Contact is successfully created or updated and assigned to the configured Segment, the worker changes the local state to `active`. Until then, the confirmation page truthfully says that confirmation was accepted and activation is being completed. A provider failure leaves a retryable state rather than claiming full activation.

## Resend Contact Synchronization

Only `confirmed_pending_provider` or already `active` subscriptions with current marketing consent may be synchronized.

The adapter:

1. resolves the canonical email and approved first/last name fields through a server-only site-scoped query;
2. creates or updates the Resend Contact by normalized email;
3. sets `unsubscribed: false` only for a newly confirmed generation backed by active consent;
4. assigns the Contact to the configured District Newsletter Segment;
5. records the Resend Contact identifier and synchronization time; and
6. marks the job complete and the subscription active.

An ordinary retry must never reverse an unsubscribe, complaint, hard-bounce, or suppression state. Re-enabling one of those records requires a fresh approved consent event and an explicit reviewed recovery path; it is not part of automatic retry behavior.

Resend Contact operations and confirmation sends use deterministic idempotency keys derived from the site, subscription, job type, and generation. Database jobs use leases and fencing tokens so two Vercel invocations cannot claim the same attempt concurrently.

## Durable Job Processing

Two job types are supported:

- `newsletter.confirmation.send`
- `newsletter.contact.sync`

Jobs contain identifiers and safe operational metadata only. They do not duplicate message bodies, raw confirmation tokens, API keys, or full contact records.

The database tracks queued, leased, completed, retryable-failed, and terminal-failed states; attempt count; next-attempt time; lease owner; lease expiry; provider message/contact identifier; and a bounded non-sensitive failure code.

The scheduled worker is a Node.js Vercel route protected by `CRON_SECRET`. It claims a bounded batch, applies exponential backoff with jitter, and stops retrying terminal policy failures. Immediate post-submission processing and scheduled processing use the same lease-protected handler.

No worker logs email addresses, confirmation URLs, tokens, message bodies, credentials, or raw provider responses.

## Confirmation Email

The confirmation message is transactional and contains no newsletter marketing content. It uses an accessible HTML template with a plain-text equivalent.

Approved initial content contract:

- Subject: **Confirm your District Newsletter subscription**
- Preview: **One more step to receive updates from the Office of Assemblywoman Carmen Morales.**
- Heading: **Confirm your subscription / Confirme su suscripción**
- Primary action: **Confirm subscription / Confirmar suscripción**
- Explain that the link expires in 48 hours.
- Explain that no action is required if the recipient did not request the subscription.
- State that the sending address is not monitored.
- Link to `https://www.assemblywomanmorales.com/contact` and include the verified district-office phone number.

The message must not claim successful subscription, delivery, legislative endorsement, or a response time.

## Broadcast Operating Model

Staff uses Resend's no-code Broadcast editor, not the Site Editor Platform, for the initial release.

Before a Broadcast can be sent, staff must:

- select the District Newsletter Segment;
- use the verified sender identity;
- include the office postal address;
- include the official contact link and phone number;
- include Resend's unsubscribe footer or `RESEND_UNSUBSCRIBE_URL` placeholder;
- send a test to an authorized staff inbox;
- review desktop and mobile rendering, links, alt text, and plain-text output; and
- use Resend's final send confirmation.

The site does not automatically create or send Broadcasts. A later editor campaign composer requires its own platform release and design review.

## Unsubscribe and Provider Event Reconciliation

The webhook route reads the raw request body and verifies the Resend/Svix signature using `svix-id`, `svix-timestamp`, `svix-signature`, and `RESEND_WEBHOOK_SECRET` before parsing or mutating data.

Webhook delivery is treated as at least once and not ordered. The database stores the unique `svix-id` and provider event time. A repeated identifier returns success without repeating mutations. State transitions compare provider time and severity so a late delivered event cannot overwrite a later bounce, complaint, suppression, or unsubscribe.

Events are applied only when the provider Contact or recipient maps to this site's subscription. Unknown or other-site events are recorded as ignored without exposing their payload to staff.

- A Resend unsubscribe or Contact update moves the local subscription to `withdrawn` and prevents future synchronization into an eligible state.
- A permanent hard bounce moves it to `bounced`.
- A complaint moves it to `complained`.
- A suppression moves it to `suppressed`.
- A delayed or failed confirmation attempt updates only delivery/job status unless the event is terminal.
- Delivered and sent events may update operational timestamps but never create consent or activate an unconfirmed subscription.

Resend remains responsible for excluding globally unsubscribed or suppressed Contacts from Broadcasts even if webhook reconciliation is delayed.

## Data Model and Database Contract

Implementation requires additive, site-scoped database objects. Exact foreign-key names must match the deployed platform schema, but the contract is fixed:

### Subscription record

- immutable subscription identifier;
- site identifier;
- canonical customer/person identifier;
- originating newsletter receipt identifier;
- current marketing-consent event identifier and policy version;
- status: `pending_confirmation`, `confirmed_pending_provider`, `active`, `withdrawn`, `bounced`, `complained`, or `suppressed`;
- confirmation generation, nonce, issued time, and expiry;
- consumed time;
- Resend Contact identifier and Segment identifier;
- provider synchronization and last-event times;
- optimistic version; and
- created and updated times.

There is one current subscription per site and canonical customer identity. Email remains on the canonical customer record rather than being copied into the subscription table.

### Newsletter job record

- job identifier;
- site and subscription identifiers;
- job type and confirmation generation;
- state, attempts, next-attempt time, and terminal flag;
- lease owner, fencing token, and lease expiry;
- deterministic idempotency key;
- provider identifier when available;
- bounded safe result/failure code; and
- created, updated, and completed times.

### Webhook receipt

- site identifier;
- unique `svix-id`;
- provider event type and provider-created time;
- mapped subscription and provider message/contact identifiers when known;
- disposition and bounded safe result code; and
- received and processed times.

Raw webhook bodies are not retained after verified processing unless a separately approved retention policy requires them.

Every table denies anonymous and browser-authenticated access. Only service-role server paths and specifically authorized staff projections may read or mutate these records. Every RPC verifies the supplied site against the referenced receipt, customer, consent, subscription, and job.

## Privacy, Retention, and Constituent Rights

Activation requires a published privacy notice that explains:

- what newsletter information is collected;
- the purpose of district-newsletter email delivery;
- that Resend processes delivery data;
- that confirmation is required;
- how to unsubscribe;
- how to request access, correction, or deletion; and
- the applicable retention approach.

The privacy notice and consent copy require human approval before `NEWSLETTER_EMAIL_ENABLED` can be enabled. This document defines system behavior and is not a substitute for legal review.

Withdrawal stops future marketing use but preserves the minimum non-message consent and audit evidence allowed by the approved retention policy. An approved deletion removes or irreversibly redacts direct personal information in the site-local record and removes the Resend Contact where policy permits. Provider deletion must not erase the fact that a suppression or withdrawal must continue to be honored.

## Environment and Secrets

The application uses these Vercel variables:

- `RESEND_API_KEY` — already present; Sensitive; Production and Preview.
- `RESEND_WEBHOOK_SECRET` — added only after the production webhook is registered.
- `RESEND_NEWSLETTER_SEGMENT_ID` — identifier of the operator-created District Newsletter Segment.
- `NEWSLETTER_CONFIRMATION_SECRET` — at least 32 random bytes; Sensitive.
- `NEWSLETTER_CONFIRMATION_KEY_ID` — non-secret active signing-key identifier.
- `NEWSLETTER_EMAIL_ENABLED` — defaults to `false`; enabled only after readiness passes.
- `CRON_SECRET` — already present and used to authorize the scheduled job route.
- `NEXT_PUBLIC_SITE_URL` — production value must be `https://www.assemblywomanmorales.com` before confirmation links are issued.

Secrets are entered directly in Vercel and never committed, printed, copied into client bundles, or pasted into chat. Changing a Vercel variable requires a fresh deployment before it affects the application.

Preview must use a separate Resend test Segment and must never synchronize preview submissions into the production District Newsletter Segment. If an isolated provider configuration is unavailable, preview provider sends remain disabled and provider adapters are tested with controlled fakes only outside production.

## Public and Staff User Experience

### Newsletter page

When all readiness gates pass, the current unavailable copy is replaced with truthful signup copy. The form states that submission alone does not subscribe the address and that confirmation is required.

If the managed form, database, Turnstile, confirmation configuration, or feature flag is unavailable, the page returns to the existing phone/contact fallback and performs no partial browser-side provider work.

### Confirmation page

The confirmation page supports:

- ready-to-confirm;
- expired link;
- invalid link;
- already confirmed;
- confirmation accepted and provider activation pending;
- active subscription; and
- temporarily unavailable.

It never exposes whether an arbitrary email address is subscribed. Responses are `no-store` and confirmation tokens are redacted from logs and analytics. The page includes a `Referrer-Policy: no-referrer` response to avoid leaking the token through outbound navigation.

### Editor and operational header

Submissions and Customers continue to show real site-local data. Where supported by current package projection contracts, staff can see pending, active, withdrawn, bounced, complained, or suppressed state. No unsupported editor UI is simulated.

The operational header changes from **Providers unavailable** to a narrower truthful statement: newsletter email is configured through Resend; SMS and AI remain unavailable; Broadcast composition occurs in Resend rather than the editor.

## Error Handling

- Invalid, expired, stale-generation, or malformed tokens do not mutate state.
- A form storage failure returns the existing truthful unavailable response and enqueues no job.
- A job-enqueue failure after a successful base receipt returns a truthful partial-availability response and is visible to staff for recovery; it never marks the subscriber active.
- A Resend outage leaves confirmation or contact-sync jobs retryable.
- A provider API acceptance records **sent/accepted**, not delivered.
- Webhook signature failures return a rejection and perform no mutation.
- Unknown webhook events are safely ignored after signature verification.
- Duplicate or out-of-order webhooks cannot reactivate a withdrawn, bounced, complained, or suppressed subscription.
- Missing Segment, webhook secret, signing secret, sender-domain readiness, or feature flag causes the email adapter to fail closed.

## Security Requirements

- All Resend SDK use is confined to Node.js server modules marked server-only.
- Confirmation and webhook mutation routes use bounded bodies, explicit methods, no-store responses, and safe error messages.
- Confirmation POST retains same-origin and rate-limit protection.
- HMAC comparisons use constant-time verification.
- Token signatures bind site, subscription, generation, nonce, and expiry.
- Webhooks are verified against the exact raw body before JSON parsing.
- `svix-id` provides replay deduplication.
- Database leases and fencing tokens protect job execution.
- Logs and staff projections exclude email bodies, raw tokens, secrets, and full webhook payloads.
- Content Security Policy changes are limited to what the rendered public routes require; the browser never connects directly to Resend.

## Testing Strategy

### Unit and route tests

- confirmation token issue, validation, expiry, generation invalidation, tamper rejection, and constant-time signature path;
- GET confirmation is read-only and POST performs the mutation;
- invalid and expired links reveal no subscriber information;
- form acceptance enqueues one confirmation job for accepted and replayed receipts;
- duplicate form retries and duplicate worker claims do not duplicate subscriptions or activations;
- provider failures leave retryable jobs and truthful UI states;
- a confirmation cannot activate missing or withdrawn consent;
- Resend Contact synchronization is limited to confirmed eligible subscriptions and the configured Segment;
- ordinary retry cannot reverse unsubscribe, bounce, complaint, or suppression;
- raw-body webhook signature verification, duplicate `svix-id`, and out-of-order event handling;
- unknown-site/provider events are ignored;
- no secret, token, email address, or provider payload appears in logs or public responses;
- feature-disabled and configuration-missing paths fail closed; and
- `NEXT_PUBLIC_SITE_URL` generates the canonical `www` confirmation URL.

### Isolated database tests

- additive migration and grants;
- site-scoped foreign-key and RPC enforcement;
- atomic pending-subscription plus job creation;
- one current subscription per site/customer;
- confirmation generation consumption;
- job lease, fencing, retry, and terminal failure behavior;
- webhook deduplication and monotonic state precedence;
- consent withdrawal and deletion/redaction behavior; and
- cross-site denial.

Database tests use an isolated database and clean up their own records. They never seed or mutate production.

### Preview acceptance

- build, lint, unit tests, database tests, and existing platform checks pass;
- `/newsletter` renders active and unavailable states correctly;
- desktop and mobile form behavior, accessibility, no overflow, and no console/network errors;
- a controlled isolated test inbox receives the bilingual confirmation message;
- link scanners cannot confirm by GET;
- POST confirms once and a replay is harmless;
- the isolated Resend Contact joins only the preview test Segment;
- test Broadcast includes unsubscribe behavior; and
- webhook retries and duplicate delivery are idempotent.

### Production acceptance

Production verification is read-only until an authorized person submits a real address with genuine consent. The first controlled production signup uses an authorized real inbox and is retained as an authentic subscriber record; it is not synthetic or placeholder data.

Acceptance verifies:

- custom-domain HTTPS and canonical redirect;
- production environment names without revealing values;
- production Segment and webhook configuration;
- non-mutating database readiness RPC;
- active form revision and privacy notice;
- feature flag state;
- one authentic double-opt-in flow;
- Resend Contact/Segment membership;
- one staff test Broadcast to authorized recipients only;
- unsubscribe reconciliation; and
- no unrelated SMS, AI, survey, or editor send capability became active.

## Deployment Sequence

1. Record the currently promoted Vercel deployment for rollback.
2. Implement and test the additive database contract in isolation.
3. Implement confirmation tokens, routes, templates, provider adapter, durable jobs, and webhook reconciliation test-first.
4. Add a reviewed privacy notice and update the managed newsletter-page copy.
5. Create separate preview and production Resend Segments.
6. Configure preview variables without enabling production sync.
7. Deploy and complete isolated preview acceptance.
8. Deploy the verified revision to production with `NEWSLETTER_EMAIL_ENABLED=false`.
9. Register the production Resend webhook and enter `RESEND_WEBHOOK_SECRET` directly in Vercel.
10. Set the production Segment identifier, confirmation signing variables, and canonical site URL.
11. Run the non-mutating readiness check.
12. Enable `NEWSLETTER_EMAIL_ENABLED`, create a fresh deployment, and perform the single authorized authentic signup.
13. Verify confirmation, Contact/Segment membership, webhook processing, unsubscribe behavior, editor visibility, and public fallback.
14. Record release evidence and the rollback/disable path.

## Rollback and Disablement

- Immediate provider disable: set `NEWSLETTER_EMAIL_ENABLED=false` and redeploy. The public page returns to the truthful unavailable fallback; no new jobs are created.
- Provider incident: pause Broadcasts in Resend, disable the feature flag, and allow no job to claim work while records remain intact.
- Web regression: promote the recorded prior Vercel deployment.
- Database migrations remain additive. Do not drop tables or delete subscriber/consent history as a rollback mechanism.
- Existing active subscribers and withdrawal/suppression state are preserved through rollback.
- Rotating `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, or the confirmation signing key follows a recorded secret-rotation procedure. Old confirmation keys remain verification-only until their final 48-hour token window expires, then are removed.

## Expected Repository Changes

Implementation is expected to add or modify focused files in these areas:

- the managed newsletter route orchestration;
- `app/newsletter/confirm/page.tsx`;
- `app/api/newsletter/confirm/route.ts`;
- `app/api/newsletter/jobs/run/route.ts`;
- `app/api/webhooks/resend/route.ts`;
- server-only newsletter token, repository, job, and Resend adapter modules;
- accessible confirmation email templates;
- additive Supabase migrations and isolated migration tests;
- newsletter and privacy page content/configuration;
- editor operational-status copy;
- `.env.example` names only;
- Vercel cron configuration if the project does not already expose a compatible scheduled worker; and
- focused unit, route, integration, and browser tests.

The unrelated untracked `client-website-setup-operator-walkthrough.md` remains outside release scope.

## Acceptance Criteria

The newsletter is live only when all of the following are true:

- the website and sending subdomain remain verified;
- the published privacy notice and consent copy are approved;
- accepted form requests create real site-local receipts and pending subscriptions without leads;
- no address enters the Resend production Segment before explicit confirmation;
- confirmation GET is read-only and confirmation POST is single-use;
- confirmed contacts synchronize idempotently into the District Newsletter Segment;
- staff can create a test and scheduled Broadcast in Resend without any editor send control;
- every marketing Broadcast includes unsubscribe and office-contact information;
- unsubscribe, bounce, complaint, failure, and suppression events are verified and reconciled safely;
- provider failure produces retryable state and truthful UI rather than simulated success;
- Production and Preview are isolated;
- no synthetic or placeholder production subscriber exists;
- SMS, AI, survey, and generic provider actions remain truthfully unavailable;
- automated, database, build, platform, desktop, mobile, direct-route, console, and network checks pass; and
- rollback and feature-disable evidence is recorded without destructive database changes.

## Provider References

- [Resend audience hygiene and double opt-in](https://resend.com/docs/knowledge-base/audience-hygiene)
- [Resend Contacts](https://resend.com/docs/dashboard/audiences/contacts)
- [Resend Broadcasts](https://resend.com/docs/dashboard/broadcasts/introduction)
- [Resend unsubscribe management](https://resend.com/docs/dashboard/audiences/managing-unsubscribe-list)
- [Resend webhook signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Resend webhook event types](https://resend.com/docs/webhooks/event-types)
