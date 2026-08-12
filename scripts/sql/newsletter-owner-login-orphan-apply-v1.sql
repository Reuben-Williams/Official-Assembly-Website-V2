begin;

create function pg_temp.owner_login_deterministic_uuid(p_value text)
returns uuid
language plpgsql
immutable
strict
as $$
declare
  v_bytes bytea;
  v_hex text;
begin
  v_bytes := substring(extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha1') from 1 for 16);
  v_bytes := pg_catalog.set_byte(v_bytes, 6, (pg_catalog.get_byte(v_bytes, 6) & 15) | 80);
  v_bytes := pg_catalog.set_byte(v_bytes, 8, (pg_catalog.get_byte(v_bytes, 8) & 63) | 128);
  v_hex := pg_catalog.encode(v_bytes, 'hex');
  return (
    pg_catalog.substr(v_hex, 1, 8) || '-' ||
    pg_catalog.substr(v_hex, 9, 4) || '-' ||
    pg_catalog.substr(v_hex, 13, 4) || '-' ||
    pg_catalog.substr(v_hex, 17, 4) || '-' ||
    pg_catalog.substr(v_hex, 21, 12)
  )::uuid;
end;
$$;

create temporary table pg_temp.owner_login_backfill_result (
  occurrence_id uuid not null,
  occurrence_replayed boolean not null,
  evidence_id uuid not null,
  evidence_replayed boolean not null,
  policy_version text not null,
  provider_message_id text not null
);
create temporary table pg_temp.owner_login_backfill_boundary as
select
  count(*) filter (
    where member.site_id = 'a3f57b25-df25-4d98-9ff6-a4a3f3a00a68'::uuid
      and member.user_id = '98e9e1e7-1a8a-4f1f-b71c-31e682567dd1'::uuid
      and member.role = 'owner'
      and users.last_sign_in_at = '2026-08-11T21:24:29.356981Z'::timestamptz
  ) as owner_count,
  (
    select count(*)
    from public.builder_newsletter_webhook_receipts receipt
    where receipt.site_id = 'a3f57b25-df25-4d98-9ff6-a4a3f3a00a68'::uuid
      and receipt.provider_message_id = 'db73a773-8609-462c-ac57-3545a535e9d5'
      and receipt.event_type = 'email.sent'
      and receipt.disposition = 'matched'
      and receipt.provider_scope_id = 'resend-team-production'
      and receipt.provider_broadcast_id is null
  ) as sent_count,
  (
    select count(*)
    from public.builder_newsletter_webhook_receipts receipt
    where receipt.site_id = 'a3f57b25-df25-4d98-9ff6-a4a3f3a00a68'::uuid
      and receipt.provider_message_id = 'db73a773-8609-462c-ac57-3545a535e9d5'
      and receipt.event_type = 'email.delivered'
      and receipt.disposition = 'matched'
      and receipt.provider_scope_id = 'resend-team-production'
      and receipt.provider_broadcast_id is null
  ) as delivered_count,
  (
    select count(*)
    from public.builder_newsletter_webhook_receipts receipt
    where receipt.site_id = 'a3f57b25-df25-4d98-9ff6-a4a3f3a00a68'::uuid
      and receipt.provider_message_id = 'db73a773-8609-462c-ac57-3545a535e9d5'
      and (
        receipt.disposition <> 'matched'
        or receipt.provider_scope_id <> 'resend-team-production'
        or receipt.provider_broadcast_id is not null
        or receipt.event_type not in (
          'email.sent', 'email.delivered', 'email.opened', 'email.clicked'
        )
      )
  ) as disqualifying_count
from public.builder_site_members member
join auth.users users on users.id = member.user_id;
grant execute on function pg_temp.owner_login_deterministic_uuid(text) to service_role;
grant insert, select on table pg_temp.owner_login_backfill_result to service_role;
grant select on table pg_temp.owner_login_backfill_boundary to service_role;

set local role service_role;

do $$
declare
  v_site_id constant uuid := 'a3f57b25-df25-4d98-9ff6-a4a3f3a00a68';
  v_operator_id constant uuid := '98e9e1e7-1a8a-4f1f-b71c-31e682567dd1';
  v_occurrence_command_id constant uuid := 'c50635af-9590-5de5-8e9b-b31a313f453c';
  v_provider_message_id constant text := 'db73a773-8609-462c-ac57-3545a535e9d5';
  v_provider_created_at constant timestamptz := '2026-08-11T21:24:21.547Z';
  v_auth_last_sign_in_at constant timestamptz := '2026-08-11T21:24:29.356981Z';
  v_occurrence_response jsonb;
  v_evidence_response jsonb;
  v_occurrence_id uuid;
  v_evidence_command_id uuid;
  v_evidence_digest text;
  v_owner_count integer;
  v_sent_count integer;
  v_delivered_count integer;
  v_disqualifying_count integer;
begin
  select
    owner_count, sent_count, delivered_count, disqualifying_count
  into v_owner_count, v_sent_count, v_delivered_count, v_disqualifying_count
  from pg_temp.owner_login_backfill_boundary;

  if v_owner_count <> 1
    or v_sent_count <> 1
    or v_delivered_count <> 1
    or v_disqualifying_count <> 0
  then
    raise exception 'newsletter owner login orphan boundary mismatch' using errcode = '55000';
  end if;

  v_occurrence_response := public.builder_record_newsletter_auth_login_occurrence_v1(
    jsonb_build_object(
      'version', 1,
      'siteId', v_site_id,
      'operatorId', v_operator_id,
      'commandId', v_occurrence_command_id,
      'authLastSignInAt', v_auth_last_sign_in_at
    )
  );
  v_occurrence_id := (v_occurrence_response ->> 'occurrenceId')::uuid;

  v_evidence_command_id := pg_temp.owner_login_deterministic_uuid(
    '{"policyVersion":"resend-owner-login-v1","operation":"record-evidence","siteId":"' ||
    v_site_id::text || '","occurrenceId":"' || v_occurrence_id::text ||
    '","providerMessageId":"' || v_provider_message_id || '"}'
  );
  v_evidence_digest := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    '{"version":1,"policyVersion":"resend-owner-login-v1","siteId":"' ||
    v_site_id::text || '","operatorId":"' || v_operator_id::text ||
    '","occurrenceId":"' || v_occurrence_id::text ||
    '","providerMessageId":"' || v_provider_message_id ||
    '","providerCreatedAt":"2026-08-11T21:24:21.547Z"' ||
    ',"authLastSignInAt":"2026-08-11T21:24:29.356Z"}',
    'UTF8'
  ), 'sha256'), 'hex');

  v_evidence_response := public.builder_record_newsletter_auth_login_evidence_v1(
    jsonb_build_object(
      'version', 1,
      'policyVersion', 'resend-owner-login-v1',
      'siteId', v_site_id,
      'operatorId', v_operator_id,
      'commandId', v_evidence_command_id,
      'occurrenceId', v_occurrence_id,
      'providerMessageId', v_provider_message_id,
      'providerCreatedAt', v_provider_created_at,
      'authLastSignInAt', v_auth_last_sign_in_at,
      'safeEvidenceDigest', v_evidence_digest
    )
  );

  insert into pg_temp.owner_login_backfill_result (
    occurrence_id, occurrence_replayed, evidence_id, evidence_replayed,
    policy_version, provider_message_id
  ) values (
    v_occurrence_id,
    (v_occurrence_response ->> 'replayed')::boolean,
    (v_evidence_response ->> 'evidenceId')::uuid,
    (v_evidence_response ->> 'replayed')::boolean,
    'resend-owner-login-v1',
    v_provider_message_id
  );
end;
$$;

reset role;

select
  occurrence_id,
  occurrence_replayed,
  evidence_id,
  evidence_replayed,
  policy_version,
  provider_message_id
from pg_temp.owner_login_backfill_result;

commit;
