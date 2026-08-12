with exact_site as (
  select id
  from public.builder_sites
  where site_key = 'official-assembly-website-v2'
),
exact_owner as (
  select member.site_id, member.user_id, users.last_sign_in_at
  from public.builder_site_members member
  join auth.users users on users.id = member.user_id
  join exact_site site on site.id = member.site_id
  where member.role = 'owner'
    and users.last_sign_in_at = '2026-08-11T21:24:29.356981Z'::timestamptz
),
receipts as (
  select
    count(*) filter (
      where receipt.event_type = 'email.sent'
        and receipt.disposition = 'matched'
        and receipt.provider_scope_id = 'resend-team-production'
        and receipt.provider_broadcast_id is null
    ) as sent_count,
    count(*) filter (
      where receipt.event_type = 'email.delivered'
        and receipt.disposition = 'matched'
        and receipt.provider_scope_id = 'resend-team-production'
        and receipt.provider_broadcast_id is null
    ) as delivered_count,
    count(*) filter (
      where receipt.disposition <> 'matched'
        or receipt.provider_scope_id <> 'resend-team-production'
        or receipt.provider_broadcast_id is not null
        or receipt.event_type not in (
          'email.sent', 'email.delivered', 'email.opened', 'email.clicked'
        )
    ) as disqualifying_count
  from public.builder_newsletter_webhook_receipts receipt
  join exact_site site on site.id = receipt.site_id
  where receipt.provider_message_id = 'db73a773-8609-462c-ac57-3545a535e9d5'
)
select
  (select count(*) from exact_site) = 1 as exact_site,
  (select count(*) from exact_owner) = 1 as exact_owner_and_auth_timestamp,
  (select site_id from exact_owner) as site_id,
  (select user_id from exact_owner) as operator_id,
  (select last_sign_in_at from exact_owner) as auth_last_sign_in_at,
  receipts.sent_count,
  receipts.delivered_count,
  receipts.disqualifying_count,
  receipts.sent_count = 1
    and receipts.delivered_count = 1
    and receipts.disqualifying_count = 0 as receipt_policy_satisfied
from receipts;
