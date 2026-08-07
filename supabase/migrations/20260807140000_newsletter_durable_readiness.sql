alter table public.builder_newsletter_site_jobs
  add column if not exists invocation_count integer not null default 0
    check (invocation_count >= 0),
  add column if not exists consecutive_failure_count integer not null default 0
    check (consecutive_failure_count between 0 and 8),
  add column if not exists last_checkpoint_at timestamptz;

create unique index if not exists builder_newsletter_one_active_reconciliation_idx
  on public.builder_newsletter_site_jobs (site_id)
  where kind = 'newsletter.segment.reconcile'
    and state in ('queued', 'leased', 'retryable_failed');

create table public.builder_newsletter_eligibility_epochs (
  site_id uuid primary key references public.builder_sites(id) on delete cascade,
  epoch bigint not null default 0 check (epoch >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.builder_newsletter_reconciliation_circuits (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  provider_scope_id text not null check (provider_scope_id = 'resend-team-production'),
  state text not null default 'closed' check (state in ('closed', 'open')),
  safe_failure_code text check (
    safe_failure_code is null or safe_failure_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  exhausted_job_id uuid,
  opened_at timestamptz,
  recovered_at timestamptz,
  recovery_operator_id uuid,
  recovery_reason text check (
    recovery_reason is null or char_length(btrim(recovery_reason)) between 1 and 500
  ),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, provider_scope_id),
  foreign key (site_id, exhausted_job_id)
    references public.builder_newsletter_site_jobs(site_id, id) on delete set null,
  check ((state = 'open') = (opened_at is not null))
);

create table public.builder_newsletter_reconciliation_runs (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  job_id uuid not null,
  provider_scope_id text not null check (provider_scope_id = 'resend-team-production'),
  state text not null default 'running'
    check (state in ('running', 'superseded', 'ready', 'terminal_failed', 'abandoned')),
  phase text not null default 'provider_segment'
    check (phase in ('provider_segment', 'local_eligible', 'finalize', 'completed')),
  expected_eligibility_epoch bigint not null check (expected_eligibility_epoch >= 0),
  provider_after_cursor text,
  provider_complete boolean not null default false,
  local_after_id uuid,
  local_complete boolean not null default false,
  provider_page_count integer not null default 0 check (provider_page_count >= 0),
  local_page_count integer not null default 0 check (local_page_count >= 0),
  audience_count integer check (audience_count is null or audience_count >= 0),
  eligibility_digest text check (
    eligibility_digest is null or eligibility_digest ~ '^[a-f0-9]{64}$'
  ),
  safe_result_code text check (
    safe_result_code is null or safe_result_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  safe_failure_code text check (
    safe_failure_code is null or safe_failure_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  started_at timestamptz not null default clock_timestamp(),
  last_checkpoint_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  member_retain_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, job_id, id),
  foreign key (site_id, job_id)
    references public.builder_newsletter_site_jobs(site_id, id) on delete restrict
);

create unique index builder_newsletter_one_running_reconciliation_idx
  on public.builder_newsletter_reconciliation_runs (site_id)
  where state = 'running';

create table public.builder_newsletter_reconciliation_members (
  site_id uuid not null,
  run_id uuid not null,
  provider_contact_id text not null check (char_length(provider_contact_id) between 1 and 200),
  subscription_id uuid,
  contact_generation integer check (contact_generation is null or contact_generation > 0),
  seen_provider boolean not null default false,
  seen_local boolean not null default false,
  eligible boolean not null default false,
  disposition text not null default 'unresolved'
    check (disposition in (
      'unresolved', 'eligible', 'provider_only', 'locally_ineligible',
      'globally_unsubscribed', 'suppressed', 'wrong_topic',
      'missing_segment', 'removed', 'blocked'
    )),
  action_state text not null default 'none'
    check (action_state in ('none', 'pending', 'completed', 'failed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, run_id, provider_contact_id),
  foreign key (site_id, run_id)
    references public.builder_newsletter_reconciliation_runs(site_id, id) on delete cascade,
  foreign key (site_id, subscription_id)
    references public.builder_newsletter_subscriptions(site_id, id) on delete set null
);

create index builder_newsletter_reconciliation_members_subscription_idx
  on public.builder_newsletter_reconciliation_members (site_id, run_id, subscription_id);

create table public.builder_newsletter_reconciliation_requests (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  command_id uuid not null,
  operation_kind text not null
    check (operation_kind in ('activation_check', 'validate', 'staff_test')),
  state text not null default 'pending' check (state in ('pending', 'completed', 'blocked')),
  requested_at timestamptz not null default clock_timestamp(),
  job_id uuid,
  run_id uuid,
  readiness_revision_id uuid,
  safe_result_code text check (
    safe_result_code is null or safe_result_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, command_id),
  foreign key (site_id, job_id)
    references public.builder_newsletter_site_jobs(site_id, id) on delete set null,
  foreign key (site_id, run_id)
    references public.builder_newsletter_reconciliation_runs(site_id, id) on delete set null,
  foreign key (site_id, readiness_revision_id)
    references public.builder_newsletter_readiness_revisions(site_id, id) on delete set null
);

create table public.builder_newsletter_provider_activation_revisions (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  revision integer not null check (revision > 0),
  provider_scope_id text not null check (provider_scope_id = 'resend-team-production'),
  resource_identity_digest text not null check (resource_identity_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'active' check (state in ('active', 'superseded')),
  provider_contact_count integer not null check (provider_contact_count >= 0),
  local_eligible_count integer not null check (local_eligible_count >= 0),
  historical_send_count integer not null check (historical_send_count >= 0),
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, revision)
);

create unique index builder_newsletter_one_active_provider_activation_idx
  on public.builder_newsletter_provider_activation_revisions (site_id, provider_scope_id)
  where state = 'active';

create table public.builder_newsletter_provider_inventory_attestations (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default extensions.gen_random_uuid(),
  policy_version text not null check (policy_version = 'resend-district-newsletter-v1'),
  operator_id uuid not null,
  categories text[] not null,
  safe_evidence_digest text not null check (safe_evidence_digest ~ '^[a-f0-9]{64}$'),
  attested_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  check (cardinality(categories) between 1 and 20),
  check (expires_at > attested_at and expires_at <= attested_at + interval '30 days')
);

alter table public.builder_newsletter_eligibility_epochs enable row level security;
alter table public.builder_newsletter_reconciliation_circuits enable row level security;
alter table public.builder_newsletter_reconciliation_runs enable row level security;
alter table public.builder_newsletter_reconciliation_members enable row level security;
alter table public.builder_newsletter_reconciliation_requests enable row level security;
alter table public.builder_newsletter_provider_activation_revisions enable row level security;
alter table public.builder_newsletter_provider_inventory_attestations enable row level security;

revoke all on table
  public.builder_newsletter_eligibility_epochs,
  public.builder_newsletter_reconciliation_circuits,
  public.builder_newsletter_reconciliation_runs,
  public.builder_newsletter_reconciliation_members,
  public.builder_newsletter_reconciliation_requests,
  public.builder_newsletter_provider_activation_revisions,
  public.builder_newsletter_provider_inventory_attestations
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.builder_newsletter_eligibility_epochs,
  public.builder_newsletter_reconciliation_circuits,
  public.builder_newsletter_reconciliation_runs,
  public.builder_newsletter_reconciliation_members,
  public.builder_newsletter_reconciliation_requests
to service_role;

grant select, insert on table
  public.builder_newsletter_provider_activation_revisions,
  public.builder_newsletter_provider_inventory_attestations
to service_role;

create function builder_private.invalidate_newsletter_readiness_v1(
  p_site_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_epoch bigint;
  v_revision integer;
  v_audience_count integer;
begin
  if p_site_id is null or p_reason !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'invalid newsletter readiness invalidation' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_site_id::text, 199)
  );
  insert into public.builder_newsletter_eligibility_epochs (site_id, epoch, updated_at)
  values (p_site_id, 1, clock_timestamp())
  on conflict (site_id) do update
  set epoch = public.builder_newsletter_eligibility_epochs.epoch + 1,
      updated_at = clock_timestamp()
  returning epoch into v_epoch;

  select count(*)::integer into v_audience_count
  from public.builder_newsletter_subscriptions subscription
  where subscription.site_id = p_site_id and subscription.status = 'active';

  select coalesce(max(readiness.revision), 0) + 1 into v_revision
  from public.builder_newsletter_readiness_revisions readiness
  where readiness.site_id = p_site_id;

  insert into public.builder_newsletter_readiness_revisions (
    site_id, revision, provider_scope_id, audience_count, eligibility_digest,
    reconciled_at, expires_at, state
  ) values (
    p_site_id, v_revision, 'resend-team-production', v_audience_count,
    encode(extensions.digest(
      'stale:' || v_epoch::text || ':' || p_reason,
      'sha256'
    ), 'hex'),
    clock_timestamp(), clock_timestamp() + interval '30 minutes', 'stale'
  );
end;
$$;

create function builder_private.invalidate_newsletter_readiness_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_contact_id uuid;
  v_relevant boolean := false;
  v_reason text;
begin
  if tg_op = 'DELETE' then
    v_site_id := old.site_id;
  else
    v_site_id := new.site_id;
  end if;

  if tg_table_name = 'builder_newsletter_subscriptions' then
    v_relevant := tg_op <> 'UPDATE' or row(
      new.status,
      new.current_consent_id,
      new.current_generation,
      new.provider_contact_id,
      new.provider_segment_id
    ) is distinct from row(
      old.status,
      old.current_consent_id,
      old.current_generation,
      old.provider_contact_id,
      old.provider_segment_id
    );
    v_reason := 'subscription_changed';
  elsif tg_table_name = 'builder_consents' then
    if tg_op = 'DELETE' then
      v_contact_id := old.contact_id;
      v_relevant := old.purpose = 'marketing_email' and old.channel = 'email';
    elsif tg_op = 'INSERT' then
      v_contact_id := new.contact_id;
      v_relevant := new.purpose = 'marketing_email' and new.channel = 'email';
    else
      v_contact_id := new.contact_id;
      v_relevant := (
        (old.purpose = 'marketing_email' and old.channel = 'email')
        or (new.purpose = 'marketing_email' and new.channel = 'email')
      ) and row(new.contact_id, new.state, new.revoked_at)
        is distinct from row(old.contact_id, old.state, old.revoked_at);
    end if;
    v_relevant := v_relevant and exists (
      select 1 from public.builder_newsletter_subscriptions subscription
      where subscription.site_id = v_site_id and subscription.contact_id = v_contact_id
    );
    v_reason := 'consent_changed';
  elsif tg_table_name = 'builder_suppressions' then
    if tg_op = 'DELETE' then
      v_contact_id := old.contact_id;
      v_relevant := old.channel = 'email';
    elsif tg_op = 'INSERT' then
      v_contact_id := new.contact_id;
      v_relevant := new.channel = 'email';
    else
      v_contact_id := new.contact_id;
      v_relevant := (old.channel = 'email' or new.channel = 'email')
        and row(new.contact_id, new.reason, new.active, new.ended_at)
          is distinct from row(old.contact_id, old.reason, old.active, old.ended_at);
    end if;
    v_relevant := v_relevant and exists (
      select 1 from public.builder_newsletter_subscriptions subscription
      where subscription.site_id = v_site_id and subscription.contact_id = v_contact_id
    );
    v_reason := 'suppression_changed';
  elsif tg_table_name = 'builder_contact_identities' then
    if tg_op = 'DELETE' then
      v_contact_id := old.contact_id;
      v_relevant := old.kind = 'email';
    elsif tg_op = 'INSERT' then
      v_contact_id := new.contact_id;
      v_relevant := new.kind = 'email';
    else
      v_contact_id := new.contact_id;
      v_relevant := (old.kind = 'email' or new.kind = 'email')
        and row(new.contact_id, new.normalized_value, new.verification_state)
          is distinct from row(old.contact_id, old.normalized_value, old.verification_state);
    end if;
    v_relevant := v_relevant and exists (
      select 1 from public.builder_newsletter_subscriptions subscription
      where subscription.site_id = v_site_id and subscription.contact_id = v_contact_id
    );
    v_reason := 'identity_changed';
  end if;

  if v_relevant then
    perform builder_private.invalidate_newsletter_readiness_v1(v_site_id, v_reason);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger builder_newsletter_subscription_readiness_invalidation
after insert or update or delete on public.builder_newsletter_subscriptions
for each row execute function builder_private.invalidate_newsletter_readiness_trigger_v1();

create trigger builder_newsletter_consent_readiness_invalidation
after insert or update or delete on public.builder_consents
for each row execute function builder_private.invalidate_newsletter_readiness_trigger_v1();

create trigger builder_newsletter_suppression_readiness_invalidation
after insert or update or delete on public.builder_suppressions
for each row execute function builder_private.invalidate_newsletter_readiness_trigger_v1();

create trigger builder_newsletter_identity_readiness_invalidation
after insert or update or delete on public.builder_contact_identities
for each row execute function builder_private.invalidate_newsletter_readiness_trigger_v1();

revoke all on function
  builder_private.invalidate_newsletter_readiness_v1(uuid, text),
  builder_private.invalidate_newsletter_readiness_trigger_v1()
from public, anon, authenticated;
grant execute on function builder_private.invalidate_newsletter_readiness_v1(uuid, text)
to service_role;

create function public.builder_schedule_newsletter_reconciliation_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_job_id uuid;
  v_latest record;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
  exception when others then
    raise exception 'invalid newsletter reconciliation schedule' using errcode = '22023';
  end;

  if (p_request ->> 'version') <> '1'
    or (select array_agg(key order by key) from jsonb_object_keys(p_request) key)
       <> array['siteId', 'version']::text[]
    or not exists (select 1 from public.builder_sites site where site.id = v_site_id)
  then
    raise exception 'invalid newsletter reconciliation schedule' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 194));

  insert into public.builder_newsletter_eligibility_epochs (site_id)
  values (v_site_id)
  on conflict (site_id) do nothing;

  insert into public.builder_newsletter_reconciliation_circuits (site_id, provider_scope_id)
  values (v_site_id, 'resend-team-production')
  on conflict (site_id, provider_scope_id) do nothing;

  if exists (
    select 1
    from public.builder_newsletter_reconciliation_circuits circuit
    where circuit.site_id = v_site_id
      and circuit.provider_scope_id = 'resend-team-production'
      and circuit.state = 'open'
  ) then
    return jsonb_build_object('version', 1, 'status', 'blocked');
  end if;

  select readiness.state, readiness.expires_at
  into v_latest
  from public.builder_newsletter_readiness_revisions readiness
  where readiness.site_id = v_site_id
  order by readiness.revision desc
  limit 1;

  if found and v_latest.state = 'ready'
    and v_latest.expires_at > clock_timestamp() + interval '15 minutes'
  then
    return jsonb_build_object('version', 1, 'status', 'fresh');
  end if;

  select job.id
  into v_job_id
  from public.builder_newsletter_site_jobs job
  where job.site_id = v_site_id
    and job.kind = 'newsletter.segment.reconcile'
    and job.state in ('queued', 'leased', 'retryable_failed')
  order by job.created_at, job.id
  limit 1;

  if v_job_id is not null then
    return jsonb_build_object('version', 1, 'status', 'already_queued', 'jobId', v_job_id);
  end if;

  insert into public.builder_newsletter_site_jobs (
    site_id, provider_scope_id, kind, state, available_at, last_checkpoint_at
  ) values (
    v_site_id, 'resend-team-production', 'newsletter.segment.reconcile',
    'queued', clock_timestamp(), clock_timestamp()
  ) returning id into v_job_id;

  return jsonb_build_object('version', 1, 'status', 'queued', 'jobId', v_job_id);
end;
$$;

create function public.builder_request_newsletter_reconciliation_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_command_id uuid;
  v_operation text;
  v_job_id uuid;
  v_existing record;
  v_schedule jsonb;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_command_id := (p_request ->> 'commandId')::uuid;
    v_operation := p_request ->> 'operation';
  exception when others then
    raise exception 'invalid newsletter reconciliation request' using errcode = '22023';
  end;

  if (p_request ->> 'version') <> '1'
    or v_operation not in ('activation_check', 'validate', 'staff_test')
    or not exists (select 1 from public.builder_sites site where site.id = v_site_id)
  then
    raise exception 'invalid newsletter reconciliation request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 195));

  select request.state, request.job_id, request.readiness_revision_id
  into v_existing
  from public.builder_newsletter_reconciliation_requests request
  where request.site_id = v_site_id and request.command_id = v_command_id;

  if found then
    return jsonb_build_object(
      'version', 1,
      'status', case v_existing.state when 'completed' then 'fresh' when 'blocked' then 'blocked' else 'pending' end,
      'jobId', v_existing.job_id,
      'readinessRevisionId', v_existing.readiness_revision_id
    );
  end if;

  v_schedule := public.builder_schedule_newsletter_reconciliation_v1(
    jsonb_build_object('version', 1, 'siteId', v_site_id)
  );

  if v_schedule ->> 'status' = 'fresh' then
    insert into public.builder_newsletter_site_jobs (
      site_id, provider_scope_id, kind, state, available_at, last_checkpoint_at
    ) values (
      v_site_id, 'resend-team-production', 'newsletter.segment.reconcile',
      'queued', clock_timestamp(), clock_timestamp()
    ) returning id into v_job_id;
  else
    v_job_id := nullif(v_schedule ->> 'jobId', '')::uuid;
  end if;

  insert into public.builder_newsletter_reconciliation_requests (
    site_id, command_id, operation_kind, state, job_id
  ) values (
    v_site_id, v_command_id, v_operation,
    case when v_schedule ->> 'status' = 'blocked' then 'blocked' else 'pending' end,
    v_job_id
  );

  return jsonb_build_object(
    'version', 1,
    'status', case when v_schedule ->> 'status' = 'blocked' then 'blocked' else 'pending' end,
    'jobId', v_job_id
  );
end;
$$;

create function public.builder_checkpoint_newsletter_reconciliation_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_job_id uuid;
  v_run_id uuid;
  v_worker_id uuid;
  v_fencing bigint;
  v_expected_epoch bigint;
  v_more_work boolean;
  v_epoch bigint;
  v_changed integer;
  v_member jsonb;
  v_provider_contact_id text;
  v_subscription_id uuid;
  v_contact_generation integer;
  v_disposition text;
  v_action_state text;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_job_id := (p_request ->> 'jobId')::uuid;
    v_run_id := (p_request ->> 'runId')::uuid;
    v_worker_id := (p_request ->> 'workerId')::uuid;
    v_fencing := (p_request ->> 'fencingToken')::bigint;
    v_expected_epoch := (p_request ->> 'expectedEligibilityEpoch')::bigint;
    v_more_work := (p_request ->> 'moreWork')::boolean;
  exception when others then
    raise exception 'invalid newsletter reconciliation checkpoint' using errcode = '22023';
  end;

  select epoch.epoch into v_epoch
  from public.builder_newsletter_eligibility_epochs epoch
  where epoch.site_id = v_site_id
  for update;

  if v_epoch is distinct from v_expected_epoch then
    raise exception 'newsletter eligibility epoch changed' using errcode = '55000';
  end if;

  if jsonb_typeof(coalesce(p_request -> 'members', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid newsletter reconciliation checkpoint' using errcode = '22023';
  end if;

  for v_member in
    select value from jsonb_array_elements(coalesce(p_request -> 'members', '[]'::jsonb)) value
  loop
    begin
      v_provider_contact_id := v_member ->> 'providerContactId';
      v_subscription_id := nullif(v_member ->> 'subscriptionId', '')::uuid;
      v_contact_generation := nullif(v_member ->> 'contactGeneration', '')::integer;
      v_disposition := v_member ->> 'disposition';
      v_action_state := v_member ->> 'actionState';
    exception when others then
      raise exception 'invalid newsletter reconciliation member' using errcode = '22023';
    end;
    if char_length(v_provider_contact_id) not between 1 and 200
      or v_disposition not in (
        'eligible', 'provider_only', 'locally_ineligible', 'globally_unsubscribed',
        'suppressed', 'wrong_topic', 'missing_segment', 'removed', 'blocked'
      )
      or v_action_state not in ('none', 'pending', 'completed', 'failed')
    then
      raise exception 'invalid newsletter reconciliation member' using errcode = '22023';
    end if;
    insert into public.builder_newsletter_reconciliation_members (
      site_id, run_id, provider_contact_id, subscription_id, contact_generation,
      seen_provider, seen_local, eligible, disposition, action_state
    ) values (
      v_site_id, v_run_id, v_provider_contact_id, v_subscription_id, v_contact_generation,
      coalesce((v_member ->> 'seenProvider')::boolean, false),
      coalesce((v_member ->> 'seenLocal')::boolean, false),
      coalesce((v_member ->> 'eligible')::boolean, false),
      v_disposition, v_action_state
    )
    on conflict (site_id, run_id, provider_contact_id) do update
    set subscription_id = coalesce(excluded.subscription_id, public.builder_newsletter_reconciliation_members.subscription_id),
        contact_generation = coalesce(excluded.contact_generation, public.builder_newsletter_reconciliation_members.contact_generation),
        seen_provider = public.builder_newsletter_reconciliation_members.seen_provider or excluded.seen_provider,
        seen_local = public.builder_newsletter_reconciliation_members.seen_local or excluded.seen_local,
        eligible = excluded.eligible,
        disposition = excluded.disposition,
        action_state = excluded.action_state,
        updated_at = clock_timestamp();
  end loop;

  update public.builder_newsletter_reconciliation_runs
  set phase = case
        when p_request ->> 'phase' in ('provider_segment', 'local_eligible', 'finalize')
          then p_request ->> 'phase'
        else phase
      end,
      provider_after_cursor = case
        when p_request ? 'providerAfterCursor' then nullif(p_request ->> 'providerAfterCursor', '')
        else provider_after_cursor
      end,
      provider_complete = coalesce((p_request ->> 'providerComplete')::boolean, provider_complete),
      local_after_id = case
        when nullif(p_request ->> 'localAfterId', '') is not null then (p_request ->> 'localAfterId')::uuid
        else local_after_id
      end,
      local_complete = coalesce((p_request ->> 'localComplete')::boolean, local_complete),
      provider_page_count = provider_page_count + coalesce((p_request ->> 'providerPages')::integer, 0),
      local_page_count = local_page_count + coalesce((p_request ->> 'localPages')::integer, 0),
      last_checkpoint_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where site_id = v_site_id and id = v_run_id and job_id = v_job_id and state = 'running'
    and expected_eligibility_epoch = v_expected_epoch
    and exists (
      select 1 from public.builder_newsletter_site_jobs job
      where job.site_id = v_site_id and job.id = v_job_id and job.state = 'leased'
        and job.lease_owner = v_worker_id and job.lease_fencing_token = v_fencing
        and job.lease_expires_at > clock_timestamp()
    );
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;

  update public.builder_newsletter_site_jobs
  set state = case when v_more_work then 'queued' else state end,
      available_at = case when v_more_work then clock_timestamp() else available_at end,
      lease_owner = case when v_more_work then null else lease_owner end,
      lease_expires_at = case when v_more_work then null else lease_expires_at end,
      consecutive_failure_count = 0,
      last_checkpoint_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where site_id = v_site_id and id = v_job_id and state = 'leased'
    and lease_owner = v_worker_id and lease_fencing_token = v_fencing
    and lease_expires_at > clock_timestamp();
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;

  return jsonb_build_object('version', 1, 'status', case when v_more_work then 'queued' else 'checkpointed' end);
end;
$$;

create function public.builder_finalize_newsletter_reconciliation_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_job_id uuid;
  v_run_id uuid;
  v_worker_id uuid;
  v_fencing bigint;
  v_expected_epoch bigint;
  v_audience_count integer;
  v_digest text;
  v_epoch bigint;
  v_revision integer;
  v_readiness_id uuid;
  v_started_at timestamptz;
  v_changed integer;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_job_id := (p_request ->> 'jobId')::uuid;
    v_run_id := (p_request ->> 'runId')::uuid;
    v_worker_id := (p_request ->> 'workerId')::uuid;
    v_fencing := (p_request ->> 'fencingToken')::bigint;
    v_expected_epoch := (p_request ->> 'expectedEligibilityEpoch')::bigint;
  exception when others then
    raise exception 'invalid newsletter reconciliation finalization' using errcode = '22023';
  end;

  select epoch.epoch into v_epoch
  from public.builder_newsletter_eligibility_epochs epoch
  where epoch.site_id = v_site_id
  for update;

  select run.started_at into v_started_at
  from public.builder_newsletter_reconciliation_runs run
  where run.site_id = v_site_id and run.id = v_run_id and run.job_id = v_job_id
    and run.state = 'running' and run.provider_complete and run.local_complete
    and run.expected_eligibility_epoch = v_expected_epoch
  for update;

  if not found then
    raise exception 'newsletter reconciliation is incomplete' using errcode = '55000';
  end if;

  if v_epoch is distinct from v_expected_epoch then
    delete from public.builder_newsletter_reconciliation_members
    where site_id = v_site_id and run_id = v_run_id;
    update public.builder_newsletter_reconciliation_runs
    set state = 'superseded', completed_at = clock_timestamp(), updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_run_id;
    update public.builder_newsletter_site_jobs
    set state = 'queued', available_at = clock_timestamp(), lease_owner = null,
        lease_expires_at = null, consecutive_failure_count = 0,
        last_checkpoint_at = clock_timestamp(), updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_job_id and state = 'leased'
      and lease_owner = v_worker_id and lease_fencing_token = v_fencing
      and lease_expires_at > clock_timestamp();
    get diagnostics v_changed = row_count;
    if v_changed <> 1 then
      raise exception 'newsletter job lease lost' using errcode = '55000';
    end if;
    return jsonb_build_object('version', 1, 'status', 'restarted');
  end if;

  if not exists (
    select 1 from public.builder_newsletter_site_jobs job
    where job.site_id = v_site_id and job.id = v_job_id and job.state = 'leased'
      and job.lease_owner = v_worker_id and job.lease_fencing_token = v_fencing
      and job.lease_expires_at > clock_timestamp()
  ) then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.builder_newsletter_reconciliation_members member
    where member.site_id = v_site_id and member.run_id = v_run_id
      and (
        member.disposition in ('unresolved', 'blocked')
        or member.action_state in ('pending', 'failed')
        or (not member.eligible and not (
          member.disposition = 'removed' and member.action_state = 'completed'
        ))
      )
  ) then
    raise exception 'newsletter audience is not ready' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.builder_newsletter_subscriptions subscription
    left join public.builder_newsletter_reconciliation_members member
      on member.site_id = subscription.site_id
      and member.run_id = v_run_id
      and member.subscription_id = subscription.id
      and member.provider_contact_id = subscription.provider_contact_id
    where subscription.site_id = v_site_id and subscription.status = 'active'
      and (
        subscription.provider_contact_id is null
        or member.provider_contact_id is null
        or not member.seen_provider
        or not member.seen_local
        or not member.eligible
        or member.disposition <> 'eligible'
      )
  ) then
    raise exception 'newsletter audience is not ready' using errcode = '55000';
  end if;

  select count(*)::integer,
         encode(extensions.digest(coalesce(string_agg(subscription.id::text, E'\n' order by subscription.id), ''), 'sha256'), 'hex')
  into v_audience_count, v_digest
  from public.builder_newsletter_subscriptions subscription
  where subscription.site_id = v_site_id and subscription.status = 'active';

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 199));
  select coalesce(max(readiness.revision), 0) + 1 into v_revision
  from public.builder_newsletter_readiness_revisions readiness
  where readiness.site_id = v_site_id;

  insert into public.builder_newsletter_readiness_revisions (
    site_id, revision, provider_scope_id, audience_count, eligibility_digest,
    reconciled_at, expires_at, state
  ) values (
    v_site_id, v_revision, 'resend-team-production', v_audience_count, v_digest,
    clock_timestamp(), clock_timestamp() + interval '30 minutes', 'ready'
  ) returning id into v_readiness_id;

  update public.builder_newsletter_reconciliation_runs
  set state = 'ready', phase = 'completed', audience_count = v_audience_count,
      eligibility_digest = v_digest, safe_result_code = 'audience_ready',
      completed_at = clock_timestamp(), member_retain_until = null,
      updated_at = clock_timestamp()
  where site_id = v_site_id and id = v_run_id;

  update public.builder_newsletter_reconciliation_requests
  set state = 'completed', run_id = v_run_id, readiness_revision_id = v_readiness_id,
      safe_result_code = 'audience_ready', updated_at = clock_timestamp()
  where site_id = v_site_id and state = 'pending' and requested_at <= v_started_at;

  delete from public.builder_newsletter_reconciliation_members
  where site_id = v_site_id and run_id = v_run_id;

  update public.builder_newsletter_site_jobs
  set state = 'completed', safe_result_code = 'audience_ready',
      lease_owner = null, lease_expires_at = null, consecutive_failure_count = 0,
      last_checkpoint_at = clock_timestamp(), updated_at = clock_timestamp()
  where site_id = v_site_id and id = v_job_id and state = 'leased'
    and lease_owner = v_worker_id and lease_fencing_token = v_fencing
    and lease_expires_at > clock_timestamp();
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.builder_newsletter_reconciliation_requests request
    where request.site_id = v_site_id and request.state = 'pending'
  ) then
    insert into public.builder_newsletter_site_jobs (
      site_id, provider_scope_id, kind, state, available_at, last_checkpoint_at
    ) values (
      v_site_id, 'resend-team-production', 'newsletter.segment.reconcile',
      'queued', clock_timestamp(), clock_timestamp()
    );
  end if;

  return jsonb_build_object(
    'version', 1, 'status', 'ready',
    'readinessRevisionId', v_readiness_id,
    'audienceCount', v_audience_count
  );
end;
$$;

create function public.builder_abandon_newsletter_reconciliations_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_job record;
  v_count integer := 0;
  v_revision integer;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
  exception when others then
    raise exception 'invalid newsletter abandonment request' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1' then
    raise exception 'invalid newsletter abandonment request' using errcode = '22023';
  end if;

  for v_job in
    select job.id
    from public.builder_newsletter_site_jobs job
    where job.site_id = v_site_id
      and job.kind = 'newsletter.segment.reconcile'
      and coalesce(job.last_checkpoint_at, job.updated_at) <= clock_timestamp() - interval '48 hours'
      and (
        job.state in ('queued', 'retryable_failed')
        or (job.state = 'leased' and job.lease_expires_at <= clock_timestamp())
      )
    for update skip locked
  loop
    update public.builder_newsletter_site_jobs
    set state = 'terminal_failed', safe_failure_code = 'worker_abandoned',
        lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_job.id;

    update public.builder_newsletter_reconciliation_runs
    set state = 'abandoned', safe_failure_code = 'worker_abandoned',
        completed_at = clock_timestamp(), member_retain_until = clock_timestamp() + interval '7 days',
        updated_at = clock_timestamp()
    where site_id = v_site_id and job_id = v_job.id and state = 'running';

    insert into public.builder_newsletter_reconciliation_circuits (
      site_id, provider_scope_id, state, safe_failure_code,
      exhausted_job_id, opened_at, updated_at
    ) values (
      v_site_id, 'resend-team-production', 'open', 'worker_abandoned',
      v_job.id, clock_timestamp(), clock_timestamp()
    )
    on conflict (site_id, provider_scope_id) do update
    set state = 'open', safe_failure_code = excluded.safe_failure_code,
        exhausted_job_id = excluded.exhausted_job_id, opened_at = excluded.opened_at,
        recovered_at = null, recovery_operator_id = null, recovery_reason = null,
        updated_at = clock_timestamp();

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 199));
    select coalesce(max(readiness.revision), 0) + 1 into v_revision
    from public.builder_newsletter_readiness_revisions readiness
    where readiness.site_id = v_site_id;

    insert into public.builder_newsletter_readiness_revisions (
      site_id, revision, provider_scope_id, audience_count, eligibility_digest,
      reconciled_at, expires_at, state
    ) values (
      v_site_id, v_revision, 'resend-team-production', 0,
      encode(extensions.digest('blocked:' || v_job.id::text, 'sha256'), 'hex'),
      clock_timestamp(), clock_timestamp() + interval '30 minutes', 'blocked'
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('version', 1, 'status', 'complete', 'abandonedCount', v_count);
end;
$$;

create function public.builder_purge_newsletter_reconciliation_members_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_count integer;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
  exception when others then
    raise exception 'invalid newsletter evidence purge' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1' then
    raise exception 'invalid newsletter evidence purge' using errcode = '22023';
  end if;

  delete from public.builder_newsletter_reconciliation_members member
  using public.builder_newsletter_reconciliation_runs run
  where member.site_id = v_site_id
    and run.site_id = member.site_id and run.id = member.run_id
    and run.state in ('terminal_failed', 'abandoned')
    and run.member_retain_until <= clock_timestamp();
  get diagnostics v_count = row_count;
  return jsonb_build_object('version', 1, 'status', 'complete', 'purgedCount', v_count);
end;
$$;

create function public.builder_recover_newsletter_reconciliation_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_operator_id uuid;
  v_reason text;
  v_job_id uuid;
  v_changed integer;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_operator_id := (p_request ->> 'operatorId')::uuid;
    v_reason := btrim(p_request ->> 'reason');
  exception when others then
    raise exception 'invalid newsletter recovery' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1' or char_length(v_reason) not between 1 and 500 then
    raise exception 'invalid newsletter recovery' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 196));
  update public.builder_newsletter_reconciliation_circuits
  set state = 'closed', recovered_at = clock_timestamp(),
      recovery_operator_id = v_operator_id, recovery_reason = v_reason,
      opened_at = null, updated_at = clock_timestamp()
  where site_id = v_site_id and provider_scope_id = 'resend-team-production' and state = 'open';
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'newsletter reconciliation circuit is not open' using errcode = '55000';
  end if;

  insert into public.builder_newsletter_site_jobs (
    site_id, provider_scope_id, kind, state, available_at, last_checkpoint_at
  ) values (
    v_site_id, 'resend-team-production', 'newsletter.segment.reconcile',
    'queued', clock_timestamp(), clock_timestamp()
  ) returning id into v_job_id;

  return jsonb_build_object('version', 1, 'status', 'queued', 'jobId', v_job_id);
end;
$$;

create function public.builder_record_newsletter_provider_activation_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_operator_id uuid;
  v_digest text;
  v_revision integer;
  v_id uuid;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_operator_id := (p_request ->> 'operatorId')::uuid;
    v_digest := p_request ->> 'resourceIdentityDigest';
  exception when others then
    raise exception 'invalid newsletter provider activation' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1' or v_digest !~ '^[a-f0-9]{64}$'
    or coalesce((p_request ->> 'providerContactCount')::integer, -1) <> 0
    or coalesce((p_request ->> 'localEligibleCount')::integer, -1) <> 0
    or coalesce((p_request ->> 'historicalSendCount')::integer, -1) <> 0
  then
    raise exception 'invalid newsletter provider activation' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 197));
  update public.builder_newsletter_provider_activation_revisions
  set state = 'superseded'
  where site_id = v_site_id and provider_scope_id = 'resend-team-production' and state = 'active';
  select coalesce(max(activation.revision), 0) + 1 into v_revision
  from public.builder_newsletter_provider_activation_revisions activation
  where activation.site_id = v_site_id;
  insert into public.builder_newsletter_provider_activation_revisions (
    site_id, revision, provider_scope_id, resource_identity_digest,
    provider_contact_count, local_eligible_count, historical_send_count, recorded_by
  ) values (
    v_site_id, v_revision, 'resend-team-production', v_digest, 0, 0, 0, v_operator_id
  ) returning id into v_id;
  return jsonb_build_object('version', 1, 'status', 'active', 'activationRevisionId', v_id);
end;
$$;

create function public.builder_record_newsletter_inventory_attestation_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_operator_id uuid;
  v_digest text;
  v_categories text[];
  v_id uuid;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_operator_id := (p_request ->> 'operatorId')::uuid;
    v_digest := p_request ->> 'safeEvidenceDigest';
    select array_agg(value order by value) into v_categories
    from jsonb_array_elements_text(p_request -> 'categories') value;
  exception when others then
    raise exception 'invalid newsletter inventory attestation' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1'
    or (p_request ->> 'policyVersion') <> 'resend-district-newsletter-v1'
    or v_digest !~ '^[a-f0-9]{64}$'
    or cardinality(v_categories) not between 1 and 20
  then
    raise exception 'invalid newsletter inventory attestation' using errcode = '22023';
  end if;

  insert into public.builder_newsletter_provider_inventory_attestations (
    site_id, policy_version, operator_id, categories, safe_evidence_digest,
    attested_at, expires_at
  ) values (
    v_site_id, 'resend-district-newsletter-v1', v_operator_id, v_categories,
    v_digest, clock_timestamp(), clock_timestamp() + interval '30 days'
  ) returning id into v_id;
  return jsonb_build_object('version', 1, 'status', 'recorded', 'attestationId', v_id);
end;
$$;

create or replace function public.builder_get_newsletter_public_readiness_v1(p_site_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'ready',
      exists (
        select 1
        from public.builder_newsletter_provider_activation_revisions activation
        where activation.site_id = p_site_id and activation.state = 'active'
      )
      and coalesce((
        select readiness.state = 'ready' and readiness.expires_at > clock_timestamp()
        from public.builder_newsletter_readiness_revisions readiness
        where readiness.site_id = p_site_id
        order by readiness.revision desc
        limit 1
      ), false)
  );
$$;

create or replace function public.builder_claim_newsletter_jobs_v1(p_request jsonb)
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
  v_email_enabled boolean;
  v_jobs jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_row record;
  v_claimed jsonb;
  v_run_id uuid;
  v_epoch bigint;
  v_failure_count integer;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_worker_id := (p_request ->> 'workerId')::uuid;
    v_limit := (p_request ->> 'limit')::integer;
    v_lease_seconds := (p_request ->> 'leaseSeconds')::integer;
    v_email_enabled := (p_request ->> 'emailEnabled')::boolean;
  exception when others then
    raise exception 'invalid newsletter job claim' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1'
    or v_limit not between 1 and 100
    or v_lease_seconds not between 15 and 900
  then
    raise exception 'invalid newsletter job claim' using errcode = '22023';
  end if;

  if not v_email_enabled then
    for v_row in
      select job.id
      from public.builder_newsletter_site_jobs job
      where job.site_id = v_site_id
        and job.kind = 'newsletter.contact.audit'
        and job.state in ('queued', 'retryable_failed')
        and job.available_at <= clock_timestamp()
      order by job.created_at, job.id
      for update skip locked
      limit v_limit
    loop
      update public.builder_newsletter_site_jobs
      set state = 'leased', lease_owner = v_worker_id,
          lease_fencing_token = lease_fencing_token + 1,
          lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
          attempt_count = attempt_count + 1, invocation_count = invocation_count + 1,
          updated_at = clock_timestamp()
      where site_id = v_site_id and id = v_row.id
      returning jsonb_build_object(
        'subject', 'site', 'id', id, 'kind', kind,
        'fencingToken', lease_fencing_token, 'leaseExpiresAt', lease_expires_at
      ) into v_claimed;
      v_jobs := v_jobs || jsonb_build_array(v_claimed);
      v_count := v_count + 1;
    end loop;

    if v_count < v_limit then
      for v_row in
        select job.id
        from public.builder_newsletter_broadcast_audit_jobs job
        where job.site_id = v_site_id
          and job.state in ('queued', 'retryable_failed')
          and job.available_at <= clock_timestamp()
        order by job.created_at, job.id
        for update skip locked
        limit (v_limit - v_count)
      loop
        update public.builder_newsletter_broadcast_audit_jobs
        set state = 'leased', lease_owner = v_worker_id,
            lease_fencing_token = lease_fencing_token + 1,
            lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
            attempt_count = attempt_count + 1,
            sweep_started_at = coalesce(sweep_started_at, clock_timestamp()),
            updated_at = clock_timestamp()
        where site_id = v_site_id and id = v_row.id
        returning jsonb_build_object(
          'subject', 'broadcast', 'id', id, 'kind', kind,
          'fencingToken', lease_fencing_token, 'leaseExpiresAt', lease_expires_at,
          'afterCursor', after_cursor
        ) into v_claimed;
        v_jobs := v_jobs || jsonb_build_array(v_claimed);
        v_count := v_count + 1;
      end loop;
    end if;
  else
    for v_row in
      select job.id
      from public.builder_newsletter_jobs job
      where job.site_id = v_site_id
        and job.state in ('queued', 'retryable_failed')
        and job.available_at <= clock_timestamp()
      order by job.created_at, job.id
      for update skip locked
      limit v_limit
    loop
      update public.builder_newsletter_jobs
      set state = 'leased', lease_owner = v_worker_id,
          lease_fencing_token = lease_fencing_token + 1,
          lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
          attempt_count = attempt_count + 1, updated_at = clock_timestamp()
      where site_id = v_site_id and id = v_row.id
      returning jsonb_build_object(
        'subject', 'subscription', 'id', id, 'kind', kind,
        'subscriptionId', subscription_id,
        'confirmationGeneration', confirmation_generation,
        'deliveryOrdinal', delivery_ordinal,
        'fencingToken', lease_fencing_token, 'leaseExpiresAt', lease_expires_at
      ) into v_claimed;
      v_jobs := v_jobs || jsonb_build_array(v_claimed);
      v_count := v_count + 1;
    end loop;

    if v_count < v_limit then
      for v_row in
        select job.id, job.state, job.consecutive_failure_count,
               job.lease_expires_at
        from public.builder_newsletter_site_jobs job
        where job.site_id = v_site_id
          and job.kind = 'newsletter.segment.reconcile'
          and (
            (job.state in ('queued', 'retryable_failed') and job.available_at <= clock_timestamp())
            or (job.state = 'leased' and job.lease_expires_at <= clock_timestamp())
          )
          and not exists (
            select 1
            from public.builder_newsletter_reconciliation_circuits circuit
            where circuit.site_id = job.site_id
              and circuit.provider_scope_id = job.provider_scope_id
              and circuit.state = 'open'
          )
        order by job.created_at, job.id
        for update skip locked
        limit (v_limit - v_count)
      loop
        v_failure_count := v_row.consecutive_failure_count
          + case when v_row.state = 'leased' then 1 else 0 end;

        if v_failure_count >= 8 then
          update public.builder_newsletter_site_jobs
          set state = 'terminal_failed', consecutive_failure_count = 8,
              safe_failure_code = 'worker_abandoned',
              lease_owner = null, lease_expires_at = null,
              updated_at = clock_timestamp()
          where site_id = v_site_id and id = v_row.id;

          update public.builder_newsletter_reconciliation_runs
          set state = 'terminal_failed', safe_failure_code = 'worker_abandoned',
              completed_at = clock_timestamp(),
              member_retain_until = clock_timestamp() + interval '7 days',
              updated_at = clock_timestamp()
          where site_id = v_site_id and job_id = v_row.id and state = 'running';

          insert into public.builder_newsletter_reconciliation_circuits (
            site_id, provider_scope_id, state, safe_failure_code,
            exhausted_job_id, opened_at, updated_at
          ) values (
            v_site_id, 'resend-team-production', 'open', 'worker_abandoned',
            v_row.id, clock_timestamp(), clock_timestamp()
          )
          on conflict (site_id, provider_scope_id) do update
          set state = 'open', safe_failure_code = excluded.safe_failure_code,
              exhausted_job_id = excluded.exhausted_job_id,
              opened_at = excluded.opened_at, recovered_at = null,
              recovery_operator_id = null, recovery_reason = null,
              updated_at = clock_timestamp();
          continue;
        end if;

        insert into public.builder_newsletter_eligibility_epochs (site_id)
        values (v_site_id)
        on conflict (site_id) do nothing;
        select epoch.epoch into v_epoch
        from public.builder_newsletter_eligibility_epochs epoch
        where epoch.site_id = v_site_id;

        select run.id into v_run_id
        from public.builder_newsletter_reconciliation_runs run
        where run.site_id = v_site_id and run.job_id = v_row.id and run.state = 'running'
        order by run.started_at desc
        limit 1;

        if v_run_id is null then
          insert into public.builder_newsletter_reconciliation_runs (
            site_id, job_id, provider_scope_id, expected_eligibility_epoch
          ) values (
            v_site_id, v_row.id, 'resend-team-production', v_epoch
          ) returning id into v_run_id;
        end if;

        update public.builder_newsletter_reconciliation_requests
        set job_id = v_row.id, updated_at = clock_timestamp()
        where site_id = v_site_id and state = 'pending' and job_id is null;

        update public.builder_newsletter_site_jobs
        set state = 'leased', lease_owner = v_worker_id,
            lease_fencing_token = lease_fencing_token + 1,
            lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
            attempt_count = attempt_count + 1,
            invocation_count = invocation_count + 1,
            consecutive_failure_count = v_failure_count,
            updated_at = clock_timestamp()
        where site_id = v_site_id and id = v_row.id
        returning jsonb_build_object(
          'subject', 'site', 'id', id, 'kind', kind,
          'fencingToken', lease_fencing_token, 'leaseExpiresAt', lease_expires_at
        ) into v_claimed;

        select v_claimed || jsonb_build_object(
          'runId', run.id,
          'phase', run.phase,
          'expectedEligibilityEpoch', run.expected_eligibility_epoch,
          'providerAfterCursor', run.provider_after_cursor,
          'providerComplete', run.provider_complete,
          'localAfterId', run.local_after_id,
          'localComplete', run.local_complete
        ) into v_claimed
        from public.builder_newsletter_reconciliation_runs run
        where run.site_id = v_site_id and run.id = v_run_id;

        v_jobs := v_jobs || jsonb_build_array(v_claimed);
        v_count := v_count + 1;
      end loop;
    end if;
  end if;

  return jsonb_build_object('version', 1, 'jobs', v_jobs);
end;
$$;

create or replace function public.builder_fail_newsletter_job_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_job_id uuid;
  v_worker_id uuid;
  v_fencing bigint;
  v_terminal_requested boolean;
  v_state text;
  v_available_at timestamptz;
  v_changed integer;
  v_kind text;
  v_failure_count integer;
  v_revision integer;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_job_id := (p_request ->> 'jobId')::uuid;
    v_worker_id := (p_request ->> 'workerId')::uuid;
    v_fencing := (p_request ->> 'fencingToken')::bigint;
    v_terminal_requested := (p_request ->> 'terminal')::boolean;
    v_available_at := case
      when v_terminal_requested then clock_timestamp()
      else (p_request ->> 'retryAt')::timestamptz
    end;
  exception when others then
    raise exception 'invalid newsletter job failure' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1'
    or (p_request ->> 'failureCode') !~ '^[a-z][a-z0-9_]{0,63}$'
  then
    raise exception 'invalid newsletter failure code' using errcode = '22023';
  end if;

  if p_request ->> 'subject' = 'subscription' then
    v_state := case when v_terminal_requested then 'terminal_failed' else 'retryable_failed' end;
    update public.builder_newsletter_jobs
    set state = v_state, available_at = v_available_at,
        safe_failure_code = p_request ->> 'failureCode',
        lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_job_id and state = 'leased'
      and lease_owner = v_worker_id and lease_fencing_token = v_fencing
      and lease_expires_at > clock_timestamp();
  elsif p_request ->> 'subject' = 'site' then
    select job.kind, job.consecutive_failure_count
    into v_kind, v_failure_count
    from public.builder_newsletter_site_jobs job
    where job.site_id = v_site_id and job.id = v_job_id and job.state = 'leased'
      and job.lease_owner = v_worker_id and job.lease_fencing_token = v_fencing
      and job.lease_expires_at > clock_timestamp()
    for update;

    if not found then
      raise exception 'newsletter job lease lost' using errcode = '55000';
    end if;

    if v_kind = 'newsletter.segment.reconcile' then
      v_failure_count := least(8, v_failure_count + 1);
      v_state := case
        when v_terminal_requested or v_failure_count >= 8 then 'terminal_failed'
        else 'retryable_failed'
      end;
      update public.builder_newsletter_site_jobs
      set state = v_state, available_at = v_available_at,
          consecutive_failure_count = v_failure_count,
          safe_failure_code = p_request ->> 'failureCode',
          lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
      where site_id = v_site_id and id = v_job_id and state = 'leased'
        and lease_owner = v_worker_id and lease_fencing_token = v_fencing
        and lease_expires_at > clock_timestamp();

      if v_state = 'terminal_failed' then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 198));
        update public.builder_newsletter_reconciliation_runs
        set state = 'terminal_failed', safe_failure_code = p_request ->> 'failureCode',
            completed_at = clock_timestamp(),
            member_retain_until = clock_timestamp() + interval '7 days',
            updated_at = clock_timestamp()
        where site_id = v_site_id and job_id = v_job_id and state = 'running';

        insert into public.builder_newsletter_reconciliation_circuits (
          site_id, provider_scope_id, state, safe_failure_code,
          exhausted_job_id, opened_at, updated_at
        ) values (
          v_site_id, 'resend-team-production', 'open', p_request ->> 'failureCode',
          v_job_id, clock_timestamp(), clock_timestamp()
        )
        on conflict (site_id, provider_scope_id) do update
        set state = 'open', safe_failure_code = excluded.safe_failure_code,
            exhausted_job_id = excluded.exhausted_job_id,
            opened_at = excluded.opened_at, recovered_at = null,
            recovery_operator_id = null, recovery_reason = null,
            updated_at = clock_timestamp();

        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_site_id::text, 199));
        select coalesce(max(readiness.revision), 0) + 1 into v_revision
        from public.builder_newsletter_readiness_revisions readiness
        where readiness.site_id = v_site_id;
        insert into public.builder_newsletter_readiness_revisions (
          site_id, revision, provider_scope_id, audience_count, eligibility_digest,
          reconciled_at, expires_at, state
        ) values (
          v_site_id, v_revision, 'resend-team-production', 0,
          encode(extensions.digest('blocked:' || v_job_id::text, 'sha256'), 'hex'),
          clock_timestamp(), clock_timestamp() + interval '30 minutes', 'blocked'
        );
      end if;
    else
      v_state := case when v_terminal_requested then 'terminal_failed' else 'retryable_failed' end;
      update public.builder_newsletter_site_jobs
      set state = v_state, available_at = v_available_at,
          safe_failure_code = p_request ->> 'failureCode',
          lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
      where site_id = v_site_id and id = v_job_id and state = 'leased'
        and lease_owner = v_worker_id and lease_fencing_token = v_fencing
        and lease_expires_at > clock_timestamp();
    end if;
  elsif p_request ->> 'subject' = 'broadcast' then
    v_state := case when v_terminal_requested then 'terminal_failed' else 'retryable_failed' end;
    update public.builder_newsletter_broadcast_audit_jobs
    set state = v_state, available_at = v_available_at,
        safe_failure_code = p_request ->> 'failureCode',
        lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_job_id and state = 'leased'
      and lease_owner = v_worker_id and lease_fencing_token = v_fencing
      and lease_expires_at > clock_timestamp();
  else
    raise exception 'invalid newsletter job subject' using errcode = '22023';
  end if;

  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;
  return jsonb_build_object('version', 1, 'state', v_state);
end;
$$;

revoke all on function
  public.builder_schedule_newsletter_reconciliation_v1(jsonb),
  public.builder_request_newsletter_reconciliation_v1(jsonb),
  public.builder_checkpoint_newsletter_reconciliation_v1(jsonb),
  public.builder_finalize_newsletter_reconciliation_v1(jsonb),
  public.builder_abandon_newsletter_reconciliations_v1(jsonb),
  public.builder_purge_newsletter_reconciliation_members_v1(jsonb),
  public.builder_recover_newsletter_reconciliation_v1(jsonb),
  public.builder_record_newsletter_provider_activation_v1(jsonb),
  public.builder_record_newsletter_inventory_attestation_v1(jsonb)
from public, anon, authenticated;

grant execute on function
  public.builder_schedule_newsletter_reconciliation_v1(jsonb),
  public.builder_request_newsletter_reconciliation_v1(jsonb),
  public.builder_checkpoint_newsletter_reconciliation_v1(jsonb),
  public.builder_finalize_newsletter_reconciliation_v1(jsonb),
  public.builder_abandon_newsletter_reconciliations_v1(jsonb),
  public.builder_purge_newsletter_reconciliation_members_v1(jsonb),
  public.builder_recover_newsletter_reconciliation_v1(jsonb),
  public.builder_record_newsletter_provider_activation_v1(jsonb),
  public.builder_record_newsletter_inventory_attestation_v1(jsonb)
to service_role;
