alter table public.builder_outbox
  drop constraint if exists builder_outbox_channel_check;
alter table public.builder_outbox
  add constraint builder_outbox_channel_check check (
    channel is null or channel in ('email', 'sms', 'website_chat')
  );

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
      'growth.bookings', 'growth.messaging'
    )
    or p_action not in ('read', 'write', 'outbound', 'export')
  then
    return false;
  end if;

  select *
  into v_snapshot
  from builder_private.builder_verified_entitlement_snapshots
  where id = p_snapshot_id;

  if not found or v_snapshot.issued_at > p_now then return false; end if;

  select *
  into v_module
  from builder_private.builder_verified_entitlement_snapshot_modules
  where snapshot_id = p_snapshot_id
    and module_id = p_module_id;

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
        v_module.state,
        v_module.grace_ends_at,
        'read',
        p_now
      );
  end if;

  if p_now <= v_snapshot.expires_at then
    return builder_private.entitlement_state_action_allowed(
      v_module.state,
      v_module.grace_ends_at,
      p_action,
      p_now
    );
  end if;
  if v_snapshot.has_prior_valid_snapshot
    and p_now <= v_snapshot.outage_window_ends_at
  then
    return builder_private.entitlement_state_action_allowed(
      v_module.state,
      v_module.grace_ends_at,
      p_action,
      p_now
    );
  end if;
  if v_snapshot.has_prior_valid_snapshot then
    return p_action = 'read'
      and builder_private.entitlement_state_action_allowed(
        v_module.state,
        v_module.grace_ends_at,
        'read',
        p_now
      );
  end if;
  return false;
end;
$$;

create or replace function public.builder_claim_outbox_work_v2(
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
        when v_candidate.purpose = 'marketing_reengagement'
          and v_candidate.channel = 'email'
          then 'marketing_email'
        when v_candidate.purpose = 'marketing_reengagement'
          and v_candidate.channel = 'sms'
          then 'marketing_sms'
        else v_candidate.purpose
      end;

      if v_candidate.purpose in (
        'marketing_reengagement',
        'customer_requested_recurring',
        'marketing_email',
        'marketing_sms'
      ) and coalesce((
        select consent.state
        from public.builder_consents consent
        where consent.site_id = v_candidate.site_id
          and consent.contact_id = v_candidate.contact_id
          and consent.channel = v_candidate.channel
          and consent.purpose = v_consent_purpose
        order by
          consent.captured_at desc,
          consent.created_at desc,
          consent.id desc
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
        lease_expires_at =
          p_now + make_interval(secs => greatest(5, p_lease_seconds)),
        attempt_count = item.attempt_count + 1,
        updated_at = p_now
    where item.site_id = v_candidate.site_id
      and item.id = v_candidate.id
    returning item.* into v_claimed;

    return next v_claimed;
  end loop;
end;
$$;

create table public.builder_messaging_conversations (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  channel text not null check (channel in ('email', 'sms', 'website_chat')),
  purpose text not null check (purpose in (
    'operational', 'transactional_booking', 'marketing_email', 'marketing_sms',
    'public_office_constituent_service', 'public_office_campaign'
  )),
  state text not null default 'new' check (state in (
    'new', 'ai_qualifying', 'assigned', 'waiting_on_customer',
    'waiting_on_staff', 'resolved', 'spam', 'archived'
  )),
  assigned_member_id uuid,
  unread_count integer not null default 0 check (unread_count >= 0),
  tag_ids uuid[] not null default '{}'::uuid[],
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, assigned_member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  constraint builder_message_channel_purpose_check check (
    (purpose = 'marketing_email' and channel = 'email')
    or (purpose = 'marketing_sms' and channel = 'sms')
    or purpose not in ('marketing_email', 'marketing_sms')
  )
);

create table public.builder_messaging_conversation_participants (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  role text not null check (role in ('customer', 'visitor', 'member', 'system')),
  contact_id uuid,
  member_id uuid,
  joined_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (site_id, conversation_id, id),
  foreign key (site_id, conversation_id)
    references public.builder_messaging_conversations(site_id, id) on delete cascade,
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (
    (role = 'customer' and contact_id is not null and member_id is null)
    or (role = 'member' and member_id is not null and contact_id is null)
    or (role in ('visitor', 'system') and member_id is null)
  )
);

create unique index builder_messaging_participant_contact_idx
  on public.builder_messaging_conversation_participants (
    site_id, conversation_id, contact_id
  ) where contact_id is not null;
create unique index builder_messaging_participant_member_idx
  on public.builder_messaging_conversation_participants (
    site_id, conversation_id, member_id
  ) where member_id is not null;

create table public.builder_messaging_conversation_assignments (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  member_id uuid not null,
  assigned_by_member_id uuid not null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  version integer not null default 1 check (version > 0),
  primary key (site_id, id),
  foreign key (site_id, conversation_id)
    references public.builder_messaging_conversations(site_id, id) on delete cascade,
  foreign key (site_id, member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, assigned_by_member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (ended_at is null or ended_at >= assigned_at)
);

create unique index builder_messaging_active_assignment_idx
  on public.builder_messaging_conversation_assignments (
    site_id, conversation_id
  ) where ended_at is null;

create table public.builder_message_templates (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  stable_key text not null check (stable_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  channel text not null check (channel in ('email', 'sms', 'website_chat')),
  purpose text not null check (purpose in (
    'operational', 'transactional_booking', 'marketing_email', 'marketing_sms',
    'public_office_constituent_service', 'public_office_campaign'
  )),
  current_revision_id uuid,
  state text not null default 'draft' check (state in ('draft', 'published', 'retired')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, stable_key),
  unique (site_id, id, channel, purpose),
  check (
    (purpose = 'marketing_email' and channel = 'email')
    or (purpose = 'marketing_sms' and channel = 'sms')
    or purpose not in ('marketing_email', 'marketing_sms')
  )
);

create table public.builder_message_template_revisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  template_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  channel text not null check (channel in ('email', 'sms', 'website_chat')),
  purpose text not null check (purpose in (
    'operational', 'transactional_booking', 'marketing_email', 'marketing_sms',
    'public_office_constituent_service', 'public_office_campaign'
  )),
  subject text check (subject is null or char_length(subject) between 1 and 500),
  body text not null check (char_length(body) between 1 and 50000),
  variable_keys text[] not null default '{}'::text[],
  state text not null default 'draft' check (state in ('draft', 'published', 'retired')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, template_id, revision_number),
  unique (site_id, template_id, id),
  foreign key (site_id, template_id, channel, purpose)
    references public.builder_message_templates(site_id, id, channel, purpose)
    on delete cascade,
  check ((channel = 'email') = (subject is not null)),
  check ((state = 'published') = (published_at is not null)),
  check (
    (purpose = 'marketing_email' and channel = 'email')
    or (purpose = 'marketing_sms' and channel = 'sms')
    or purpose not in ('marketing_email', 'marketing_sms')
  )
);

alter table public.builder_message_templates
  add constraint builder_message_templates_current_revision_fk
  foreign key (site_id, id, current_revision_id)
  references public.builder_message_template_revisions(site_id, template_id, id)
  on delete restrict;

create table public.builder_messaging_senders (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  connection_id uuid,
  channel text not null check (channel in ('email', 'sms', 'website_chat')),
  stable_key text not null check (stable_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null check (char_length(display_name) between 1 and 200),
  sender_reference text not null check (char_length(sender_reference) between 1 and 500),
  state text not null default 'pending' check (
    state in ('pending', 'verified', 'degraded', 'disabled')
  ),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, stable_key),
  foreign key (site_id, connection_id)
    references public.builder_provider_connections(site_id, id) on delete restrict,
  check (channel = 'website_chat' or connection_id is not null)
);

create table public.builder_messages (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),
  channel text not null check (channel in ('email', 'sms', 'website_chat')),
  purpose text not null check (purpose in (
    'operational', 'transactional_booking', 'marketing_email', 'marketing_sms',
    'public_office_constituent_service', 'public_office_campaign'
  )),
  author_type text not null check (author_type in ('member', 'provider', 'visitor', 'system')),
  author_id text check (author_id is null or char_length(author_id) between 1 and 500),
  body_format text not null default 'plain_text' check (
    body_format in ('plain_text', 'rich_text')
  ),
  body text not null check (char_length(body) between 1 and 50000),
  template_revision_id uuid,
  state text not null check (
    state in ('draft', 'received', 'delivery_requested', 'sent', 'failed', 'redacted')
  ),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, conversation_id, id),
  foreign key (site_id, conversation_id)
    references public.builder_messaging_conversations(site_id, id) on delete cascade,
  foreign key (site_id, template_revision_id)
    references public.builder_message_template_revisions(site_id, id) on delete restrict,
  check (
    (purpose = 'marketing_email' and channel = 'email')
    or (purpose = 'marketing_sms' and channel = 'sms')
    or purpose not in ('marketing_email', 'marketing_sms')
  ),
  check (
    (author_type in ('member', 'provider') and author_id is not null)
    or author_type in ('visitor', 'system')
  )
);

create table public.builder_message_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  message_id uuid not null,
  conversation_id uuid not null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
  actor_type text not null check (actor_type in ('member', 'provider', 'visitor', 'system')),
  actor_id text check (actor_id is null or char_length(actor_id) between 1 and 500),
  from_state text,
  to_state text,
  sanitized_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(sanitized_metadata) = 'object'
    and octet_length(sanitized_metadata::text) <= 16384
    and sanitized_metadata::text !~* '"[^"]*(body|destination|email|phone|token|secret|credential|authorization)[^"]*"'
  ),
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, conversation_id, message_id)
    references public.builder_messages(site_id, conversation_id, id) on delete restrict
);

create trigger builder_message_events_append_only
before update or delete on public.builder_message_events
for each row execute function builder_private.reject_append_only_change();

create table public.builder_message_deliveries (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  message_id uuid not null,
  conversation_id uuid not null,
  contact_id uuid not null,
  sender_id uuid not null,
  destination_reference text not null check (
    char_length(destination_reference) between 1 and 500
  ),
  channel text not null check (channel in ('email', 'sms', 'website_chat')),
  purpose text not null check (purpose in (
    'operational', 'transactional_booking', 'marketing_email', 'marketing_sms',
    'public_office_constituent_service', 'public_office_campaign'
  )),
  state text not null default 'requested' check (state in (
    'requested', 'authorized', 'held', 'claimed', 'submitted', 'accepted',
    'delivered', 'failed_retryable', 'failed_terminal', 'suppressed',
    'cancelled', 'reconciliation_required'
  )),
  attempt integer not null default 0 check (attempt >= 0),
  version integer not null default 1 check (version > 0),
  policy_decision_id uuid,
  worker_id text check (worker_id is null or char_length(worker_id) between 1 and 255),
  lease_token uuid,
  provider_reference text check (
    provider_reference is null or char_length(provider_reference) <= 500
  ),
  reason_code text check (
    reason_code is null or reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  retry_at timestamptz,
  outbox_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  correlation_id uuid not null,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  unique (site_id, outbox_id),
  foreign key (site_id, conversation_id, message_id)
    references public.builder_messages(site_id, conversation_id, id) on delete restrict,
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, sender_id)
    references public.builder_messaging_senders(site_id, id) on delete restrict,
  foreign key (site_id, outbox_id)
    references public.builder_outbox(site_id, id) on delete restrict,
  check (
    (purpose = 'marketing_email' and channel = 'email')
    or (purpose = 'marketing_sms' and channel = 'sms')
    or purpose not in ('marketing_email', 'marketing_sms')
  )
);

create table public.builder_message_delivery_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  delivery_id uuid not null,
  message_id uuid not null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
  from_state text,
  to_state text not null,
  reason_code text check (
    reason_code is null or reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  provider_reference text check (
    provider_reference is null or char_length(provider_reference) <= 500
  ),
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, delivery_id)
    references public.builder_message_deliveries(site_id, id) on delete restrict,
  foreign key (site_id, message_id)
    references public.builder_messages(site_id, id) on delete restrict
);

create trigger builder_message_delivery_events_append_only
before update or delete on public.builder_message_delivery_events
for each row execute function builder_private.reject_append_only_change();

create table public.builder_message_transport_decisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  delivery_id uuid not null,
  message_id uuid not null,
  action text not null check (action in ('submit', 'hold', 'suppress', 'reject')),
  allowed boolean not null,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  evidence_ids text[] not null default '{}'::text[],
  retry_at timestamptz,
  evaluated_at timestamptz not null,
  attempt integer not null check (attempt > 0),
  policy_version integer not null default 1 check (policy_version > 0),
  primary key (site_id, id),
  unique (site_id, delivery_id, attempt),
  foreign key (site_id, delivery_id)
    references public.builder_message_deliveries(site_id, id) on delete restrict,
  foreign key (site_id, message_id)
    references public.builder_messages(site_id, id) on delete restrict,
  check (allowed = (action = 'submit')),
  check ((action = 'hold') or retry_at is null)
);

create trigger builder_message_transport_decisions_append_only
before update or delete on public.builder_message_transport_decisions
for each row execute function builder_private.reject_append_only_change();

alter table public.builder_message_deliveries
  add constraint builder_message_deliveries_policy_decision_fk
  foreign key (site_id, policy_decision_id)
  references public.builder_message_transport_decisions(site_id, id)
  on delete restrict;

create table public.builder_message_booking_reminder_links (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  delivery_id uuid not null,
  message_id uuid not null,
  reminder_plan_id uuid not null,
  reminder_occurrence_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, delivery_id),
  unique (site_id, reminder_occurrence_id),
  foreign key (site_id, delivery_id)
    references public.builder_message_deliveries(site_id, id) on delete restrict,
  foreign key (site_id, message_id)
    references public.builder_messages(site_id, id) on delete restrict,
  foreign key (site_id, reminder_plan_id)
    references public.builder_booking_reminder_plans(site_id, id) on delete restrict,
  foreign key (site_id, reminder_occurrence_id)
    references public.builder_booking_reminder_occurrences(site_id, id) on delete restrict
);

create index builder_messaging_conversations_updated_idx
  on public.builder_messaging_conversations (site_id, updated_at desc, id);
create index builder_messages_conversation_idx
  on public.builder_messages (site_id, conversation_id, created_at, id);
create index builder_message_deliveries_retry_idx
  on public.builder_message_deliveries (site_id, retry_at, updated_at)
  where state in ('failed_retryable', 'reconciliation_required');
create index builder_message_deliveries_provider_idx
  on public.builder_message_deliveries (site_id, provider_reference)
  where provider_reference is not null;

alter table public.builder_messaging_conversations enable row level security;
alter table public.builder_messaging_conversation_participants enable row level security;
alter table public.builder_messaging_conversation_assignments enable row level security;
alter table public.builder_messages enable row level security;
alter table public.builder_message_events enable row level security;
alter table public.builder_message_deliveries enable row level security;
alter table public.builder_message_delivery_events enable row level security;
alter table public.builder_message_transport_decisions enable row level security;
alter table public.builder_message_templates enable row level security;
alter table public.builder_message_template_revisions enable row level security;
alter table public.builder_messaging_senders enable row level security;
alter table public.builder_message_booking_reminder_links enable row level security;

create or replace function builder_private.resource_exists(
  p_site_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return case p_resource_type
    when 'lead' then exists(
      select 1 from public.builder_leads
      where site_id = p_site_id and id = p_resource_id
    )
    when 'customer' then exists(
      select 1 from public.builder_contacts
      where site_id = p_site_id and id = p_resource_id
    )
    when 'task' then exists(
      select 1 from public.builder_tasks
      where site_id = p_site_id and id = p_resource_id
    )
    when 'booking' then exists(
      select 1 from public.builder_bookings
      where site_id = p_site_id and id = p_resource_id
    )
    when 'conversation' then exists(
      select 1 from public.builder_messaging_conversations
      where site_id = p_site_id and id = p_resource_id
    )
    else false
  end;
end;
$$;

create or replace function builder_private.member_can_access_growth_record(
  p_site_id uuid,
  p_member_id uuid,
  p_capability text,
  p_resource_type text,
  p_resource_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_role text;
  v_site_scope boolean;
  v_assigned_scope boolean;
begin
  select role into v_role
  from public.builder_site_members
  where site_id = p_site_id and user_id = p_member_id;
  if v_role is null then return false; end if;
  if v_role = 'owner' then return true; end if;

  select
    coalesce(bool_or(scope = 'site'), false),
    coalesce(bool_or(scope = 'assigned'), false)
  into v_site_scope, v_assigned_scope
  from public.builder_member_capabilities
  where site_id = p_site_id
    and member_id = p_member_id
    and capability = p_capability;
  if v_site_scope then return true; end if;
  if not v_assigned_scope then return false; end if;

  if p_resource_type = 'conversation'
    and p_capability in ('messages.read', 'messages.draft', 'messages.send')
  then
    if exists(
      select 1
      from public.builder_messaging_conversation_assignments assignment
      where assignment.site_id = p_site_id
        and assignment.conversation_id = p_resource_id
        and assignment.member_id = p_member_id
        and assignment.ended_at is null
    ) then
      return true;
    end if;
  end if;

  if not (
    (p_resource_type = 'lead' and p_capability in ('leads.read', 'leads.update'))
    or (p_resource_type = 'customer' and p_capability in ('customers.read', 'customers.update'))
    or (p_resource_type = 'task' and p_capability in ('tasks.read', 'tasks.manage'))
    or (
      p_resource_type = 'conversation'
      and p_capability in ('messages.read', 'messages.draft', 'messages.send')
    )
    or (p_resource_type = 'project' and p_capability in ('projects.read', 'projects.manage'))
    or (
      p_resource_type = 'booking'
      and p_capability in ('bookings.read', 'bookings.update', 'bookings.checkIn')
    )
  ) then
    return false;
  end if;
  return builder_private.can_access_growth_record_node(
    p_site_id,
    p_member_id,
    p_resource_type,
    p_resource_id,
    0,
    array[]::text[]
  );
end;
$$;

create policy builder_messaging_conversations_read
on public.builder_messaging_conversations for select to authenticated
using (
  builder_private.module_action_allowed(site_id, 'growth.messaging', 'read')
  and builder_private.member_can_access_growth_record(
    site_id, (select auth.uid()), 'messages.read', 'conversation', id
  )
);

create policy builder_messaging_participants_read
on public.builder_messaging_conversation_participants for select to authenticated
using (
  builder_private.module_action_allowed(site_id, 'growth.messaging', 'read')
  and builder_private.member_can_access_growth_record(
    site_id, (select auth.uid()), 'messages.read', 'conversation', conversation_id
  )
);

create policy builder_messaging_assignments_read
on public.builder_messaging_conversation_assignments for select to authenticated
using (
  builder_private.module_action_allowed(site_id, 'growth.messaging', 'read')
  and builder_private.member_can_access_growth_record(
    site_id, (select auth.uid()), 'messages.read', 'conversation', conversation_id
  )
);

create policy builder_messages_read
on public.builder_messages for select to authenticated
using (
  builder_private.module_action_allowed(site_id, 'growth.messaging', 'read')
  and builder_private.member_can_access_growth_record(
    site_id, (select auth.uid()), 'messages.read', 'conversation', conversation_id
  )
);

create policy builder_message_events_read
on public.builder_message_events for select to authenticated
using (
  builder_private.module_action_allowed(site_id, 'growth.messaging', 'read')
  and builder_private.member_can_access_growth_record(
    site_id, (select auth.uid()), 'messages.read', 'conversation', conversation_id
  )
);

create policy builder_message_deliveries_read
on public.builder_message_deliveries for select to authenticated
using (
  builder_private.module_action_allowed(site_id, 'growth.messaging', 'read')
  and builder_private.member_can_access_growth_record(
    site_id, (select auth.uid()), 'messages.read', 'conversation', conversation_id
  )
);

create policy builder_message_delivery_events_read
on public.builder_message_delivery_events for select to authenticated
using (
  exists (
    select 1
    from public.builder_message_deliveries delivery
    where delivery.site_id = builder_message_delivery_events.site_id
      and delivery.id = builder_message_delivery_events.delivery_id
      and builder_private.member_can_access_growth_record(
        delivery.site_id, (select auth.uid()), 'messages.read',
        'conversation', delivery.conversation_id
      )
  )
);

create policy builder_message_transport_decisions_read
on public.builder_message_transport_decisions for select to authenticated
using (
  exists (
    select 1
    from public.builder_message_deliveries delivery
    where delivery.site_id = builder_message_transport_decisions.site_id
      and delivery.id = builder_message_transport_decisions.delivery_id
      and builder_private.member_can_access_growth_record(
        delivery.site_id, (select auth.uid()), 'messages.read',
        'conversation', delivery.conversation_id
      )
  )
);

create policy builder_message_templates_read
on public.builder_message_templates for select to authenticated
using (
  builder_private.module_action_allowed(site_id, 'growth.messaging', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'messages.read', 'site'
  )
);

create policy builder_message_template_revisions_read
on public.builder_message_template_revisions for select to authenticated
using (
  builder_private.module_action_allowed(site_id, 'growth.messaging', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'messages.read', 'site'
  )
);

create policy builder_messaging_senders_read
on public.builder_messaging_senders for select to authenticated
using (
  builder_private.module_action_allowed(site_id, 'growth.messaging', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'messages.read', 'site'
  )
);

create policy builder_message_booking_reminder_links_read
on public.builder_message_booking_reminder_links for select to authenticated
using (
  exists (
    select 1
    from public.builder_message_deliveries delivery
    where delivery.site_id = builder_message_booking_reminder_links.site_id
      and delivery.id = builder_message_booking_reminder_links.delivery_id
      and builder_private.member_can_access_growth_record(
        delivery.site_id, (select auth.uid()), 'messages.read',
        'conversation', delivery.conversation_id
      )
  )
);

revoke all on
  public.builder_messaging_conversations,
  public.builder_messaging_conversation_participants,
  public.builder_messaging_conversation_assignments,
  public.builder_messages,
  public.builder_message_events,
  public.builder_message_deliveries,
  public.builder_message_delivery_events,
  public.builder_message_transport_decisions,
  public.builder_message_templates,
  public.builder_message_template_revisions,
  public.builder_messaging_senders,
  public.builder_message_booking_reminder_links
from anon;

revoke insert, update, delete on
  public.builder_messaging_conversations,
  public.builder_messaging_conversation_participants,
  public.builder_messaging_conversation_assignments,
  public.builder_messages,
  public.builder_message_events,
  public.builder_message_deliveries,
  public.builder_message_delivery_events,
  public.builder_message_transport_decisions,
  public.builder_message_templates,
  public.builder_message_template_revisions,
  public.builder_messaging_senders,
  public.builder_message_booking_reminder_links
from authenticated;

grant select on
  public.builder_messaging_conversations,
  public.builder_messaging_conversation_participants,
  public.builder_messaging_conversation_assignments,
  public.builder_messages,
  public.builder_message_events,
  public.builder_message_deliveries,
  public.builder_message_delivery_events,
  public.builder_message_transport_decisions,
  public.builder_message_templates,
  public.builder_message_template_revisions,
  public.builder_messaging_senders,
  public.builder_message_booking_reminder_links
to authenticated;

grant all on
  public.builder_messaging_conversations,
  public.builder_messaging_conversation_participants,
  public.builder_messaging_conversation_assignments,
  public.builder_messages,
  public.builder_message_events,
  public.builder_message_deliveries,
  public.builder_message_delivery_events,
  public.builder_message_transport_decisions,
  public.builder_message_templates,
  public.builder_message_template_revisions,
  public.builder_messaging_senders,
  public.builder_message_booking_reminder_links
to service_role;

create function builder_private.messaging_replay_result(p_claim jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_set(
    p_claim -> 'result',
    '{status}',
    '"replayed"'::jsonb,
    true
  );
$$;

create function builder_private.record_messaging_message_event_v1(
  p_site_id uuid,
  p_message_id uuid,
  p_conversation_id uuid,
  p_event_type text,
  p_actor_type text,
  p_actor_id text,
  p_from_state text,
  p_to_state text,
  p_correlation_id uuid,
  p_occurred_at timestamptz default now()
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.builder_message_events (
    site_id, message_id, conversation_id, event_type, actor_type, actor_id,
    from_state, to_state, correlation_id, occurred_at
  ) values (
    p_site_id, p_message_id, p_conversation_id, p_event_type, p_actor_type,
    p_actor_id, p_from_state, p_to_state, p_correlation_id, p_occurred_at
  );
$$;

create function builder_private.record_messaging_delivery_event_v1(
  p_site_id uuid,
  p_delivery_id uuid,
  p_message_id uuid,
  p_event_type text,
  p_from_state text,
  p_to_state text,
  p_reason_code text,
  p_provider_reference text,
  p_correlation_id uuid,
  p_occurred_at timestamptz default now()
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.builder_message_delivery_events (
    site_id, delivery_id, message_id, event_type, from_state, to_state,
    reason_code, provider_reference, correlation_id, occurred_at
  ) values (
    p_site_id, p_delivery_id, p_message_id, p_event_type, p_from_state,
    p_to_state, p_reason_code, p_provider_reference, p_correlation_id,
    p_occurred_at
  );
$$;

create function public.builder_apply_messaging_command_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_type text;
  v_payload jsonb;
  v_expected_version integer;
  v_correlation_id uuid;
  v_claim jsonb;
  v_result jsonb;
  v_conversation public.builder_messaging_conversations%rowtype;
  v_message public.builder_messages%rowtype;
  v_delivery public.builder_message_deliveries%rowtype;
  v_sender public.builder_messaging_senders%rowtype;
  v_template public.builder_message_templates%rowtype;
  v_revision public.builder_message_template_revisions%rowtype;
  v_conversation_id uuid;
  v_message_id uuid;
  v_delivery_id uuid;
  v_outbox_id uuid;
  v_contact_id uuid;
  v_target_state text;
  v_from_state text;
  v_reason_code text;
  v_provider_key text;
  v_connection_id uuid;
  v_connection_state text;
  v_participant jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'commandId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'correlationId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or char_length(coalesce(p_request ->> 'idempotencyKey', '')) not between 1 and 255
    or jsonb_typeof(p_request -> 'actor') <> 'object'
    or jsonb_typeof(p_request -> 'payload') <> 'object'
  then
    raise exception 'invalid messaging command envelope' using errcode = '22023';
  end if;

  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_type := p_request #>> '{actor,type}';
  v_actor_id_text := p_request #>> '{actor,id}';
  v_type := p_request ->> 'type';
  v_payload := p_request -> 'payload';
  v_correlation_id := (p_request ->> 'correlationId')::uuid;
  if p_request ? 'expectedVersion' then
    v_expected_version := (p_request ->> 'expectedVersion')::integer;
  end if;

  if v_actor_type not in ('member', 'provider', 'visitor', 'system')
    or (
      v_actor_type in ('member', 'provider')
      and coalesce(v_actor_id_text, '') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    or (
      v_actor_type in ('visitor', 'system')
      and v_actor_id_text is not null
      and char_length(v_actor_id_text) > 500
    )
    or v_type not in (
      'conversation.create', 'conversation.add_participant',
      'conversation.assign', 'conversation.transition',
      'message.create_draft', 'message.revise_draft',
      'message.record_inbound', 'message.request_delivery',
      'delivery.authorize', 'delivery.claim', 'delivery.submit',
      'delivery.reconcile', 'delivery.fail', 'delivery.suppress',
      'delivery.cancel', 'template.publish', 'sender.register'
    )
  then
    raise exception 'invalid messaging command' using errcode = '22023';
  end if;

  if v_actor_type in ('member', 'provider') then
    v_actor_id := v_actor_id_text::uuid;
  end if;
  if v_actor_type = 'member' and not exists (
    select 1 from public.builder_site_members
    where site_id = v_site_id and user_id = v_actor_id
  ) then
    raise exception 'messaging actor is not a site member' using errcode = '42501';
  end if;

  if v_type in (
    'conversation.create', 'message.create_draft',
    'message.record_inbound', 'sender.register'
  ) and p_request ? 'expectedVersion' then
    raise exception 'expectedVersion is forbidden for create commands' using errcode = '22023';
  elsif v_type not in (
    'conversation.create', 'message.create_draft',
    'message.record_inbound', 'sender.register'
  ) and coalesce(v_expected_version, 0) < 1 then
    raise exception 'expectedVersion is required' using errcode = '22023';
  end if;

  if not builder_private.module_action_allowed(v_site_id, 'growth.messaging', 'write') then
    raise exception 'messaging write is not entitled' using errcode = '42501';
  end if;

  v_claim := builder_private.claim_operational_command_v1(
    p_request,
    'growth.messaging.command.v1'
  );
  if v_claim ->> 'status' = 'replay' then
    return builder_private.messaging_replay_result(v_claim);
  end if;

  if v_type = 'conversation.create' then
    if v_actor_type <> 'member'
      or not builder_private.member_has_capability(
        v_site_id, v_actor_id, 'messages.draft', 'site'
      )
      or coalesce(v_payload ->> 'conversationId', '') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or v_payload ->> 'channel' not in ('email', 'sms', 'website_chat')
      or v_payload ->> 'purpose' not in (
        'operational', 'transactional_booking', 'marketing_email', 'marketing_sms',
        'public_office_constituent_service', 'public_office_campaign'
      )
      or jsonb_typeof(v_payload -> 'participantIds') <> 'array'
      or jsonb_array_length(v_payload -> 'participantIds') < 1
      or jsonb_array_length(v_payload -> 'participantIds') > 50
    then
      raise exception 'invalid conversation creation' using errcode = '22023';
    end if;
    v_conversation_id := (v_payload ->> 'conversationId')::uuid;
    insert into public.builder_messaging_conversations (
      site_id, id, channel, purpose
    ) values (
      v_site_id, v_conversation_id, v_payload ->> 'channel',
      v_payload ->> 'purpose'
    );
    for v_participant in
      select value from jsonb_array_elements(v_payload -> 'participantIds')
    loop
      if jsonb_typeof(v_participant) <> 'string'
        or trim(both '"' from v_participant::text) !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then
        raise exception 'invalid conversation participant' using errcode = '22023';
      end if;
      if exists (
        select 1 from public.builder_contacts
        where site_id = v_site_id
          and id = trim(both '"' from v_participant::text)::uuid
      ) then
        insert into public.builder_messaging_conversation_participants (
          site_id, id, conversation_id, role, contact_id
        ) values (
          v_site_id, trim(both '"' from v_participant::text)::uuid,
          v_conversation_id, 'customer',
          trim(both '"' from v_participant::text)::uuid
        );
      elsif exists (
        select 1 from public.builder_site_members
        where site_id = v_site_id
          and user_id = trim(both '"' from v_participant::text)::uuid
      ) then
        insert into public.builder_messaging_conversation_participants (
          site_id, id, conversation_id, role, member_id
        ) values (
          v_site_id, trim(both '"' from v_participant::text)::uuid,
          v_conversation_id, 'member',
          trim(both '"' from v_participant::text)::uuid
        );
      else
        insert into public.builder_messaging_conversation_participants (
          site_id, id, conversation_id, role
        ) values (
          v_site_id, trim(both '"' from v_participant::text)::uuid,
          v_conversation_id, 'visitor'
        );
      end if;
    end loop;
    v_result := jsonb_build_object(
      'version', 1, 'status', 'applied',
      'aggregateId', v_conversation_id, 'aggregateVersion', 1
    );

  elsif v_type in (
    'conversation.add_participant', 'conversation.assign',
    'conversation.transition'
  ) then
    v_conversation_id := (v_payload ->> 'conversationId')::uuid;
    select * into v_conversation
    from public.builder_messaging_conversations
    where site_id = v_site_id and id = v_conversation_id
    for update;
    if v_conversation.id is null
      or v_conversation.version <> v_expected_version
    then
      raise exception 'messaging conversation version conflict' using errcode = '40001';
    end if;

    if v_type = 'conversation.add_participant' then
      if v_actor_type <> 'member'
        or not builder_private.member_can_access_growth_record(
          v_site_id, v_actor_id, 'messages.draft',
          'conversation', v_conversation_id
        )
        or v_payload ->> 'role' not in ('customer', 'visitor', 'member', 'system')
      then
        raise exception 'conversation participant is not authorized' using errcode = '42501';
      end if;
      if v_payload ->> 'role' = 'customer' then
        insert into public.builder_messaging_conversation_participants (
          site_id, id, conversation_id, role, contact_id
        ) values (
          v_site_id, (v_payload ->> 'participantId')::uuid,
          v_conversation_id, 'customer',
          (v_payload ->> 'participantId')::uuid
        );
      elsif v_payload ->> 'role' = 'member' then
        insert into public.builder_messaging_conversation_participants (
          site_id, id, conversation_id, role, member_id
        ) values (
          v_site_id, (v_payload ->> 'participantId')::uuid,
          v_conversation_id, 'member',
          (v_payload ->> 'participantId')::uuid
        );
      else
        insert into public.builder_messaging_conversation_participants (
          site_id, id, conversation_id, role
        ) values (
          v_site_id, (v_payload ->> 'participantId')::uuid,
          v_conversation_id, v_payload ->> 'role'
        );
      end if;
    elsif v_type = 'conversation.assign' then
      if v_actor_type <> 'member'
        or not builder_private.member_can_access_growth_record(
          v_site_id, v_actor_id, 'messages.send',
          'conversation', v_conversation_id
        )
        or not exists (
          select 1 from public.builder_site_members
          where site_id = v_site_id
            and user_id = (v_payload ->> 'assignedMemberId')::uuid
        )
      then
        raise exception 'conversation assignment is not authorized' using errcode = '42501';
      end if;
      update public.builder_messaging_conversation_assignments
      set ended_at = now(), version = version + 1
      where site_id = v_site_id
        and conversation_id = v_conversation_id
        and ended_at is null;
      insert into public.builder_messaging_conversation_assignments (
        site_id, conversation_id, member_id, assigned_by_member_id
      ) values (
        v_site_id, v_conversation_id,
        (v_payload ->> 'assignedMemberId')::uuid, v_actor_id
      );
      update public.builder_messaging_conversations
      set assigned_member_id = (v_payload ->> 'assignedMemberId')::uuid,
          state = 'assigned'
      where site_id = v_site_id and id = v_conversation_id;
    else
      if v_actor_type <> 'member'
        or not builder_private.member_can_access_growth_record(
          v_site_id, v_actor_id, 'messages.draft',
          'conversation', v_conversation_id
        )
        or v_payload ->> 'action' not in (
          'new', 'ai_qualifying', 'assigned', 'waiting_on_customer',
          'waiting_on_staff', 'resolved', 'spam', 'archived'
        )
      then
        raise exception 'conversation transition is not authorized' using errcode = '42501';
      end if;
      update public.builder_messaging_conversations
      set state = v_payload ->> 'action'
      where site_id = v_site_id and id = v_conversation_id;
    end if;
    update public.builder_messaging_conversations
    set version = version + 1, updated_at = now()
    where site_id = v_site_id and id = v_conversation_id
    returning * into v_conversation;
    v_result := jsonb_build_object(
      'version', 1, 'status', 'applied',
      'aggregateId', v_conversation_id,
      'aggregateVersion', v_conversation.version
    );

  elsif v_type in (
    'message.create_draft', 'message.revise_draft', 'message.record_inbound'
  ) then
    if v_type = 'message.create_draft' then
      v_message_id := (v_payload ->> 'messageId')::uuid;
      v_conversation_id := (v_payload ->> 'conversationId')::uuid;
      select * into v_conversation
      from public.builder_messaging_conversations
      where site_id = v_site_id and id = v_conversation_id;
      if v_actor_type <> 'member'
        or v_conversation.id is null
        or not builder_private.member_can_access_growth_record(
          v_site_id, v_actor_id, 'messages.draft',
          'conversation', v_conversation_id
        )
        or v_payload ->> 'channel' <> v_conversation.channel
        or v_payload ->> 'purpose' <> v_conversation.purpose
        or char_length(coalesce(v_payload ->> 'body', '')) not between 1 and 50000
      then
        raise exception 'message draft is not authorized' using errcode = '42501';
      end if;
      insert into public.builder_messages (
        site_id, id, conversation_id, direction, channel, purpose,
        author_type, author_id, body, template_revision_id, state
      ) values (
        v_site_id, v_message_id, v_conversation_id, 'outbound',
        v_conversation.channel, v_conversation.purpose, 'member',
        v_actor_id::text, v_payload ->> 'body',
        nullif(v_payload ->> 'templateRevisionId', '')::uuid, 'draft'
      ) returning * into v_message;
      perform builder_private.record_messaging_message_event_v1(
        v_site_id, v_message.id, v_message.conversation_id, 'message.created',
        v_actor_type, v_actor_id_text, null, 'draft', v_correlation_id
      );
    elsif v_type = 'message.revise_draft' then
      v_message_id := (v_payload ->> 'messageId')::uuid;
      select * into v_message
      from public.builder_messages
      where site_id = v_site_id and id = v_message_id
      for update;
      if v_message.id is null
        or v_message.version <> v_expected_version
        or v_message.state <> 'draft'
        or v_actor_type <> 'member'
        or not builder_private.member_can_access_growth_record(
          v_site_id, v_actor_id, 'messages.draft',
          'conversation', v_message.conversation_id
        )
        or char_length(coalesce(v_payload ->> 'body', '')) not between 1 and 50000
      then
        raise exception 'message revision is not authorized' using errcode = '42501';
      end if;
      update public.builder_messages
      set body = v_payload ->> 'body',
          version = version + 1,
          updated_at = now()
      where site_id = v_site_id and id = v_message_id
      returning * into v_message;
      perform builder_private.record_messaging_message_event_v1(
        v_site_id, v_message.id, v_message.conversation_id, 'message.revised',
        v_actor_type, v_actor_id_text, 'draft', 'draft', v_correlation_id
      );
    else
      if v_actor_type not in ('provider', 'system', 'visitor')
        or char_length(coalesce(v_payload ->> 'body', '')) not between 1 and 50000
      then
        raise exception 'inbound message is not authorized' using errcode = '42501';
      end if;
      v_message_id := (v_payload ->> 'messageId')::uuid;
      v_conversation_id := (v_payload ->> 'conversationId')::uuid;
      select * into v_conversation
      from public.builder_messaging_conversations
      where site_id = v_site_id and id = v_conversation_id
      for update;
      if v_conversation.id is null
        or v_payload ->> 'channel' <> v_conversation.channel
        or v_payload ->> 'purpose' <> v_conversation.purpose
        or not exists (
          select 1
          from public.builder_messaging_conversation_participants
          where site_id = v_site_id
            and conversation_id = v_conversation_id
            and id = (v_payload ->> 'participantId')::uuid
        )
      then
        raise exception 'invalid inbound message' using errcode = '22023';
      end if;
      insert into public.builder_messages (
        site_id, id, conversation_id, direction, channel, purpose,
        author_type, author_id, body, state
      ) values (
        v_site_id, v_message_id, v_conversation_id, 'inbound',
        v_conversation.channel, v_conversation.purpose,
        v_actor_type, v_actor_id_text, v_payload ->> 'body', 'received'
      ) returning * into v_message;
      update public.builder_messaging_conversations
      set unread_count = unread_count + 1,
          state = 'waiting_on_staff',
          version = version + 1,
          updated_at = now()
      where site_id = v_site_id and id = v_conversation_id;
      perform builder_private.record_messaging_message_event_v1(
        v_site_id, v_message.id, v_message.conversation_id, 'message.received',
        v_actor_type, v_actor_id_text, null, 'received', v_correlation_id
      );
    end if;
    v_result := jsonb_build_object(
      'version', 1, 'status', 'applied',
      'aggregateId', v_message.id,
      'aggregateVersion', v_message.version
    );

  elsif v_type = 'message.request_delivery' then
    v_message_id := (v_payload ->> 'messageId')::uuid;
    v_delivery_id := (v_payload ->> 'deliveryId')::uuid;
    select * into v_message
    from public.builder_messages
    where site_id = v_site_id and id = v_message_id
    for update;
    select * into v_sender
    from public.builder_messaging_senders
    where site_id = v_site_id and id = (v_payload ->> 'senderId')::uuid;
    select participant.contact_id into v_contact_id
    from public.builder_messaging_conversation_participants participant
    where participant.site_id = v_site_id
      and participant.conversation_id = v_message.conversation_id
      and participant.role = 'customer'
    order by participant.joined_at, participant.id
    limit 1;
    if v_message.id is null
      or v_message.version <> v_expected_version
      or v_message.state <> 'draft'
      or v_actor_type <> 'member'
      or not builder_private.member_can_access_growth_record(
        v_site_id, v_actor_id, 'messages.send',
        'conversation', v_message.conversation_id
      )
      or v_sender.id is null
      or v_sender.state <> 'verified'
      or v_sender.channel <> v_message.channel
      or v_contact_id is null
      or char_length(coalesce(v_payload ->> 'destinationReference', ''))
        not between 1 and 500
    then
      raise exception 'message delivery request is not authorized' using errcode = '42501';
    end if;
    select coalesce(connection.provider_key, 'website_chat')
    into v_provider_key
    from public.builder_messaging_senders sender
    left join public.builder_provider_connections connection
      on connection.site_id = sender.site_id
      and connection.id = sender.connection_id
    where sender.site_id = v_site_id and sender.id = v_sender.id;
    v_outbox_id := gen_random_uuid();
    insert into public.builder_outbox (
      site_id, id, topic, payload, idempotency_key, schema_version,
      aggregate_type, aggregate_id, correlation_id, module_id, channel,
      provider_key, purpose, contact_id
    ) values (
      v_site_id, v_outbox_id, 'growth.message.delivery_requested',
      jsonb_build_object('version', 1, 'deliveryId', v_delivery_id),
      p_request ->> 'idempotencyKey', 1, 'message', v_message.id,
      v_correlation_id, 'growth.messaging', v_message.channel,
      v_provider_key, v_message.purpose, v_contact_id
    );
    insert into public.builder_message_deliveries (
      site_id, id, message_id, conversation_id, contact_id, sender_id,
      destination_reference, channel, purpose, outbox_id, idempotency_key,
      correlation_id
    ) values (
      v_site_id, v_delivery_id, v_message.id, v_message.conversation_id,
      v_contact_id, v_sender.id, v_payload ->> 'destinationReference',
      v_message.channel, v_message.purpose, v_outbox_id,
      p_request ->> 'idempotencyKey', v_correlation_id
    ) returning * into v_delivery;
    update public.builder_messages
    set state = 'delivery_requested',
        version = version + 1,
        updated_at = now()
    where site_id = v_site_id and id = v_message.id
    returning * into v_message;
    perform builder_private.record_messaging_message_event_v1(
      v_site_id, v_message.id, v_message.conversation_id,
      'message.delivery_requested', v_actor_type, v_actor_id_text,
      'draft', 'delivery_requested', v_correlation_id
    );
    perform builder_private.record_messaging_delivery_event_v1(
      v_site_id, v_delivery.id, v_message.id, 'delivery.requested',
      null, 'requested', null, null, v_correlation_id
    );
    v_result := jsonb_build_object(
      'version', 1, 'status', 'applied',
      'aggregateId', v_message.id,
      'aggregateVersion', v_message.version
    );

  elsif v_type like 'delivery.%' then
    v_delivery_id := (v_payload ->> 'deliveryId')::uuid;
    select * into v_delivery
    from public.builder_message_deliveries
    where site_id = v_site_id and id = v_delivery_id
    for update;
    if v_delivery.id is null or v_delivery.version <> v_expected_version then
      raise exception 'messaging delivery version conflict' using errcode = '40001';
    end if;
    v_from_state := v_delivery.state;
    v_reason_code := nullif(v_payload ->> 'reasonCode', '');
    if v_type = 'delivery.authorize' then
      if v_actor_type <> 'member'
        or not builder_private.member_can_access_growth_record(
          v_site_id, v_actor_id, 'messages.send',
          'conversation', v_delivery.conversation_id
        )
      then raise exception 'delivery authorization is forbidden' using errcode = '42501';
      end if;
      v_target_state := 'authorized';
    elsif v_type = 'delivery.claim' then
      if v_actor_type <> 'system' then
        raise exception 'delivery claim is server-only' using errcode = '42501';
      end if;
      v_target_state := 'claimed';
    elsif v_type = 'delivery.submit' then
      if v_actor_type <> 'system' then
        raise exception 'delivery submission is server-only' using errcode = '42501';
      end if;
      v_target_state := 'submitted';
    elsif v_type = 'delivery.reconcile' then
      if v_actor_type not in ('provider', 'system') then
        raise exception 'delivery reconciliation is server-only' using errcode = '42501';
      end if;
      v_target_state := case v_payload ->> 'outcome'
        when 'delivered' then 'delivered'
        when 'failed' then 'failed_terminal'
        when 'bounced' then 'failed_terminal'
        when 'complained' then 'failed_terminal'
        else null
      end;
    elsif v_type = 'delivery.fail' then
      if v_actor_type not in ('member', 'system') then
        raise exception 'delivery failure is forbidden' using errcode = '42501';
      end if;
      v_target_state := case
        when coalesce((v_payload ->> 'retryable')::boolean, false)
          then 'failed_retryable'
        else 'failed_terminal'
      end;
    elsif v_type = 'delivery.suppress' then
      if v_actor_type not in ('member', 'system') then
        raise exception 'delivery suppression is forbidden' using errcode = '42501';
      end if;
      v_target_state := 'suppressed';
    else
      if v_actor_type not in ('member', 'system') then
        raise exception 'delivery cancellation is forbidden' using errcode = '42501';
      end if;
      v_target_state := 'cancelled';
    end if;
    if v_target_state is null then
      raise exception 'invalid delivery transition' using errcode = '22023';
    end if;
    update public.builder_message_deliveries
    set state = v_target_state,
        provider_reference = coalesce(
          nullif(v_payload ->> 'providerReference', ''),
          provider_reference
        ),
        reason_code = v_reason_code,
        retry_at = case
          when v_target_state = 'failed_retryable'
            then nullif(v_payload ->> 'retryAt', '')::timestamptz
          else null
        end,
        worker_id = case
          when v_target_state = 'claimed' then v_payload ->> 'workerId'
          else worker_id
        end,
        lease_token = case
          when v_target_state = 'claimed'
            then (v_payload ->> 'leaseToken')::uuid
          else lease_token
        end,
        version = version + 1,
        updated_at = now()
    where site_id = v_site_id and id = v_delivery_id
    returning * into v_delivery;
    perform builder_private.record_messaging_delivery_event_v1(
      v_site_id, v_delivery.id, v_delivery.message_id,
      replace(v_type, '.', '_'), v_from_state, v_delivery.state,
      v_delivery.reason_code, v_delivery.provider_reference, v_correlation_id
    );
    if v_delivery.state = 'delivered' then
      update public.builder_messages
      set state = 'sent', version = version + 1, updated_at = now()
      where site_id = v_site_id and id = v_delivery.message_id;
    elsif v_delivery.state = 'failed_terminal' then
      update public.builder_messages
      set state = 'failed', version = version + 1, updated_at = now()
      where site_id = v_site_id and id = v_delivery.message_id;
    end if;
    v_result := jsonb_build_object(
      'version', 1, 'status', 'applied',
      'aggregateId', v_delivery.id,
      'aggregateVersion', v_delivery.version
    );

  elsif v_type = 'template.publish' then
    if v_actor_type <> 'member'
      or not builder_private.member_has_capability(
        v_site_id, v_actor_id, 'templates.manage', 'site'
      )
    then raise exception 'template publication is forbidden' using errcode = '42501';
    end if;
    select * into v_template
    from public.builder_message_templates
    where site_id = v_site_id and id = (v_payload ->> 'templateId')::uuid
    for update;
    select * into v_revision
    from public.builder_message_template_revisions
    where site_id = v_site_id
      and id = (v_payload ->> 'revisionId')::uuid
      and template_id = v_template.id
    for update;
    if v_template.id is null
      or v_template.version <> v_expected_version
      or v_revision.id is null
      or v_revision.state <> 'draft'
    then raise exception 'template version conflict' using errcode = '40001';
    end if;
    update public.builder_message_template_revisions
    set state = 'published', published_at = now()
    where site_id = v_site_id and id = v_revision.id;
    update public.builder_message_templates
    set current_revision_id = v_revision.id,
        state = 'published',
        version = version + 1,
        updated_at = now()
    where site_id = v_site_id and id = v_template.id
    returning * into v_template;
    v_result := jsonb_build_object(
      'version', 1, 'status', 'applied',
      'aggregateId', v_template.id,
      'aggregateVersion', v_template.version
    );

  else
    if v_actor_type <> 'member'
      or not builder_private.member_has_capability(
        v_site_id, v_actor_id, 'integrations.manage', 'site'
      )
      or v_payload ->> 'channel' not in ('email', 'sms', 'website_chat')
      or char_length(coalesce(v_payload ->> 'senderReference', ''))
        not between 1 and 500
    then raise exception 'sender registration is forbidden' using errcode = '42501';
    end if;
    if v_payload ? 'connectionId' then
      v_connection_id := (v_payload ->> 'connectionId')::uuid;
    end if;
    if v_payload ->> 'channel' <> 'website_chat' then
      select connection.state into v_connection_state
      from public.builder_provider_connections connection
      where connection.site_id = v_site_id
        and connection.id = v_connection_id
        and connection.provider_kind = v_payload ->> 'channel';
      if v_connection_state is null then
        raise exception 'sender provider connection is required' using errcode = '22023';
      end if;
    end if;
    insert into public.builder_messaging_senders (
      site_id, id, connection_id, channel, stable_key, display_name,
      sender_reference, state
    ) values (
      v_site_id, (v_payload ->> 'senderId')::uuid, v_connection_id,
      v_payload ->> 'channel',
      coalesce(nullif(v_payload ->> 'stableKey', ''),
        'sender-' || replace((v_payload ->> 'senderId')::uuid::text, '-', '')),
      coalesce(nullif(v_payload ->> 'displayName', ''), 'Configured sender'),
      v_payload ->> 'senderReference',
      case
        when v_payload ->> 'channel' = 'website_chat'
          or v_connection_state = 'ready' then 'verified'
        else 'pending'
      end
    ) returning * into v_sender;
    v_result := jsonb_build_object(
      'version', 1, 'status', 'applied',
      'aggregateId', v_sender.id,
      'aggregateVersion', v_sender.version
    );
  end if;

  return builder_private.complete_operational_command_v1(
    p_request,
    'growth.messaging.command.v1',
    v_result
  );
end;
$$;

create function public.builder_prepare_message_delivery_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_outbox_id uuid := (p_request ->> 'outboxId')::uuid;
  v_worker_id text := p_request ->> 'workerId';
  v_lease_token uuid := (p_request ->> 'leaseToken')::uuid;
  v_now timestamptz := (p_request ->> 'now')::timestamptz;
  v_outbox public.builder_outbox%rowtype;
  v_delivery public.builder_message_deliveries%rowtype;
  v_message public.builder_messages%rowtype;
  v_sender public.builder_messaging_senders%rowtype;
  v_provider_key text;
  v_subject text;
begin
  if p_request ->> 'version' <> '1'
    or v_site_id is null
    or v_outbox_id is null
    or char_length(coalesce(v_worker_id, '')) not between 1 and 255
    or v_lease_token is null
    or v_now is null
  then
    raise exception 'invalid messaging delivery preparation' using errcode = '22023';
  end if;

  select * into v_outbox
  from public.builder_outbox
  where site_id = v_site_id and id = v_outbox_id
  for update;
  if v_outbox.id is null
    or v_outbox.topic <> 'growth.message.delivery_requested'
    or v_outbox.status <> 'claimed'
    or v_outbox.lease_owner <> v_worker_id
    or v_outbox.lease_token <> v_lease_token
    or v_outbox.lease_expires_at < v_now
  then
    raise exception 'stale or invalid messaging outbox lease' using errcode = '40001';
  end if;

  select * into v_delivery
  from public.builder_message_deliveries
  where site_id = v_site_id and outbox_id = v_outbox_id
  for update;
  if v_delivery.id is null
    or v_delivery.state not in ('requested', 'failed_retryable', 'claimed')
  then
    raise exception 'messaging delivery cannot be prepared' using errcode = '40001';
  end if;

  if not (
    v_delivery.state = 'claimed'
    and v_delivery.worker_id = v_worker_id
    and v_delivery.lease_token = v_lease_token
    and v_delivery.attempt = v_outbox.attempt_count
  ) then
    update public.builder_message_deliveries
    set state = 'claimed',
        attempt = v_outbox.attempt_count,
        worker_id = v_worker_id,
        lease_token = v_lease_token,
        reason_code = null,
        retry_at = null,
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_delivery.id
    returning * into v_delivery;
    perform builder_private.record_messaging_delivery_event_v1(
      v_site_id, v_delivery.id, v_delivery.message_id, 'delivery.claimed',
      case when v_delivery.attempt = 1 then 'requested' else 'failed_retryable' end,
      'claimed', null, null, v_delivery.correlation_id, v_now
    );
  end if;

  select * into v_message
  from public.builder_messages
  where site_id = v_site_id and id = v_delivery.message_id;
  select * into v_sender
  from public.builder_messaging_senders
  where site_id = v_site_id and id = v_delivery.sender_id;
  select coalesce(connection.provider_key, 'website_chat')
  into v_provider_key
  from public.builder_messaging_senders sender
  left join public.builder_provider_connections connection
    on connection.site_id = sender.site_id
    and connection.id = sender.connection_id
  where sender.site_id = v_site_id and sender.id = v_sender.id;
  select revision.subject into v_subject
  from public.builder_message_template_revisions revision
  where revision.site_id = v_site_id
    and revision.id = v_message.template_revision_id;
  if v_message.channel = 'email' then
    v_subject := coalesce(v_subject, 'Message from ' || v_sender.display_name);
  end if;

  if v_message.id is null
    or v_sender.id is null
    or v_sender.state <> 'verified'
    or v_provider_key is null
  then
    raise exception 'messaging provider configuration is unavailable' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'version', 1,
    'siteId', v_site_id,
    'outboxId', v_outbox_id,
    'deliveryId', v_delivery.id,
    'messageId', v_message.id,
    'conversationId', v_message.conversation_id,
    'contactId', v_delivery.contact_id,
    'channel', v_delivery.channel,
    'purpose', v_delivery.purpose,
    'senderId', v_sender.id,
    'senderReference', v_sender.sender_reference,
    'destinationReference', v_delivery.destination_reference,
    'providerKey', v_provider_key,
    'subject', v_subject,
    'text', v_message.body,
    'idempotencyKey', v_delivery.idempotency_key,
    'correlationId', v_delivery.correlation_id,
    'workerId', v_worker_id,
    'leaseToken', v_lease_token,
    'deliveryVersion', v_delivery.version,
    'attempt', v_delivery.attempt
  );
end;
$$;

create function public.builder_record_message_transport_decision_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_outbox_id uuid := (p_request ->> 'outboxId')::uuid;
  v_delivery_id uuid := (p_request ->> 'deliveryId')::uuid;
  v_worker_id text := p_request ->> 'workerId';
  v_lease_token uuid := (p_request ->> 'leaseToken')::uuid;
  v_expected_version integer := (p_request ->> 'expectedVersion')::integer;
  v_decided_at timestamptz := (p_request ->> 'decidedAt')::timestamptz;
  v_authorization jsonb := p_request -> 'authorization';
  v_outbox public.builder_outbox%rowtype;
  v_delivery public.builder_message_deliveries%rowtype;
  v_decision public.builder_message_transport_decisions%rowtype;
  v_action text;
  v_reason_code text;
  v_target_state text;
  v_status text;
  v_evidence_ids text[];
  v_retry_at timestamptz;
begin
  if p_request ->> 'version' <> '1'
    or jsonb_typeof(v_authorization) <> 'object'
    or jsonb_typeof(v_authorization -> 'evidenceIds') <> 'array'
  then
    raise exception 'invalid messaging transport decision' using errcode = '22023';
  end if;
  v_action := v_authorization ->> 'action';
  v_reason_code := v_authorization ->> 'reasonCode';
  if v_action not in ('submit', 'hold', 'suppress', 'reject')
    or char_length(coalesce(v_reason_code, '')) not between 1 and 128
    or (v_authorization ->> 'allowed')::boolean <> (v_action = 'submit')
  then
    raise exception 'invalid messaging transport authorization' using errcode = '22023';
  end if;
  select coalesce(array_agg(value), '{}'::text[])
  into v_evidence_ids
  from jsonb_array_elements_text(v_authorization -> 'evidenceIds');
  if exists (
    select 1 from unnest(v_evidence_ids) evidence
    where char_length(evidence) not between 1 and 500
  ) then
    raise exception 'invalid messaging policy evidence' using errcode = '22023';
  end if;
  if v_authorization ? 'retryAt' then
    v_retry_at := (v_authorization ->> 'retryAt')::timestamptz;
  end if;

  select * into v_outbox
  from public.builder_outbox
  where site_id = v_site_id and id = v_outbox_id
  for update;
  select * into v_delivery
  from public.builder_message_deliveries
  where site_id = v_site_id and id = v_delivery_id
  for update;
  if v_outbox.id is null
    or v_outbox.status <> 'claimed'
    or v_outbox.lease_owner <> v_worker_id
    or v_outbox.lease_token <> v_lease_token
    or v_outbox.lease_expires_at < v_decided_at
    or v_delivery.id is null
    or v_delivery.outbox_id <> v_outbox_id
    or v_delivery.worker_id <> v_worker_id
    or v_delivery.lease_token <> v_lease_token
  then
    raise exception 'stale messaging policy lease' using errcode = '40001';
  end if;

  select * into v_decision
  from public.builder_message_transport_decisions
  where site_id = v_site_id
    and delivery_id = v_delivery_id
    and attempt = v_outbox.attempt_count;
  if v_decision.id is not null then
    return jsonb_build_object(
      'version', 1,
      'status', case v_decision.action
        when 'submit' then 'authorized'
        when 'hold' then 'held'
        when 'suppress' then 'suppressed'
        else 'rejected'
      end,
      'deliveryVersion', v_delivery.version
    );
  end if;
  if v_delivery.version <> v_expected_version
    or v_delivery.state <> 'claimed'
  then
    raise exception 'messaging delivery version conflict' using errcode = '40001';
  end if;

  v_target_state := case v_action
    when 'submit' then 'authorized'
    when 'hold' then 'held'
    when 'suppress' then 'suppressed'
    else 'failed_terminal'
  end;
  v_status := case v_action
    when 'submit' then 'authorized'
    when 'hold' then 'held'
    when 'suppress' then 'suppressed'
    else 'rejected'
  end;
  insert into public.builder_message_transport_decisions (
    site_id, delivery_id, message_id, action, allowed, reason_code,
    evidence_ids, retry_at, evaluated_at, attempt
  ) values (
    v_site_id, v_delivery.id, v_delivery.message_id, v_action,
    v_action = 'submit', v_reason_code, v_evidence_ids, v_retry_at,
    v_decided_at, v_outbox.attempt_count
  ) returning * into v_decision;
  update public.builder_message_deliveries
  set state = v_target_state,
      policy_decision_id = v_decision.id,
      reason_code = case when v_action = 'submit' then null else v_reason_code end,
      retry_at = v_retry_at,
      version = version + 1,
      updated_at = v_decided_at
  where site_id = v_site_id and id = v_delivery.id
  returning * into v_delivery;
  perform builder_private.record_messaging_delivery_event_v1(
    v_site_id, v_delivery.id, v_delivery.message_id, 'delivery.policy_decided',
    'claimed', v_target_state,
    case when v_action = 'submit' then null else v_reason_code end,
    null, v_delivery.correlation_id, v_decided_at
  );
  return jsonb_build_object(
    'version', 1,
    'status', v_status,
    'deliveryVersion', v_delivery.version
  );
end;
$$;

create function public.builder_complete_message_delivery_attempt_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_outbox_id uuid := (p_request ->> 'outboxId')::uuid;
  v_delivery_id uuid := (p_request ->> 'deliveryId')::uuid;
  v_worker_id text := p_request ->> 'workerId';
  v_lease_token uuid := (p_request ->> 'leaseToken')::uuid;
  v_expected_version integer := (p_request ->> 'expectedVersion')::integer;
  v_completed_at timestamptz := (p_request ->> 'completedAt')::timestamptz;
  v_outcome text := p_request ->> 'outcome';
  v_provider_reference text := nullif(p_request ->> 'providerReference', '');
  v_reason_code text := nullif(p_request ->> 'reasonCode', '');
  v_retry_at timestamptz;
  v_outbox public.builder_outbox%rowtype;
  v_delivery public.builder_message_deliveries%rowtype;
  v_from_state text;
begin
  if v_outcome not in (
    'accepted', 'failed_retryable', 'failed_terminal',
    'reconciliation_required'
  ) or (
    v_outcome in ('accepted', 'reconciliation_required')
    and v_provider_reference is null
  ) then
    raise exception 'invalid messaging delivery outcome' using errcode = '22023';
  end if;
  if p_request ? 'retryAt' then
    v_retry_at := (p_request ->> 'retryAt')::timestamptz;
  end if;
  select * into v_outbox
  from public.builder_outbox
  where site_id = v_site_id and id = v_outbox_id
  for update;
  select * into v_delivery
  from public.builder_message_deliveries
  where site_id = v_site_id and id = v_delivery_id
  for update;
  if v_outbox.id is null
    or v_outbox.status <> 'claimed'
    or v_outbox.lease_owner <> v_worker_id
    or v_outbox.lease_token <> v_lease_token
    or v_outbox.lease_expires_at < v_completed_at
    or v_delivery.id is null
    or v_delivery.outbox_id <> v_outbox_id
    or v_delivery.worker_id <> v_worker_id
    or v_delivery.lease_token <> v_lease_token
  then
    raise exception 'stale messaging completion lease' using errcode = '40001';
  end if;
  if v_delivery.state = v_outcome
    and v_delivery.provider_reference is not distinct from v_provider_reference
  then
    return jsonb_build_object(
      'version', 1, 'status', v_outcome,
      'deliveryVersion', v_delivery.version
    );
  end if;
  if v_delivery.version <> v_expected_version
    or v_delivery.state <> 'authorized'
  then
    raise exception 'messaging completion version conflict' using errcode = '40001';
  end if;
  v_from_state := v_delivery.state;
  update public.builder_message_deliveries
  set state = v_outcome,
      provider_reference = v_provider_reference,
      reason_code = v_reason_code,
      retry_at = v_retry_at,
      version = version + 1,
      updated_at = v_completed_at
  where site_id = v_site_id and id = v_delivery_id
  returning * into v_delivery;
  perform builder_private.record_messaging_delivery_event_v1(
    v_site_id, v_delivery.id, v_delivery.message_id,
    'delivery.' || v_outcome, v_from_state, v_outcome,
    v_reason_code, v_provider_reference, v_delivery.correlation_id,
    v_completed_at
  );
  if v_outcome = 'accepted' then
    update public.builder_messages
    set state = 'sent', version = version + 1, updated_at = v_completed_at
    where site_id = v_site_id and id = v_delivery.message_id;
  elsif v_outcome = 'failed_terminal' then
    update public.builder_messages
    set state = 'failed', version = version + 1, updated_at = v_completed_at
    where site_id = v_site_id and id = v_delivery.message_id;
  end if;
  return jsonb_build_object(
    'version', 1, 'status', v_outcome,
    'deliveryVersion', v_delivery.version
  );
end;
$$;

create function public.builder_record_messaging_webhook_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_connection_id uuid := (p_request ->> 'connectionId')::uuid;
  v_provider_event_id text := p_request ->> 'providerEventId';
  v_replay_key text := p_request ->> 'replayKey';
  v_occurred_at timestamptz := (p_request ->> 'occurredAt')::timestamptz;
  v_received_at timestamptz := (p_request ->> 'receivedAt')::timestamptz;
  v_payload_digest text := p_request ->> 'payloadDigest';
  v_event jsonb := p_request -> 'event';
  v_kind text;
  v_rows integer;
  v_delivery public.builder_message_deliveries%rowtype;
  v_message public.builder_messages%rowtype;
  v_conversation public.builder_messaging_conversations%rowtype;
  v_target_state text;
  v_reason_code text;
  v_message_from_state text;
  v_correlation_id uuid := gen_random_uuid();
begin
  if p_request ->> 'version' <> '1'
    or char_length(coalesce(v_provider_event_id, '')) not between 1 and 500
    or char_length(coalesce(v_replay_key, '')) not between 1 and 500
    or coalesce(v_payload_digest, '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(v_event) <> 'object'
    or not exists (
      select 1
      from public.builder_provider_connections connection
      where connection.site_id = v_site_id and connection.id = v_connection_id
    )
  then
    raise exception 'invalid messaging webhook receipt' using errcode = '22023';
  end if;

  insert into builder_private.builder_provider_webhook_receipts (
    site_id, connection_id, provider_event_id, replay_key,
    signature_verified, occurred_at, received_at, payload_digest
  ) values (
    v_site_id, v_connection_id, v_provider_event_id, v_replay_key,
    true, v_occurred_at, v_received_at, v_payload_digest
  ) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return '{"version":1,"status":"replayed"}'::jsonb;
  end if;

  v_kind := v_event ->> 'kind';
  if v_kind = 'delivery' then
    select * into v_delivery
    from public.builder_message_deliveries
    where site_id = v_site_id and id = (v_event ->> 'deliveryId')::uuid
    for update;
    if v_delivery.id is null
      or v_event ->> 'outcome' not in (
        'delivered', 'failed', 'bounced', 'complained'
      )
    then
      raise exception 'invalid messaging delivery webhook' using errcode = '22023';
    end if;
    v_reason_code := coalesce(
      nullif(v_event ->> 'reasonCode', ''),
      case v_event ->> 'outcome'
        when 'bounced' then 'provider_bounce'
        when 'complained' then 'provider_complaint'
        when 'failed' then 'provider_failure'
        else null
      end
    );
    if v_reason_code is not null
      and v_reason_code !~ '^[a-z][a-z0-9._-]{0,127}$'
    then
      raise exception 'invalid messaging webhook reason' using errcode = '22023';
    end if;
    v_target_state := case v_event ->> 'outcome'
      when 'delivered' then 'delivered'
      else 'failed_terminal'
    end;
    update public.builder_message_deliveries
    set state = v_target_state,
        reason_code = v_reason_code,
        version = version + 1,
        updated_at = v_occurred_at
    where site_id = v_site_id and id = v_delivery.id
    returning * into v_delivery;
    perform builder_private.record_messaging_delivery_event_v1(
      v_site_id, v_delivery.id, v_delivery.message_id,
      'delivery.webhook_' || (v_event ->> 'outcome'),
      case when v_target_state = 'delivered' then 'accepted' else null end,
      v_target_state, v_reason_code, v_delivery.provider_reference,
      v_delivery.correlation_id, v_occurred_at
    );
    select state into v_message_from_state
    from public.builder_messages
    where site_id = v_site_id and id = v_delivery.message_id
    for update;
    update public.builder_messages
    set state = case when v_target_state = 'delivered' then 'sent' else 'failed' end,
        version = version + 1,
        updated_at = v_occurred_at
    where site_id = v_site_id and id = v_delivery.message_id
    returning * into v_message;
    perform builder_private.record_messaging_message_event_v1(
      v_site_id, v_message.id, v_message.conversation_id,
      case when v_target_state = 'delivered'
        then 'message.delivered' else 'message.failed' end,
      'provider', v_connection_id::text, v_message_from_state,
      case when v_target_state = 'delivered' then 'sent' else 'failed' end,
      v_delivery.correlation_id, v_occurred_at
    );
    if v_event ->> 'outcome' in ('bounced', 'complained')
      and v_delivery.channel in ('email', 'sms')
      and not exists (
        select 1 from public.builder_suppressions suppression
        where suppression.site_id = v_site_id
          and suppression.contact_id = v_delivery.contact_id
          and suppression.channel = v_delivery.channel
          and suppression.active
      )
    then
      insert into public.builder_suppressions (
        site_id, contact_id, channel, reason
      ) values (
        v_site_id, v_delivery.contact_id, v_delivery.channel,
        case when v_event ->> 'outcome' = 'bounced'
          then 'bounce' else 'complaint' end
      );
    end if;
    update public.builder_booking_reminder_occurrences occurrence
    set state = case
          when v_target_state = 'delivered' then 'delivered'
          else 'failed_review'
        end,
        provider_reference = coalesce(
          v_delivery.provider_reference, occurrence.provider_reference
        ),
        failure_reason = case
          when v_target_state = 'delivered' then null else v_reason_code
        end,
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        version = version + 1,
        updated_at = v_occurred_at
    from public.builder_message_booking_reminder_links link
    where link.site_id = v_site_id
      and link.delivery_id = v_delivery.id
      and occurrence.site_id = link.site_id
      and occurrence.id = link.reminder_occurrence_id;

  elsif v_kind = 'inbound' then
    select * into v_conversation
    from public.builder_messaging_conversations
    where site_id = v_site_id
      and id = (v_event ->> 'conversationId')::uuid
    for update;
    if v_conversation.id is null
      or v_event ->> 'channel' <> v_conversation.channel
      or v_event ->> 'purpose' <> v_conversation.purpose
      or char_length(coalesce(v_event ->> 'body', '')) not between 1 and 50000
      or not exists (
        select 1
        from public.builder_messaging_conversation_participants participant
        where participant.site_id = v_site_id
          and participant.conversation_id = v_conversation.id
          and participant.id = (v_event ->> 'participantId')::uuid
      )
    then
      raise exception 'invalid inbound messaging webhook' using errcode = '22023';
    end if;
    insert into public.builder_messages (
      site_id, id, conversation_id, direction, channel, purpose,
      author_type, author_id, body, state
    ) values (
      v_site_id, (v_event ->> 'messageId')::uuid, v_conversation.id,
      'inbound', v_conversation.channel, v_conversation.purpose,
      'provider', v_connection_id::text, v_event ->> 'body', 'received'
    ) returning * into v_message;
    update public.builder_messaging_conversations
    set unread_count = unread_count + 1,
        state = 'waiting_on_staff',
        version = version + 1,
        updated_at = v_occurred_at
    where site_id = v_site_id and id = v_conversation.id;
    perform builder_private.record_messaging_message_event_v1(
      v_site_id, v_message.id, v_message.conversation_id, 'message.received',
      'provider', v_connection_id::text, null, 'received',
      v_correlation_id, v_occurred_at
    );

  elsif v_kind = 'unsubscribe' then
    if v_event ->> 'channel' not in ('email', 'sms')
      or coalesce(v_event ->> 'destinationDigest', '') !~ '^[a-f0-9]{64}$'
      or not exists (
        select 1 from public.builder_contacts
        where site_id = v_site_id
          and id = (v_event ->> 'contactId')::uuid
      )
    then
      raise exception 'invalid unsubscribe webhook' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.builder_suppressions suppression
      where suppression.site_id = v_site_id
        and suppression.contact_id = (v_event ->> 'contactId')::uuid
        and suppression.channel = v_event ->> 'channel'
        and suppression.active
    ) then
      insert into public.builder_suppressions (
        site_id, contact_id, channel, reason, destination_digest
      ) values (
        v_site_id, (v_event ->> 'contactId')::uuid,
        v_event ->> 'channel', 'unsubscribe',
        v_event ->> 'destinationDigest'
      );
    end if;

  elsif v_kind = 'connection' then
    if v_event ->> 'state' not in (
      'ready', 'degraded', 'disconnected', 'revoked'
    ) or (
      v_event ? 'reasonCode'
      and v_event ->> 'reasonCode' !~ '^[a-z][a-z0-9._-]{0,127}$'
    ) then
      raise exception 'invalid provider connection webhook' using errcode = '22023';
    end if;
    update public.builder_provider_connections
    set state = v_event ->> 'state',
        sanitized_reason_code = nullif(v_event ->> 'reasonCode', ''),
        checked_at = v_received_at,
        last_successful_at = case
          when v_event ->> 'state' = 'ready' then v_received_at
          else last_successful_at
        end,
        disconnected_at = case
          when v_event ->> 'state' = 'disconnected' then v_received_at
          else null
        end,
        revoked_at = case
          when v_event ->> 'state' = 'revoked' then v_received_at
          else null
        end,
        version = version + 1,
        updated_at = v_received_at
    where site_id = v_site_id and id = v_connection_id;
    update public.builder_messaging_senders
    set state = case
          when v_event ->> 'state' = 'ready' then 'verified'
          else 'degraded'
        end,
        version = version + 1,
        updated_at = v_received_at
    where site_id = v_site_id
      and connection_id = v_connection_id
      and state <> 'disabled';
  else
    raise exception 'unsupported messaging webhook event' using errcode = '22023';
  end if;

  return '{"version":1,"status":"applied"}'::jsonb;
end;
$$;

create function builder_private.messaging_projection_actor_allowed(
  p_site_id uuid,
  p_actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select
    (auth.uid() is null or auth.uid() = p_actor_id)
    and exists (
      select 1
      from public.builder_site_members member
      where member.site_id = p_site_id
        and member.user_id = p_actor_id
    )
    and builder_private.module_action_allowed(
      p_site_id, 'growth.messaging', 'read'
    );
$$;

create function public.builder_list_messaging_conversations_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_actor_id uuid := (p_request ->> 'actorId')::uuid;
  v_limit integer := greatest(1, least(coalesce((p_request ->> 'limit')::integer, 50), 100));
  v_search text := nullif(trim(p_request ->> 'search'), '');
  v_channel text := nullif(p_request ->> 'channel', '');
  v_state text := nullif(p_request ->> 'state', '');
  v_before timestamptz := coalesce(
    nullif(p_request ->> 'updatedBefore', '')::timestamptz,
    'infinity'::timestamptz
  );
  v_items jsonb;
begin
  if p_request ->> 'version' <> '1'
    or not builder_private.messaging_projection_actor_allowed(v_site_id, v_actor_id)
  then
    return '{"version":1,"status":"restricted","items":[]}'::jsonb;
  end if;
  if v_channel is not null and v_channel not in ('email', 'sms', 'website_chat') then
    raise exception 'invalid messaging channel filter' using errcode = '22023';
  end if;
  if v_state is not null and v_state not in (
    'new', 'ai_qualifying', 'assigned', 'waiting_on_customer',
    'waiting_on_staff', 'resolved', 'spam', 'archived'
  ) then
    raise exception 'invalid messaging state filter' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'updatedAt' desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'conversationId', conversation.id,
      'channel', conversation.channel,
      'purpose', conversation.purpose,
      'state', conversation.state,
      'assignedMemberId', conversation.assigned_member_id,
      'unreadCount', conversation.unread_count,
      'tagIds', to_jsonb(conversation.tag_ids),
      'participantCount', (
        select count(*)
        from public.builder_messaging_conversation_participants participant
        where participant.site_id = conversation.site_id
          and participant.conversation_id = conversation.id
      ),
      'lastMessage', (
        select jsonb_build_object(
          'messageId', message.id,
          'direction', message.direction,
          'state', message.state,
          'preview', left(regexp_replace(message.body, '\s+', ' ', 'g'), 160),
          'createdAt', message.created_at
        )
        from public.builder_messages message
        where message.site_id = conversation.site_id
          and message.conversation_id = conversation.id
        order by message.created_at desc, message.id desc
        limit 1
      ),
      'version', conversation.version,
      'createdAt', conversation.created_at,
      'updatedAt', conversation.updated_at
    ) as item
    from public.builder_messaging_conversations conversation
    where conversation.site_id = v_site_id
      and conversation.updated_at < v_before
      and (v_channel is null or conversation.channel = v_channel)
      and (v_state is null or conversation.state = v_state)
      and builder_private.member_can_access_growth_record(
        v_site_id, v_actor_id, 'messages.read',
        'conversation', conversation.id
      )
      and (
        v_search is null
        or exists (
          select 1
          from public.builder_messages message
          where message.site_id = conversation.site_id
            and message.conversation_id = conversation.id
            and message.body ilike '%' || v_search || '%'
        )
      )
    order by conversation.updated_at desc, conversation.id desc
    limit v_limit
  ) projection;
  return jsonb_build_object(
    'version', 1,
    'status', 'allowed',
    'items', v_items
  );
end;
$$;

create function public.builder_get_messaging_conversation_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_actor_id uuid := (p_request ->> 'actorId')::uuid;
  v_conversation_id uuid := (p_request ->> 'conversationId')::uuid;
  v_conversation public.builder_messaging_conversations%rowtype;
  v_participants jsonb;
  v_messages jsonb;
begin
  if p_request ->> 'version' <> '1'
    or not builder_private.messaging_projection_actor_allowed(v_site_id, v_actor_id)
    or not builder_private.member_can_access_growth_record(
      v_site_id, v_actor_id, 'messages.read',
      'conversation', v_conversation_id
    )
  then
    return '{"version":1,"status":"not_found"}'::jsonb;
  end if;
  select * into v_conversation
  from public.builder_messaging_conversations
  where site_id = v_site_id and id = v_conversation_id;
  if v_conversation.id is null then
    return '{"version":1,"status":"not_found"}'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'participantId', participant.id,
    'role', participant.role,
    'contactId', participant.contact_id,
    'memberId', participant.member_id,
    'joinedAt', participant.joined_at,
    'version', participant.version
  ) order by participant.joined_at, participant.id), '[]'::jsonb)
  into v_participants
  from public.builder_messaging_conversation_participants participant
  where participant.site_id = v_site_id
    and participant.conversation_id = v_conversation_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'messageId', message.id,
    'direction', message.direction,
    'channel', message.channel,
    'purpose', message.purpose,
    'author', jsonb_strip_nulls(jsonb_build_object(
      'type', message.author_type,
      'id', message.author_id
    )),
    'body', jsonb_build_object(
      'format', message.body_format,
      'text', message.body
    ),
    'state', message.state,
    'templateRevisionId', message.template_revision_id,
    'version', message.version,
    'createdAt', message.created_at,
    'updatedAt', message.updated_at,
    'deliveries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'deliveryId', delivery.id,
        'senderId', delivery.sender_id,
        'channel', delivery.channel,
        'purpose', delivery.purpose,
        'state', delivery.state,
        'attempt', delivery.attempt,
        'reasonCode', delivery.reason_code,
        'retryAt', delivery.retry_at,
        'version', delivery.version,
        'requestedAt', delivery.requested_at,
        'updatedAt', delivery.updated_at
      ) order by delivery.requested_at, delivery.id), '[]'::jsonb)
      from public.builder_message_deliveries delivery
      where delivery.site_id = message.site_id
        and delivery.message_id = message.id
    )
  ) order by message.created_at, message.id), '[]'::jsonb)
  into v_messages
  from public.builder_messages message
  where message.site_id = v_site_id
    and message.conversation_id = v_conversation_id;

  return jsonb_build_object(
    'version', 1,
    'status', 'allowed',
    'conversation', jsonb_build_object(
      'conversationId', v_conversation.id,
      'channel', v_conversation.channel,
      'purpose', v_conversation.purpose,
      'state', v_conversation.state,
      'assignedMemberId', v_conversation.assigned_member_id,
      'unreadCount', v_conversation.unread_count,
      'tagIds', to_jsonb(v_conversation.tag_ids),
      'version', v_conversation.version,
      'createdAt', v_conversation.created_at,
      'updatedAt', v_conversation.updated_at,
      'participants', v_participants,
      'messages', v_messages
    )
  );
end;
$$;

create function public.builder_get_messaging_health_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_actor_id uuid := (p_request ->> 'actorId')::uuid;
  v_role text;
  v_open integer;
  v_unread integer;
  v_pending integer;
  v_retryable integer;
  v_reconciliation integer;
  v_failed integer;
  v_provider_ready integer;
  v_provider_degraded integer;
begin
  select role into v_role
  from public.builder_site_members
  where site_id = v_site_id and user_id = v_actor_id;
  if p_request ->> 'version' <> '1'
    or not builder_private.messaging_projection_actor_allowed(v_site_id, v_actor_id)
    or (
      v_role <> 'owner'
      and not builder_private.member_has_capability(
        v_site_id, v_actor_id, 'siteHealth.read', 'site'
      )
    )
  then
    return '{"version":1,"status":"restricted"}'::jsonb;
  end if;

  select
    count(*) filter (where state not in ('resolved', 'spam', 'archived')),
    coalesce(sum(unread_count), 0)
  into v_open, v_unread
  from public.builder_messaging_conversations
  where site_id = v_site_id;
  select
    count(*) filter (where state in ('requested', 'authorized', 'claimed', 'submitted', 'accepted')),
    count(*) filter (where state = 'failed_retryable'),
    count(*) filter (where state = 'reconciliation_required'),
    count(*) filter (where state = 'failed_terminal')
  into v_pending, v_retryable, v_reconciliation, v_failed
  from public.builder_message_deliveries
  where site_id = v_site_id;
  select
    count(*) filter (where state = 'ready'),
    count(*) filter (where state in ('degraded', 'disconnected', 'revoked'))
  into v_provider_ready, v_provider_degraded
  from public.builder_provider_connections
  where site_id = v_site_id and provider_kind in ('email', 'sms');

  return jsonb_build_object(
    'version', 1,
    'status', 'allowed',
    'openConversations', v_open,
    'unreadMessages', v_unread,
    'pendingDeliveries', v_pending,
    'retryableDeliveries', v_retryable,
    'reconciliationDeliveries', v_reconciliation,
    'terminalFailures', v_failed,
    'readyProviders', v_provider_ready,
    'degradedProviders', v_provider_degraded
  );
end;
$$;

create function public.builder_request_booking_reminder_delivery_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_plan_id uuid := (p_request ->> 'reminderPlanId')::uuid;
  v_occurrence_id uuid := (p_request ->> 'reminderOccurrenceId')::uuid;
  v_idempotency_key text := p_request ->> 'idempotencyKey';
  v_correlation_id uuid := (p_request ->> 'correlationId')::uuid;
  v_occurrence public.builder_booking_reminder_occurrences%rowtype;
  v_template public.builder_message_template_revisions%rowtype;
  v_sender public.builder_messaging_senders%rowtype;
  v_conversation_id uuid := gen_random_uuid();
  v_participant_id uuid := gen_random_uuid();
  v_message_id uuid := gen_random_uuid();
  v_delivery_id uuid := gen_random_uuid();
  v_outbox_id uuid := gen_random_uuid();
  v_existing_delivery_id uuid;
  v_provider_key text;
  v_purpose text;
begin
  if p_request ->> 'version' <> '1'
    or char_length(coalesce(v_idempotency_key, '')) not between 1 and 255
  then
    raise exception 'invalid reminder delivery request' using errcode = '22023';
  end if;
  select link.delivery_id into v_existing_delivery_id
  from public.builder_message_booking_reminder_links link
  where link.site_id = v_site_id
    and link.reminder_occurrence_id = v_occurrence_id;
  if v_existing_delivery_id is not null then
    return jsonb_build_object(
      'version', 1,
      'status', 'replayed',
      'deliveryReference', v_existing_delivery_id
    );
  end if;

  select * into v_occurrence
  from public.builder_booking_reminder_occurrences occurrence
  where occurrence.site_id = v_site_id
    and occurrence.id = v_occurrence_id
    and occurrence.plan_id = v_plan_id
  for update;
  if v_occurrence.id is null
    or v_occurrence.state <> 'claimed'
    or v_occurrence.latest_send_at < now()
  then
    return '{"version":1,"status":"rejected"}'::jsonb;
  end if;
  select * into v_template
  from public.builder_message_template_revisions revision
  where revision.site_id = v_site_id
    and revision.id = v_occurrence.template_revision_id
    and revision.state = 'published';
  select * into v_sender
  from public.builder_messaging_senders sender
  where sender.site_id = v_site_id
    and sender.channel = v_occurrence.channel
    and sender.state = 'verified'
  order by sender.updated_at desc, sender.id
  limit 1;
  if v_template.id is null
    or v_sender.id is null
    or v_template.channel <> v_occurrence.channel
  then
    return '{"version":1,"status":"rejected"}'::jsonb;
  end if;
  v_purpose := case
    when v_occurrence.purpose = 'marketing_reengagement'
      and v_occurrence.channel = 'email' then 'marketing_email'
    when v_occurrence.purpose = 'marketing_reengagement'
      and v_occurrence.channel = 'sms' then 'marketing_sms'
    else 'transactional_booking'
  end;
  if v_template.purpose <> v_purpose then
    return '{"version":1,"status":"rejected"}'::jsonb;
  end if;
  select coalesce(connection.provider_key, 'website_chat')
  into v_provider_key
  from public.builder_messaging_senders sender
  left join public.builder_provider_connections connection
    on connection.site_id = sender.site_id
    and connection.id = sender.connection_id
  where sender.site_id = v_site_id and sender.id = v_sender.id;

  insert into public.builder_messaging_conversations (
    site_id, id, channel, purpose, state
  ) values (
    v_site_id, v_conversation_id, v_occurrence.channel,
    v_purpose, 'waiting_on_staff'
  );
  insert into public.builder_messaging_conversation_participants (
    site_id, id, conversation_id, role, contact_id
  ) values (
    v_site_id, v_participant_id, v_conversation_id,
    'customer', v_occurrence.recipient_contact_id
  );
  insert into public.builder_messages (
    site_id, id, conversation_id, direction, channel, purpose,
    author_type, author_id, body, template_revision_id, state
  ) values (
    v_site_id, v_message_id, v_conversation_id, 'outbound',
    v_occurrence.channel, v_purpose, 'system', 'booking-reminder-worker',
    v_template.body, v_template.id, 'delivery_requested'
  );
  insert into public.builder_outbox (
    site_id, id, topic, payload, idempotency_key, schema_version,
    aggregate_type, aggregate_id, correlation_id, module_id, channel,
    provider_key, purpose, contact_id
  ) values (
    v_site_id, v_outbox_id, 'growth.message.delivery_requested',
    jsonb_build_object('version', 1, 'deliveryId', v_delivery_id),
    v_idempotency_key, 1, 'message', v_message_id, v_correlation_id,
    'growth.messaging', v_occurrence.channel, v_provider_key,
    v_purpose, v_occurrence.recipient_contact_id
  );
  insert into public.builder_message_deliveries (
    site_id, id, message_id, conversation_id, contact_id, sender_id,
    destination_reference, channel, purpose, outbox_id, idempotency_key,
    correlation_id
  ) values (
    v_site_id, v_delivery_id, v_message_id, v_conversation_id,
    v_occurrence.recipient_contact_id, v_sender.id,
    v_occurrence.contact_point_reference::text, v_occurrence.channel,
    v_purpose, v_outbox_id, v_idempotency_key, v_correlation_id
  );
  insert into public.builder_message_booking_reminder_links (
    site_id, delivery_id, message_id, reminder_plan_id,
    reminder_occurrence_id
  ) values (
    v_site_id, v_delivery_id, v_message_id, v_plan_id, v_occurrence_id
  );
  perform builder_private.record_messaging_message_event_v1(
    v_site_id, v_message_id, v_conversation_id,
    'message.delivery_requested', 'system', 'booking-reminder-worker',
    null, 'delivery_requested', v_correlation_id
  );
  perform builder_private.record_messaging_delivery_event_v1(
    v_site_id, v_delivery_id, v_message_id, 'delivery.requested',
    null, 'requested', null, null, v_correlation_id
  );
  return jsonb_build_object(
    'version', 1,
    'status', 'accepted',
    'deliveryReference', v_delivery_id
  );
end;
$$;

revoke all on function builder_private.messaging_replay_result(jsonb) from public, anon, authenticated;
revoke all on function builder_private.record_messaging_message_event_v1(
  uuid, uuid, uuid, text, text, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function builder_private.record_messaging_delivery_event_v1(
  uuid, uuid, uuid, text, text, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function builder_private.messaging_projection_actor_allowed(uuid, uuid)
  from public, anon, authenticated;

revoke all on function public.builder_apply_messaging_command_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_apply_messaging_command_v1(jsonb) to service_role;
revoke all on function public.builder_prepare_message_delivery_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_prepare_message_delivery_v1(jsonb) to service_role;
revoke all on function public.builder_record_message_transport_decision_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_record_message_transport_decision_v1(jsonb) to service_role;
revoke all on function public.builder_complete_message_delivery_attempt_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_complete_message_delivery_attempt_v1(jsonb) to service_role;
revoke all on function public.builder_record_messaging_webhook_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_record_messaging_webhook_v1(jsonb) to service_role;
revoke all on function public.builder_request_booking_reminder_delivery_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.builder_request_booking_reminder_delivery_v1(jsonb)
  to service_role;

revoke all on function public.builder_list_messaging_conversations_v1(jsonb)
  from public, anon;
revoke all on function public.builder_get_messaging_conversation_v1(jsonb)
  from public, anon;
revoke all on function public.builder_get_messaging_health_v1(jsonb)
  from public, anon;
grant execute on function public.builder_list_messaging_conversations_v1(jsonb)
  to authenticated, service_role;
grant execute on function public.builder_get_messaging_conversation_v1(jsonb)
  to authenticated, service_role;
grant execute on function public.builder_get_messaging_health_v1(jsonb)
  to authenticated, service_role;
