create table public.builder_newsletter_auth_login_occurrences (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  command_id uuid not null,
  policy_version text not null check (policy_version = 'resend-owner-login-v1'),
  operator_id uuid not null,
  auth_last_sign_in_at timestamptz not null,
  expires_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, command_id),
  unique (site_id, operator_id, auth_last_sign_in_at),
  foreign key (site_id, operator_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (expires_at > auth_last_sign_in_at),
  check (expires_at <= auth_last_sign_in_at + interval '7 days')
);

create table public.builder_newsletter_auth_login_evidence (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  command_id uuid not null,
  policy_version text not null check (policy_version = 'resend-owner-login-v1'),
  occurrence_id uuid not null,
  operator_id uuid not null,
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 200),
  provider_created_at timestamptz not null,
  auth_last_sign_in_at timestamptz not null,
  safe_evidence_digest text not null check (safe_evidence_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, command_id),
  unique (site_id, occurrence_id),
  unique (site_id, provider_message_id),
  foreign key (site_id, occurrence_id)
    references public.builder_newsletter_auth_login_occurrences(site_id, id) on delete restrict,
  foreign key (site_id, operator_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (
    auth_last_sign_in_at >= provider_created_at
    and auth_last_sign_in_at <= provider_created_at + interval '1 hour'
  )
);

create table public.builder_newsletter_auth_login_recovery_commands (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  command_id uuid not null,
  operator_id uuid not null,
  queued_count integer not null check (queued_count >= 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, command_id),
  foreign key (site_id, operator_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

alter table public.builder_newsletter_site_jobs
  drop constraint if exists builder_newsletter_site_jobs_kind_check;

alter table public.builder_newsletter_site_jobs
  add constraint builder_newsletter_site_jobs_kind_check
    check (kind in (
      'newsletter.contact.audit',
      'newsletter.segment.reconcile',
      'newsletter.auth_login.reconcile'
    )),
  add column auth_login_occurrence_id uuid,
  add constraint builder_newsletter_site_jobs_auth_login_occurrence_fkey
    foreign key (site_id, auth_login_occurrence_id)
      references public.builder_newsletter_auth_login_occurrences(site_id, id)
      on delete restrict,
  add constraint builder_newsletter_site_jobs_auth_login_shape_check
    check (
      (kind = 'newsletter.auth_login.reconcile' and auth_login_occurrence_id is not null)
      or (kind <> 'newsletter.auth_login.reconcile' and auth_login_occurrence_id is null)
    );

create unique index builder_newsletter_one_auth_login_job_idx
  on public.builder_newsletter_site_jobs (site_id, auth_login_occurrence_id)
  where kind = 'newsletter.auth_login.reconcile';

alter table public.builder_newsletter_auth_login_occurrences enable row level security;
alter table public.builder_newsletter_auth_login_evidence enable row level security;
alter table public.builder_newsletter_auth_login_recovery_commands enable row level security;

revoke all on table
  public.builder_newsletter_auth_login_occurrences,
  public.builder_newsletter_auth_login_evidence,
  public.builder_newsletter_auth_login_recovery_commands
from public, anon, authenticated;

grant select, insert on table
  public.builder_newsletter_auth_login_occurrences,
  public.builder_newsletter_auth_login_evidence,
  public.builder_newsletter_auth_login_recovery_commands
to service_role;

create function public.builder_record_newsletter_auth_login_occurrence_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_operator_id uuid;
  v_command_id uuid;
  v_auth_last_sign_in_at timestamptz;
  v_occurrence_id uuid;
  v_job_id uuid;
  v_existing record;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_operator_id := (p_request ->> 'operatorId')::uuid;
    v_command_id := (p_request ->> 'commandId')::uuid;
    v_auth_last_sign_in_at := (p_request ->> 'authLastSignInAt')::timestamptz;
  exception when others then
    raise exception 'invalid newsletter owner login occurrence' using errcode = '22023';
  end;

  if p_request ->> 'version' <> '1'
    or (select array_agg(key order by key) from jsonb_object_keys(p_request) key)
      <> array['authLastSignInAt', 'commandId', 'operatorId', 'siteId', 'version']::text[]
    or v_auth_last_sign_in_at > clock_timestamp() + interval '1 minute'
  then
    raise exception 'invalid newsletter owner login occurrence' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.builder_site_members member
    where member.site_id = v_site_id
      and member.user_id = v_operator_id
      and member.role = 'owner'
  ) then
    raise exception 'newsletter owner login occurrence not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 211));

  select occurrence.id, occurrence.command_id, occurrence.operator_id,
         occurrence.auth_last_sign_in_at, occurrence.policy_version
  into v_existing
  from public.builder_newsletter_auth_login_occurrences occurrence
  where occurrence.site_id = v_site_id
    and (
      occurrence.command_id = v_command_id
      or (occurrence.operator_id = v_operator_id
        and occurrence.auth_last_sign_in_at = v_auth_last_sign_in_at)
    )
  order by occurrence.created_at
  limit 1;

  if found then
    if v_existing.command_id <> v_command_id
      or v_existing.operator_id <> v_operator_id
      or v_existing.auth_last_sign_in_at <> v_auth_last_sign_in_at
      or v_existing.policy_version <> 'resend-owner-login-v1'
    then
      raise exception 'newsletter owner login occurrence command conflict' using errcode = '23505';
    end if;
    select job.id into v_job_id
    from public.builder_newsletter_site_jobs job
    where job.site_id = v_site_id
      and job.kind = 'newsletter.auth_login.reconcile'
      and job.auth_login_occurrence_id = v_existing.id;
    if v_job_id is null then
      raise exception 'newsletter owner login occurrence job missing' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'version', 1, 'status', 'queued', 'occurrenceId', v_existing.id,
      'jobId', v_job_id, 'replayed', true
    );
  end if;

  insert into public.builder_newsletter_auth_login_occurrences (
    site_id, command_id, policy_version, operator_id, auth_last_sign_in_at, expires_at
  ) values (
    v_site_id, v_command_id, 'resend-owner-login-v1', v_operator_id,
    v_auth_last_sign_in_at, v_auth_last_sign_in_at + interval '7 days'
  ) returning id into v_occurrence_id;

  insert into public.builder_newsletter_site_jobs (
    site_id, provider_scope_id, kind, auth_login_occurrence_id,
    state, available_at
  ) values (
    v_site_id, 'resend-team-production', 'newsletter.auth_login.reconcile',
    v_occurrence_id, 'queued', clock_timestamp()
  ) returning id into v_job_id;

  return jsonb_build_object(
    'version', 1, 'status', 'queued', 'occurrenceId', v_occurrence_id,
    'jobId', v_job_id, 'replayed', false
  );
end;
$$;

create function public.builder_claim_newsletter_auth_login_jobs_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_worker_id uuid;
  v_limit integer;
  v_lease_seconds integer;
  v_jobs jsonb := '[]'::jsonb;
  v_row record;
  v_claimed record;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_worker_id := (p_request ->> 'workerId')::uuid;
    v_limit := (p_request ->> 'limit')::integer;
    v_lease_seconds := (p_request ->> 'leaseSeconds')::integer;
  exception when others then
    raise exception 'invalid newsletter owner login job claim' using errcode = '22023';
  end;
  if p_request ->> 'version' <> '1'
    or v_limit not between 1 and 25
    or v_lease_seconds not between 15 and 900
    or (select array_agg(key order by key) from jsonb_object_keys(p_request) key)
      <> array['leaseSeconds', 'limit', 'siteId', 'version', 'workerId']::text[]
  then
    raise exception 'invalid newsletter owner login job claim' using errcode = '22023';
  end if;

  update public.builder_newsletter_site_jobs job
  set state = 'terminal_failed', safe_failure_code = case
        when occurrence.expires_at <= clock_timestamp() then 'owner_login_occurrence_expired'
        else 'owner_login_attempts_exhausted'
      end,
      lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
  from public.builder_newsletter_auth_login_occurrences occurrence
  where job.site_id = v_site_id
    and job.site_id = occurrence.site_id
    and job.auth_login_occurrence_id = occurrence.id
    and job.kind = 'newsletter.auth_login.reconcile'
    and (
      job.state in ('queued', 'retryable_failed')
      or (job.state = 'leased' and job.lease_expires_at <= clock_timestamp())
    )
    and (occurrence.expires_at <= clock_timestamp() or job.attempt_count >= 12);

  for v_row in
    select job.id, occurrence.id as occurrence_id,
           occurrence.operator_id, occurrence.auth_last_sign_in_at
    from public.builder_newsletter_site_jobs job
    join public.builder_newsletter_auth_login_occurrences occurrence
      on occurrence.site_id = job.site_id
      and occurrence.id = job.auth_login_occurrence_id
    where job.site_id = v_site_id
      and job.kind = 'newsletter.auth_login.reconcile'
      and (
        (job.state in ('queued', 'retryable_failed') and job.available_at <= clock_timestamp())
        or (job.state = 'leased' and job.lease_expires_at <= clock_timestamp())
      )
      and occurrence.expires_at > clock_timestamp()
      and job.attempt_count < 12
    order by job.created_at, job.id
    for update of job skip locked
    limit v_limit
  loop
    update public.builder_newsletter_site_jobs job
    set state = 'leased', lease_owner = v_worker_id,
        lease_fencing_token = lease_fencing_token + 1,
        lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
        attempt_count = attempt_count + 1,
        invocation_count = invocation_count + 1,
        updated_at = clock_timestamp()
    where job.site_id = v_site_id and job.id = v_row.id
    returning job.lease_fencing_token, job.lease_expires_at, job.attempt_count
    into v_claimed;

    v_jobs := v_jobs || jsonb_build_array(jsonb_build_object(
      'subject', 'site',
      'id', v_row.id,
      'kind', 'newsletter.auth_login.reconcile',
      'occurrenceId', v_row.occurrence_id,
      'operatorId', v_row.operator_id,
      'authLastSignInAt', v_row.auth_last_sign_in_at,
      'fencingToken', v_claimed.lease_fencing_token,
      'leaseExpiresAt', v_claimed.lease_expires_at,
      'attemptCount', v_claimed.attempt_count
    ));
  end loop;

  return jsonb_build_object('version', 1, 'jobs', v_jobs);
end;
$$;

create function public.builder_record_newsletter_auth_login_evidence_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_operator_id uuid;
  v_command_id uuid;
  v_occurrence_id uuid;
  v_provider_message_id text;
  v_provider_created_at timestamptz;
  v_auth_last_sign_in_at timestamptz;
  v_digest text;
  v_existing record;
  v_evidence_id uuid;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_operator_id := (p_request ->> 'operatorId')::uuid;
    v_command_id := (p_request ->> 'commandId')::uuid;
    v_occurrence_id := (p_request ->> 'occurrenceId')::uuid;
    v_provider_message_id := btrim(p_request ->> 'providerMessageId');
    v_provider_created_at := (p_request ->> 'providerCreatedAt')::timestamptz;
    v_auth_last_sign_in_at := (p_request ->> 'authLastSignInAt')::timestamptz;
    v_digest := p_request ->> 'safeEvidenceDigest';
  exception when others then
    raise exception 'invalid newsletter owner login evidence' using errcode = '22023';
  end;

  if p_request ->> 'version' <> '1'
    or p_request ->> 'policyVersion' <> 'resend-owner-login-v1'
    or char_length(v_provider_message_id) not between 1 and 200
    or v_digest !~ '^[a-f0-9]{64}$'
    or (select array_agg(key order by key) from jsonb_object_keys(p_request) key)
      <> array[
        'authLastSignInAt', 'commandId', 'occurrenceId', 'operatorId',
        'policyVersion', 'providerCreatedAt', 'providerMessageId',
        'safeEvidenceDigest', 'siteId', 'version'
      ]::text[]
  then
    raise exception 'invalid newsletter owner login evidence' using errcode = '22023';
  end if;

  select occurrence.id, occurrence.operator_id, occurrence.auth_last_sign_in_at,
         occurrence.expires_at, occurrence.policy_version
  into v_existing
  from public.builder_newsletter_auth_login_occurrences occurrence
  where occurrence.site_id = v_site_id and occurrence.id = v_occurrence_id;
  if not found
    or v_existing.operator_id <> v_operator_id
    or v_existing.auth_last_sign_in_at <> v_auth_last_sign_in_at
    or v_existing.expires_at <= clock_timestamp()
    or v_existing.policy_version <> 'resend-owner-login-v1'
    or v_auth_last_sign_in_at < v_provider_created_at
    or v_auth_last_sign_in_at > v_provider_created_at + interval '1 hour'
  then
    raise exception 'newsletter owner login occurrence mismatch' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.builder_site_members member
    where member.site_id = v_site_id
      and member.user_id = v_operator_id
      and member.role = 'owner'
  ) then
    raise exception 'newsletter owner login evidence not authorized' using errcode = '42501';
  end if;

  if (
    select count(*) from public.builder_newsletter_webhook_receipts receipt
    where receipt.site_id = v_site_id
      and receipt.provider_message_id = v_provider_message_id
      and receipt.disposition = 'matched'
      and receipt.provider_scope_id = 'resend-team-production'
      and receipt.provider_broadcast_id is null
      and receipt.event_type = 'email.sent'
  ) <> 1
  or (
    select count(*) from public.builder_newsletter_webhook_receipts receipt
    where receipt.site_id = v_site_id
      and receipt.provider_message_id = v_provider_message_id
      and receipt.disposition = 'matched'
      and receipt.provider_scope_id = 'resend-team-production'
      and receipt.provider_broadcast_id is null
      and receipt.event_type = 'email.delivered'
  ) <> 1
  or exists (
    select 1 from public.builder_newsletter_webhook_receipts receipt
    where receipt.site_id = v_site_id
      and receipt.provider_message_id = v_provider_message_id
      and (
        receipt.disposition <> 'matched'
        or receipt.provider_scope_id <> 'resend-team-production'
        or receipt.provider_broadcast_id is not null
        or receipt.event_type not in (
          'email.sent', 'email.delivered', 'email.opened', 'email.clicked'
        )
      )
  )
  then
    raise exception 'newsletter owner login delivery evidence mismatch' using errcode = '55000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 212));

  select evidence.id, evidence.command_id, evidence.occurrence_id, evidence.operator_id,
         evidence.provider_message_id, evidence.provider_created_at,
         evidence.auth_last_sign_in_at, evidence.safe_evidence_digest,
         evidence.policy_version
  into v_existing
  from public.builder_newsletter_auth_login_evidence evidence
  where evidence.site_id = v_site_id
    and (
      evidence.command_id = v_command_id
      or evidence.occurrence_id = v_occurrence_id
      or evidence.provider_message_id = v_provider_message_id
    )
  order by evidence.created_at
  limit 1;

  if found then
    if v_existing.command_id <> v_command_id
      or v_existing.occurrence_id <> v_occurrence_id
      or v_existing.operator_id <> v_operator_id
      or v_existing.provider_message_id <> v_provider_message_id
      or v_existing.provider_created_at <> v_provider_created_at
      or v_existing.auth_last_sign_in_at <> v_auth_last_sign_in_at
      or v_existing.safe_evidence_digest <> v_digest
      or v_existing.policy_version <> 'resend-owner-login-v1'
    then
      raise exception 'newsletter owner login evidence command conflict' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'version', 1, 'status', 'recorded', 'evidenceId', v_existing.id,
      'replayed', true
    );
  end if;

  insert into public.builder_newsletter_auth_login_evidence (
    site_id, command_id, policy_version, occurrence_id, operator_id,
    provider_message_id, provider_created_at, auth_last_sign_in_at,
    safe_evidence_digest
  ) values (
    v_site_id, v_command_id, 'resend-owner-login-v1', v_occurrence_id,
    v_operator_id, v_provider_message_id, v_provider_created_at,
    v_auth_last_sign_in_at, v_digest
  ) returning id into v_evidence_id;

  return jsonb_build_object(
    'version', 1, 'status', 'recorded', 'evidenceId', v_evidence_id,
    'replayed', false
  );
end;
$$;

create function public.builder_requeue_newsletter_auth_login_jobs_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_operator_id uuid;
  v_command_id uuid;
  v_queued_count integer;
  v_existing record;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_operator_id := (p_request ->> 'operatorId')::uuid;
    v_command_id := (p_request ->> 'commandId')::uuid;
  exception when others then
    raise exception 'invalid newsletter owner login recovery' using errcode = '22023';
  end;
  if p_request ->> 'version' <> '1'
    or (select array_agg(key order by key) from jsonb_object_keys(p_request) key)
      <> array['commandId', 'operatorId', 'siteId', 'version']::text[]
  then
    raise exception 'invalid newsletter owner login recovery' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.builder_site_members member
    where member.site_id = v_site_id
      and member.user_id = v_operator_id
      and member.role = 'owner'
  ) then
    raise exception 'newsletter owner login recovery not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 213));
  select recovery.queued_count, recovery.operator_id into v_existing
  from public.builder_newsletter_auth_login_recovery_commands recovery
  where recovery.site_id = v_site_id and recovery.command_id = v_command_id;
  if found then
    if v_existing.operator_id <> v_operator_id then
      raise exception 'newsletter owner login recovery command conflict' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'version', 1, 'status', 'queued', 'queuedCount', v_existing.queued_count,
      'replayed', true
    );
  end if;

  update public.builder_newsletter_site_jobs job
  set state = 'queued', available_at = clock_timestamp(), attempt_count = 0,
      safe_failure_code = null, lease_owner = null, lease_expires_at = null,
      updated_at = clock_timestamp()
  from public.builder_newsletter_auth_login_occurrences occurrence
  where job.site_id = v_site_id
    and job.site_id = occurrence.site_id
    and job.auth_login_occurrence_id = occurrence.id
    and job.kind = 'newsletter.auth_login.reconcile'
    and (
      job.state in ('retryable_failed', 'terminal_failed')
      or (job.state = 'leased' and job.lease_expires_at <= clock_timestamp())
    )
    and occurrence.expires_at > clock_timestamp()
    and not exists (
      select 1 from public.builder_newsletter_auth_login_evidence evidence
      where evidence.site_id = job.site_id
        and evidence.occurrence_id = occurrence.id
    );
  get diagnostics v_queued_count = row_count;

  insert into public.builder_newsletter_auth_login_recovery_commands (
    site_id, command_id, operator_id, queued_count
  ) values (v_site_id, v_command_id, v_operator_id, v_queued_count);

  return jsonb_build_object(
    'version', 1, 'status', 'queued', 'queuedCount', v_queued_count,
    'replayed', false
  );
end;
$$;

revoke all on function
  public.builder_record_newsletter_auth_login_occurrence_v1(jsonb),
  public.builder_claim_newsletter_auth_login_jobs_v1(jsonb),
  public.builder_record_newsletter_auth_login_evidence_v1(jsonb),
  public.builder_requeue_newsletter_auth_login_jobs_v1(jsonb)
from public, anon, authenticated;

grant execute on function
  public.builder_record_newsletter_auth_login_occurrence_v1(jsonb),
  public.builder_claim_newsletter_auth_login_jobs_v1(jsonb),
  public.builder_record_newsletter_auth_login_evidence_v1(jsonb),
  public.builder_requeue_newsletter_auth_login_jobs_v1(jsonb)
to service_role;
