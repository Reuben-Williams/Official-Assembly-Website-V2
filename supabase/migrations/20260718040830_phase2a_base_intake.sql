create function builder_private.reject_append_only_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

revoke all on function builder_private.reject_append_only_change() from public, anon, authenticated;

create table public.builder_form_submissions (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  form_id text not null check (form_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 32768),
  source text not null check (source in ('public_form', 'phone', 'walk_in', 'staff_entry', 'import')),
  zip_code text check (zip_code is null or zip_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  locale text check (locale is null or locale ~ '^[A-Za-z]{2}(-[A-Za-z0-9]{2,8})?$'),
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key)
);

create table public.builder_form_submission_consents (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  submission_id uuid not null,
  policy_version text not null check (policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  purpose text not null check (purpose ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  language_digest text not null check (language_digest ~ '^[a-f0-9]{64}$'),
  source text not null check (source in ('public_form', 'phone', 'walk_in', 'staff_entry', 'import')),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, submission_id)
    references public.builder_form_submissions(site_id, id) on delete restrict,
  unique (site_id, submission_id, purpose, policy_version)
);

create table public.builder_form_submission_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  submission_id uuid not null,
  event_kind text not null check (event_kind in ('spam', 'restored', 'reviewed', 'corrected')),
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8192),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, submission_id)
    references public.builder_form_submissions(site_id, id) on delete restrict,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_form_submission_results (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  submission_id uuid not null,
  version integer not null check (version > 0),
  prior_result_id uuid,
  result_code text not null check (result_code in ('base_only', 'enhanced', 'review_required', 'identity_conflict', 'spam')),
  contact_id uuid,
  lead_id uuid,
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata) = 'object' and octet_length(safe_metadata::text) <= 8192),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, submission_id)
    references public.builder_form_submissions(site_id, id) on delete restrict,
  foreign key (site_id, prior_result_id)
    references public.builder_form_submission_results(site_id, id) on delete restrict,
  unique (site_id, submission_id, version),
  check ((result_code = 'identity_conflict' and contact_id is null and lead_id is null) or result_code <> 'identity_conflict'),
  check ((version = 1 and prior_result_id is null) or (version > 1 and prior_result_id is not null))
);

create function builder_private.validate_submission_result_history()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.version = 1 then return new; end if;
  if not exists (
    select 1
    from public.builder_form_submission_results prior
    where prior.site_id = new.site_id
      and prior.id = new.prior_result_id
      and prior.submission_id = new.submission_id
      and prior.version = new.version - 1
  ) then
    raise exception 'result history must be contiguous' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function builder_private.validate_submission_result_history() from public, anon, authenticated;
create trigger builder_form_submission_results_contiguous
before insert on public.builder_form_submission_results
for each row execute function builder_private.validate_submission_result_history();

create table public.builder_member_invitations (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  canonical_email_digest text not null check (canonical_email_digest ~ '^[a-f0-9]{64}$'),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  template_id text not null check (template_id ~ '^growth_[a-z0-9_]+$'),
  template_version integer not null check (template_version > 0),
  invited_by uuid not null,
  state text not null default 'pending' check (state in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  accepted_by uuid,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (token_hash),
  foreign key (site_id, invited_by) references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, accepted_by) references public.builder_site_members(site_id, user_id) on delete restrict,
  check ((state = 'accepted') = (accepted_by is not null and accepted_at is not null)),
  check ((state = 'revoked') = (revoked_at is not null))
);

create table public.builder_health_checks (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  check_kind text not null check (check_kind ~ '^[a-z][a-z0-9._-]{0,63}$'),
  status text not null check (status in ('healthy', 'degraded', 'failed')),
  observed_version text,
  queue_age_seconds integer check (queue_age_seconds is null or queue_age_seconds >= 0),
  snapshot_age_seconds integer check (snapshot_age_seconds is null or snapshot_age_seconds >= 0),
  safe_code text check (safe_code is null or safe_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id)
);

create table builder_private.builder_ingestion_receipts (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  safe_result_code text not null check (safe_result_code in ('enhanced', 'enhancement_unavailable', 'identity_conflict', 'review_suggested', 'spam')),
  entitlement_decision text not null check (entitlement_decision in ('base_only', 'enhanced', 'review')),
  submission_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, submission_id) references public.builder_form_submissions(site_id, id) on delete restrict
);

create table builder_private.builder_rate_limit_buckets (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  bucket_key_hmac text not null check (bucket_key_hmac ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  window_ends_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (site_id, bucket_key_hmac, window_started_at),
  check (window_ends_at > window_started_at)
);

create table builder_private.builder_verified_entitlement_snapshots (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  installation_id uuid not null,
  sequence bigint not null check (sequence > 0),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  outage_window_ends_at timestamptz not null,
  has_prior_valid_snapshot boolean not null,
  verified_at timestamptz not null default clock_timestamp(),
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  contract_version integer not null check (contract_version > 0),
  unique (site_id, sequence),
  unique (site_id, sequence, id),
  check (issued_at < expires_at and outage_window_ends_at >= expires_at)
);

create table builder_private.builder_verified_entitlement_snapshot_modules (
  snapshot_id uuid not null,
  site_id uuid not null,
  sequence bigint not null,
  module_id text not null check (module_id in (
    'core.website', 'growth.dashboard', 'growth.leads', 'growth.customers', 'growth.messaging',
    'growth.automations', 'growth.reviews', 'growth.projects', 'growth.ai', 'growth.chat'
  )),
  module_version text not null check (module_version ~ '^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$'),
  state text not null check (state in (
    'available', 'requested', 'request_withdrawn', 'trialing', 'trial_expired',
    'provisioning', 'provisioning_error', 'setup_required', 'active',
    'payment_attention', 'grace_period', 'suspended', 'offboarding',
    'termination_failed', 'terminated'
  )),
  setup_complete boolean not null,
  grace_ends_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, module_id),
  foreign key (site_id, sequence, snapshot_id)
    references builder_private.builder_verified_entitlement_snapshots(site_id, sequence, id) on delete cascade,
  check (state = 'grace_period' or grace_ends_at is null)
);

create table builder_private.builder_verified_entitlement_incident_overrides (
  snapshot_id uuid not null,
  site_id uuid not null,
  sequence bigint not null,
  id uuid not null default gen_random_uuid(),
  module_id text,
  mode text not null check (mode in ('blocked', 'read_only')),
  reason_code text not null check (reason_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, id),
  foreign key (site_id, sequence, snapshot_id)
    references builder_private.builder_verified_entitlement_snapshots(site_id, sequence, id) on delete cascade,
  check (module_id is null or module_id in (
    'core.website', 'growth.dashboard', 'growth.leads', 'growth.customers', 'growth.messaging',
    'growth.automations', 'growth.reviews', 'growth.projects', 'growth.ai', 'growth.chat'
  )),
  check (ends_at > starts_at)
);

create index builder_form_submissions_inbox_idx on public.builder_form_submissions (site_id, received_at desc, id);
create index builder_form_submissions_form_idx on public.builder_form_submissions (site_id, form_id, received_at desc);
create index builder_form_submission_events_idx on public.builder_form_submission_events (site_id, submission_id, created_at);
create index builder_form_submission_results_latest_idx on public.builder_form_submission_results (site_id, submission_id, version desc);
create index builder_member_invitations_expiry_idx on public.builder_member_invitations (site_id, state, expires_at);
create index builder_health_checks_latest_idx on public.builder_health_checks (site_id, check_kind, observed_at desc);
create index builder_ingestion_receipts_expiry_idx on builder_private.builder_ingestion_receipts (site_id, expires_at);
create index builder_rate_limit_buckets_expiry_idx on builder_private.builder_rate_limit_buckets (site_id, window_ends_at);
create index builder_verified_entitlement_latest_idx on builder_private.builder_verified_entitlement_snapshots (site_id, sequence desc);
create index builder_verified_entitlement_module_idx on builder_private.builder_verified_entitlement_snapshot_modules (site_id, module_id, sequence desc);
create index builder_verified_entitlement_override_idx on builder_private.builder_verified_entitlement_incident_overrides (site_id, module_id, sequence desc, starts_at, ends_at);

create trigger builder_form_submissions_append_only
before update or delete on public.builder_form_submissions
for each row execute function builder_private.reject_append_only_change();
create trigger builder_form_submission_consents_append_only
before update or delete on public.builder_form_submission_consents
for each row execute function builder_private.reject_append_only_change();
create trigger builder_form_submission_events_append_only
before update or delete on public.builder_form_submission_events
for each row execute function builder_private.reject_append_only_change();
create trigger builder_form_submission_results_append_only
before update or delete on public.builder_form_submission_results
for each row execute function builder_private.reject_append_only_change();
create trigger builder_verified_entitlement_snapshots_append_only
before update or delete on builder_private.builder_verified_entitlement_snapshots
for each row execute function builder_private.reject_append_only_change();
create trigger builder_verified_entitlement_snapshot_modules_append_only
before update or delete on builder_private.builder_verified_entitlement_snapshot_modules
for each row execute function builder_private.reject_append_only_change();
create trigger builder_verified_entitlement_overrides_append_only
before update or delete on builder_private.builder_verified_entitlement_incident_overrides
for each row execute function builder_private.reject_append_only_change();

create function builder_private.store_verified_entitlement_snapshot_v1(p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_installation_id uuid;
  v_sequence bigint;
  v_issued_at timestamptz;
  v_expires_at timestamptz;
  v_outage_ends_at timestamptz;
  v_prior boolean := false;
  v_digest text;
  v_contract_version integer;
  v_snapshot_id uuid;
  v_latest builder_private.builder_verified_entitlement_snapshots%rowtype;
  v_module jsonb;
  v_override jsonb;
  v_module_id text;
  v_state text;
  v_grace_ends_at timestamptz;
begin
  if jsonb_typeof(p_snapshot) <> 'object' or octet_length(p_snapshot::text) > 65536 then
    raise exception 'invalid verified snapshot payload' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_snapshot ->> 'siteId')::uuid;
    v_installation_id := (p_snapshot ->> 'installationId')::uuid;
    v_sequence := (p_snapshot ->> 'sequence')::bigint;
    v_issued_at := (p_snapshot ->> 'issuedAt')::timestamptz;
    v_expires_at := (p_snapshot ->> 'expiresAt')::timestamptz;
    v_outage_ends_at := v_expires_at + interval '24 hours';
    v_digest := encode(extensions.digest(convert_to(p_snapshot::text, 'UTF8'), 'sha256'), 'hex');
    v_contract_version := (p_snapshot ->> 'version')::integer;
  exception when others then
    raise exception 'invalid verified snapshot payload' using errcode = '22023';
  end;

  if not exists (select 1 from public.builder_sites where id = v_site_id) then
    raise exception 'verified snapshot site is unknown' using errcode = '22023';
  end if;
  if v_sequence <= 0 or v_digest !~ '^[a-f0-9]{64}$' or v_contract_version <= 0
    or v_issued_at >= v_expires_at or v_outage_ends_at < v_expires_at
  then
    raise exception 'invalid verified snapshot metadata' using errcode = '22023';
  end if;
  if v_expires_at <= clock_timestamp() then
    raise exception 'verified snapshot is expired' using errcode = '22023';
  end if;
  if jsonb_typeof(p_snapshot -> 'modules') <> 'object'
    or (select count(*) from jsonb_object_keys(p_snapshot -> 'modules')) <> 10
    or jsonb_typeof(p_snapshot -> 'incidentOverrides') <> 'array'
    or jsonb_array_length(p_snapshot -> 'incidentOverrides') > 100
  then
    raise exception 'verified snapshot module set is incomplete' using errcode = '22023';
  end if;
  if (
    select count(*)
    from jsonb_object_keys(p_snapshot -> 'modules') module_id
    where module_id in (
      'core.website', 'growth.dashboard', 'growth.leads', 'growth.customers', 'growth.messaging',
      'growth.automations', 'growth.reviews', 'growth.projects', 'growth.ai', 'growth.chat'
    )
  ) <> 10 then
    raise exception 'verified snapshot module set is invalid' using errcode = '22023';
  end if;

  select snapshot.* into v_latest
  from builder_private.builder_verified_entitlement_snapshots snapshot
  where snapshot.site_id = v_site_id
  order by snapshot.sequence desc
  limit 1
  for update;

  if found then
    v_prior := true;
    if v_latest.installation_id <> v_installation_id then
      raise exception 'verified snapshot installation mismatch' using errcode = '22023';
    end if;
    if v_sequence < v_latest.sequence then
      raise exception 'verified snapshot sequence is stale' using errcode = '22023';
    end if;
    if v_sequence = v_latest.sequence then
      if v_digest = v_latest.digest then
        return jsonb_build_object(
          'version', 1,
          'status', 'replayed',
          'snapshotId', v_latest.id,
          'siteId', v_latest.site_id,
          'installationId', v_latest.installation_id,
          'sequence', v_latest.sequence,
          'digest', v_latest.digest
        );
      end if;
      raise exception 'verified snapshot sequence conflict' using errcode = '22023';
    end if;
  end if;

  insert into builder_private.builder_verified_entitlement_snapshots (
    site_id, installation_id, sequence, issued_at, expires_at, outage_window_ends_at,
    has_prior_valid_snapshot, digest, contract_version
  ) values (
    v_site_id, v_installation_id, v_sequence, v_issued_at, v_expires_at, v_outage_ends_at,
    v_prior, v_digest, v_contract_version
  ) returning id into v_snapshot_id;

  for v_module_id, v_module in select key, value from jsonb_each(p_snapshot -> 'modules') loop
    v_state := v_module ->> 'state';
    begin
      v_grace_ends_at := case
        when v_module ? 'graceExpiresAt' and jsonb_typeof(v_module -> 'graceExpiresAt') = 'string'
          then (v_module ->> 'graceExpiresAt')::timestamptz
        else null
      end;
    exception when others then
      raise exception 'verified snapshot grace deadline is invalid' using errcode = '22023';
    end;
    if v_module_id not in (
        'core.website', 'growth.dashboard', 'growth.leads', 'growth.customers', 'growth.messaging',
        'growth.automations', 'growth.reviews', 'growth.projects', 'growth.ai', 'growth.chat'
      )
      or (v_module ->> 'moduleVersion') !~ '^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$'
      or v_state not in (
        'available', 'requested', 'request_withdrawn', 'trialing', 'trial_expired',
        'provisioning', 'provisioning_error', 'setup_required', 'active',
        'payment_attention', 'grace_period', 'suspended', 'offboarding',
        'termination_failed', 'terminated'
      )
      or jsonb_typeof(v_module -> 'setupComplete') <> 'boolean'
      or (v_state <> 'grace_period' and v_grace_ends_at is not null)
    then
      raise exception 'verified snapshot module is invalid' using errcode = '22023';
    end if;
    insert into builder_private.builder_verified_entitlement_snapshot_modules (
      snapshot_id, site_id, sequence, module_id, module_version, state, setup_complete, grace_ends_at
    ) values (
      v_snapshot_id, v_site_id, v_sequence, v_module_id, v_module ->> 'moduleVersion', v_state,
      (v_module ->> 'setupComplete')::boolean, v_grace_ends_at
    );
  end loop;

  for v_override in select value from jsonb_array_elements(p_snapshot -> 'incidentOverrides') loop
    if jsonb_typeof(v_override) <> 'object'
      or (v_override ->> 'mode') not in ('blocked', 'read_only')
      or (v_override ->> 'reasonCode') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
      or v_override ->> 'moduleId' not in (
        '*', 'core.website', 'growth.dashboard', 'growth.leads', 'growth.customers',
        'growth.messaging', 'growth.automations', 'growth.reviews', 'growth.projects',
        'growth.ai', 'growth.chat'
      )
    then
      raise exception 'verified snapshot override is invalid' using errcode = '22023';
    end if;
    begin
      insert into builder_private.builder_verified_entitlement_incident_overrides (
        snapshot_id, site_id, sequence, module_id, mode, reason_code, starts_at, ends_at
      ) values (
        v_snapshot_id, v_site_id, v_sequence, nullif(v_override ->> 'moduleId', '*'),
        v_override ->> 'mode', v_override ->> 'reasonCode',
        v_issued_at, v_outage_ends_at
      );
    end;
  end loop;

  return jsonb_build_object(
    'version', 1,
    'status', 'stored',
    'snapshotId', v_snapshot_id,
    'siteId', v_site_id,
    'installationId', v_installation_id,
    'sequence', v_sequence,
    'digest', v_digest
  );
end;
$$;

create function public.builder_store_verified_entitlement_snapshot_v1(p_snapshot jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select builder_private.store_verified_entitlement_snapshot_v1(p_snapshot);
$$;

revoke all on function builder_private.store_verified_entitlement_snapshot_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_store_verified_entitlement_snapshot_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_store_verified_entitlement_snapshot_v1(jsonb) to service_role;

alter table public.builder_form_submissions enable row level security;
alter table public.builder_form_submission_consents enable row level security;
alter table public.builder_form_submission_events enable row level security;
alter table public.builder_form_submission_results enable row level security;
alter table public.builder_member_invitations enable row level security;
alter table public.builder_health_checks enable row level security;

create policy builder_form_submissions_editor_read on public.builder_form_submissions
for select to authenticated using (builder_private.has_site_role(site_id, array['owner', 'editor']));
create policy builder_form_submission_consents_editor_read on public.builder_form_submission_consents
for select to authenticated using (builder_private.has_site_role(site_id, array['owner', 'editor']));
create policy builder_form_submission_events_editor_read on public.builder_form_submission_events
for select to authenticated using (builder_private.has_site_role(site_id, array['owner', 'editor']));
create policy builder_form_submission_results_editor_read on public.builder_form_submission_results
for select to authenticated using (builder_private.has_site_role(site_id, array['owner', 'editor']));

revoke all on public.builder_form_submissions from anon, authenticated;
revoke all on public.builder_form_submission_consents from anon, authenticated;
revoke all on public.builder_form_submission_events from anon, authenticated;
revoke all on public.builder_form_submission_results from anon, authenticated;
revoke all on public.builder_member_invitations from anon, authenticated;
revoke all on public.builder_health_checks from anon, authenticated;
grant select on public.builder_form_submissions, public.builder_form_submission_consents,
  public.builder_form_submission_events, public.builder_form_submission_results to authenticated;

grant all on public.builder_form_submissions, public.builder_form_submission_consents,
  public.builder_form_submission_events, public.builder_form_submission_results,
  public.builder_member_invitations, public.builder_health_checks to service_role;
grant all on builder_private.builder_ingestion_receipts, builder_private.builder_rate_limit_buckets,
  builder_private.builder_verified_entitlement_snapshots,
  builder_private.builder_verified_entitlement_snapshot_modules,
  builder_private.builder_verified_entitlement_incident_overrides to service_role;
