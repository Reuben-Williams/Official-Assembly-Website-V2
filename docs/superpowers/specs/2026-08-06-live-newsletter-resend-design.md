# Live Newsletter and Resend Integration Design

**Status:** Revised design approved and independently reviewed; awaiting user review before implementation planning

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
5. retrieves the Contact's Topic subscriptions before any Topic mutation; if the District Newsletter Topic is already `opt_out` for an active record, it records provider withdrawal and stops rather than re-opting the Contact;
6. sets the District Newsletter Topic to `opt_in` only for a newly confirmed generation backed by active consent and newer than every recorded withdrawal;
7. ensures membership in the configured District Newsletter Segment;
8. re-reads Contact, Topic, and Segment state after any ambiguous response;
9. records the verified Resend Contact identifier and synchronization time; and
10. marks the job complete and the subscription active only after the provider state is verified.

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

Site-scoped provider-maintenance jobs require one site, forbid a subscription or Broadcast validation, and support:

- `newsletter.segment.reconcile`
- `newsletter.contact.audit`

Provider Broadcast audit jobs require one site and configured Resend team scope, forbid a subscription, and support:

- `newsletter.broadcast.audit`

Jobs contain identifiers and safe operational metadata only. They do not duplicate message bodies, raw confirmation tokens, API keys, or full contact records. Subscription jobs may carry confirmation generation/ordinal fields. Site-maintenance and provider-audit jobs carry only their site/provider scope and durable cursor or saga state. Foreign keys, kind allowlists, and database check constraints enforce the three mutually exclusive subject shapes.

The database tracks queued, leased, completed, retryable-failed, and terminal-failed states; attempt count; next-attempt time; lease owner; lease expiry; provider message/contact identifier; and a bounded non-sensitive failure code.

The scheduled worker is a Node.js Vercel route protected by `CRON_SECRET`. It claims a bounded batch, applies exponential backoff with jitter, and stops retrying terminal policy failures. Immediate post-submission processing and scheduled processing use the same lease/fencing primitives but dispatch to their typed handlers. When `NEWSLETTER_EMAIL_ENABLED=false`, outbound confirmation/Contact mutation, mutating Segment reconciliation, and production validation handlers fail closed, but verified webhook processing, `newsletter.contact.audit`, and read-only Broadcast audits continue so disablement cannot erase withdrawal or incident evidence.

Contact synchronization jobs persist saga phases such as `lookup`, `contact_ensured`, `topic_ensured`, `segment_ensured`, and `verified`. Topic withdrawal removes Segment membership and sets the District Newsletter Topic to `opt_out`. Global withdrawal performs those steps and preserves provider `unsubscribed: true`. The stored withdrawal origin is never collapsed or cleared by ordinary retry.

Only an authorized `newsletter.contact.reactivate_global` job may clear provider-global unsubscribe. It requires a newer confirmed generation, newer approved consent than the withdrawal, no complaint/bounce/suppression, an operator reason, and a provider read both before and after mutation. Complaint recovery is unsupported in this release. Hard-bounce or suppression recovery requires a separately documented provider remediation and fresh consent and cannot reuse the global-withdrawal job.

Approved deletion removes Segment membership, opts out the Topic, and deletes the provider Contact only when the operator has verified that the Contact has no other approved use in the dedicated team. Otherwise it retains the provider suppression/withdrawal marker while removing site-specific membership and properties.

Resend's `contact.updated` webhook does not include Topic subscriptions. For every verified `contact.updated` event mapped to this site, the server retrieves the Contact, its Segment memberships, and `GET /contacts/:contact_id/topics` before opening the receipt/mutation transaction. Retrieval failure returns a retryable response and inserts no receipt. An observed District Newsletter `opt_out` moves an otherwise active record to `withdrawn_topic`, removes Segment eligibility, and can never be reversed by ordinary sync. A later provider-side `opt_in` does not reactivate a locally withdrawn record without a newer fresh-consent generation.

The hourly `newsletter.contact.audit` job is provider-read-only and remains enabled during feature disablement. It walks every locally known provider Contact, retrieves Contact, Segment, and Topic state, and atomically records local withdrawal, global-unsubscribe, suppression, provider-removal, or drift evidence. It never creates/updates a provider Contact, changes Topic state, or changes Segment membership. When provider state requires a provider-side removal, it records the local record as non-eligible and leaves the outbound mutation queued but unclaimed until the feature is deliberately re-enabled; provider-native unsubscribe/suppression continues to protect delivery in the meantime. Cursor checkpoints resume the local Contact walk without treating an incomplete pass as successful.

The reconciliation job runs at least hourly and immediately before every production Broadcast validation. It walks both sides: every Contact in the production Segment and every locally active/confirmed subscription with a provider Contact identifier. For each, it retrieves global unsubscribe, Segment membership, and Topic subscriptions. It removes unconfirmed, topic-withdrawn, globally withdrawn, expired, bounced, complained, suppressed, unknown, or other-site Contacts; transitions a local active record to `withdrawn_topic` when provider Topic state is `opt_out`; and verifies that every retained Contact is explicitly `opt_in` to the District Newsletter Topic. It never opts an ineligible or previously withdrawn Contact in merely because the Contact exists in Resend. A full successful walk records a signed, expiring readiness revision; any unreadable Contact/Topic state fails readiness closed and prevents Broadcast validation.

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
- run the protected `staff-test` operation to open the configured staff-test window;
- send a test only to an allowlisted staff inbox and wait for the audit to confirm the Broadcast remained an unscheduled draft;
- review desktop and mobile rendering, links, alt text, and plain-text output; and
- provide the dashboard Broadcast identifier to the protected Staff Portal validation control; and
- click **Send** in Resend within ten minutes after validation, without scheduling or changing the Broadcast.

The protected validation control is available only to an authorized site owner/operator. It creates or replays a durable Broadcast validation record keyed by the operator command identifier. Validation:

1. refuses validation while any unresolved critical Broadcast incident exists for the site/provider team;
2. retrieves the dashboard Broadcast and requires `draft` status with no provider schedule;
3. verifies the fixed sender, production Segment, opt-out-by-default Topic, unsubscribe placeholder/footer, office-contact content, and approved Reply-To state;
4. runs fresh Segment reconciliation and requires every provider member to map to an active, confirmed, non-withdrawn, non-suppressed Supabase subscription;
5. canonicalizes the Broadcast fields and calculates a SHA-256 digest over sender, subject, preview text, HTML, text, Segment, Topic, and approved Reply-To state;
6. requires a `confirmed-test` observation for the same Broadcast identifier and exact digest within the preceding 24 hours; and
7. records the operator, Broadcast identifier, confirmed-test observation, digest, readiness revision, audience count, validation time, and ten-minute expiry without retaining another message-body copy or creating any provider mutation.

The production validation operation is itself non-dispatching. It may retrieve provider state and perform the Contact/Topic/Segment reconciliation already authorized by the subscription system, but it cannot create, update, schedule, copy, or send a Broadcast and cannot accept or derive a staff-recipient override. Deployment readiness uses the same validator in `activation-check` mode, which performs all non-dispatching content/configuration/readiness checks but intentionally omits the confirmed-test prerequisite because it creates neither a send-valid approval nor a staff-test window.

The separate `staff-test` operation may open a ten-minute **staff-test window** for the exact draft identifier and digest. The recipient set comes only from the preconfigured production staff-test allowlist; the operator cannot supply or expand it. A verified email event is provisionally classified as a test only when the recipient matches that allowlist, the provider Broadcast remains `draft`, and both `scheduled_at` and `sent_at` remain null. A test observation never becomes, consumes, or by itself authorizes a production validation. After a fifteen-minute quiet period, the audit re-retrieves the Broadcast: if it is still an unscheduled draft, the test classification becomes `confirmed-test` and may be referenced only as the mandatory QA prerequisite of a later same-ID/same-digest production validation; if it became scheduled, queued, or sent, the event is reclassified through the production-send rules and incidents when no matching production validation exists. A non-allowlisted recipient can never enter the test path.

A validation is single-use for one Broadcast identifier and exact digest. A newer validation supersedes an unused older validation for the same Broadcast. Validation of a Broadcast already observed as scheduled, queued, or sent is forbidden. After ten minutes, the approval is expired and staff must revalidate the unchanged draft. Any edit changes the digest and requires a new validation. The first release does not support scheduled sends; a scheduled provider status always invalidates the approval and creates an incident.

Staff sends from Resend immediately after a successful validation. The application cannot repeat the send, cancel it, or guarantee that audience eligibility and content remained unchanged between validation and the dashboard click. This residual risk is explicit. Resend's Topic/global-unsubscribe and suppression controls remain authoritative at delivery time, while post-send reconciliation detects drift or bypass.

Webhook processing and the scheduled `newsletter.broadcast.audit` job retrieve the observed Broadcast, recompute the canonical digest, and compare the provider identifier, sender, Segment, Topic, schedule state, and digest with the most recent unconsumed validation. `sent_at` from the retrieved Broadcast is the only timestamp that can authorize a final send. The half-open validity rule is `validated_at <= sent_at < valid_until`, using UTC instants and a database-generated `valid_until`; this rejects a validation created after the provider send and treats a send exactly at expiry as expired. `email.sent.created_at` and local observation time are operational evidence only and never authorize a send.

A `queued` Broadcast whose `sent_at` is still null is recorded as `provider-timing-pending`; it neither consumes the validation nor creates a matching disposition. The worker re-retrieves it with bounded backoff. When `sent_at` appears, the exact rule above applies. If the provider remains queued without `sent_at` for 24 hours, or provider timestamps contradict one another, the Broadcast becomes an incident rather than being assumed valid. Later recipient events reuse the final recorded disposition rather than comparing their delivery timestamps with the original window.

The first matching `sent` observation atomically consumes the validation and records the provider status and `sent_at`. An unvalidated, expired, scheduled, content-modified, wrong-audience, wrong-Topic, or wrong-sender Broadcast atomically upserts a critical incident keyed by `(site_id, provider_broadcast_id)`. A critical incident blocks all later production validations until the containment and resolution contract below is complete. Incident lockout does not claim to recall email already accepted by Resend.

Broadcast validation records have valid, superseded, expired, provider-timing-pending, consumed-matching, and incident states. Staff-test windows and observations remain separate records: they cannot become, consume, or authorize production validations, although a `confirmed-test` observation is the required same-ID/same-digest QA prerequisite referenced by a later production validation. Validation is an operational approval artifact, not final dispatch authority. The audit worker tracks its own attempts, cursor, lease/fencing data, and safe provider-observed status without sharing subscription-only columns.

Resend team access is limited to the smallest practical set of designated staff. Production Contacts, Segment membership, and Topic state are not operated manually. Final send authority necessarily remains with the staff members permitted to use the Resend dashboard. Because Resend's Member/Admin roles are coarse, the runbook, short validation window, audit, and incident lockout are required; a dashboard send that bypasses validation is an unauthorized operational event that the application detects rather than prevents.

Before activation, the audit performs a full paginated inventory with `limit=100`, following `after` until `has_more=false`. Readiness fails if any Broadcast is scheduled, queued, or sent; the dedicated Production team has no historical-send exception in this release. Existing drafts, including the staff-test draft, are recorded as baseline drafts and remain watched.

After activation, every audit run starts at the newest page and paginates the complete dedicated-team inventory. Its `after` cursor is an in-progress checkpoint only: it advances after each page transaction commits, resumes after retry, and is cleared only when `has_more=false`. The next run restarts from the newest page, so status changes to an old draft cannot hide behind a creation-time high-water mark. Items are reprocessed idempotently. New items created ahead of an in-progress cursor are picked up when the next complete run restarts; webhooks provide the real-time path. A run is not marked successful unless every page was processed, all provisional staff tests due for recheck were classified, and every current validation/pending timing record was re-retrieved.

The audit maps every scheduled/queued/sent provider Broadcast to its test observation, production validation, or incident. Unvalidated, expired, scheduled, duplicate, or content-conflicting sends atomically upsert a critical incident keyed by `(site_id, provider_broadcast_id)` and trigger the containment contract. The audit is detection, not permission to send; staff retains final dashboard authority.

### Broadcast incident containment and recovery

The designated Resend team owner/admin is the incident responder. On a critical incident, the runbook requires all of the following:

1. set `NEWSLETTER_EMAIL_ENABLED=false`, deploy the disabled configuration, and record that this stops new application-side newsletter work but does not stop dashboard sends;
2. in Resend, bulk-cancel every scheduled Broadcast and re-retrieve each one until it is back in `draft` status;
3. remove every non-responder member from the dedicated Resend team; if the current provider UI does not permit an admin removal, each member must use **Leave Team**, and the incident remains uncontained until the member list proves only the designated responder set retains access;
4. rotate the management and transactional sending API keys after access is restricted, record only their provider identifiers, and deploy the replacements without exposing values;
5. complete a fresh full Broadcast inventory from the newest page through `has_more=false`, covering every Broadcast created or changed since 24 hours before first detection, and reconcile all affected recipients and provider events; and
6. record the member-list evidence, cancelled Broadcast identifiers/statuses, audit completion, operator identities, containment time, and a bounded resolution reason.

An incident may move to `contained` only after steps 1–5 succeed. Closing it and re-enabling validation requires two authorized operators, no scheduled or queued Broadcast, all unauthorized sends classified, a clean full audit, verified Segment/Topic readiness, replacement keys deployed, and an explicit re-enable record. If team access cannot be restricted, the incident remains open and production validation stays locked. Already queued or sent messages cannot be recalled and are reported as such.

The site does not author, copy, schedule, or send Broadcast content. The private editor provides only the protected validation result, its expiry, safe audience-readiness evidence, incident status, and a link back to Resend. A later editor campaign composer or site-owned send control requires its own platform release and design review.

## Unsubscribe and Provider Event Reconciliation

The webhook route reads the raw request body and verifies the Resend/Svix signature using `svix-id`, `svix-timestamp`, `svix-signature`, and `RESEND_WEBHOOK_SECRET` before parsing or mutating data.

Webhook delivery is treated as at least once and not ordered. After signature verification and bounded normalization, the server may reuse a Broadcast-wide matching-send/incident disposition or a `confirmed-test` disposition only when it belongs to the exact same provider message identifier. A test disposition is message-scoped and never short-circuits provider retrieval for a new message/event. When no safe reusable disposition exists, the server retrieves the bounded Broadcast fields from Resend before opening the database transaction; retrieval failure returns a retryable response and does not insert the webhook receipt. For a `contact.updated` event, the same pre-transaction phase also retrieves current Contact, Segment, and Topic state because the webhook payload does not contain Topic subscriptions.

One database RPC then atomically inserts the unique `svix-id` receipt, maps the configured provider team/site scope, and classifies the Broadcast as provisional staff test, matching production send, pending provider timing, or incident **before and independently of recipient-to-subscription mapping**. The test branch requires the preconfigured allowlist fingerprint, current test window, exact draft digest, `draft` status, and null `scheduled_at`/`sent_at`; it cannot consume a production validation. The production branch uses the exact validation and `sent_at` rules above. Every other send creates/replays the critical incident keyed by `(site_id, provider_broadcast_id)`, even when the recipient is unknown or belongs to no local subscription. The transaction then applies any valid monotonic subscription/job/Broadcast-observation transition and marks the receipt processed with its disposition. If any step fails, the entire transaction rolls back, allowing Resend's retry to apply the event. Concurrent webhook and audit classifications converge through the same row locks and unique constraints. A repeated processed identifier returns the recorded disposition without repeating mutations, while a different event for the same unauthorized Broadcast increments the same incident rather than creating another. No state exists in which a receipt is permanently deduplicated while its transition or required incident is missing.

State transitions compare provider time and severity so a late delivered event cannot overwrite a later bounce, complaint, suppression, or unsubscribe. Distinct event identifiers that arrive out of order are still evaluated rather than discarded merely because an event was previously processed.

Recipient subscription transitions are applied only when the provider Contact or recipient maps to this site's subscription. Unknown or other-site recipients are recorded as ignored without exposing their payload to staff, but that recipient disposition never suppresses independent test/send classification or its incident upsert.

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
- kind: `segment_reconcile` or `contact_audit`;
- saga phase or reconciliation cursor;
- state, attempts, next-attempt time, terminal flag, and lease/fencing data;
- bounded safe result/failure code; and
- created, updated, and completed times.

This shape forbids subscription and Broadcast validation identifiers and all confirmation-delivery fields.

### Site/team-scoped Broadcast audit job record

- job identifier;
- required site and provider-team scope identifiers;
- kind: `broadcast_audit`;
- activation cutoff and baseline-completed time;
- sweep start time, in-progress `after` cursor, page count, and last fully completed sweep time;
- due time and staff-test/provider-timing recheck deadlines;
- state, attempts, next-attempt time, terminal flag, and lease/fencing data;
- bounded safe result/failure code; and
- created, updated, and completed times.

Audit jobs deliberately have no Broadcast validation foreign key because their purpose is to discover every provider Broadcast, including one without a validation. Database foreign keys and check constraints enforce all three job subject shapes.

### Webhook receipt

- site identifier;
- unique `svix-id` and atomic processing state;
- provider event type and provider-created time;
- mapped subscription and provider message/contact identifiers when known;
- provider Broadcast identifier and mapped validation or staff-test observation identifier when present;
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
- safe provider status, `scheduled_at`/`sent_at`, and digest evidence;
- open, acknowledged, contained, or resolved state;
- first-seen, last-seen, and occurrence-count fields; and
- containment evidence, two authorized resolving operators, resolution reason, and resolution time when closed.

The verified webhook RPC and audit worker use the same atomic upsert keyed by `(site_id, provider_broadcast_id)`. A new event increments or enriches the existing incident without erasing its first-seen evidence. Incident creation does not depend on a recipient or subscription mapping.

### Broadcast validation record

- immutable validation and operator-command identifiers;
- authorized operator and validation time;
- required dashboard Broadcast identifier;
- required confirmed-test observation identifier and canonical content digest;
- Segment, Topic, sender, and approved Reply-To snapshot;
- readiness revision, audience count, and readiness expiry;
- fixed ten-minute `valid_until` time;
- valid, superseded, expired, provider-timing-pending, consumed-matching, or incident state;
- first provider scheduled/queued/sent observation, provider `sent_at`, and safe provider status;
- consuming webhook receipt or audit cursor when applicable;
- safe result/failure code; and
- created, updated, superseded, expired, consumed, and incident times when applicable.

The database stores the digest and provider identifiers, not another copy of the Broadcast HTML or text. At most one unconsumed validation may be current for a site/Broadcast. A scheduled state incidents immediately; queued-without-`sent_at` stays pending; the first exact `sent_at` classification consumes or incidents the validation atomically. The provider remains the only Broadcast content store.

### Staff-test window and observation record

- immutable window/observation identifiers and authorized operator;
- required site and dashboard Broadcast identifier;
- canonical draft digest and staff-test command identifier;
- opened time and fixed ten-minute expiry;
- configured allowlist revision, recipient keyed fingerprint, and provider message identifier;
- provisional-test, confirmed-test, reclassified-production, expired, or incident state;
- provider draft/status evidence and fifteen-minute recheck time; and
- consuming webhook receipt, audit cursor, and safe result code when applicable.

The keyed recipient fingerprint is computed server-side from the configured staff-test allowlist and is never accepted from the operator. The record stores no full recipient address or message body. A staff-test observation cannot be converted into or authorize a production validation. A `confirmed-test` record may be referenced by foreign key only as the later validation's mandatory QA prerequisite; if the provider Broadcast leaves unscheduled `draft` state, the observation is reclassified through the production rules and ceases to qualify.

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
- `NEWSLETTER_TEST_RECIPIENTS` — Sensitive canonical JSON allowlist of authorized real staff test inboxes; it is read only for server-side test-event classification and is never returned, logged, or copied into the database.
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

The protected Staff Portal newsletter-operations surface accepts a Resend Broadcast identifier and provides **Open staff test window**, **Validate newsletter**, and **Open Resend** actions. The test action uses only the configured allowlist; it does not expose or accept recipient addresses. A successful production validation shows the Broadcast identifier, audience count, readiness revision, content digest abbreviation, validation time, ten-minute expiry, and an explicit instruction to send immediately without editing or scheduling. It never displays the full Broadcast body or recipient addresses. Failed validation shows a bounded reason and produces no approval.

The operational header changes from **Providers unavailable** to a narrower truthful statement: newsletter email is configured through Resend; SMS and AI remain unavailable; Broadcast composition and final sending occur in Resend rather than the editor. If a critical Broadcast incident is open, the newsletter-operations surface shows validation locked, the containment status, and the authorized review path without exposing provider payloads.

## Error Handling

- Invalid, expired, stale-generation, or malformed tokens do not mutate state.
- A newsletter receipt, customer/consent mutation, pending subscription, and initial confirmation job commit in one RPC transaction. Failure in any step rolls back all newsletter mutations, returns the existing truthful unavailable response, and leaves no stranded accepted receipt.
- A Resend outage leaves confirmation or contact-sync jobs retryable.
- An email-send outcome that remains ambiguous beyond Resend's 24-hour idempotency window becomes terminal and requires an authorized new confirmation generation; it is never blindly resent.
- A Broadcast retrieval or Segment-reconciliation timeout fails validation without producing an approval.
- A Broadcast sent after validation expiry, changed after validation, or scheduled in the first release creates an incident; the application does not claim it prevented or recalled that send.
- A provider event that cannot yet be classified remains retryable and does not permanently deduplicate before its validation/incident disposition is committed.
- A Contact/Topic/Segment read failure during `contact.updated` or reconciliation returns retryable/fails readiness and never assumes the Contact remains eligible.
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
- Staff-test recipient comparison uses the server-only configured allowlist and stores only a site-keyed fingerprint in test-observation records.
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
- `contact.updated` Topic read-through, retry without receipt on read failure, feature-disabled hourly `newsletter.contact.audit`, and denial of ordinary re-opt-in after provider Topic withdrawal;
- production validation enforces operator and content/readiness policy while creating no provider Broadcast mutation or send;
- activation-check mode cannot create either a send-valid approval or a staff-test window;
- the staff-test operation can open only the configured-allowlist test window and cannot create a production validation;
- staff-test events require an exact allowlist fingerprint and unscheduled draft state, remain provisional for fifteen minutes, never consume production validation, reclassify/incident if the Broadcast leaves draft state, reuse test disposition only for the same provider message identifier, and never short-circuit retrieval for a new message;
- production validation requires a confirmed test for the same Broadcast and exact digest within 24 hours, then binds that digest to a ten-minute window with supersession and single consumption;
- half-open `validated_at <= sent_at < valid_until` enforcement using provider `sent_at` only, post-send validation rejection, queued-without-`sent_at` pending/retry, timing contradiction, post-validation content changes, expired approvals, duplicate observations, and scheduled-send rejection;
- raw-body webhook signature verification, atomic receipt-plus-mutation, crash rollback, duplicate `svix-id`, and reordered distinct event IDs;
- webhook `broadcast_id` mapping accepts an exact current dashboard validation and atomically incidents unvalidated, expired, scheduled, duplicate, or mismatched Broadcasts before recipient mapping;
- different recipient webhooks and a scheduled audit for the same unauthorized provider Broadcast upsert one incident, preserve first-seen evidence, and increment the occurrence count;
- activation baseline rejects every queued, scheduled, or sent Broadcast without exception, while complete newest-first paginated audit sweeps resume safely, restart from newest after completion, and detect status changes to old drafts;
- critical incident lockout, schedule cancellation verification, provider-member restriction, key rotation, two-operator resolution, and refusal to re-enable when access cannot be contained;
- unconfigured provider-team/site events are rejected without mutation, while unknown recipients still perform independent test/send classification and incident an unauthorized `broadcast_id` before their recipient transition is ignored;
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
- enforced subscription, `segment_reconcile`/`contact_audit` site-maintenance, and site/team Broadcast-audit job shapes, plus their leases, validation digest binding, duplicate command replay, and provider-state reconciliation;
- staff-test window/observation isolation from production validations, keyed allowlist fingerprints, provider-message-scoped disposition reuse, provisional reclassification, and retention without full recipient addresses;
- production validation foreign-key binding to a confirmed test with the same Broadcast/digest inside the 24-hour test-validity window;
- validation half-open expiry, provider-timing-pending transitions, single consumption, and post-send validation denial;
- audit baseline, per-page cursor checkpoint, incomplete-sweep resume, next-run newest restart, and idempotent full-inventory reprocessing;
- atomic webhook receipt/mutation, rollback/retry after injected crash, deduplication, and monotonic state precedence;
- unique consumed provider-Broadcast validation mapping and one replay-safe unauthorized-Broadcast incident per provider identifier across webhook and audit races, including events for unknown recipients;
- incident containment evidence and distinct two-operator resolution/re-enable authorization;
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
- with provider calls hard-disabled, controlled provider fakes prove confirmation delivery, Contact/Topic/Segment sagas, Topic read-through and missed-event reconciliation, topic/global withdrawal, global-reactivation denial/approval, Segment reconciliation, staff-test classification/reclassification, dashboard-Broadcast validation, provider-`sent_at` expiry/mismatch, full-inventory Broadcast audit, incident containment/lockout, and webhook retry/deduplication without touching the Production Resend team.

Only if a wholly separate Preview Resend team is provisioned, the following additional live-provider checks are required:

- a controlled isolated test inbox receives the bilingual confirmation message from the non-production subdomain;
- the isolated Contact joins only that team's Preview Segment and explicit default-opt-out Topic opt-in;
- the separate staff-test window permits only configured isolated test recipients, the dashboard test leaves the Broadcast in unscheduled draft state, the fifteen-minute recheck confirms it as test-only, and no production validation is consumed; and
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
- disabled-mode `newsletter.contact.audit` still observes and records Topic/global withdrawal without provider mutation;
- the activation Broadcast inventory contains no scheduled, queued, or sent Broadcast;
- activation-check mode rejects the wrong sender, Segment, Topic, missing unsubscribe/footer, stale readiness, or unauthorized operator and returns safe digest/readiness evidence without creating a staff-test window, send-valid approval, provider Broadcast mutation, or send;
- the separate staff-test operation rejects an unconfigured allowlist, maps only to configured staff inboxes, and leaves the Broadcast as an unscheduled draft through the fifteen-minute audit recheck; its confirmed observation may be referenced only as the same-ID/same-digest QA prerequisite and cannot itself authorize a production validation;
- short-lived dashboard validation, provider-`sent_at` timing, immediate-send policy, scheduled-send incidenting, content-digest mismatch, validation expiry, full-inventory audit detection, and incident containment/lockout have passed controlled provider-fake acceptance and, when provisioned, the wholly separate Preview Resend team;
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
12. Run the non-mutating database/provider readiness checks, empty-Segment reconciliation, and complete activation Broadcast inventory; require zero scheduled, queued, or sent Broadcasts.
13. Enable `NEWSLETTER_EMAIL_ENABLED`, create a fresh deployment, and perform the single authorized authentic signup.
14. Verify confirmation, Contact/Topic/Segment membership, atomic webhook processing, withdrawal behavior, editor visibility, and public fallback.
15. Compose a dashboard Broadcast in Resend, run `activation-check`, then run the separate `staff-test` operation to open the configured test window. Use Resend's test-delivery control only for those authorized staff inboxes and wait for the fifteen-minute audit recheck to confirm the Broadcast remained an unscheduled draft. Verify that no send-valid approval, provider Broadcast mutation, or production-Segment send occurred.
16. Record release evidence and the rollback/disable path.

## Rollback and Disablement

- Immediate provider disable: set `NEWSLETTER_EMAIL_ENABLED=false` and redeploy. The public page returns to the truthful unavailable fallback; no new signup, confirmation-send, Contact-mutation, or validation work is created. Verified webhooks and read-only Broadcast/Contact audits remain active so withdrawal, suppression, unauthorized-send, and incident evidence cannot be lost during containment.
- Provider incident: execute the complete Broadcast incident containment contract above. Feature disablement alone is not containment, and validation remains locked until provider access, schedules, keys, audit, and two-operator resolution evidence pass.
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
- `contact.updated`, hourly Contact audit, and scheduled reconciliation read actual Topic subscriptions, including while outbound work is disabled, and ordinary retry never reverses a Topic withdrawal;
- bidirectional Segment/Topic reconciliation removes every member without active confirmed Supabase eligibility and fails validation closed on unreadable provider state;
- staff can compose, test, and immediately send a dashboard Broadcast in Resend without an editor send control, while the Staff Portal requires a confirmed test of the exact Broadcast digest within 24 hours and validates that Broadcast/audience no more than ten minutes before the intended send;
- staff test delivery is allowlisted and provider-message-scoped, remains distinct from production validation, is confirmed only while the provider Broadcast stays an unscheduled draft, and never suppresses retrieval for a later provider message;
- only provider `sent_at` inside the half-open validation window can classify a production send as matching;
- the product and runbook explicitly state that validation is point-in-time and that unauthorized or post-validation sends are detected, not technically prevented;
- activation permits no scheduled, queued, or sent Broadcast, and recurring full paginated inventories detect status changes to pre-existing drafts, while any incident locks validation until schedules, provider access, keys, audit, and two-operator recovery are verified;
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
- [Resend list Broadcasts API](https://resend.com/docs/api-reference/broadcasts/list-broadcasts)
- [Resend cursor pagination](https://resend.com/docs/api-reference/pagination)
- [Resend create Broadcast API](https://resend.com/docs/api-reference/broadcasts/create-broadcast)
- [Resend update Broadcast API](https://resend.com/docs/api-reference/broadcasts/update-broadcast)
- [Resend send Broadcast API and API-created restriction](https://resend.com/docs/api-reference/broadcasts/send-broadcast)
- [Resend Segments](https://resend.com/docs/dashboard/segments/introduction)
- [Resend Topics](https://resend.com/docs/dashboard/topics/introduction)
- [Resend retrieve Contact Topics API](https://resend.com/docs/api-reference/contacts/get-contact-topics)
- [Resend contact.updated webhook fields](https://resend.com/docs/webhooks/contacts/updated)
- [Resend team access management](https://resend.com/docs/dashboard/settings/team)
- [Resend unsubscribe management](https://resend.com/docs/dashboard/audiences/managing-unsubscribe-list)
- [Resend email idempotency limits](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend webhook signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Resend webhook event types](https://resend.com/docs/webhooks/event-types)
- [Resend suppression-added events](https://resend.com/docs/webhooks/suppressions/added)
- [Resend suppression-removed events](https://resend.com/docs/webhooks/suppressions/removed)
