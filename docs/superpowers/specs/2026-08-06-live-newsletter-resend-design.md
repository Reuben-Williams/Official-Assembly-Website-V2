# Live Newsletter and Resend Integration Design

**Status:** Revised design approved, pending independent specification review and implementation planning

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
- Vercel lists `RESEND_API_KEY` as a Sensitive variable for Production and Preview. Because Resend Contacts and global unsubscribe state are team-wide, the Production key must be removed from Preview before application work begins. Preview provider calls remain hard-disabled unless a distinct Resend team is provisioned.

Infrastructure readiness is not application readiness. Production newsletter collection remains disabled until the application, database, privacy notice, Resend Segment, webhook, and verification gates in this document pass.

## Goals

- Collect authentic newsletter requests through the existing managed form, Turnstile, same-origin checks, rate limits, and explicit marketing-email consent.
- Require double opt-in before a resident becomes eligible for marketing Broadcasts.
- Keep consent and subscription history in site-scoped production storage.
- Mirror confirmed, eligible subscribers into a dedicated Resend Segment.
- Let staff compose, preview, test, and immediately send newsletters in Resend's no-code Broadcast editor after a protected site-owned consent-readiness validation.
- Include a working unsubscribe mechanism in every marketing Broadcast.
- Reconcile provider unsubscribes, hard bounces, complaints, failures, and suppressions into the site-local subscriber state.
- Make every external side effect idempotent or safe to repeat.
- Keep production free of synthetic, sample, seeded, and placeholder subscribers.

## Non-goals

- No editor-embedded campaign composer or send button in this release.
- No scheduled newsletter sending in the first release.
- No automatic campaign content generation.
- No SMS, AI, survey, or generic outbound messaging activation.
- No import of historical contacts without separately reviewed consent evidence.
- No automatic subscription from contact-form submissions, customer records, leads, staff-created records, or email addresses gathered for another purpose.
- No purchase, rental, scraping, or enrichment of email lists.
- No claim that provider acceptance proves inbox delivery.
- No inbound mailbox or monitored Reply-To address unless one is separately provisioned and approved.

## Approaches Considered

### 1. Double opt-in with site-local consent and Resend Broadcasts — selected

The website records the request as pending, sends a transactional confirmation message, and activates the subscription only after the resident deliberately confirms. Confirmed contacts are synchronized to a dedicated Resend Segment and default-opt-out Topic. Staff composes, tests, and immediately sends marketing newsletters in the Resend dashboard. Before the dashboard send, a protected Staff Portal control retrieves that exact dashboard Broadcast, reconciles subscriber eligibility, validates its fixed fields and content contract, and records a short-lived approval digest. Webhooks and scheduled provider audits then determine whether the actual dashboard send matched a current approval.

This has more implementation work than single opt-in, but it provides the clearest proof that the submitted address belongs to a person who wants the newsletter. It also keeps the existing editor submission/customer history aligned with the delivery provider.

### 2. Immediate single opt-in — rejected

The website would add every accepted form submission to Resend immediately. This creates less friction but is more vulnerable to mistyped addresses, unwanted signups, bots, complaints, and list-quality damage.

### 3. Resend-hosted or Resend-only signup — rejected

This would bypass the existing managed form, Turnstile policy, site-local submission receipt, consent evidence, Customers view, and retention workflow. It is operationally simple but breaks the approved system-of-record boundary.

### Final-send control reconsideration — Resend dashboard send selected

The originally approved site-owned API-copy dispatcher is not implementable without weakening the Topic/content contract. Resend can retrieve a dashboard Broadcast with its Topic, preview text, and Reply-To state, but its create/update Broadcast APIs do not expose all of those fields, and its send-Broadcast API accepts only API-created Broadcasts. An API copy therefore cannot be proven to preserve the exact staff-reviewed, Topic-bound dashboard Broadcast.

Three final-send approaches were compared:

1. **Resend dashboard send with site validation and audit — selected.** This preserves Resend's native Topic-scoped unsubscribe behavior, dashboard testing, sending, and reporting. The trade-off is that validation is point-in-time and bypasses are detected after provider action rather than technically prevented.
2. **Site-controlled per-recipient Emails API sending — rejected for this release.** This would provide technical final-send control but would require custom unsubscribe/preferences, recipient batching, scheduling, retry, reconciliation, and reporting infrastructure and would lose most of the native Broadcast workflow.
3. **Collection-only staged release — rejected.** This would activate signup and double opt-in without sending newsletters and would not meet the approved launch goal.

## System of Record and Provider Boundary

Supabase is authoritative for:

- the immutable managed-form receipt;
- the canonical site-local person/customer reference;
- the captured marketing-email consent evidence and policy version;
- pending, confirmed, active, topic-withdrawn, globally withdrawn, expired, and provider-suppressed subscriber state;
- confirmation generations, expiry, and consumption;
- provider synchronization attempts and outcomes; and
- verified webhook receipts and audit events;
- Broadcast validation digests, audience-readiness revisions, validation expiry, send observations, and provider incidents.

Resend is authoritative for:

- provider Contact identifiers;
- the operational District Newsletter Segment;
- Broadcast drafts, tests, dashboard sends, schedules, and provider delivery events;
- Resend's global unsubscribe and suppression enforcement; and
- provider message identifiers.

The public browser never calls Resend. All Resend API access is server-only. Provider-specific code is isolated behind a small newsletter delivery adapter rather than embedded in public components or the shared editor core.

The private editor may display subscription and delivery facts supplied by the site-local database, but it does not gain a campaign composer or send button in this release. It gains a protected newsletter-operations control that validates a specified Resend dashboard Broadcast and reports the approval expiry. Staff then returns to Resend and clicks **Send** immediately.

This is a point-in-time validation and detection boundary, not a technical send interception boundary. Resend dashboard permissions can bypass the Staff Portal validation, and the application cannot prevent an authorized Resend user from changing or sending a Broadcast after validation. Restricted provider access, a ten-minute validation window, webhook reconciliation, scheduled provider audit, and incident lockout reduce that risk and make a bypass visible. The site never claims that a matching validation proves it technically authorized or initiated the provider send.

## Resend Configuration

The Production Resend team must be dedicated to this site. Readiness verifies that it contains no unrelated domains, Contacts, Segments, Topics, or applications; otherwise an isolated team must be provisioned and the sending domain verified there before activation.

An authorized operator creates one Resend Segment named **District Newsletter** and one public Topic with the same resident-facing name. The Topic uses `opt_out` as its immutable default so a Contact is ineligible unless the application explicitly opts it in after double confirmation. Their identifiers are stored in Vercel as `RESEND_NEWSLETTER_SEGMENT_ID` and `RESEND_NEWSLETTER_TOPIC_ID`.

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
- `contact.deleted`
- `suppression.added`
- `suppression.removed`

Open and click tracking are not required for activation and are not copied into the constituent system of record. This minimizes unnecessary behavioral data.

## Public Signup Flow

1. The resident opens `/newsletter` and sees the published managed form plus the approved privacy notice and marketing-consent language.
2. The form submits to the existing `POST /api/forms/newsletter-signup` endpoint.
3. The existing package route enforces a published compatible form revision, same-origin policy, body limits, Turnstile, request and identity rate limits, request fingerprinting, and explicit consent evidence.
4. Contact forms continue to use the published strict ingestion service unchanged. Newsletter forms use a site-local ingestion adapter backed by `builder_ingest_official_assembly_newsletter_v1`. That RPC invokes the existing strict ingestion contract and, in the same PostgreSQL transaction, stores or replays the immutable receipt, creates or matches the site-local customer identity, records marketing-email consent without a lead, creates or reuses the pending subscription, and enqueues exactly the allowed initial or next confirmation-delivery ordinal under the current generation and rate policy.
5. The newsletter RPC returns the same versioned acceptance shape expected by the published route. Any failure in receipt, customer, consent, subscription, or job creation rolls back the entire newsletter transaction and returns no success acknowledgement.
6. The public response says that the request was received and that a confirmation link will arrive shortly. It does not say the address is subscribed or that the email has been delivered.
7. A best-effort inline worker may claim the new job immediately. A protected scheduled worker retries jobs that remain pending.

The committed database transaction is not rolled back because Resend is temporarily unavailable after the job is durable. Instead, the confirmation job remains retryable. A provider outage cannot erase valid consent evidence or produce a false active subscription.

Repeated form submissions use the existing form idempotency contract. Replayed receipts do not create duplicate subscriptions. A pending record reuses its current unexpired confirmation generation; it does not create a new generation on every request.

A **generation** identifies one confirmation token lifecycle. A **delivery ordinal** identifies one logical confirmation message within that generation. The initial accepted request creates ordinal 1. A later authentic request after the cooldown may enqueue ordinal 2 with the same token generation. Transport retries for one ordinal reuse the same durable job, payload, and Resend email idempotency key; they do not create another ordinal. Jobs are unique on `(site_id, subscription_id, generation, delivery_ordinal)`, and the provider key includes all four values.

Logical confirmation deliveries are limited to one ordinal per normalized address per 15 minutes, five ordinals per 24 hours, and ten ordinals per rolling 30 days. Limits are enforced atomically before enqueueing and use non-reversible site-scoped address fingerprints rather than browser-visible email values. Authorized requeue never resets or deletes the rolling delivery ledger. Re-running transport for an existing ordinal does not consume a new logical-delivery allowance; creating a new ordinal always does.

An expired generation may be renewed only by a fresh authentic form submission with approved consent evidence or by an authorized staff recovery action. A subscriber who withdrew only from the District Newsletter Topic may start a fresh form-consent and double-opt-in generation. A provider-global unsubscribe requires that same fresh consent plus an authorized `newsletter.contact.reactivate_global` review job that verifies there is no complaint, bounce, or suppression before it may set global `unsubscribed: false`, opt in the Topic, and restore Segment membership. Complaint, hard-bounce, or suppression states never enter that ordinary reactivation path. Pending subscriptions expire after 30 days and follow the approved retention/redaction policy while their minimum consent audit evidence remains governed by that policy.

At 30 days without confirmation, a scheduled database transition changes the status to `expired_pending`, clears the usable nonce and key reference, terminally closes queued confirmation jobs, and preserves only the approved receipt/consent audit and bounded delivery ledger. A fresh authentic request after expiration creates the next generation and remains subject to the rolling address limits.

Terminal or repeatedly failed jobs appear in an authorized operations view with a bounded failure code. An authorized requeue uses the same unexpired generation and existing ordinal only for transport recovery. A deliberate logical resend creates the next ordinal and counts against every rolling limit. Creating a new generation invalidates older links but does not reset delivery limits. The operator and reason are recorded. There is no anonymous public endpoint that can generate unbounded confirmation messages.

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

Each confirmation generation stores its signing-key identifier, issued time, and expiry. The server holds an active-plus-verification-only keyring. Token payloads use a fixed field order and canonical UTF-8 JSON representation with short versioned keys: `v`, `site`, `sub`, `gen`, `nonce`, `iat`, `exp`, and `kid`. The wire form is `base64url(payload).base64url(HMAC-SHA256(payload))`. Unknown keys, non-canonical encodings, duplicate fields, clock-skew violations, and invalid signatures fail closed. Rotation changes the active key for new generations while retaining old keys for verification through their final 48-hour lifetime.

Tokens expire after 48 hours. Starting a new confirmation generation invalidates every older link. Successful confirmation consumes the generation exactly once. A replay after success renders a harmless already-confirmed result and performs no duplicate provider operation.

### Link-scanner and token-leakage safety

The emailed link uses `https://www.assemblywomanmorales.com/newsletter/confirm#token=...`. URL fragments are not sent in the HTTP request or Referer header. A small same-origin client component reads the fragment, immediately removes it with `history.replaceState`, and posts it in a bounded `no-store` request to `POST /api/newsletter/confirmation-session`. That route applies the same strict same-origin and Fetch Metadata checks as the mutation route, validates the token without mutating subscription state, and exchanges it for a `__Host-newsletter-confirmation` cookie with Secure, HttpOnly, SameSite=Lax, `Path=/`, no Domain attribute, and a ten-minute lifetime.

The clean `/newsletter/confirm` page renders an explicit **Confirm subscription** button. The button sends a same-origin POST to `POST /api/newsletter/confirm` using the short-lived cookie. The cookie contains an encrypted or authenticated opaque session reference, not the reusable confirmation token, and is deleted after success or terminal failure.

Email-security scanners that only fetch links never receive the fragment and cannot activate or establish a session. A scanner that executes JavaScript may establish a short-lived read-only session, but confirmation still requires the separate POST action. Application, Vercel, analytics, and error logs are tested to ensure they never record fragment tokens, request bodies, confirmation cookies, or decoded token payloads.

### Confirmation mutation

The confirmation POST verifies:

- the authenticated confirmation session and its bound token signature, version, key identifier, site, and expiry;
- the current stored nonce and generation;
- pending status and active consent;
- same-origin request headers;
- bounded request size and rate limits; and
- single-use database consumption.

For an ordinary pending or topic-withdrawn subscription, the database atomically changes the subscription to `confirmed_pending_provider` and enqueues a Resend Contact synchronization job. For a globally withdrawn Contact, it changes to `confirmed_pending_global_review` and does not enqueue ordinary synchronization; an authorized global-reactivation review is required. Complaint, bounce, and suppression states remain non-eligible and do not enter either automatic path. The browser receives the same generic accepted-for-review result and never receives the canonical customer record or provider credential.

After the Resend Contact is successfully created or updated and assigned to the configured Segment, the worker changes the local state to `active`. Until then, the confirmation page truthfully says that confirmation was accepted and activation is being completed. A provider failure leaves a retryable state rather than claiming full activation.

## Resend Contact Synchronization

Only `confirmed_pending_provider` or already `active` subscriptions with current marketing consent may enter ordinary synchronization. `confirmed_pending_global_review` is handled only by the authorized global-reactivation saga.

The adapter:

1. resolves the canonical email and approved first/last name fields through a server-only site-scoped query;
2. retrieves the Resend Contact by stored provider identifier or normalized email;
3. creates the Contact only when lookup proves it is absent, then persists the returned identifier before continuing;
4. conditionally updates approved properties without changing unrelated Contact properties;
5. sets the District Newsletter Topic to `opt_in` only for a newly confirmed generation backed by active consent;
6. ensures membership in the configured District Newsletter Segment;
7. re-reads Contact, Topic, and Segment state after any ambiguous response;
8. records the verified Resend Contact identifier and synchronization time; and
9. marks the job complete and the subscription active only after the provider state is verified.

An ordinary retry must never reverse an unsubscribe, complaint, hard-bounce, or suppression state. Re-enabling one of those records requires a fresh approved consent event and an explicit reviewed recovery path; it is not part of automatic retry behavior.

Resend Contact, Topic, and Segment APIs do not provide the email-send idempotency contract. Contact synchronization is therefore a resumable saga. Each completed provider phase and returned identifier is persisted before the next phase. A timeout or ambiguous response causes a provider read before any retry, so the worker converges on the desired state without assuming that the failed HTTP response means no mutation occurred.

Confirmation email sends use a deterministic Resend idempotency key derived from the site, subscription, job type, generation, and delivery ordinal. Resend retains email-send idempotency keys for 24 hours. Within that window, an ambiguous send retries with the identical key and payload. If a provider message identifier was returned, the job never sends again even when a webhook is delayed. If the outcome remains ambiguous without an identifier after 24 hours, automatic sending stops and the job becomes `terminal_ambiguous`. An authorized recovery creates a new confirmation generation and ordinal, invalidates the older link, remains subject to the rolling address ledger, and records the reason before sending; it never blindly repeats the old request outside Resend's deduplication window.

Database jobs use leases and fencing tokens so two Vercel invocations cannot claim the same attempt concurrently.

## Durable Job Processing

Subscription-scoped jobs require one site and one subscription and support:

- `newsletter.confirmation.send`
- `newsletter.contact.sync`
- `newsletter.contact.withdraw`
- `newsletter.contact.reactivate_global`
- `newsletter.contact.delete`

Site-scoped provider-maintenance jobs require one site, forbid a subscription or Broadcast release, and support:

- `newsletter.segment.reconcile`

Provider Broadcast audit jobs require one site and configured Resend team scope, forbid a subscription, and support:

- `newsletter.broadcast.audit`

Jobs contain identifiers and safe operational metadata only. They do not duplicate message bodies, raw confirmation tokens, API keys, or full contact records. Subscription jobs may carry confirmation generation/ordinal fields. Site-maintenance and provider-audit jobs carry only their site/provider scope and durable cursor or saga state. Foreign keys, kind allowlists, and database check constraints enforce the three mutually exclusive subject shapes.

The database tracks queued, leased, completed, retryable-failed, and terminal-failed states; attempt count; next-attempt time; lease owner; lease expiry; provider message/contact identifier; and a bounded non-sensitive failure code.

The scheduled worker is a Node.js Vercel route protected by `CRON_SECRET`. It claims a bounded batch, applies exponential backoff with jitter, and stops retrying terminal policy failures. Immediate post-submission processing and scheduled processing use the same lease/fencing primitives but dispatch to their typed handlers.

Contact synchronization jobs persist saga phases such as `lookup`, `contact_ensured`, `topic_ensured`, `segment_ensured`, and `verified`. Topic withdrawal removes Segment membership and sets the District Newsletter Topic to `opt_out`. Global withdrawal performs those steps and preserves provider `unsubscribed: true`. The stored withdrawal origin is never collapsed or cleared by ordinary retry.

Only an authorized `newsletter.contact.reactivate_global` job may clear provider-global unsubscribe. It requires a newer confirmed generation, newer approved consent than the withdrawal, no complaint/bounce/suppression, an operator reason, and a provider read both before and after mutation. Complaint recovery is unsupported in this release. Hard-bounce or suppression recovery requires a separately documented provider remediation and fresh consent and cannot reuse the global-withdrawal job.

Approved deletion removes Segment membership, opts out the Topic, and deletes the provider Contact only when the operator has verified that the Contact has no other approved use in the dedicated team. Otherwise it retains the provider suppression/withdrawal marker while removing site-specific membership and properties.

The reconciliation job lists the production Segment and compares every member with active, confirmed Supabase eligibility. It removes unconfirmed, topic-withdrawn, globally withdrawn, expired, bounced, complained, suppressed, unknown, or other-site Contacts; verifies that every retained Contact is opted in to the District Newsletter Topic; and records a signed, expiring readiness result. It never opts an ineligible Contact in merely because the Contact exists in Resend.

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

Staff uses Resend's no-code Broadcast editor, not the Site Editor Platform, to compose, preview, test, and immediately send the final **dashboard Broadcast**. The Staff Portal does not copy the Broadcast, schedule it, or call Resend's send-Broadcast endpoint. Its protected newsletter-operations control performs a point-in-time validation of the exact dashboard Broadcast identifier and records a short-lived approval for later reconciliation.

Before a Broadcast can be sent, staff must:

- select the District Newsletter Segment;
- select the public District Newsletter Topic;
- use the verified sender identity;
- include the office postal address;
- include the official contact link and phone number;
- include Resend's unsubscribe footer or `RESEND_UNSUBSCRIBE_URL` placeholder;
- send a test to an authorized staff inbox;
- review desktop and mobile rendering, links, alt text, and plain-text output; and
- provide the dashboard Broadcast identifier to the protected Staff Portal validation control; and
- click **Send** in Resend within ten minutes after validation, without scheduling or changing the Broadcast.

The protected validation control is available only to an authorized site owner/operator. It creates or replays a durable Broadcast validation record keyed by the operator command identifier. Validation:

1. refuses validation while any unresolved critical Broadcast incident exists for the site/provider team;
2. retrieves the dashboard Broadcast and requires `draft` status with no provider schedule;
3. verifies the fixed sender, production Segment, opt-out-by-default Topic, unsubscribe placeholder/footer, office-contact content, and approved Reply-To state;
4. runs fresh Segment reconciliation and requires every provider member to map to an active, confirmed, non-withdrawn, non-suppressed Supabase subscription;
5. canonicalizes the Broadcast fields and records a SHA-256 digest over sender, subject, preview text, HTML, text, Segment, Topic, and approved Reply-To state; and
6. records the operator, Broadcast identifier, digest, readiness revision, audience count, validation time, and ten-minute expiry without retaining another message-body copy or creating any provider mutation.

The production validation operation is itself non-dispatching. It may retrieve provider state and perform the Contact/Topic/Segment reconciliation already authorized by the subscription system, but it cannot create, update, schedule, copy, or send a Broadcast and cannot accept or derive a staff-recipient override. Deployment readiness uses the same validator in `activation-check` mode, which records a bounded audit result but is forbidden from creating a send-valid approval.

A validation is single-use for one Broadcast identifier and exact digest. A newer validation supersedes an unused older validation for the same Broadcast. Validation of a Broadcast already observed as scheduled, queued, or sent is forbidden. After ten minutes, the approval is expired and staff must revalidate the unchanged draft. Any edit changes the digest and requires a new validation. The first release does not support scheduled sends; a scheduled provider status always invalidates the approval and creates an incident.

Staff sends from Resend immediately after a successful validation. The application cannot repeat the send, cancel it, or guarantee that audience eligibility and content remained unchanged between validation and the dashboard click. This residual risk is explicit. Resend's Topic/global-unsubscribe and suppression controls remain authoritative at delivery time, while post-send reconciliation detects drift or bypass.

Webhook processing and the scheduled `newsletter.broadcast.audit` job retrieve the observed Broadcast, recompute the canonical digest, and compare the provider identifier, sender, Segment, Topic, schedule state, and digest with the most recent unconsumed validation. The send is treated as matching only when an authoritative provider queued/sent timestamp falls within the stored validation window and every immutable comparison succeeds. That timestamp comes from the retrieved Broadcast state or the verified `email.sent` event, never from a later local observation time. Later recipient events reuse the recorded disposition rather than comparing their delivery timestamps with the original window. Missing or contradictory provider timing remains retryable for a bounded period and then becomes an incident rather than being assumed valid.

The first matching queued/sent observation atomically consumes the validation and records the provider status and observed time. An unvalidated, expired, scheduled, content-modified, wrong-audience, wrong-Topic, or wrong-sender Broadcast atomically upserts a critical incident keyed by `(site_id, provider_broadcast_id)`. A critical incident blocks all later production validations until an authorized operator contains the provider send, acknowledges the event, records a resolution reason, and closes the incident. Incident lockout does not claim to recall email already accepted by Resend.

Broadcast validation records have valid, superseded, expired, consumed-matching, and incident states. Validation is an operational approval artifact, not final dispatch authority. The audit worker tracks its own attempts, cursor, lease/fencing data, and safe provider-observed status without sharing subscription-only columns.

Resend team access is limited to the smallest practical set of designated staff. Production Contacts, Segment membership, and Topic state are not operated manually. Final send authority necessarily remains with the staff members permitted to use the Resend dashboard. Because Resend's Member/Admin roles are coarse, the runbook, short validation window, audit, and incident lockout are required; a dashboard send that bypasses validation is an unauthorized operational event that the application detects rather than prevents.

A scheduled `newsletter.broadcast.audit` job lists newly scheduled/queued/sent provider Broadcasts from a site/team-scoped durable cursor and maps every provider Broadcast identifier to its matching validation. Unvalidated, expired, scheduled, duplicate, or content-conflicting sends atomically upsert a critical incident keyed by `(site_id, provider_broadcast_id)` and trigger the documented provider-disable response. The audit is detection, not permission to send; staff retains final dashboard authority.

The site does not author, copy, schedule, or send Broadcast content. The private editor provides only the protected validation result, its expiry, safe audience-readiness evidence, incident status, and a link back to Resend. A later editor campaign composer or site-owned send control requires its own platform release and design review.

## Unsubscribe and Provider Event Reconciliation

The webhook route reads the raw request body and verifies the Resend/Svix signature using `svix-id`, `svix-timestamp`, `svix-signature`, and `RESEND_WEBHOOK_SECRET` before parsing or mutating data.

Webhook delivery is treated as at least once and not ordered. After signature verification and bounded normalization, the server first checks whether the `broadcast_id` already has a matching or incident disposition. If it does not, the server retrieves the bounded Broadcast fields from Resend before opening the database transaction; retrieval failure returns a retryable response and does not insert the webhook receipt. One database RPC then atomically inserts the unique `svix-id` receipt, maps the configured provider team/site scope, and performs Broadcast validation matching **before and independently of recipient-to-subscription mapping**. The transaction consumes a current exact-match validation or creates/replays the critical incident keyed by `(site_id, provider_broadcast_id)`, even when the recipient is unknown or belongs to no local subscription. It then applies any valid monotonic subscription/job/Broadcast-observation transition and marks the receipt processed with its disposition. If any step fails, the entire transaction rolls back, allowing Resend's retry to apply the event. Concurrent webhook and audit classifications converge through the same row locks and unique constraints. A repeated processed identifier returns the recorded disposition without repeating mutations, while a different event for the same unauthorized Broadcast increments the same incident rather than creating another. No state exists in which a receipt is permanently deduplicated while its transition or required incident is missing.

State transitions compare provider time and severity so a late delivered event cannot overwrite a later bounce, complaint, suppression, or unsubscribe. Distinct event identifiers that arrive out of order are still evaluated rather than discarded merely because an event was previously processed.

Recipient subscription transitions are applied only when the provider Contact or recipient maps to this site's subscription. Unknown or other-site recipients are recorded as ignored without exposing their payload to staff, but that recipient disposition never suppresses the independent Broadcast-authorization check or its incident upsert.

- A District Newsletter Topic opt-out moves the local subscription to `withdrawn_topic`, records `withdrawal_origin: topic`, enqueues `newsletter.contact.withdraw`, and permits reactivation only through a fresh form-consent and double-opt-in generation.
- A provider-global unsubscribe moves it to `withdrawn_global`, records `withdrawal_origin: global`, enqueues `newsletter.contact.withdraw`, and also requires the authorized global-reactivation policy before provider-global state can be cleared.
- A permanent hard bounce moves it to `bounced`.
- A complaint moves it to `complained`.
- `email.suppressed` or `suppression.added` moves it to `suppressed`, removes Segment eligibility, and preserves the suppression origin.
- `suppression.removed` records provider removal but does not reactivate, opt in, or restore Segment membership. The local record remains in a reviewed non-eligible state until an authorized recovery establishes that the underlying complaint/bounce issue is resolved and then requires fresh consent where policy permits.
- `contact.deleted` moves an otherwise eligible subscription to `provider_removed_review` and prevents Broadcast eligibility. Automatic reconciliation does not recreate it; an authorized repair must verify active local consent and absence of withdrawal, bounce, complaint, or suppression before enqueueing a new Contact saga.
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
- status: `pending_confirmation`, `expired_pending`, `confirmed_pending_provider`, `confirmed_pending_global_review`, `active`, `withdrawn_topic`, `withdrawn_global`, `bounced`, `complained`, `suppressed`, or `provider_removed_review`;
- withdrawal origin, provider-global unsubscribe state, and withdrawal time when applicable;
- confirmation generation, nonce, signing-key identifier, issued time, and expiry;
- consumed time;
- Resend Contact identifier and Segment identifier;
- provider synchronization and last-event times;
- optimistic version; and
- created and updated times.

There is one current subscription per site and canonical customer identity. Email remains on the canonical customer record rather than being copied into the subscription table.

### Subscription-scoped job record

- job identifier;
- required site and subscription identifiers;
- job type, confirmation generation, and delivery ordinal when applicable;
- current provider-saga phase and per-phase outcomes;
- state, attempts, next-attempt time, and terminal flag;
- lease owner, fencing token, and lease expiry;
- deterministic idempotency key;
- provider identifier when available;
- bounded safe result/failure code; and
- created, updated, and completed times.

Check constraints allow only confirmation/contact job kinds and require or forbid confirmation generation/ordinal according to that kind.

### Site-scoped provider-maintenance job record

- job identifier;
- required site identifier and provider-scope identifier;
- kind: `segment_reconcile`;
- saga phase or reconciliation cursor;
- state, attempts, next-attempt time, terminal flag, and lease/fencing data;
- bounded safe result/failure code; and
- created, updated, and completed times.

This shape forbids subscription and Broadcast validation identifiers and all confirmation-delivery fields.

### Site/team-scoped Broadcast audit job record

- job identifier;
- required site and provider-team scope identifiers;
- kind: `broadcast_audit`;
- due time and durable provider-list cursor;
- state, attempts, next-attempt time, terminal flag, and lease/fencing data;
- bounded safe result/failure code; and
- created, updated, and completed times.

Audit jobs deliberately have no Broadcast validation foreign key because their purpose is to discover every provider Broadcast, including one without a validation. Database foreign keys and check constraints enforce all three job subject shapes.

### Webhook receipt

- site identifier;
- unique `svix-id` and atomic processing state;
- provider event type and provider-created time;
- mapped subscription and provider message/contact identifiers when known;
- provider Broadcast identifier and mapped validation identifier when present;
- disposition and bounded safe result code; and
- received and processed times.

The verified webhook RPC writes the receipt and mapped mutation in one transaction. Raw webhook bodies are not retained after verified processing unless a separately approved retention policy requires them.

### Provider Broadcast incident record

- incident identifier;
- required site and provider-team scope identifiers;
- required provider Broadcast identifier;
- unique constraint on `(site_id, provider_broadcast_id)`;
- mapped validation identifier when one exists;
- first and last detection source: webhook or scheduled audit;
- first and last `svix-id` or audit cursor when applicable;
- reason: unvalidated, validation-expired, scheduled-in-v1, duplicate-send, content mismatch, wrong Segment, wrong Topic, wrong sender, or other bounded policy code;
- safe provider status and digest evidence;
- open, acknowledged, contained, or resolved state;
- first-seen, last-seen, and occurrence-count fields; and
- authorized operator, resolution reason, and resolution time when closed.

The verified webhook RPC and audit worker use the same atomic upsert keyed by `(site_id, provider_broadcast_id)`. A new event increments or enriches the existing incident without erasing its first-seen evidence. Incident creation does not depend on a recipient or subscription mapping.

### Broadcast validation record

- immutable validation and operator-command identifiers;
- authorized operator and validation time;
- required dashboard Broadcast identifier;
- canonical content digest;
- Segment, Topic, sender, and approved Reply-To snapshot;
- readiness revision, audience count, and readiness expiry;
- fixed ten-minute `valid_until` time;
- valid, superseded, expired, consumed-matching, or incident state;
- first provider scheduled/queued/sent observation and safe provider status;
- consuming webhook receipt or audit cursor when applicable;
- safe result/failure code; and
- created, updated, superseded, expired, consumed, and incident times when applicable.

The database stores the digest and provider identifiers, not another copy of the Broadcast HTML or text. At most one unconsumed validation may be current for a site/Broadcast. The first matching scheduled/queued/sent classification consumes or incidents that validation atomically. The provider remains the only Broadcast content store.

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

Production uses these Vercel variables:

- `RESEND_SEND_API_KEY` — domain-restricted Sending-access key for transactional confirmation mail.
- `RESEND_MANAGEMENT_API_KEY` — Full-access key used only by server-side Contact, Topic, Segment, reconciliation, protected Broadcast validation retrieval, and provider audit operations. It never calls a Broadcast create, update, schedule, or send endpoint in this release.
- `RESEND_WEBHOOK_SECRET` — added only after the production webhook is registered.
- `RESEND_NEWSLETTER_SEGMENT_ID` — identifier of the operator-created District Newsletter Segment.
- `RESEND_NEWSLETTER_TOPIC_ID` — identifier of the public, default-opt-out District Newsletter Topic.
- `NEWSLETTER_CONFIRMATION_KEYRING` — Sensitive canonical JSON object mapping key identifiers to at least 32 random bytes of base64url secret material; includes active and verification-only keys.
- `NEWSLETTER_CONFIRMATION_ACTIVE_KEY_ID` — non-secret active signing-key identifier present in the keyring.
- `NEWSLETTER_EMAIL_ENABLED` — defaults to `false`; enabled only after readiness passes.
- `CRON_SECRET` — already present and used to authorize the scheduled job route.
- `NEXT_PUBLIC_SITE_URL` — production value must be `https://www.assemblywomanmorales.com` before confirmation links are issued.

The currently configured `RESEND_API_KEY` is temporary setup state. Before activation, an operator creates the two purpose-specific keys, verifies their permissions, adds the new variables to Production only, removes `RESEND_API_KEY` from Preview and Production, and rotates/revokes the temporary key after the replacement deployment is verified.

Secrets are entered directly in Vercel and never committed, printed, copied into client bundles, or pasted into chat. Changing a Vercel variable requires a fresh deployment before it affects the application.

Resend Contacts, global unsubscribe, suppressions, webhooks, and usage are team-wide. A separate Segment inside the Production team is not Preview isolation. Preview provider calls therefore remain hard-disabled by default and provider adapters use controlled fakes plus isolated database fixtures.

Live Preview provider testing is allowed only if an entirely separate Resend team is provisioned with its own API keys, verified non-production sending subdomain, webhook endpoint/secret, Segment, default-opt-out Topic, and authorized test contacts. Preview confirmation links use that Preview deployment's allow-listed origin and can never target `www.assemblywomanmorales.com`. Production keys, Contact IDs, Segment/Topic IDs, webhook receipts, and suppressions are never shared with Preview.

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

Submissions and Customers continue to show real site-local data. Where supported by current package projection contracts, staff can see pending, active, topic-withdrawn, globally withdrawn, expired, bounced, complained, or suppressed state. No unsupported editor UI is simulated.

The protected Staff Portal newsletter-operations surface accepts a Resend Broadcast identifier and provides **Validate newsletter** and **Open Resend** actions. A successful result shows the Broadcast identifier, audience count, readiness revision, content digest abbreviation, validation time, ten-minute expiry, and an explicit instruction to send immediately without editing or scheduling. It never displays the full Broadcast body or recipient addresses. Failed validation shows a bounded reason and produces no approval.

The operational header changes from **Providers unavailable** to a narrower truthful statement: newsletter email is configured through Resend; SMS and AI remain unavailable; Broadcast composition and final sending occur in Resend rather than the editor. If a critical Broadcast incident is open, the newsletter-operations surface shows validation locked, the containment status, and the authorized review path without exposing provider payloads.

## Error Handling

- Invalid, expired, stale-generation, or malformed tokens do not mutate state.
- A newsletter receipt, customer/consent mutation, pending subscription, and initial confirmation job commit in one RPC transaction. Failure in any step rolls back all newsletter mutations, returns the existing truthful unavailable response, and leaves no stranded accepted receipt.
- A Resend outage leaves confirmation or contact-sync jobs retryable.
- An email-send outcome that remains ambiguous beyond Resend's 24-hour idempotency window becomes terminal and requires an authorized new confirmation generation; it is never blindly resent.
- A Broadcast retrieval or Segment-reconciliation timeout fails validation without producing an approval.
- A Broadcast sent after validation expiry, changed after validation, or scheduled in the first release creates an incident; the application does not claim it prevented or recalled that send.
- A provider event that cannot yet be classified remains retryable and does not permanently deduplicate before its validation/incident disposition is committed.
- A provider API acceptance records **sent/accepted**, not delivered.
- Webhook signature failures return a rejection and perform no mutation.
- Unknown webhook events are safely ignored after signature verification.
- Duplicate or out-of-order webhooks cannot reactivate a topic-withdrawn, globally withdrawn, bounced, complained, or suppressed subscription.
- A webhook transaction crash commits neither the receipt nor mutation, so provider retry can safely apply it.
- Missing Segment, webhook secret, signing secret, sender-domain readiness, or feature flag causes the email adapter to fail closed.

## Security Requirements

- All Resend SDK use is confined to Node.js server modules marked server-only.
- Confirmation-session exchange, confirmation mutation, and webhook routes use bounded bodies, explicit methods, no-store responses, and safe error messages.
- Confirmation-session exchange and confirmation POST both retain same-origin, Fetch Metadata, and rate-limit protection.
- HMAC comparisons use constant-time verification.
- Token signatures bind site, subscription, generation, nonce, and expiry.
- Webhooks are verified against the exact raw body before JSON parsing.
- `svix-id` provides replay deduplication.
- Provider Broadcast incidents use a separate unique `(site_id, provider_broadcast_id)` key so different recipient events and scheduled audits converge on one incident.
- Database leases and fencing tokens protect job execution.
- Logs and staff projections exclude email bodies, raw tokens, secrets, and full webhook payloads.
- Content Security Policy changes are limited to what the rendered public routes require; the browser never connects directly to Resend.

## Testing Strategy

### Unit and route tests

- canonical confirmation-token serialization, issue, keyring lookup, rotation, validation, expiry, generation invalidation, unknown-key rejection, tamper rejection, and constant-time signature path;
- fragment-token exchange rejects cross-origin requests, removes the fragment, produces no token-bearing request URL/log entry, creates only the Secure `__Host-` read-only session cookie with `Path=/`, and sends that cookie to the confirmation POST;
- invalid and expired links reveal no subscriber information;
- form acceptance enqueues exactly one initial ordinal for accepted and replayed receipts;
- duplicate form retries and duplicate worker claims do not duplicate subscriptions or activations;
- repeated pending requests reuse one unexpired generation, create distinct bounded delivery ordinals only after cooldown, keep transport retry within an ordinal, never reset the rolling ledger during requeue, and cannot email-bomb an address or create unbounded generations;
- provider failures leave retryable jobs and truthful UI states;
- a confirmation cannot activate missing consent or bypass topic/global withdrawal reactivation policy;
- Resend Contact synchronization is limited to confirmed eligible subscriptions, the configured Segment, and explicit opt-in to the default-opt-out Topic;
- ordinary retry cannot reverse unsubscribe, bounce, complaint, or suppression;
- Contact/Topic/Segment saga resumes after a timeout at every provider phase and reconciles ambiguous mutations before retry;
- confirmation-send ambiguity inside and outside Resend's 24-hour idempotency window;
- topic withdrawal, global withdrawal, authorized global reactivation, Segment removal, deletion, and non-automatic recovery after complaint, bounce, suppression removal, or Contact deletion;
- production validation enforces operator and content/readiness policy while creating no provider Broadcast mutation or send;
- activation-check mode cannot create a send-valid approval;
- dashboard Broadcast to short-lived validation-digest binding, ten-minute expiry, supersession, and single consumption;
- validation retrieval/reconciliation timeouts, post-validation content changes, expired approvals, duplicate send observations, and scheduled-send rejection;
- raw-body webhook signature verification, atomic receipt-plus-mutation, crash rollback, duplicate `svix-id`, and reordered distinct event IDs;
- webhook `broadcast_id` mapping accepts an exact current dashboard validation and atomically incidents unvalidated, expired, scheduled, duplicate, or mismatched Broadcasts before recipient mapping;
- different recipient webhooks and a scheduled audit for the same unauthorized provider Broadcast upsert one incident, preserve first-seen evidence, and increment the occurrence count;
- scheduled Broadcast audit cursor reconciliation detects scheduled/queued/sent provider Broadcasts without an exact current validation;
- unconfigured provider-team/site events are rejected without mutation, while unknown recipients still perform Broadcast authorization and incident an unauthorized `broadcast_id` before their recipient transition is ignored;
- no secret, token, email address, or provider payload appears in logs or public responses;
- feature-disabled and configuration-missing paths fail closed; and
- `NEXT_PUBLIC_SITE_URL` generates the canonical `www` confirmation URL.

### Isolated database tests

- additive migration and grants;
- site-scoped foreign-key and RPC enforcement;
- atomic strict receipt/customer/consent plus pending-subscription/job creation, including injected failure at every step and a simulated crash at the former receipt-to-subscription boundary;
- one current subscription per site/customer;
- confirmation generation consumption;
- delivery-ordinal uniqueness, rolling address ledger, and 30-day `expired_pending` transition;
- job lease, fencing, retry, and terminal failure behavior;
- enforced subscription, site-maintenance, and site/team-audit job shapes, plus their leases, validation digest binding, duplicate command replay, and provider-state reconciliation;
- atomic webhook receipt/mutation, rollback/retry after injected crash, deduplication, and monotonic state precedence;
- unique consumed provider-Broadcast validation mapping and one replay-safe unauthorized-Broadcast incident per provider identifier across webhook and audit races, including events for unknown recipients;
- consent withdrawal and deletion/redaction behavior; and
- cross-site denial.

Database tests use an isolated database and clean up their own records. They never seed or mutate production.

### Preview acceptance

The following checks are required in every Preview:

- build, lint, unit tests, database tests, and existing platform checks pass;
- `/newsletter` renders active and unavailable states correctly;
- desktop and mobile form behavior, accessibility, no overflow, and no console/network errors;
- link scanners cannot confirm by GET;
- confirmation POST confirms once and a replay is harmless; and
- with provider calls hard-disabled, controlled provider fakes prove confirmation delivery, Contact/Topic/Segment sagas, topic/global withdrawal, global-reactivation denial/approval, Segment reconciliation, dashboard-Broadcast validation, validation expiry/mismatch, Broadcast audit, incident lockout, and webhook retry/deduplication without touching the Production Resend team.

Only if a wholly separate Preview Resend team is provisioned, the following additional live-provider checks are required:

- a controlled isolated test inbox receives the bilingual confirmation message from the non-production subdomain;
- the isolated Contact joins only that team's Preview Segment and explicit default-opt-out Topic opt-in;
- a dashboard test Broadcast passes validation and includes Topic-scoped unsubscribe behavior, but is sent only to isolated authorized test recipients; and
- live webhook retries and duplicate delivery reconcile idempotently inside that Preview team.

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
- Resend Contact/Segment membership and explicit Topic opt-in;
- Segment reconciliation removes every provider member not backed by an active confirmed Supabase subscription;
- activation-check mode rejects the wrong sender, Segment, Topic, missing unsubscribe/footer, stale readiness, or unauthorized operator and returns safe digest/readiness evidence without creating a send-valid approval, provider Broadcast mutation, or send;
- short-lived dashboard validation, immediate-send policy, scheduled-send incidenting, content-digest mismatch, validation expiry, audit detection, and incident lockout have passed controlled provider-fake acceptance and, when provisioned, the wholly separate Preview Resend team;
- production activation performs no production-Segment Broadcast send; the first real send requires a separate authorized staff action after activation;
- one Resend dashboard test delivery to authorized staff inboxes only;
- unsubscribe reconciliation; and
- no unrelated SMS, AI, survey, or editor send capability became active.

## Deployment Sequence

1. Record the currently promoted Vercel deployment for rollback.
2. Remove the Production Resend key from Preview and hard-disable Preview provider calls unless a separate Resend team is explicitly provisioned.
3. Implement and test the additive atomic newsletter-ingestion and database contract in isolation.
4. Implement confirmation keyring/tokens, fragment exchange/session routes, templates, provider sagas, durable jobs, webhook reconciliation, Segment reconciliation, and protected Broadcast validation/audit test-first.
5. Add a reviewed privacy notice and update the managed newsletter-page copy.
6. Create the Production District Newsletter Segment and public default-opt-out Topic.
7. Create purpose-specific Production Resend keys, deploy them, verify their permissions, then revoke the temporary key.
8. Deploy and complete isolated Preview acceptance with provider calls disabled or with a wholly separate Preview Resend team.
9. Deploy the verified revision to production with `NEWSLETTER_EMAIL_ENABLED=false`.
10. Register the production Resend webhook for the approved events and enter `RESEND_WEBHOOK_SECRET` directly in Vercel.
11. Set the production Segment/Topic identifiers, confirmation keyring, active key identifier, and canonical site URL.
12. Run the non-mutating database/provider readiness and empty-Segment reconciliation checks.
13. Enable `NEWSLETTER_EMAIL_ENABLED`, create a fresh deployment, and perform the single authorized authentic signup.
14. Verify confirmation, Contact/Topic/Segment membership, atomic webhook processing, withdrawal behavior, editor visibility, and public fallback.
15. Compose a dashboard Broadcast in Resend and use Resend's test-delivery control to send only to authorized staff inboxes. Exercise `activation-check`; verify its contract and readiness result without creating a send-valid approval, provider Broadcast mutation, or production-Segment send.
16. Record release evidence and the rollback/disable path.

## Rollback and Disablement

- Immediate provider disable: set `NEWSLETTER_EMAIL_ENABLED=false` and redeploy. The public page returns to the truthful unavailable fallback; no new jobs are created.
- Provider incident: pause Broadcasts in Resend, disable the feature flag, and allow no job to claim work while records remain intact.
- Web regression: promote the recorded prior Vercel deployment.
- Database migrations remain additive. Do not drop tables or delete subscriber/consent history as a rollback mechanism.
- Existing active subscribers and withdrawal/suppression state are preserved through rollback.
- Rotating either purpose-specific Resend key, `RESEND_WEBHOOK_SECRET`, or the confirmation keyring follows a recorded secret-rotation procedure. Old confirmation keys remain verification-only until their final 48-hour token window expires, then are removed.

## Expected Repository Changes

Implementation is expected to add or modify focused files in these areas:

- the managed newsletter route orchestration;
- `app/newsletter/confirm/page.tsx`;
- `app/api/newsletter/confirmation-session/route.ts`;
- `app/api/newsletter/confirm/route.ts`;
- `app/api/newsletter/jobs/run/route.ts`;
- a protected Staff Portal newsletter Broadcast validation control and server route;
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
- the application never adds an address to the Resend production Segment before explicit confirmation, and every successful validation proves the Segment contained no ineligible member at that validation boundary;
- confirmation link fragments are absent from request URLs/logs, session exchange is read-only, and confirmation POST is single-use;
- confirmed contacts synchronize through a resumable saga into the District Newsletter Segment and explicit default-opt-out Topic opt-in;
- Segment reconciliation removes every member without active confirmed Supabase eligibility;
- staff can compose, test, and immediately send a dashboard Broadcast in Resend without an editor send control, while the Staff Portal validates the exact Broadcast and audience no more than ten minutes before the intended send;
- the product and runbook explicitly state that validation is point-in-time and that unauthorized or post-validation sends are detected, not technically prevented;
- every marketing Broadcast includes unsubscribe and office-contact information;
- unsubscribe, bounce, complaint, failure, and suppression events are verified and reconciled safely;
- provider failure produces retryable state and truthful UI rather than simulated success;
- Production provider calls are absent from Preview; any live Preview provider testing uses a wholly separate Resend team, domain, keys, webhook, Segment, Topic, Contacts, and origin;
- no synthetic or placeholder production subscriber exists;
- SMS, AI, survey, and generic provider actions remain truthfully unavailable;
- automated, database, build, platform, desktop, mobile, direct-route, console, and network checks pass; and
- rollback and feature-disable evidence is recorded without destructive database changes.

## Provider References

- [Resend audience hygiene and double opt-in](https://resend.com/docs/knowledge-base/audience-hygiene)
- [Resend Contacts](https://resend.com/docs/dashboard/audiences/contacts)
- [Resend Broadcasts](https://resend.com/docs/dashboard/broadcasts/introduction)
- [Resend retrieve Broadcast API](https://resend.com/docs/api-reference/broadcasts/get-broadcast)
- [Resend create Broadcast API](https://resend.com/docs/api-reference/broadcasts/create-broadcast)
- [Resend update Broadcast API](https://resend.com/docs/api-reference/broadcasts/update-broadcast)
- [Resend send Broadcast API and API-created restriction](https://resend.com/docs/api-reference/broadcasts/send-broadcast)
- [Resend Segments](https://resend.com/docs/dashboard/segments/introduction)
- [Resend Topics](https://resend.com/docs/dashboard/topics/introduction)
- [Resend unsubscribe management](https://resend.com/docs/dashboard/audiences/managing-unsubscribe-list)
- [Resend email idempotency limits](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend webhook signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Resend webhook event types](https://resend.com/docs/webhooks/event-types)
- [Resend suppression-added events](https://resend.com/docs/webhooks/suppressions/added)
- [Resend suppression-removed events](https://resend.com/docs/webhooks/suppressions/removed)
