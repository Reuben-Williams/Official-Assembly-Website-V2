create table public.builder_newsletter_provider_history_reconciliations (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  command_id uuid not null,
  policy_version text not null check (policy_version = 'resend-initial-history-v1'),
  operator_id uuid not null,
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 200),
  classification text not null check (classification in (
    'auth_smtp_magic_link', 'unattributed_failed_setup_test'
  )),
  provider_status text not null check (provider_status in ('delivered', 'failed')),
  provider_created_at timestamptz not null,
  safe_evidence_digest text not null check (safe_evidence_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, provider_message_id),
  foreign key (site_id, operator_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (
    (classification = 'auth_smtp_magic_link' and provider_status = 'delivered')
    or (classification = 'unattributed_failed_setup_test' and provider_status = 'failed')
  )
);

create index builder_newsletter_history_reconciliation_command_idx
  on public.builder_newsletter_provider_history_reconciliations (site_id, command_id);

alter table public.builder_newsletter_provider_history_reconciliations enable row level security;
revoke all on table public.builder_newsletter_provider_history_reconciliations
from public, anon, authenticated;
grant select, insert on table public.builder_newsletter_provider_history_reconciliations
to service_role;

create function public.builder_record_newsletter_history_reconciliation_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_operator_id uuid;
  v_command_id uuid;
  v_digest text;
  v_entry record;
  v_existing_count integer;
  v_inserted_count integer;
  v_message_ids text[];
  v_expected_message_ids constant text[] := array[
    '038fb647-8443-42d1-9c16-98f45d944d34',
    '1c9faeab-9011-40df-a011-fe7203dd3f29',
    '21b1a46d-625b-4338-bdd7-dbb4bdca953d',
    '811ea57a-349d-40c5-a0e6-880b2c79eff4',
    '8f77edd1-1342-48a7-99a5-4d0ce8eebbff',
    'a1c81a5d-c005-48b3-8ab0-3894958ac9cf',
    'a9f2632a-63f3-403d-9cc3-b727173df3df',
    'd7477a6b-e5ff-4dac-a087-2a162567b538'
  ]::text[];
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_operator_id := (p_request ->> 'operatorId')::uuid;
    v_command_id := (p_request ->> 'commandId')::uuid;
    v_digest := p_request ->> 'safeEvidenceDigest';
  exception when others then
    raise exception 'invalid newsletter history reconciliation' using errcode = '22023';
  end;

  if p_request ->> 'version' <> '1'
    or p_request ->> 'policyVersion' <> 'resend-initial-history-v1'
    or v_digest !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_request -> 'entries') <> 'array'
    or jsonb_array_length(p_request -> 'entries') <> 8
    or (select array_agg(key order by key) from jsonb_object_keys(p_request) key)
      <> array[
        'commandId', 'entries', 'operatorId', 'policyVersion',
        'safeEvidenceDigest', 'siteId', 'version'
      ]::text[]
    or exists (
      select 1
      from jsonb_array_elements(p_request -> 'entries') entry
      where jsonb_typeof(entry) <> 'object'
        or (select array_agg(key order by key) from jsonb_object_keys(entry) key)
          <> array[
            'classification', 'providerCreatedAt', 'providerMessageId', 'providerStatus'
          ]::text[]
    )
  then
    raise exception 'invalid newsletter history reconciliation' using errcode = '22023';
  end if;

  begin
    select array_agg(item."providerMessageId" order by item."providerMessageId")
    into v_message_ids
    from jsonb_to_recordset(p_request -> 'entries') as item(
      "providerMessageId" text,
      "classification" text,
      "providerStatus" text,
      "providerCreatedAt" timestamptz
    );
  exception when others then
    raise exception 'invalid newsletter history reconciliation' using errcode = '22023';
  end;

  if v_message_ids <> v_expected_message_ids
    or (select count(*) from jsonb_to_recordset(p_request -> 'entries') as item(
      "providerMessageId" text, "classification" text, "providerStatus" text,
      "providerCreatedAt" timestamptz
    ) where item."classification" = 'auth_smtp_magic_link'
      and item."providerStatus" = 'delivered') <> 7
    or (select count(*) from jsonb_to_recordset(p_request -> 'entries') as item(
      "providerMessageId" text, "classification" text, "providerStatus" text,
      "providerCreatedAt" timestamptz
    ) where item."classification" = 'unattributed_failed_setup_test'
      and item."providerStatus" = 'failed'
      and item."providerMessageId" = '038fb647-8443-42d1-9c16-98f45d944d34') <> 1
    or exists (
      select 1
      from jsonb_to_recordset(p_request -> 'entries') as item(
        "providerMessageId" text, "classification" text, "providerStatus" text,
        "providerCreatedAt" timestamptz
      )
      where item."providerCreatedAt" is null
        or (item."classification" = 'auth_smtp_magic_link' and item."providerStatus" <> 'delivered')
        or (item."classification" = 'unattributed_failed_setup_test' and item."providerStatus" <> 'failed')
    )
  then
    raise exception 'invalid newsletter history reconciliation' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.builder_site_members member
    where member.site_id = v_site_id
      and member.user_id = v_operator_id
      and member.role = 'owner'
  ) then
    raise exception 'newsletter history reconciliation not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 205));

  select count(*)::integer into v_existing_count
  from public.builder_newsletter_provider_history_reconciliations reconciliation
  where reconciliation.site_id = v_site_id
    and reconciliation.command_id = v_command_id;
  if v_existing_count > 0 then
    if v_existing_count <> 8 or exists (
      select 1
      from public.builder_newsletter_provider_history_reconciliations reconciliation
      where reconciliation.site_id = v_site_id
        and reconciliation.command_id = v_command_id
        and (
          reconciliation.operator_id <> v_operator_id
          or reconciliation.policy_version <> 'resend-initial-history-v1'
          or reconciliation.safe_evidence_digest <> v_digest
          or not exists (
            select 1
            from jsonb_to_recordset(p_request -> 'entries') as item(
              "providerMessageId" text, "classification" text, "providerStatus" text,
              "providerCreatedAt" timestamptz
            )
            where item."providerMessageId" = reconciliation.provider_message_id
              and item."classification" = reconciliation.classification
              and item."providerStatus" = reconciliation.provider_status
              and item."providerCreatedAt" = reconciliation.provider_created_at
          )
        )
    ) then
      raise exception 'newsletter history reconciliation command conflict' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'version', 1, 'status', 'recorded', 'entryCount', 8, 'replayed', true
    );
  end if;

  if exists (
    select 1
    from public.builder_newsletter_provider_history_reconciliations reconciliation
    where reconciliation.site_id = v_site_id
      and reconciliation.provider_message_id = any(v_expected_message_ids)
  ) then
    raise exception 'newsletter history reconciliation already recorded' using errcode = '55000';
  end if;

  for v_entry in
    select
      item."providerMessageId" as provider_message_id,
      item."classification" as classification,
      item."providerStatus" as provider_status,
      item."providerCreatedAt" as provider_created_at
    from jsonb_to_recordset(p_request -> 'entries') as item(
      "providerMessageId" text, "classification" text, "providerStatus" text,
      "providerCreatedAt" timestamptz
    )
  loop
    if v_entry.classification = 'auth_smtp_magic_link' then
      if (
        select count(*)
        from public.builder_newsletter_webhook_receipts receipt
        where receipt.site_id = v_site_id
          and receipt.provider_scope_id = 'resend-team-production'
          and receipt.provider_message_id = v_entry.provider_message_id
          and receipt.disposition = 'matched'
          and receipt.provider_broadcast_id is null
          and receipt.event_type in ('email.sent', 'email.delivered')
      ) <> 2
      or not exists (
        select 1 from public.builder_newsletter_webhook_receipts receipt
        where receipt.site_id = v_site_id
          and receipt.provider_message_id = v_entry.provider_message_id
          and receipt.event_type = 'email.sent'
          and receipt.disposition = 'matched'
          and receipt.provider_broadcast_id is null
      )
      or not exists (
        select 1 from public.builder_newsletter_webhook_receipts receipt
        where receipt.site_id = v_site_id
          and receipt.provider_message_id = v_entry.provider_message_id
          and receipt.event_type = 'email.delivered'
          and receipt.disposition = 'matched'
          and receipt.provider_broadcast_id is null
      )
      then
        raise exception 'newsletter Auth history evidence is incomplete' using errcode = '55000';
      end if;
    elsif exists (
      select 1 from public.builder_newsletter_webhook_receipts receipt
      where receipt.site_id = v_site_id
        and receipt.provider_message_id = v_entry.provider_message_id
    ) then
      raise exception 'failed newsletter setup history has delivery evidence' using errcode = '55000';
    end if;
  end loop;

  insert into public.builder_newsletter_provider_history_reconciliations (
    site_id, command_id, policy_version, operator_id, provider_message_id,
    classification, provider_status, provider_created_at, safe_evidence_digest
  )
  select
    v_site_id, v_command_id, 'resend-initial-history-v1', v_operator_id,
    item."providerMessageId", item."classification", item."providerStatus",
    item."providerCreatedAt", v_digest
  from jsonb_to_recordset(p_request -> 'entries') as item(
    "providerMessageId" text, "classification" text, "providerStatus" text,
    "providerCreatedAt" timestamptz
  );
  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> 8 then
    raise exception 'newsletter history reconciliation insert mismatch' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'version', 1, 'status', 'recorded', 'entryCount', v_inserted_count, 'replayed', false
  );
end;
$$;

revoke all on function public.builder_record_newsletter_history_reconciliation_v1(jsonb)
from public, anon, authenticated;
grant execute on function public.builder_record_newsletter_history_reconciliation_v1(jsonb)
to service_role;
