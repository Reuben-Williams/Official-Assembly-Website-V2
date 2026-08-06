create or replace function builder_private.snapshot_module_action_allowed(
  p_snapshot_id uuid,
  p_module_id text,
  p_action text,
  p_now timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_snapshot builder_private.builder_verified_entitlement_snapshots%rowtype;
  v_module builder_private.builder_verified_entitlement_snapshot_modules%rowtype;
  v_override_mode text;
begin
  if p_snapshot_id is null
    or p_module_id not in (
      'growth.customers', 'growth.leads', 'growth.dashboard',
      'growth.bookings', 'growth.messaging', 'growth.campaigns',
      'growth.automations', 'growth.ai'
    )
    or p_action not in ('read', 'write', 'outbound', 'export')
  then
    return false;
  end if;

  select * into v_snapshot
  from builder_private.builder_verified_entitlement_snapshots
  where id = p_snapshot_id;
  if not found or v_snapshot.issued_at > p_now then return false; end if;

  select * into v_module
  from builder_private.builder_verified_entitlement_snapshot_modules
  where snapshot_id = p_snapshot_id and module_id = p_module_id;
  if not found then return false; end if;

  select case
    when count(*) = 0 then null
    when bool_or(mode = 'blocked') then 'blocked'
    else 'read_only'
  end
  into v_override_mode
  from builder_private.builder_verified_entitlement_incident_overrides
  where snapshot_id = p_snapshot_id
    and (module_id is null or module_id = p_module_id)
    and starts_at <= p_now
    and ends_at > p_now;

  if v_override_mode = 'blocked' then return false; end if;
  if v_override_mode = 'read_only' then
    return p_action = 'read'
      and builder_private.entitlement_state_action_allowed(
        v_module.state, v_module.grace_ends_at, 'read', p_now
      );
  end if;
  if p_now <= v_snapshot.expires_at then
    return builder_private.entitlement_state_action_allowed(
      v_module.state, v_module.grace_ends_at, p_action, p_now
    );
  end if;
  if v_snapshot.has_prior_valid_snapshot and p_now <= v_snapshot.outage_window_ends_at then
    return builder_private.entitlement_state_action_allowed(
      v_module.state, v_module.grace_ends_at, p_action, p_now
    );
  end if;
  if v_snapshot.has_prior_valid_snapshot then
    return p_action = 'read'
      and builder_private.entitlement_state_action_allowed(
        v_module.state, v_module.grace_ends_at, 'read', p_now
      );
  end if;
  return false;
end;
$$;

create table public.builder_automation_templates (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  stable_key text not null check (
    stable_key ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'
  ),
  name text not null check (char_length(name) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  current_revision_id uuid,
  state text not null default 'draft' check (
    state in ('draft', 'approved', 'retired')
  ),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, stable_key)
);

create table public.builder_automation_template_revisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  template_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  source_version text not null check (char_length(source_version) between 1 and 100),
  trigger_definition jsonb not null check (
    jsonb_typeof(trigger_definition) = 'object'
    and octet_length(trigger_definition::text) <= 32768
  ),
  conditions jsonb not null default '[]'::jsonb check (
    jsonb_typeof(conditions) = 'array'
    and octet_length(conditions::text) <= 65536
  ),
  steps jsonb not null check (
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) between 1 and 100
    and octet_length(steps::text) <= 131072
  ),
  stop_conditions text[] not null check (
    stop_conditions @> array[
      'consent_withdrawn', 'customer_replied', 'booking_cancelled',
      'booking_completed', 'emergency_paused', 'entitlement_suspended'
    ]::text[]
  ),
  message_template_revision_ids uuid[] not null default '{}'::uuid[],
  maximum_runs_per_subject integer not null default 1 check (
    maximum_runs_per_subject between 1 and 1000
  ),
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, template_id, revision_number),
  unique (site_id, template_id, id),
  foreign key (site_id, template_id)
    references public.builder_automation_templates(site_id, id) on delete cascade
);

alter table public.builder_automation_templates
  add constraint builder_automation_templates_current_revision_fk
  foreign key (site_id, id, current_revision_id)
  references public.builder_automation_template_revisions(site_id, template_id, id)
  on delete restrict;

create table public.builder_automations (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  stable_key text not null check (
    stable_key ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'
  ),
  name text not null check (char_length(name) between 1 and 200),
  state text not null default 'draft' check (
    state in (
      'draft', 'in_review', 'approved', 'active',
      'paused', 'changes_requested', 'retired'
    )
  ),
  current_revision_id uuid,
  approved_revision_id uuid,
  version integer not null default 1 check (version > 0),
  created_by_member_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, stable_key),
  foreign key (site_id, created_by_member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_automation_revisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  automation_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  source text not null check (
    source in ('developer_template', 'manual', 'ai_suggestion')
  ),
  template_revision_id uuid not null,
  trigger_definition jsonb not null check (
    jsonb_typeof(trigger_definition) = 'object'
    and octet_length(trigger_definition::text) <= 32768
  ),
  conditions jsonb not null default '[]'::jsonb check (
    jsonb_typeof(conditions) = 'array'
    and octet_length(conditions::text) <= 65536
  ),
  steps jsonb not null check (
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) between 1 and 100
    and octet_length(steps::text) <= 131072
  ),
  stop_conditions text[] not null check (
    stop_conditions @> array[
      'consent_withdrawn', 'customer_replied', 'booking_cancelled',
      'booking_completed', 'emergency_paused', 'entitlement_suspended'
    ]::text[]
  ),
  message_template_revision_ids uuid[] not null default '{}'::uuid[],
  maximum_runs_per_subject integer not null default 1 check (
    maximum_runs_per_subject between 1 and 1000
  ),
  created_by_member_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, automation_id, revision_number),
  unique (site_id, automation_id, id),
  foreign key (site_id, automation_id)
    references public.builder_automations(site_id, id) on delete cascade,
  foreign key (site_id, template_revision_id)
    references public.builder_automation_template_revisions(site_id, id)
    on delete restrict,
  foreign key (site_id, created_by_member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

alter table public.builder_automations
  add constraint builder_automations_current_revision_fk
  foreign key (site_id, id, current_revision_id)
  references public.builder_automation_revisions(site_id, automation_id, id)
  on delete restrict,
  add constraint builder_automations_approved_revision_fk
  foreign key (site_id, id, approved_revision_id)
  references public.builder_automation_revisions(site_id, automation_id, id)
  on delete restrict;

create table public.builder_automation_revision_message_templates (
  site_id uuid not null,
  automation_revision_id uuid not null,
  message_template_revision_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, automation_revision_id, message_template_revision_id),
  foreign key (site_id, automation_revision_id)
    references public.builder_automation_revisions(site_id, id) on delete cascade,
  foreign key (site_id, message_template_revision_id)
    references public.builder_message_template_revisions(site_id, id)
    on delete restrict
);

create table public.builder_automation_approvals (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  automation_id uuid not null,
  automation_revision_id uuid not null,
  state text not null default 'approved' check (
    state in ('approved', 'revoked')
  ),
  approved_by_member_id uuid not null,
  reason text not null check (char_length(reason) between 12 and 1000),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, automation_id, automation_revision_id),
  foreign key (site_id, automation_id, automation_revision_id)
    references public.builder_automation_revisions(site_id, automation_id, id)
    on delete restrict,
  foreign key (site_id, approved_by_member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check ((state = 'revoked') = (revoked_at is not null))
);

create table public.builder_automation_runs (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  automation_id uuid not null,
  automation_revision_id uuid not null,
  trigger_event_id uuid not null,
  trigger_topic text not null check (
    trigger_topic ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  trigger_version integer not null check (trigger_version > 0),
  aggregate_type text not null check (
    aggregate_type ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  aggregate_id uuid not null,
  correlation_id uuid not null,
  idempotency_key text not null check (
    char_length(idempotency_key) between 1 and 255
  ),
  trigger_payload jsonb not null default '{}'::jsonb check (
    jsonb_typeof(trigger_payload) = 'object'
    and octet_length(trigger_payload::text) <= 65536
  ),
  state text not null default 'pending' check (
    state in (
      'pending', 'running', 'waiting', 'completed',
      'stopped', 'failed', 'recovery_required'
    )
  ),
  current_step integer not null default 0 check (current_step >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner text check (
    lease_owner is null or char_length(lease_owner) between 1 and 255
  ),
  lease_token uuid,
  lease_expires_at timestamptz,
  stop_reason text,
  recovery_of_run_id uuid,
  last_result jsonb not null default '{}'::jsonb check (
    jsonb_typeof(last_result) = 'object'
    and octet_length(last_result::text) <= 65536
  ),
  version integer not null default 1 check (version > 0),
  next_attempt_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  unique (site_id, trigger_event_id, automation_revision_id),
  foreign key (site_id, automation_id, automation_revision_id)
    references public.builder_automation_revisions(site_id, automation_id, id)
    on delete restrict,
  foreign key (site_id, recovery_of_run_id)
    references public.builder_automation_runs(site_id, id) on delete restrict,
  check (
    (lease_owner is null and lease_token is null and lease_expires_at is null)
    or (
      lease_owner is not null
      and lease_token is not null
      and lease_expires_at is not null
    )
  )
);

create table public.builder_automation_run_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  run_id uuid not null,
  event_type text not null check (
    event_type ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  idempotency_key text not null check (
    char_length(idempotency_key) between 1 and 255
  ),
  payload jsonb not null default '{}'::jsonb check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 65536
  ),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, run_id)
    references public.builder_automation_runs(site_id, id) on delete cascade
);

create table public.builder_automation_ai_drafts (
  site_id uuid not null,
  id uuid not null,
  automation_id uuid not null,
  actor_id uuid not null,
  prompt_version_id uuid not null,
  model_configuration_version_id uuid not null,
  provider_kind text not null check (
    provider_kind ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  approval_state text not null default 'draft' check (
    approval_state = 'draft'
  ),
  provider_result jsonb not null check (
    jsonb_typeof(provider_result) = 'object'
    and octet_length(provider_result::text) <= 65536
  ),
  created_at timestamptz not null,
  primary key (site_id, id),
  foreign key (site_id, automation_id)
    references public.builder_automations(site_id, id) on delete cascade,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create index builder_automations_site_state_updated_idx
  on public.builder_automations(site_id, state, updated_at desc, id);
create index builder_automation_runs_claim_idx
  on public.builder_automation_runs(site_id, next_attempt_at, created_at, id)
  where state in ('pending', 'running', 'waiting', 'recovery_required');
create index builder_automation_runs_subject_idx
  on public.builder_automation_runs(
    site_id, aggregate_type, aggregate_id, state, created_at desc
  );
create index builder_automation_run_events_run_idx
  on public.builder_automation_run_events(site_id, run_id, occurred_at, id);

create trigger builder_automation_template_revisions_append_only
before update or delete on public.builder_automation_template_revisions
for each row execute function builder_private.reject_append_only_change();
create trigger builder_automation_revisions_append_only
before update or delete on public.builder_automation_revisions
for each row execute function builder_private.reject_append_only_change();
create trigger builder_automation_approvals_append_only
before update or delete on public.builder_automation_approvals
for each row execute function builder_private.reject_append_only_change();
create trigger builder_automation_run_events_append_only
before update or delete on public.builder_automation_run_events
for each row execute function builder_private.reject_append_only_change();
create trigger builder_automation_ai_drafts_append_only
before update or delete on public.builder_automation_ai_drafts
for each row execute function builder_private.reject_append_only_change();

alter table public.builder_automation_templates enable row level security;
alter table public.builder_automation_template_revisions enable row level security;
alter table public.builder_automations enable row level security;
alter table public.builder_automation_revisions enable row level security;
alter table public.builder_automation_revision_message_templates enable row level security;
alter table public.builder_automation_approvals enable row level security;
alter table public.builder_automation_runs enable row level security;
alter table public.builder_automation_run_events enable row level security;
alter table public.builder_automation_ai_drafts enable row level security;

create policy builder_automation_templates_read
on public.builder_automation_templates for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.automations', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'automations.read', 'site'
  )
);
create policy builder_automation_template_revisions_read
on public.builder_automation_template_revisions for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.automations', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'automations.read', 'site'
  )
);
create policy builder_automations_read
on public.builder_automations for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.automations', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'automations.read', 'site'
  )
);
create policy builder_automation_revisions_read
on public.builder_automation_revisions for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.automations', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'automations.read', 'site'
  )
);
create policy builder_automation_revision_message_templates_read
on public.builder_automation_revision_message_templates
for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.automations', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'automations.read', 'site'
  )
);
create policy builder_automation_approvals_read
on public.builder_automation_approvals for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.automations', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'automations.read', 'site'
  )
);
create policy builder_automation_runs_read
on public.builder_automation_runs for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.automations', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'automations.read', 'site'
  )
);
create policy builder_automation_run_events_read
on public.builder_automation_run_events for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.automations', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'automations.read', 'site'
  )
);
create policy builder_automation_ai_drafts_read
on public.builder_automation_ai_drafts for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.automations', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'automations.read', 'site'
  )
);

revoke all on table public.builder_automation_templates from anon, authenticated;
revoke all on table public.builder_automation_template_revisions from anon, authenticated;
revoke all on table public.builder_automations from anon, authenticated;
revoke all on table public.builder_automation_revisions from anon, authenticated;
revoke all on table public.builder_automation_revision_message_templates from anon, authenticated;
revoke all on table public.builder_automation_approvals from anon, authenticated;
revoke all on table public.builder_automation_runs from anon, authenticated;
revoke all on table public.builder_automation_run_events from anon, authenticated;
revoke all on table public.builder_automation_ai_drafts from anon, authenticated;

grant select on table public.builder_automation_templates to authenticated, service_role;
grant select on table public.builder_automation_template_revisions to authenticated, service_role;
grant select on table public.builder_automations to authenticated, service_role;
grant select on table public.builder_automation_revisions to authenticated, service_role;
grant select on table public.builder_automation_revision_message_templates to authenticated, service_role;
grant select on table public.builder_automation_approvals to authenticated, service_role;
grant select on table public.builder_automation_runs to authenticated, service_role;
grant select on table public.builder_automation_run_events to authenticated, service_role;
grant select on table public.builder_automation_ai_drafts to authenticated, service_role;
grant update (lease_expires_at) on table public.builder_automation_runs
to service_role;
grant execute on function builder_private.member_has_capability(
  uuid, uuid, text, text
) to authenticated;

create function builder_private.automation_member_allowed(
  p_site_id uuid,
  p_actor_id uuid,
  p_capability text,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select
    builder_private.module_action_allowed(
      p_site_id, 'growth.automations', p_action
    )
    and builder_private.member_has_capability(
      p_site_id, p_actor_id, p_capability, 'site'
    );
$$;

revoke all on function builder_private.automation_member_allowed(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;

create function builder_private.automation_command_replay(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_command_id uuid := (p_request ->> 'commandId')::uuid;
  v_idempotency_key text := p_request ->> 'idempotencyKey';
  v_payload_hash text := encode(
    public.digest(convert_to(p_request::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_receipt public.builder_command_receipts%rowtype;
begin
  select receipt.* into v_receipt
  from public.builder_command_receipts receipt
  where receipt.site_id = v_site_id
    and (
      receipt.command_id = v_command_id
      or receipt.idempotency_key = v_idempotency_key
    )
  order by receipt.command_id
  limit 1
  for update;

  if not found then return null; end if;
  if v_receipt.command_id <> v_command_id
    or v_receipt.idempotency_key <> v_idempotency_key
    or v_receipt.command_type <> p_request ->> 'type'
    or v_receipt.command_version <> (p_request ->> 'version')::integer
    or v_receipt.payload_hash <> v_payload_hash
  then
    return jsonb_build_object(
      'version', 1,
      'status', 'denied',
      'reasonCode', 'idempotency_conflict'
    );
  end if;

  return v_receipt.sanitized_result
    || jsonb_build_object('version', 1, 'status', 'replayed');
end;
$$;

create function builder_private.record_automation_command(
  p_request jsonb,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_command_id uuid := (p_request ->> 'commandId')::uuid;
  v_idempotency_key text := p_request ->> 'idempotencyKey';
  v_payload_hash text := encode(
    public.digest(convert_to(p_request::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_existing jsonb;
begin
  insert into public.builder_command_receipts (
    site_id,
    command_id,
    idempotency_key,
    command_type,
    command_version,
    payload_hash,
    status,
    sanitized_result,
    lease_token,
    lease_expires_at,
    completed_at
  ) values (
    v_site_id,
    v_command_id,
    v_idempotency_key,
    p_request ->> 'type',
    (p_request ->> 'version')::integer,
    v_payload_hash,
    'succeeded',
    p_result,
    null,
    null,
    clock_timestamp()
  )
  on conflict do nothing;

  if found then return p_result; end if;
  v_existing := builder_private.automation_command_replay(p_request);
  return coalesce(v_existing, p_result);
end;
$$;

revoke all on function builder_private.automation_command_replay(jsonb)
from public, anon, authenticated, service_role;
revoke all on function builder_private.record_automation_command(jsonb, jsonb)
from public, anon, authenticated, service_role;

create function public.builder_apply_automation_command_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_expected_version integer;
  v_type text;
  v_payload jsonb;
  v_automation_id uuid;
  v_revision_id uuid;
  v_approval_id uuid;
  v_template_id uuid;
  v_template_revision_id uuid;
  v_template_stable_key text;
  v_message_revision_ids uuid[] := '{}'::uuid[];
  v_stop_conditions text[];
  v_automation public.builder_automations%rowtype;
  v_result jsonb;
  v_replay jsonb;
  v_now timestamptz := statement_timestamp();
  v_revision_number integer;
  v_content_digest text;
  v_reason text;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or jsonb_typeof(p_request -> 'actor') <> 'object'
    or p_request #>> '{actor,type}' <> 'member'
    or jsonb_typeof(p_request -> 'payload') <> 'object'
    or char_length(coalesce(p_request ->> 'idempotencyKey', '')) not between 1 and 128
    or coalesce(p_request ->> 'correlationId', '') = ''
    or coalesce(p_request ->> 'type', '') not in (
      'automation.create', 'automation.create_revision',
      'automation.submit_approval', 'automation.request_changes',
      'automation.approve', 'automation.activate', 'automation.pause',
      'automation.resume', 'automation.retire'
    )
  then
    raise exception 'invalid automation command envelope' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    perform (p_request ->> 'commandId')::uuid;
    v_actor_id := (p_request #>> '{actor,id}')::uuid;
    v_expected_version := (p_request ->> 'expectedVersion')::integer;
  exception when others then
    raise exception 'invalid automation command identifiers' using errcode = '22023';
  end;

  v_type := p_request ->> 'type';
  v_payload := p_request -> 'payload';
  v_automation_id := (v_payload ->> 'automationId')::uuid;

  v_replay := builder_private.automation_command_replay(p_request);
  if v_replay is not null then return v_replay; end if;

  if not builder_private.automation_member_allowed(
    v_site_id,
    v_actor_id,
    case when v_type = 'automation.approve'
      then 'automations.approve' else 'automations.manage' end,
    'write'
  ) then
    raise exception 'automation command is not authorized' using errcode = '42501';
  end if;

  if v_type = 'automation.create' then
    if v_expected_version <> 0 then
      return jsonb_build_object(
        'version', 1, 'status', 'conflict', 'reasonCode', 'version_conflict'
      );
    end if;
    insert into public.builder_automations (
      site_id, id, stable_key, name, created_by_member_id
    ) values (
      v_site_id,
      v_automation_id,
      v_payload ->> 'stableKey',
      v_payload ->> 'name',
      v_actor_id
    );
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'automationId', v_automation_id,
      'aggregateVersion', 1
    );
    return builder_private.record_automation_command(p_request, v_result);
  end if;

  select * into v_automation
  from public.builder_automations
  where site_id = v_site_id and id = v_automation_id
  for update;
  if not found then
    raise exception 'automation not found' using errcode = 'P0002';
  end if;
  if v_automation.version <> v_expected_version then
    return jsonb_build_object(
      'version', 1,
      'status', 'conflict',
      'reasonCode', 'version_conflict',
      'expectedVersion', v_expected_version,
      'actualVersion', v_automation.version
    );
  end if;

  if v_type = 'automation.create_revision' then
    v_revision_id := (v_payload ->> 'revisionId')::uuid;
    v_template_stable_key := v_payload ->> 'templateStableKey';
    if v_template_stable_key is null
      or jsonb_typeof(v_payload -> 'trigger') <> 'object'
      or jsonb_typeof(v_payload -> 'conditions') <> 'array'
      or jsonb_typeof(v_payload -> 'steps') <> 'array'
      or jsonb_array_length(v_payload -> 'steps') = 0
      or jsonb_typeof(v_payload -> 'stopConditions') <> 'array'
    then
      raise exception 'invalid automation revision' using errcode = '22023';
    end if;

    select coalesce(array_agg(
      (step -> 'action' -> 'templateVersion' ->> 'templateRevisionId')::uuid
      order by step ->> 'stepKey'
    ), '{}'::uuid[])
    into v_message_revision_ids
    from jsonb_array_elements(v_payload -> 'steps') step
    where step -> 'action' -> 'templateVersion' ->> 'templateRevisionId'
      is not null;

    if exists (
      select 1
      from unnest(v_message_revision_ids) revision_id
      where not exists (
        select 1
        from public.builder_message_template_revisions message_revision
        where message_revision.site_id = v_site_id
          and message_revision.id = revision_id
          and message_revision.state = 'published'
      )
    ) then
      raise exception 'message template revision is not published'
        using errcode = '23503';
    end if;

    select coalesce(array_agg(value order by value), '{}'::text[])
    into v_stop_conditions
    from jsonb_array_elements_text(v_payload -> 'stopConditions') value;

    insert into public.builder_automation_templates (
      site_id, stable_key, name, description, state
    ) values (
      v_site_id,
      v_template_stable_key,
      initcap(replace(v_template_stable_key, '_', ' ')),
      'Developer-approved automation template.',
      'approved'
    )
    on conflict (site_id, stable_key) do update
      set updated_at = excluded.updated_at
    returning id into v_template_id;

    select id into v_template_revision_id
    from public.builder_automation_template_revisions
    where site_id = v_site_id and template_id = v_template_id
    order by revision_number desc
    limit 1;

    v_content_digest := encode(
      public.digest(
        convert_to(
          jsonb_build_object(
            'trigger', v_payload -> 'trigger',
            'conditions', v_payload -> 'conditions',
            'steps', v_payload -> 'steps',
            'stopConditions', v_payload -> 'stopConditions'
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    if v_template_revision_id is null then
      v_template_revision_id := gen_random_uuid();
      insert into public.builder_automation_template_revisions (
        site_id,
        id,
        template_id,
        revision_number,
        source_version,
        trigger_definition,
        conditions,
        steps,
        stop_conditions,
        message_template_revision_ids,
        maximum_runs_per_subject,
        content_digest
      ) values (
        v_site_id,
        v_template_revision_id,
        v_template_id,
        1,
        '1.0.0',
        v_payload -> 'trigger',
        v_payload -> 'conditions',
        v_payload -> 'steps',
        v_stop_conditions,
        v_message_revision_ids,
        coalesce((v_payload ->> 'maximumRunsPerSubject')::integer, 1),
        v_content_digest
      );
      update public.builder_automation_templates
      set current_revision_id = v_template_revision_id,
          version = version + 1,
          updated_at = v_now
      where site_id = v_site_id and id = v_template_id;
    end if;

    select coalesce(max(revision_number), 0) + 1
    into v_revision_number
    from public.builder_automation_revisions
    where site_id = v_site_id and automation_id = v_automation_id;

    insert into public.builder_automation_revisions (
      site_id,
      id,
      automation_id,
      revision_number,
      source,
      template_revision_id,
      trigger_definition,
      conditions,
      steps,
      stop_conditions,
      message_template_revision_ids,
      maximum_runs_per_subject,
      created_by_member_id
    ) values (
      v_site_id,
      v_revision_id,
      v_automation_id,
      v_revision_number,
      v_payload ->> 'source',
      v_template_revision_id,
      v_payload -> 'trigger',
      v_payload -> 'conditions',
      v_payload -> 'steps',
      v_stop_conditions,
      v_message_revision_ids,
      coalesce((v_payload ->> 'maximumRunsPerSubject')::integer, 1),
      v_actor_id
    );

    insert into public.builder_automation_revision_message_templates (
      site_id, automation_revision_id, message_template_revision_id
    )
    select v_site_id, v_revision_id, revision_id
    from unnest(v_message_revision_ids) revision_id;

    update public.builder_automations
    set current_revision_id = v_revision_id,
        approved_revision_id = null,
        state = 'draft',
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_automation_id
    returning * into v_automation;

  elsif v_type = 'automation.submit_approval' then
    if v_automation.current_revision_id is null then
      raise exception 'automation revision is required' using errcode = '22023';
    end if;
    update public.builder_automations
    set state = 'in_review',
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_automation_id
    returning * into v_automation;

  elsif v_type = 'automation.request_changes' then
    update public.builder_automations
    set state = 'changes_requested',
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_automation_id
    returning * into v_automation;

  elsif v_type = 'automation.approve' then
    v_revision_id := (v_payload ->> 'revisionId')::uuid;
    v_approval_id := (v_payload ->> 'approvalId')::uuid;
    if v_automation.state <> 'in_review'
      or v_automation.current_revision_id is distinct from v_revision_id
    then
      return builder_private.record_automation_command(
        p_request,
        jsonb_build_object(
          'version', 1,
          'status', 'denied',
          'reasonCode', 'approval_required'
        )
      );
    end if;
    v_reason := coalesce(
      nullif(v_payload ->> 'reason', ''),
      'Approved by an authorized business member.'
    );
    insert into public.builder_automation_approvals (
      site_id,
      id,
      automation_id,
      automation_revision_id,
      approved_by_member_id,
      reason
    ) values (
      v_site_id,
      v_approval_id,
      v_automation_id,
      v_revision_id,
      v_actor_id,
      v_reason
    );
    update public.builder_automations
    set approved_revision_id = v_revision_id,
        state = 'approved',
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_automation_id
    returning * into v_automation;

  elsif v_type = 'automation.activate' then
    if v_automation.approved_revision_id is null
      or v_automation.approved_revision_id is distinct from
        v_automation.current_revision_id
      or not exists (
        select 1
        from public.builder_automation_approvals approval
        where approval.site_id = v_site_id
          and approval.automation_id = v_automation_id
          and approval.automation_revision_id = v_automation.current_revision_id
          and approval.state = 'approved'
      )
    then
      return builder_private.record_automation_command(
        p_request,
        jsonb_build_object(
          'version', 1,
          'status', 'denied',
          'reasonCode', 'approval_required'
        )
      );
    end if;
    update public.builder_automations
    set state = 'active',
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_automation_id
    returning * into v_automation;

  elsif v_type = 'automation.pause' then
    update public.builder_automations
    set state = 'paused',
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_automation_id
    returning * into v_automation;

  elsif v_type = 'automation.resume' then
    if v_automation.approved_revision_id is null then
      return builder_private.record_automation_command(
        p_request,
        jsonb_build_object(
          'version', 1,
          'status', 'denied',
          'reasonCode', 'approval_required'
        )
      );
    end if;
    update public.builder_automations
    set state = 'active',
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_automation_id
    returning * into v_automation;

  elsif v_type = 'automation.retire' then
    update public.builder_automations
    set state = 'retired',
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_automation_id
    returning * into v_automation;
  end if;

  v_result := jsonb_build_object(
    'version', 1,
    'status', 'applied',
    'automationId', v_automation_id,
    'aggregateVersion', v_automation.version,
    'state', v_automation.state
  );
  return builder_private.record_automation_command(p_request, v_result);
end;
$$;

create function public.builder_start_automation_run_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_automation_id uuid;
  v_event_id uuid;
  v_aggregate_id uuid;
  v_correlation_id uuid;
  v_automation public.builder_automations%rowtype;
  v_revision public.builder_automation_revisions%rowtype;
  v_run_id uuid;
  v_existing_run_id uuid;
  v_entitlement_state text;
  v_setup_complete boolean;
  v_now timestamptz;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or char_length(coalesce(p_request ->> 'idempotencyKey', '')) not between 1 and 255
    or coalesce(p_request ->> 'eventTopic', '') !~
      '^[a-z][a-z0-9._-]{0,127}$'
    or coalesce(p_request ->> 'aggregateType', '') !~
      '^[a-z][a-z0-9._-]{0,127}$'
  then
    raise exception 'invalid automation run request' using errcode = '22023';
  end if;
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_automation_id := (p_request ->> 'automationId')::uuid;
    v_event_id := (p_request ->> 'eventId')::uuid;
    v_aggregate_id := (p_request ->> 'aggregateId')::uuid;
    v_correlation_id := (p_request ->> 'correlationId')::uuid;
    v_now := coalesce(
      (p_request ->> 'occurredAt')::timestamptz,
      statement_timestamp()
    );
  exception when others then
    raise exception 'invalid automation run identifiers' using errcode = '22023';
  end;

  select run.id into v_existing_run_id
  from public.builder_automation_runs run
  where run.site_id = v_site_id
    and (
      run.idempotency_key = p_request ->> 'idempotencyKey'
      or (
        run.trigger_event_id = v_event_id
        and run.automation_id = v_automation_id
      )
    )
  limit 1;
  if found then
    return jsonb_build_object(
      'version', 1,
      'status', 'replayed',
      'runId', v_existing_run_id
    );
  end if;

  select module.state, module.setup_complete
  into v_entitlement_state, v_setup_complete
  from builder_private.builder_verified_entitlement_snapshot_modules module
  join builder_private.builder_verified_entitlement_snapshots snapshot
    on snapshot.id = module.snapshot_id
  where module.site_id = v_site_id
    and module.module_id = 'growth.automations'
    and snapshot.issued_at <= v_now
  order by module.sequence desc
  limit 1;

  if v_entitlement_state = 'suspended'
    or not coalesce(v_setup_complete, false)
    or not builder_private.module_action_allowed(
      v_site_id, 'growth.automations', 'outbound'
    )
  then
    return jsonb_build_object(
      'version', 1,
      'status', 'denied',
      'reasonCode', 'entitlement_suspended'
    );
  end if;

  if exists (
    select 1
    from public.builder_emergency_pauses pause
    where pause.site_id = v_site_id
      and pause.active
      and (
        (pause.scope = 'site' and pause.scope_key = v_site_id::text)
        or (
          pause.scope = 'module'
          and pause.scope_key = 'growth.automations'
        )
      )
  ) then
    return jsonb_build_object(
      'version', 1,
      'status', 'denied',
      'reasonCode', 'emergency_pause'
    );
  end if;

  select * into v_automation
  from public.builder_automations
  where site_id = v_site_id and id = v_automation_id
  for update;
  if not found or v_automation.state <> 'active' then
    return jsonb_build_object(
      'version', 1,
      'status', 'denied',
      'reasonCode', 'automation_not_active'
    );
  end if;

  select * into v_revision
  from public.builder_automation_revisions
  where site_id = v_site_id
    and id = v_automation.current_revision_id
    and automation_id = v_automation_id;
  if not found
    or v_revision.trigger_definition ->> 'type' <>
      p_request ->> 'eventTopic'
    or not exists (
      select 1
      from public.builder_automation_approvals approval
      where approval.site_id = v_site_id
        and approval.automation_id = v_automation_id
        and approval.automation_revision_id = v_revision.id
        and approval.state = 'approved'
    )
  then
    return jsonb_build_object(
      'version', 1,
      'status', 'denied',
      'reasonCode', 'approval_required'
    );
  end if;

  if (
    select count(*)
    from public.builder_automation_runs run
    where run.site_id = v_site_id
      and run.automation_revision_id = v_revision.id
      and run.aggregate_type = p_request ->> 'aggregateType'
      and run.aggregate_id = v_aggregate_id
      and run.state not in ('failed')
  ) >= v_revision.maximum_runs_per_subject then
    return jsonb_build_object(
      'version', 1,
      'status', 'denied',
      'reasonCode', 'maximum_runs_reached'
    );
  end if;

  v_run_id := gen_random_uuid();
  insert into public.builder_automation_runs (
    site_id,
    id,
    automation_id,
    automation_revision_id,
    trigger_event_id,
    trigger_topic,
    trigger_version,
    aggregate_type,
    aggregate_id,
    correlation_id,
    idempotency_key,
    trigger_payload,
    next_attempt_at
  ) values (
    v_site_id,
    v_run_id,
    v_automation_id,
    v_revision.id,
    v_event_id,
    p_request ->> 'eventTopic',
    (p_request ->> 'eventVersion')::integer,
    p_request ->> 'aggregateType',
    v_aggregate_id,
    v_correlation_id,
    p_request ->> 'idempotencyKey',
    coalesce(p_request -> 'payload', '{}'::jsonb),
    v_now
  );

  insert into public.builder_automation_run_events (
    site_id, run_id, event_type, idempotency_key, payload, occurred_at
  ) values (
    v_site_id,
    v_run_id,
    'run.started',
    'start:' || (p_request ->> 'idempotencyKey'),
    jsonb_build_object(
      'eventId', v_event_id,
      'eventTopic', p_request ->> 'eventTopic',
      'correlationId', v_correlation_id
    ),
    v_now
  );

  return jsonb_build_object(
    'version', 1,
    'status', 'started',
    'runId', v_run_id,
    'automationRevisionId', v_revision.id
  );
exception when unique_violation then
  select run.id into v_existing_run_id
  from public.builder_automation_runs run
  where run.site_id = v_site_id
    and run.idempotency_key = p_request ->> 'idempotencyKey';
  return jsonb_build_object(
    'version', 1,
    'status', 'replayed',
    'runId', v_existing_run_id
  );
end;
$$;

create function public.builder_claim_automation_runs_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_worker_id text;
  v_now timestamptz;
  v_limit integer;
  v_lease_seconds integer;
  v_candidate public.builder_automation_runs%rowtype;
  v_claimed public.builder_automation_runs%rowtype;
  v_revision public.builder_automation_revisions%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_recovered boolean;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or char_length(coalesce(p_request ->> 'workerId', '')) not between 1 and 255
  then
    raise exception 'invalid automation run claim' using errcode = '22023';
  end if;
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_worker_id := p_request ->> 'workerId';
  v_now := coalesce(
    (p_request ->> 'now')::timestamptz,
    statement_timestamp()
  );
  v_limit := greatest(1, least(
    100, coalesce((p_request ->> 'limit')::integer, 10)
  ));
  v_lease_seconds := greatest(1, least(
    300, coalesce((p_request ->> 'leaseSeconds')::integer, 60)
  ));

  if not builder_private.module_action_allowed(
    v_site_id, 'growth.automations', 'outbound'
  ) then
    return jsonb_build_object(
      'version', 1,
      'status', 'denied',
      'reasonCode', 'entitlement_suspended',
      'claimedCount', 0,
      'items', '[]'::jsonb
    );
  end if;

  for v_candidate in
    select run.*
    from public.builder_automation_runs run
    join public.builder_automations automation
      on automation.site_id = run.site_id
      and automation.id = run.automation_id
    where run.site_id = v_site_id
      and run.state in ('pending', 'running', 'waiting', 'recovery_required')
      and run.next_attempt_at <= v_now
      and (
        run.lease_expires_at is null
        or run.lease_expires_at <= v_now
      )
      and automation.state = 'active'
    order by run.next_attempt_at, run.created_at, run.id
    limit v_limit
    for update skip locked
  loop
    v_recovered := v_candidate.lease_token is not null;
    update public.builder_automation_runs run
    set state = 'running',
        lease_owner = v_worker_id,
        lease_token = gen_random_uuid(),
        lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
        attempt_count = run.attempt_count + 1,
        started_at = coalesce(run.started_at, v_now),
        version = run.version + 1,
        updated_at = v_now
    where run.site_id = v_candidate.site_id and run.id = v_candidate.id
    returning run.* into v_claimed;

    select * into v_revision
    from public.builder_automation_revisions
    where site_id = v_claimed.site_id
      and id = v_claimed.automation_revision_id;

    insert into public.builder_automation_run_events (
      site_id, run_id, event_type, idempotency_key, payload, occurred_at
    ) values (
      v_claimed.site_id,
      v_claimed.id,
      case when v_recovered then 'run.recovered' else 'run.claimed' end,
      'claim:' || v_claimed.id::text || ':' || v_claimed.lease_token::text,
      jsonb_build_object(
        'workerId', v_worker_id,
        'leaseToken', v_claimed.lease_token,
        'leaseExpiresAt', v_claimed.lease_expires_at,
        'recovered', v_recovered
      ),
      v_now
    );

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'siteId', v_claimed.site_id,
      'runId', v_claimed.id,
      'automationId', v_claimed.automation_id,
      'automationRevisionId', v_claimed.automation_revision_id,
      'aggregateType', v_claimed.aggregate_type,
      'aggregateId', v_claimed.aggregate_id,
      'currentStep', v_claimed.current_step,
      'steps', v_revision.steps,
      'triggerPayload', v_claimed.trigger_payload,
      'workerId', v_claimed.lease_owner,
      'leaseToken', v_claimed.lease_token,
      'leaseExpiresAt', v_claimed.lease_expires_at,
      'version', v_claimed.version,
      'recovered', v_recovered
    ));
  end loop;

  return jsonb_build_object(
    'version', 1,
    'status', 'claimed',
    'claimedCount', jsonb_array_length(v_items),
    'items', v_items
  );
end;
$$;

create function public.builder_advance_automation_run_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid;
  v_run_id uuid;
  v_lease_token uuid;
  v_expected_version integer;
  v_now timestamptz;
  v_run public.builder_automation_runs%rowtype;
  v_revision public.builder_automation_revisions%rowtype;
  v_next_state text;
  v_event_type text;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or char_length(coalesce(p_request ->> 'workerId', '')) not between 1 and 255
    or char_length(coalesce(p_request ->> 'idempotencyKey', '')) not between 1 and 255
    or jsonb_typeof(p_request -> 'result') <> 'object'
  then
    raise exception 'invalid automation run advance' using errcode = '22023';
  end if;
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_run_id := (p_request ->> 'runId')::uuid;
  v_lease_token := (p_request ->> 'leaseToken')::uuid;
  v_expected_version := (p_request ->> 'expectedVersion')::integer;
  v_now := coalesce(
    (p_request ->> 'now')::timestamptz,
    statement_timestamp()
  );

  if exists (
    select 1
    from public.builder_automation_run_events event
    where event.site_id = v_site_id
      and event.idempotency_key = p_request ->> 'idempotencyKey'
  ) then
    return jsonb_build_object(
      'version', 1, 'status', 'replayed', 'runId', v_run_id
    );
  end if;

  select * into v_run
  from public.builder_automation_runs
  where site_id = v_site_id and id = v_run_id
  for update;
  if not found then
    raise exception 'automation run not found' using errcode = 'P0002';
  end if;
  if v_run.state = 'stopped' then
    return jsonb_build_object(
      'version', 1, 'status', 'denied', 'reasonCode', 'run_stopped'
    );
  end if;
  if v_run.lease_owner is distinct from p_request ->> 'workerId'
    or v_run.lease_token is distinct from v_lease_token
    or v_run.lease_expires_at is null
    or v_run.lease_expires_at <= v_now
  then
    return jsonb_build_object(
      'version', 1, 'status', 'denied', 'reasonCode', 'lease_lost'
    );
  end if;
  if v_run.version <> v_expected_version then
    return jsonb_build_object(
      'version', 1,
      'status', 'conflict',
      'reasonCode', 'version_conflict',
      'actualVersion', v_run.version
    );
  end if;

  select * into v_revision
  from public.builder_automation_revisions
  where site_id = v_site_id and id = v_run.automation_revision_id;

  v_next_state := case
    when p_request #>> '{result,status}' = 'failed_retryable'
      then 'pending'
    when p_request #>> '{result,status}' = 'failed'
      then 'failed'
    when v_run.current_step + 1 >= jsonb_array_length(v_revision.steps)
      then 'completed'
    else 'pending'
  end;
  v_event_type := case
    when v_next_state = 'completed' then 'run.completed'
    when v_next_state = 'failed' then 'run.failed'
    else 'run.advanced'
  end;

  update public.builder_automation_runs
  set state = v_next_state,
      current_step = case
        when p_request #>> '{result,status}' in ('failed', 'failed_retryable')
          then current_step
        else current_step + 1
      end,
      last_result = p_request -> 'result',
      next_attempt_at = case
        when v_next_state = 'pending'
          then v_now + interval '30 seconds'
        else next_attempt_at
      end,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      completed_at = case
        when v_next_state in ('completed', 'failed') then v_now
        else completed_at
      end,
      version = version + 1,
      updated_at = v_now
  where site_id = v_site_id and id = v_run_id
  returning * into v_run;

  insert into public.builder_automation_run_events (
    site_id, run_id, event_type, idempotency_key, payload, occurred_at
  ) values (
    v_site_id,
    v_run_id,
    v_event_type,
    p_request ->> 'idempotencyKey',
    jsonb_build_object(
      'workerId', p_request ->> 'workerId',
      'result', p_request -> 'result',
      'currentStep', v_run.current_step,
      'state', v_run.state
    ),
    v_now
  );

  return jsonb_build_object(
    'version', 1,
    'status', 'applied',
    'runId', v_run_id,
    'runVersion', v_run.version,
    'state', v_run.state
  );
end;
$$;

create function public.builder_stop_automation_runs_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid;
  v_aggregate_id uuid;
  v_now timestamptz;
  v_candidate record;
  v_first_run_id uuid;
  v_count integer := 0;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'reasonCode', '') not in (
      'consent_withdrawn', 'customer_replied', 'booking_cancelled',
      'booking_completed', 'emergency_paused', 'entitlement_suspended'
    )
    or char_length(coalesce(p_request ->> 'idempotencyKey', '')) not between 1 and 255
  then
    raise exception 'invalid automation stop signal' using errcode = '22023';
  end if;
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_aggregate_id := (p_request ->> 'aggregateId')::uuid;
  v_now := coalesce(
    (p_request ->> 'occurredAt')::timestamptz,
    statement_timestamp()
  );

  select event.run_id into v_first_run_id
  from public.builder_automation_run_events event
  where event.site_id = v_site_id
    and event.idempotency_key = p_request ->> 'idempotencyKey'
  limit 1;
  if found then
    return jsonb_build_object(
      'version', 1,
      'status', 'replayed',
      'runId', v_first_run_id
    );
  end if;

  for v_candidate in
    select run.id
    from public.builder_automation_runs run
    join public.builder_automation_revisions revision
      on revision.site_id = run.site_id
      and revision.id = run.automation_revision_id
    where run.site_id = v_site_id
      and run.aggregate_type = p_request ->> 'aggregateType'
      and run.aggregate_id = v_aggregate_id
      and run.state not in ('completed', 'stopped', 'failed')
      and p_request ->> 'reasonCode' = any(revision.stop_conditions)
    order by run.created_at, run.id
    for update skip locked
  loop
    update public.builder_automation_runs
    set state = 'stopped',
        stop_reason = p_request ->> 'reasonCode',
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        completed_at = v_now,
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_candidate.id;

    insert into public.builder_automation_run_events (
      site_id, run_id, event_type, idempotency_key, payload, occurred_at
    ) values (
      v_site_id,
      v_candidate.id,
      'run.stopped',
      case when v_count = 0
        then p_request ->> 'idempotencyKey'
        else (p_request ->> 'idempotencyKey') || ':' || v_candidate.id::text
      end,
      jsonb_build_object(
        'eventId', p_request ->> 'eventId',
        'eventTopic', p_request ->> 'eventTopic',
        'reasonCode', p_request ->> 'reasonCode',
        'correlationId', p_request ->> 'correlationId'
      ),
      v_now
    );
    v_first_run_id := coalesce(v_first_run_id, v_candidate.id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'version', 1,
    'status', case when v_count > 0 then 'stopped' else 'ignored' end,
    'reasonCode', case when v_count > 0 then 'run_stopped' else 'no_match' end,
    'stoppedCount', v_count,
    'runId', v_first_run_id
  );
end;
$$;

create function public.builder_record_automation_ai_draft_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid;
  v_automation_id uuid;
  v_draft_id uuid;
  v_actor_id uuid;
  v_created_at timestamptz;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or jsonb_typeof(p_request -> 'providerResult') <> 'object'
    or char_length(coalesce(p_request ->> 'providerKind', '')) not between 1 and 128
  then
    raise exception 'invalid automation AI draft' using errcode = '22023';
  end if;
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_automation_id := (p_request ->> 'automationId')::uuid;
  v_draft_id := (p_request ->> 'draftId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_created_at := coalesce(
    (p_request ->> 'createdAt')::timestamptz,
    statement_timestamp()
  );

  insert into public.builder_automation_ai_drafts (
    site_id,
    id,
    automation_id,
    actor_id,
    prompt_version_id,
    model_configuration_version_id,
    provider_kind,
    approval_state,
    provider_result,
    created_at
  ) values (
    v_site_id,
    v_draft_id,
    v_automation_id,
    v_actor_id,
    (p_request ->> 'promptVersionId')::uuid,
    (p_request ->> 'modelConfigurationVersionId')::uuid,
    p_request ->> 'providerKind',
    'draft',
    p_request -> 'providerResult',
    v_created_at
  )
  on conflict (site_id, id) do nothing;

  return jsonb_build_object(
    'version', 1,
    'status', case when found then 'recorded' else 'replayed' end,
    'draftId', v_draft_id,
    'approvalState', 'draft'
  );
end;
$$;

revoke all on function public.builder_apply_automation_command_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_start_automation_run_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_claim_automation_runs_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_advance_automation_run_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_stop_automation_runs_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_record_automation_ai_draft_v1(jsonb) from public, anon, authenticated;

grant execute on function public.builder_apply_automation_command_v1(jsonb) to service_role;
grant execute on function public.builder_start_automation_run_v1(jsonb) to service_role;
grant execute on function public.builder_claim_automation_runs_v1(jsonb) to service_role;
grant execute on function public.builder_advance_automation_run_v1(jsonb) to service_role;
grant execute on function public.builder_stop_automation_runs_v1(jsonb) to service_role;
grant execute on function public.builder_record_automation_ai_draft_v1(jsonb) to service_role;
