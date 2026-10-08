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

Provider message IDs are retained in the delivery ledger. Before enabling sends,
extend the strict provider inventory and webhook classification to recognize only
these ledger-backed staff notices for this site, recipient and policy version.
Unrelated transactional messages remain blocked. Do not bypass or disable the
newsletter production readiness gate. Store no provider credentials in the
ledger or browser.

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
