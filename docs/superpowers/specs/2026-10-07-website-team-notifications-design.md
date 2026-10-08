# Website team notifications

## Approved user-facing behavior

The team inbox is `aswcmoralesteam@gmail.com`. The user selected brief notices
with a secure Staff Portal link; residents' submitted details do not go in email.
Sign-in links, newsletter confirmations and unsubscribe messages continue to go
to the requesting person. This does not change staff access or newsletter consent.

## Scope and boundaries

Deliver a notice for each new accepted onsite Contact or Newsletter form
submission after activation. Do not replay historic/test submissions. Reject
Survey requests as the current ingestion service already does. Existing portal
Submissions, Customers, Leads and in-app notification records remain unchanged.

Persist a service-only activation record with a cutoff timestamp and policy
epoch. Eligibility requires a queue event and accepted submission created on or
after that cutoff. A disable/re-enable cycle retains the original cutoff and
epoch; it must not reset eligibility or replay already recorded events. Exclude
any service-created submission marked as a test in trusted metadata. Browser
clients cannot set this classification or move the activation cutoff backwards.

The email contains only a fixed subject, a generic notice, and the canonical
`/admin/editor?workspace=website.submissions` link. No name, email address, message,
form answer, authentication token or submission identifier is included. Opening
the link requires the recipient's normal authorized staff login.

Vercel/Supabase account, billing, security and deployment notices are provider
account settings, not application mail. They require separate dashboard settings
and must not transfer account ownership or security recovery to the team inbox.

## Delivery architecture

Use the existing accepted-submission notification queue as the event source.
Add a site-scoped, service-only email delivery ledger without changing the
existing in-app projection state. A versioned service-only claim RPC joins the
queue to the submission metadata, not its payload, and claims bounded jobs with
an expiring lease and fencing token. A finish RPC rejects stale workers.

A server-only worker uses the verified updates-domain sender and the existing
domain-scoped Resend send credential. The recipient and generic content are
fixed and versioned. A persistent idempotency key identifies each queue event.
Retries use that same key and identical content; ambiguous delivery after the
provider's idempotency retention window stops for operator review instead of
potentially sending a duplicate. API failures use bounded backoff and safe codes.

Freeze the sender, recipient, subject, body, policy version, provider scope,
idempotency key and opaque correlation tag in the ledger before the first
possible send. Persist `first_attempt_at` before making the provider request;
the retry deadline is measured from this timestamp, never from a later retry.
Use a conservative deadline shorter than Resend's documented 24-hour retention.
Configuration changes affect only new jobs, not retry payloads.

Provider message IDs are retained in the delivery ledger. Before enabling sends,
extend the strict provider inventory and webhook classification to recognize only
these ledger-backed staff notices for this site, recipient and policy version.
Unrelated transactional messages remain blocked. Do not bypass or disable the
newsletter production readiness gate. Store no provider credentials in the
ledger or browser.

Each notice carries an unpredictable, persisted per-job correlation tag plus
the fixed staff-notice purpose and policy tags. Resend documents that email tags
are included in signed webhook events. Extend the verified webhook path before
ordinary newsletter classification: bind an otherwise unknown provider email ID
only when the verified event's correlation tag matches an issued ledger job,
its exact sender/single recipient/subject and provider scope match the frozen
policy, no broadcast ID is present, and the email's `data.created_at` agrees
with the recorded send attempt within bounded clock/request latency. Do not
compare a later delivery-event timestamp to send time. Provider scope comes
from the verified webhook endpoint's configured account boundary, not an
unverified or nonexistent payload account field. Never recognize notices from generic subject,
recipient, sender or purpose tags alone.

Use a service-only, idempotent binding RPC with uniqueness on provider email ID
and job correlation. It may record a valid signed receipt before the send worker
finishes or after that worker loses its lease. Stale workers cannot change lease
state or overwrite the binding. A second conflicting message ID is retained for
operator review, not silently allowed. The original newsletter classifier sees
unrecognized or mismatched messages exactly as before.

If a provider accepted the request but the process crashed before recording its
ID, retry the identical idempotent request only before the fixed retry deadline;
this recovers the original ID. A matching signed webhook can independently
recover it. Inventory encountering an unresolved ID remains blocked/retryable
until one of these evidence paths succeeds; it never invents history evidence.
After the deadline, do not resend automatically. Owner review can investigate
the retained ledger and verified receipts. Exclude proven notices from Auth SMTP
login accounting as well as allowing them in the strict transactional inventory.

Track provider acceptance separately from `email.delivered`, `email.failed`,
`email.bounced` and suppression receipts. “Delivered” means recipient mail server
acceptance, not a guarantee that Gmail placed it in the Inbox rather than Spam.
Duplicate and out-of-order receipts must not downgrade a delivered, bounced,
failed or suppressed outcome when an older `email.sent` event arrives later.
Owner recovery is a narrow, recorded investigation action, not a general resend
console or editable recipient/policy interface.

The existing authenticated cron infrastructure runs the worker in a separate
bounded route, serialized and below the provider send rate. The private ledger
has no anonymous or staff browser access. Owner-facing status reports pending,
sent, failed and review-required counts without exposing form answers.

## Activation and verification

Write regression tests before implementation. Use an isolated PGlite database
for lease contention, replay, stale completion, recipient immutability,
cross-site rejection and grants. Mock provider failures, duplicate retries,
expired idempotency windows and safe notice content. Test unauthorized cron
requests, provider inventory exclusion and webhook classification.
Also test activation cutoff persistence, test exclusion, webhook-before-worker
completion, accepted-send/process-crash recovery, expired-window no-resend,
forged or mismatched tags, conflicting IDs and staff Auth SMTP exclusion.

Apply the additive migration only after these tests pass. Activate future-event
delivery only when production configuration and ledger-backed provider readiness
pass. Stage a production build, verify existing newsletter and editor flows, then
promote the exact tested artifact. Do not send an unsolicited real test email;
an explicitly authorized staff test or the next authentic submission provides
end-to-end delivery evidence. An accepted Resend request is not inbox delivery.

## Recovery

Disabling staff notices stops new claims, not resident newsletter confirmations.
Keep the additive ledger and known message IDs for audit/inventory. Failed or
ambiguous jobs remain recoverable under an owner-reviewed action; they are never
silently marked delivered.

## Provider contract references

- [Resend email tags](https://resend.com/docs/dashboard/emails/tags)
- [Resend idempotency retention](https://resend.com/changelog/idempotency-keys)
- [Resend delivery event semantics](https://resend.com/docs/webhooks/event-types)
