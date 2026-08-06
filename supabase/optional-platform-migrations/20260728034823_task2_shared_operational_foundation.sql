create table public.builder_provider_connections (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  provider_kind text not null check (provider_kind in (
    'payment', 'email', 'sms', 'external-calendar', 'virtual-meeting',
    'ai-response', 'bot-protection', 'object-storage'
  )),
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9._-]{0,127}$'),
  capabilities text[] not null default '{}'::text[],
  state text not null default 'setup_required' check (state in (
    'setup_required', 'ready', 'degraded', 'disconnected', 'revoked'
  )),
  connection_owner_id uuid,
  external_account_reference text check (
    external_account_reference is null or char_length(external_account_reference) <= 255
  ),
  sanitized_reason_code text check (
    sanitized_reason_code is null or sanitized_reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  diagnostic_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(diagnostic_metadata) = 'object'
    and octet_length(diagnostic_metadata::text) <= 8192
    and diagnostic_metadata::text !~* '"[^"]*(token|secret|password|credential|cookie|authorization|private[_-]?key)[^"]*"'
  ),
  connected_at timestamptz,
  checked_at timestamptz,
  last_successful_at timestamptz,
  disconnected_at timestamptz,
  revoked_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, provider_kind, provider_key),
  foreign key (site_id, connection_owner_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check ((state = 'disconnected') = (disconnected_at is not null)),
  check ((state = 'revoked') = (revoked_at is not null))
);

create table builder_private.builder_provider_connection_secrets (
  site_id uuid not null,
  connection_id uuid not null,
  secret_store text not null check (secret_store in ('vault', 'provider')),
  secret_reference text not null check (
    char_length(secret_reference) between 1 and 500
    and secret_reference !~ '[[:space:]]'
  ),
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  primary key (site_id, connection_id),
  foreign key (site_id, connection_id)
    references public.builder_provider_connections(site_id, id) on delete cascade
);

create table builder_private.builder_provider_webhook_receipts (
  site_id uuid not null,
  connection_id uuid not null,
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 500),
  replay_key text not null check (char_length(replay_key) between 1 and 500),
  signature_verified boolean not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  primary key (site_id, connection_id, replay_key),
  unique (site_id, connection_id, provider_event_id),
  foreign key (site_id, connection_id)
    references public.builder_provider_connections(site_id, id) on delete cascade
);

create table public.builder_emergency_pauses (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  scope text not null check (scope in ('site', 'module', 'channel', 'provider')),
  scope_key text not null check (char_length(scope_key) between 1 and 160),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  active boolean not null default true,
  created_by uuid not null,
  ended_by uuid,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  version integer not null default 1 check (version > 0),
  primary key (site_id, id),
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, ended_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (active = (ended_at is null)),
  check ((ended_at is null) = (ended_by is null))
);

create unique index builder_emergency_pauses_active_scope_idx
  on public.builder_emergency_pauses (site_id, scope, scope_key)
  where active;

alter table public.builder_outbox
  drop constraint if exists builder_outbox_status_check;
alter table public.builder_outbox
  add constraint builder_outbox_status_check check (status in (
    'pending', 'claimed', 'completed', 'failed', 'dead_letter',
    'reconciliation_required', 'cancelled', 'suppressed'
  )),
  add column lease_token uuid,
  add column handler_version integer not null default 1 check (handler_version > 0),
  add column module_id text check (
    module_id is null or module_id ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  add column channel text check (channel is null or channel in ('email', 'sms')),
  add column provider_key text check (
    provider_key is null or provider_key ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  add column purpose text check (
    purpose is null or purpose ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  add column contact_id uuid,
  add column failure_classification text check (
    failure_classification is null or failure_classification in (
      'none', 'transient', 'permanent', 'reconciliation-required'
    )
  ),
  add column provider_reference text check (
    provider_reference is null or char_length(provider_reference) <= 500
  ),
  add column updated_at timestamptz not null default now(),
  add constraint builder_outbox_contact_fk
    foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  add constraint builder_outbox_lease_shape_check check (
    (status = 'claimed') =
    (lease_owner is not null and lease_expires_at is not null)
  );

create table public.builder_outbox_attempts (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  outbox_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  worker_id text not null check (char_length(worker_id) between 1 and 255),
  lease_token uuid not null,
  transition text not null check (transition in (
    'completed', 'retry_scheduled', 'dead_letter', 'reconciliation_required',
    'cancelled', 'suppressed', 'lease_expired'
  )),
  failure_classification text check (
    failure_classification is null or failure_classification in (
      'none', 'transient', 'permanent', 'reconciliation-required'
    )
  ),
  result_code text check (result_code is null or char_length(result_code) <= 255),
  error_code text check (error_code is null or char_length(error_code) <= 255),
  provider_reference text check (
    provider_reference is null or char_length(provider_reference) <= 500
  ),
  retry_at timestamptz,
  recorded_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, outbox_id, attempt_number),
  unique (site_id, outbox_id, lease_token),
  foreign key (site_id, outbox_id)
    references public.builder_outbox(site_id, id) on delete restrict
);

create trigger builder_outbox_attempts_append_only
before update or delete on public.builder_outbox_attempts
for each row execute function builder_private.reject_append_only_change();

create index builder_outbox_dead_letter_idx
  on public.builder_outbox (site_id, updated_at desc)
  where status in ('dead_letter', 'reconciliation_required');

create table public.builder_member_notification_preferences (
  site_id uuid not null,
  member_id uuid not null,
  category text not null check (category ~ '^[a-z][a-z0-9._-]{0,127}$'),
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  sms_enabled boolean not null default false,
  email_destination_reference uuid,
  sms_destination_reference uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, member_id, category),
  foreign key (site_id, member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (not email_enabled or email_destination_reference is not null),
  check (not sms_enabled or sms_destination_reference is not null)
);

alter table public.builder_tasks
  add column task_kind text not null default 'general' check (
    task_kind in ('general', 'owner_reminder')
  ),
  add column idempotency_key text,
  add column recurrence jsonb check (
    recurrence is null or (
      jsonb_typeof(recurrence) = 'object'
      and octet_length(recurrence::text) <= 4096
    )
  ),
  add column paused_at timestamptz,
  add column snoozed_until timestamptz;

alter table public.builder_tasks
  add constraint builder_tasks_idempotency_unique unique (site_id, idempotency_key);

create table public.builder_task_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  task_id uuid not null,
  event_type text not null check (event_type in (
    'created', 'assigned', 'due', 'snoozed', 'paused', 'resumed',
    'completed', 'cancelled'
  )),
  actor_id uuid,
  target_member_id uuid,
  reason_code text check (
    reason_code is null or reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 8192
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, task_id)
    references public.builder_tasks(site_id, id) on delete restrict,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, target_member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create trigger builder_task_events_append_only
before update or delete on public.builder_task_events
for each row execute function builder_private.reject_append_only_change();

alter table public.builder_record_assignments
  drop constraint builder_record_assignments_resource_type_check,
  add constraint builder_record_assignments_resource_type_check check (
    resource_type in ('lead', 'customer', 'task', 'conversation', 'project', 'booking')
  );

alter table public.builder_record_access_edges
  drop constraint builder_record_access_edges_registry_check,
  add constraint builder_record_access_edges_registry_check check (
    (child_resource_type = 'customer' and parent_resource_type = 'lead')
    or (
      child_resource_type = 'task'
      and parent_resource_type in ('lead', 'customer', 'project', 'task', 'booking')
    )
    or (
      child_resource_type = 'conversation'
      and parent_resource_type in ('lead', 'customer', 'project', 'task', 'booking')
    )
  );

alter table public.builder_in_app_notifications
  drop constraint if exists builder_in_app_notifications_resource_type_check;
alter table public.builder_in_app_notifications
  add constraint builder_in_app_notifications_resource_type_check check (
    resource_type is null or resource_type in (
      'lead', 'customer', 'task', 'submission', 'site', 'booking', 'reminder'
    )
  ),
  add column idempotency_key text,
  add column version integer not null default 1 check (version > 0);

update public.builder_in_app_notifications
set idempotency_key = 'legacy-notification:' || id::text
where idempotency_key is null;

alter table public.builder_in_app_notifications
  add constraint builder_notifications_idempotency_unique
    unique (site_id, idempotency_key);

create table builder_private.builder_usage_policies (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  meter text not null check (meter in (
    'email_messages', 'sms_messages', 'ai_requests',
    'ai_input_tokens', 'ai_output_tokens', 'ai_cost_micros'
  )),
  period_key text not null check (period_key ~ '^[0-9]{4}-[0-9]{2}$'),
  hard_limit bigint not null check (hard_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, meter, period_key)
);

create table public.builder_usage_summaries (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  meter text not null check (meter in (
    'email_messages', 'sms_messages', 'ai_requests',
    'ai_input_tokens', 'ai_output_tokens', 'ai_cost_micros'
  )),
  period_key text not null check (period_key ~ '^[0-9]{4}-[0-9]{2}$'),
  hard_limit bigint not null check (hard_limit >= 0),
  used bigint not null default 0 check (used >= 0),
  reserved bigint not null default 0 check (reserved >= 0),
  status text generated always as (
    case when used + reserved >= hard_limit then 'limited' else 'available' end
  ) stored,
  updated_at timestamptz not null default now(),
  primary key (site_id, meter, period_key)
);

create table builder_private.builder_usage_reservations (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  meter text not null,
  period_key text not null,
  quantity bigint not null check (quantity > 0),
  actual_quantity bigint check (actual_quantity is null or actual_quantity >= 0),
  state text not null default 'reserved' check (
    state in ('reserved', 'committed', 'released', 'reconciliation_required')
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  reason_code text check (
    reason_code is null or reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, meter, period_key)
    references builder_private.builder_usage_policies(site_id, meter, period_key)
    on delete restrict
);

alter table public.builder_provider_connections enable row level security;
alter table public.builder_emergency_pauses enable row level security;
alter table public.builder_outbox_attempts enable row level security;
alter table public.builder_member_notification_preferences enable row level security;
alter table public.builder_task_events enable row level security;
alter table public.builder_usage_summaries enable row level security;

create policy builder_provider_connections_read
on public.builder_provider_connections for select to authenticated
using (
  builder_private.member_has_capability(
    site_id,
    (select auth.uid()),
    'integrations.manage',
    'site'
  )
  or builder_private.member_has_capability(
    site_id,
    (select auth.uid()),
    'siteHealth.read',
    null
  )
);

create policy builder_emergency_pauses_read
on public.builder_emergency_pauses for select to authenticated
using (
  builder_private.member_has_capability(
    site_id,
    (select auth.uid()),
    'emergencyPause.manage',
    'site'
  )
  or builder_private.member_has_capability(
    site_id,
    (select auth.uid()),
    'siteHealth.read',
    null
  )
);

create policy builder_outbox_attempts_read
on public.builder_outbox_attempts for select to authenticated
using (
  builder_private.member_has_capability(
    site_id,
    (select auth.uid()),
    'siteHealth.read',
    null
  )
);

create policy builder_member_notification_preferences_read
on public.builder_member_notification_preferences for select to authenticated
using (member_id = (select auth.uid()));

create policy builder_member_notification_preferences_insert
on public.builder_member_notification_preferences for insert to authenticated
with check (
  member_id = (select auth.uid())
  and exists (
    select 1
    from public.builder_site_members member
    where member.site_id = builder_member_notification_preferences.site_id
      and member.user_id = (select auth.uid())
  )
);

create policy builder_member_notification_preferences_update
on public.builder_member_notification_preferences for update to authenticated
using (member_id = (select auth.uid()))
with check (member_id = (select auth.uid()));

create policy builder_task_events_read
on public.builder_task_events for select to authenticated
using (
  builder_private.member_can_access_growth_record(
    site_id,
    (select auth.uid()),
    'tasks.read',
    'task',
    task_id
  )
);

create policy builder_usage_summaries_read
on public.builder_usage_summaries for select to authenticated
using (
  builder_private.member_has_capability(
    site_id,
    (select auth.uid()),
    'siteHealth.read',
    null
  )
  or builder_private.member_has_capability(
    site_id,
    (select auth.uid()),
    'billing.manage',
    'site'
  )
);

revoke all on table
  public.builder_provider_connections,
  public.builder_emergency_pauses,
  public.builder_outbox_attempts,
  public.builder_member_notification_preferences,
  public.builder_task_events,
  public.builder_usage_summaries,
  builder_private.builder_provider_connection_secrets,
  builder_private.builder_provider_webhook_receipts,
  builder_private.builder_usage_policies,
  builder_private.builder_usage_reservations
from public, anon, authenticated, service_role;

grant select on
  public.builder_provider_connections,
  public.builder_emergency_pauses,
  public.builder_outbox_attempts,
  public.builder_task_events,
  public.builder_usage_summaries
to authenticated;

grant select, insert, update on
  public.builder_member_notification_preferences
to authenticated;

create function public.builder_claim_outbox_work_v2(
  p_site_id uuid,
  p_worker text,
  p_now timestamptz,
  p_lease_seconds integer default 60,
  p_limit integer default 20
)
returns setof public.builder_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.builder_outbox%rowtype;
  v_claimed public.builder_outbox%rowtype;
  v_consent_purpose text;
begin
  if p_site_id is null
    or p_worker is null
    or char_length(trim(p_worker)) not between 1 and 255
    or p_now is null
  then
    raise exception 'invalid outbox claim' using errcode = '22023';
  end if;

  for v_candidate in
    select item.*
    from public.builder_outbox item
    where item.site_id = p_site_id
      and item.available_at <= p_now
      and (
        item.status = 'pending'
        or (
          item.status = 'claimed'
          and item.lease_expires_at < p_now
        )
      )
    order by item.available_at, item.created_at, item.id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  loop
    if exists (
      select 1
      from public.builder_emergency_pauses pause
      where pause.site_id = v_candidate.site_id
        and pause.active
        and (
          (pause.scope = 'site' and pause.scope_key = v_candidate.site_id::text)
          or (pause.scope = 'module' and pause.scope_key = v_candidate.module_id)
          or (pause.scope = 'channel' and pause.scope_key = v_candidate.channel)
          or (pause.scope = 'provider' and pause.scope_key = v_candidate.provider_key)
        )
    ) then
      continue;
    end if;

    if v_candidate.contact_id is not null and v_candidate.channel is not null then
      if exists (
        select 1
        from public.builder_suppressions suppression
        where suppression.site_id = v_candidate.site_id
          and suppression.contact_id = v_candidate.contact_id
          and suppression.channel = v_candidate.channel
          and suppression.active
      ) then
        continue;
      end if;

      v_consent_purpose := case
        when v_candidate.purpose = 'marketing_reengagement' and v_candidate.channel = 'email'
          then 'marketing_email'
        when v_candidate.purpose = 'marketing_reengagement' and v_candidate.channel = 'sms'
          then 'marketing_sms'
        else v_candidate.purpose
      end;

      if v_candidate.purpose in ('marketing_reengagement', 'customer_requested_recurring')
        and coalesce((
          select consent.state
          from public.builder_consents consent
          where consent.site_id = v_candidate.site_id
            and consent.contact_id = v_candidate.contact_id
            and consent.channel = v_candidate.channel
            and consent.purpose = v_consent_purpose
          order by consent.captured_at desc, consent.created_at desc, consent.id desc
          limit 1
        ), 'revoked') <> 'granted'
      then
        continue;
      end if;

      if exists (
        select 1
        from public.builder_consents consent
        where consent.site_id = v_candidate.site_id
          and consent.contact_id = v_candidate.contact_id
          and consent.channel = v_candidate.channel
          and consent.purpose = v_consent_purpose
          and consent.state = 'revoked'
          and not exists (
            select 1
            from public.builder_consents newer
            where newer.site_id = consent.site_id
              and newer.contact_id = consent.contact_id
              and newer.channel = consent.channel
              and newer.purpose = consent.purpose
              and (
                newer.captured_at,
                newer.created_at,
                newer.id
              ) > (
                consent.captured_at,
                consent.created_at,
                consent.id
              )
          )
      ) then
        continue;
      end if;
    end if;

    if v_candidate.status = 'claimed' then
      insert into public.builder_outbox_attempts (
        site_id,
        outbox_id,
        attempt_number,
        worker_id,
        lease_token,
        transition,
        failure_classification,
        error_code,
        recorded_at
      ) values (
        v_candidate.site_id,
        v_candidate.id,
        v_candidate.attempt_count,
        v_candidate.lease_owner,
        v_candidate.lease_token,
        'lease_expired',
        'transient',
        'lease_expired',
        p_now
      ) on conflict (site_id, outbox_id, attempt_number) do nothing;
    end if;

    update public.builder_outbox item
    set status = 'claimed',
        lease_owner = p_worker,
        lease_token = gen_random_uuid(),
        lease_expires_at = p_now + make_interval(secs => greatest(5, p_lease_seconds)),
        attempt_count = item.attempt_count + 1,
        updated_at = p_now
    where item.site_id = v_candidate.site_id
      and item.id = v_candidate.id
    returning item.* into v_claimed;

    return next v_claimed;
  end loop;
end;
$$;

create function public.builder_complete_outbox_work_v2(
  p_site_id uuid,
  p_outbox_id uuid,
  p_worker text,
  p_lease_token uuid,
  p_attempt integer,
  p_now timestamptz,
  p_result_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.builder_outbox%rowtype;
begin
  if exists (
    select 1
    from public.builder_outbox_attempts attempt
    where attempt.site_id = p_site_id
      and attempt.outbox_id = p_outbox_id
      and attempt.attempt_number = p_attempt
      and attempt.lease_token = p_lease_token
      and attempt.transition = 'completed'
  ) then
    return jsonb_build_object(
      'status', 'replayed',
      'outboxId', p_outbox_id,
      'attempt', p_attempt
    );
  end if;

  select item.* into v_item
  from public.builder_outbox item
  where item.site_id = p_site_id and item.id = p_outbox_id
  for update;

  if v_item.id is null
    or v_item.status <> 'claimed'
    or v_item.lease_owner <> p_worker
    or v_item.lease_token <> p_lease_token
    or v_item.attempt_count <> p_attempt
    or v_item.lease_expires_at < p_now
  then
    return jsonb_build_object(
      'status', 'conflict',
      'reason', 'stale_or_expired_lease'
    );
  end if;

  update public.builder_outbox
  set status = 'completed',
      completed_at = p_now,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      failure_classification = 'none',
      updated_at = p_now
  where site_id = p_site_id and id = p_outbox_id;

  insert into public.builder_outbox_attempts (
    site_id,
    outbox_id,
    attempt_number,
    worker_id,
    lease_token,
    transition,
    failure_classification,
    result_code,
    recorded_at
  ) values (
    p_site_id,
    p_outbox_id,
    p_attempt,
    p_worker,
    p_lease_token,
    'completed',
    'none',
    left(p_result_code, 255),
    p_now
  );

  return jsonb_build_object(
    'status', 'applied',
    'outboxId', p_outbox_id,
    'attempt', p_attempt
  );
end;
$$;

create function public.builder_fail_outbox_work_v2(
  p_site_id uuid,
  p_outbox_id uuid,
  p_worker text,
  p_lease_token uuid,
  p_attempt integer,
  p_now timestamptz,
  p_error_code text,
  p_classification text,
  p_retry_at timestamptz default null,
  p_provider_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.builder_outbox%rowtype;
  v_status text;
  v_transition text;
begin
  if p_classification not in ('transient', 'permanent', 'reconciliation-required') then
    raise exception 'invalid outbox failure classification' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.builder_outbox_attempts attempt
    where attempt.site_id = p_site_id
      and attempt.outbox_id = p_outbox_id
      and attempt.attempt_number = p_attempt
      and attempt.lease_token = p_lease_token
  ) then
    return jsonb_build_object(
      'status', 'replayed',
      'outboxId', p_outbox_id,
      'attempt', p_attempt
    );
  end if;

  select item.* into v_item
  from public.builder_outbox item
  where item.site_id = p_site_id and item.id = p_outbox_id
  for update;

  if v_item.id is null
    or v_item.status <> 'claimed'
    or v_item.lease_owner <> p_worker
    or v_item.lease_token <> p_lease_token
    or v_item.attempt_count <> p_attempt
    or v_item.lease_expires_at < p_now
  then
    return jsonb_build_object(
      'status', 'conflict',
      'reason', 'stale_or_expired_lease'
    );
  end if;

  if p_classification = 'transient' then
    v_status := 'pending';
    v_transition := 'retry_scheduled';
    if p_retry_at is null or p_retry_at <= p_now then
      raise exception 'retry_at must be in the future' using errcode = '22023';
    end if;
  elsif p_classification = 'permanent' then
    v_status := 'dead_letter';
    v_transition := 'dead_letter';
  else
    v_status := 'reconciliation_required';
    v_transition := 'reconciliation_required';
  end if;

  update public.builder_outbox
  set status = v_status,
      available_at = case when v_status = 'pending' then p_retry_at else available_at end,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      last_error = left(p_error_code, 2000),
      failure_classification = p_classification,
      provider_reference = left(p_provider_reference, 500),
      updated_at = p_now
  where site_id = p_site_id and id = p_outbox_id;

  insert into public.builder_outbox_attempts (
    site_id,
    outbox_id,
    attempt_number,
    worker_id,
    lease_token,
    transition,
    failure_classification,
    error_code,
    provider_reference,
    retry_at,
    recorded_at
  ) values (
    p_site_id,
    p_outbox_id,
    p_attempt,
    p_worker,
    p_lease_token,
    v_transition,
    p_classification,
    left(p_error_code, 255),
    left(p_provider_reference, 500),
    p_retry_at,
    p_now
  );

  return jsonb_build_object(
    'status', 'applied',
    'outboxId', p_outbox_id,
    'attempt', p_attempt,
    'outboxStatus', v_status
  );
end;
$$;

create function public.builder_reserve_site_usage_v1(
  p_site_id uuid,
  p_meter text,
  p_period_key text,
  p_quantity bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy builder_private.builder_usage_policies%rowtype;
  v_summary public.builder_usage_summaries%rowtype;
  v_reservation builder_private.builder_usage_reservations%rowtype;
begin
  if p_quantity <= 0 or char_length(coalesce(p_idempotency_key, '')) not between 1 and 255 then
    raise exception 'invalid usage reservation' using errcode = '22023';
  end if;

  select reservation.* into v_reservation
  from builder_private.builder_usage_reservations reservation
  where reservation.site_id = p_site_id
    and reservation.idempotency_key = p_idempotency_key;
  if v_reservation.id is not null then
    return jsonb_build_object(
      'status', 'replayed',
      'reservationId', v_reservation.id,
      'state', v_reservation.state
    );
  end if;

  select policy.* into v_policy
  from builder_private.builder_usage_policies policy
  where policy.site_id = p_site_id
    and policy.meter = p_meter
    and policy.period_key = p_period_key
  for update;
  if v_policy.site_id is null then
    return jsonb_build_object('status', 'limited', 'reasonCode', 'policy_missing');
  end if;

  insert into public.builder_usage_summaries (
    site_id,
    meter,
    period_key,
    hard_limit
  ) values (
    p_site_id,
    p_meter,
    p_period_key,
    v_policy.hard_limit
  ) on conflict (site_id, meter, period_key) do update
  set hard_limit = excluded.hard_limit,
      updated_at = statement_timestamp();

  select summary.* into v_summary
  from public.builder_usage_summaries summary
  where summary.site_id = p_site_id
    and summary.meter = p_meter
    and summary.period_key = p_period_key
  for update;

  if v_summary.used + v_summary.reserved + p_quantity > v_policy.hard_limit then
    return jsonb_build_object(
      'status', 'limited',
      'reasonCode', 'site_limit_exceeded',
      'remaining', greatest(0, v_policy.hard_limit - v_summary.used - v_summary.reserved)
    );
  end if;

  insert into builder_private.builder_usage_reservations (
    site_id,
    meter,
    period_key,
    quantity,
    idempotency_key
  ) values (
    p_site_id,
    p_meter,
    p_period_key,
    p_quantity,
    p_idempotency_key
  ) returning * into v_reservation;

  update public.builder_usage_summaries
  set reserved = reserved + p_quantity,
      updated_at = statement_timestamp()
  where site_id = p_site_id
    and meter = p_meter
    and period_key = p_period_key;

  return jsonb_build_object(
    'status', 'reserved',
    'reservationId', v_reservation.id,
    'quantity', p_quantity
  );
end;
$$;

create function public.builder_commit_site_usage_v1(
  p_site_id uuid,
  p_reservation_id uuid,
  p_actual_quantity bigint,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation builder_private.builder_usage_reservations%rowtype;
begin
  if p_actual_quantity < 0 then
    raise exception 'invalid actual usage' using errcode = '22023';
  end if;
  select reservation.* into v_reservation
  from builder_private.builder_usage_reservations reservation
  where reservation.site_id = p_site_id and reservation.id = p_reservation_id
  for update;
  if v_reservation.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_reservation.state = 'committed' then
    return jsonb_build_object(
      'status', 'replayed',
      'reservationId', v_reservation.id,
      'actualQuantity', v_reservation.actual_quantity
    );
  end if;
  if v_reservation.state <> 'reserved' then
    return jsonb_build_object('status', 'conflict', 'state', v_reservation.state);
  end if;

  update builder_private.builder_usage_reservations
  set state = 'committed',
      actual_quantity = p_actual_quantity,
      reason_code = p_reason_code,
      updated_at = statement_timestamp()
  where site_id = p_site_id and id = p_reservation_id;

  update public.builder_usage_summaries
  set reserved = greatest(0, reserved - v_reservation.quantity),
      used = used + p_actual_quantity,
      updated_at = statement_timestamp()
  where site_id = p_site_id
    and meter = v_reservation.meter
    and period_key = v_reservation.period_key;

  return jsonb_build_object(
    'status', 'committed',
    'reservationId', p_reservation_id,
    'actualQuantity', p_actual_quantity
  );
end;
$$;

create function public.builder_release_site_usage_v1(
  p_site_id uuid,
  p_reservation_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation builder_private.builder_usage_reservations%rowtype;
begin
  select reservation.* into v_reservation
  from builder_private.builder_usage_reservations reservation
  where reservation.site_id = p_site_id and reservation.id = p_reservation_id
  for update;
  if v_reservation.id is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_reservation.state = 'released' then
    return jsonb_build_object('status', 'replayed', 'reservationId', p_reservation_id);
  end if;
  if v_reservation.state <> 'reserved' then
    return jsonb_build_object('status', 'conflict', 'state', v_reservation.state);
  end if;

  update builder_private.builder_usage_reservations
  set state = 'released',
      reason_code = p_reason_code,
      updated_at = statement_timestamp()
  where site_id = p_site_id and id = p_reservation_id;

  update public.builder_usage_summaries
  set reserved = greatest(0, reserved - v_reservation.quantity),
      updated_at = statement_timestamp()
  where site_id = p_site_id
    and meter = v_reservation.meter
    and period_key = v_reservation.period_key;

  return jsonb_build_object('status', 'released', 'reservationId', p_reservation_id);
end;
$$;

revoke all on function
  public.builder_claim_outbox_work_v2(uuid,text,timestamptz,integer,integer),
  public.builder_complete_outbox_work_v2(uuid,uuid,text,uuid,integer,timestamptz,text),
  public.builder_fail_outbox_work_v2(uuid,uuid,text,uuid,integer,timestamptz,text,text,timestamptz,text),
  public.builder_reserve_site_usage_v1(uuid,text,text,bigint,text),
  public.builder_commit_site_usage_v1(uuid,uuid,bigint,text),
  public.builder_release_site_usage_v1(uuid,uuid,text)
from public, anon, authenticated;

grant execute on function
  public.builder_claim_outbox_work_v2(uuid,text,timestamptz,integer,integer),
  public.builder_complete_outbox_work_v2(uuid,uuid,text,uuid,integer,timestamptz,text),
  public.builder_fail_outbox_work_v2(uuid,uuid,text,uuid,integer,timestamptz,text,text,timestamptz,text),
  public.builder_reserve_site_usage_v1(uuid,text,text,bigint,text),
  public.builder_commit_site_usage_v1(uuid,uuid,bigint,text),
  public.builder_release_site_usage_v1(uuid,uuid,text)
to service_role;
