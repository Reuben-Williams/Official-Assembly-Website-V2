create extension if not exists btree_gist with schema extensions;

set search_path = public, extensions;

alter table public.builder_contact_identities
  add constraint builder_contact_identities_recipient_key
  unique (site_id, id, contact_id);

alter table public.builder_member_capabilities
  drop constraint builder_member_capabilities_capability_check,
  add constraint builder_member_capabilities_capability_check check (capability in (
    'dashboard.read', 'leads.read', 'leads.create', 'leads.update', 'leads.assign', 'leads.export',
    'customers.read', 'customers.update', 'customers.export', 'customers.deleteRequest',
    'tasks.read', 'tasks.manage', 'messages.read', 'messages.draft', 'messages.send',
    'templates.manage', 'reviews.manage', 'automations.read', 'automations.manage',
    'automations.approve', 'projects.read', 'projects.manage', 'integrations.manage',
    'members.manage', 'billing.manage', 'siteHealth.read', 'emergencyPause.manage',
    'bookings.read', 'bookings.create', 'bookings.update', 'bookings.approve',
    'bookings.assign', 'bookings.checkIn', 'bookings.manageServices',
    'bookings.manageAvailability', 'bookings.manageResources',
    'bookings.managePayments', 'bookings.export'
  )),
  drop constraint builder_member_capabilities_scope_check,
  add constraint builder_member_capabilities_scope_check check (
    scope = 'site'
    or (
      scope = 'assigned'
      and capability in (
        'leads.read', 'leads.update', 'customers.read', 'customers.update',
        'tasks.read', 'tasks.manage', 'messages.read', 'messages.draft',
        'messages.send', 'projects.read', 'projects.manage',
        'bookings.read', 'bookings.update', 'bookings.checkIn'
      )
    )
  );

alter table builder_private.builder_verified_entitlement_snapshot_modules
  drop constraint builder_verified_entitlement_snapshot_modules_module_id_check,
  add constraint builder_verified_entitlement_snapshot_modules_module_id_check check (module_id in (
    'core.website', 'growth.dashboard', 'growth.leads', 'growth.customers', 'growth.messaging',
    'growth.automations', 'growth.reviews', 'growth.projects', 'growth.ai', 'growth.chat',
    'growth.bookings'
  ));

alter table builder_private.builder_verified_entitlement_incident_overrides
  drop constraint builder_verified_entitlement_incident_overrides_module_id_check,
  add constraint builder_verified_entitlement_incident_overrides_module_id_check check (
    module_id is null or module_id in (
      'core.website', 'growth.dashboard', 'growth.leads', 'growth.customers', 'growth.messaging',
      'growth.automations', 'growth.reviews', 'growth.projects', 'growth.ai', 'growth.chat',
      'growth.bookings'
    )
  );

create or replace function builder_private.can_access_growth_record_node(
  p_site_id uuid,
  p_member_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_depth integer,
  p_path text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_edge record;
  v_has_parent boolean := false;
  v_node_key text;
begin
  if p_site_id is null or p_member_id is null or p_resource_id is null
    or p_resource_type not in (
      'lead', 'customer', 'task', 'conversation', 'project', 'booking'
    )
    or p_depth > 8
  then
    return false;
  end if;

  v_node_key := p_resource_type || ':' || p_resource_id::text;
  if v_node_key = any(p_path) then return false; end if;

  if exists (
    select 1
    from public.builder_record_assignments assignment
    where assignment.site_id = p_site_id
      and assignment.member_id = p_member_id
      and assignment.resource_type = p_resource_type
      and assignment.resource_id = p_resource_id
      and assignment.state = 'active'
  ) then
    return true;
  end if;

  for v_edge in
    select parent_resource_type, parent_resource_id
    from public.builder_record_access_edges
    where site_id = p_site_id
      and child_resource_type = p_resource_type
      and child_resource_id = p_resource_id
  loop
    v_has_parent := true;
    if not (
      (p_resource_type = 'customer' and v_edge.parent_resource_type = 'lead')
      or (
        p_resource_type in ('task', 'conversation')
        and v_edge.parent_resource_type in (
          'lead', 'customer', 'project', 'task', 'booking'
        )
      )
    ) then
      return false;
    end if;
    if not builder_private.can_access_growth_record_node(
      p_site_id,
      p_member_id,
      v_edge.parent_resource_type,
      v_edge.parent_resource_id,
      p_depth + 1,
      array_append(p_path, v_node_key)
    ) then
      return false;
    end if;
  end loop;

  return v_has_parent;
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
  if not v_assigned_scope or not (
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

create function builder_private.booking_site_read_allowed(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select builder_private.dependent_action_allowed(
      p_site_id,
      'growth.customers',
      'growth.bookings',
      'read'
    )
    and builder_private.member_has_capability(
      p_site_id,
      (select auth.uid()),
      'bookings.read',
      'site'
    );
$$;

create function builder_private.booking_record_read_allowed(
  p_site_id uuid,
  p_booking_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select builder_private.dependent_action_allowed(
      p_site_id,
      'growth.customers',
      'growth.bookings',
      'read'
    )
    and builder_private.member_can_access_growth_record(
      p_site_id,
      (select auth.uid()),
      'bookings.read',
      'booking',
      p_booking_id
    );
$$;

create function builder_private.booking_customer_record_read_allowed(
  p_site_id uuid,
  p_contact_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select builder_private.dependent_action_allowed(
      p_site_id,
      'growth.customers',
      'growth.bookings',
      'read'
    )
    and builder_private.member_can_access_growth_record(
      p_site_id,
      (select auth.uid()),
      'customers.read',
      'customer',
      p_contact_id
    );
$$;

create table public.builder_booking_services (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  stable_key text not null check (stable_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  state text not null default 'active' check (state in ('active', 'inactive', 'archived')),
  current_revision_id uuid,
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, stable_key),
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_booking_service_revisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  service_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  previous_revision_id uuid,
  status text not null default 'published' check (status = 'published'),
  title text not null check (char_length(title) between 1 and 200),
  description text not null check (char_length(description) between 1 and 4000),
  category text not null check (category ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  public_visibility text not null check (public_visibility in ('public', 'unlisted', 'private')),
  service_mode text not null check (service_mode in (
    'appointment', 'on_site_request', 'class', 'course', 'public_event', 'session_package'
  )),
  confirmation_mode text not null check (confirmation_mode in (
    'instant', 'approval_required', 'request_only', 'waitlist'
  )),
  definition jsonb not null check (
    jsonb_typeof(definition) = 'object'
    and octet_length(definition::text) <= 32768
  ),
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  minimum_notice_minutes integer not null check (minimum_notice_minutes between 0 and 527040),
  booking_horizon_days integer not null check (booking_horizon_days between 1 and 730),
  slot_interval_minutes integer not null check (slot_interval_minutes between 1 and 1440),
  maximum_participants integer not null check (maximum_participants between 1 and 100000),
  pricing_mode text not null check (pricing_mode in (
    'free', 'pay_later', 'full_payment', 'deposit', 'authorization_hold',
    'package', 'membership'
  )),
  published_by uuid not null,
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, service_id, revision_number),
  foreign key (site_id, service_id)
    references public.builder_booking_services(site_id, id) on delete restrict,
  foreign key (site_id, previous_revision_id)
    references public.builder_booking_service_revisions(site_id, id) on delete restrict,
  foreign key (site_id, published_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (
    (revision_number = 1 and previous_revision_id is null)
    or (revision_number > 1 and previous_revision_id is not null)
  )
);

alter table public.builder_booking_services
  add constraint builder_booking_services_current_revision_fk
  foreign key (site_id, current_revision_id)
  references public.builder_booking_service_revisions(site_id, id) on delete restrict;

create table public.builder_booking_resources (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  stable_key text not null check (stable_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  kind text not null check (kind in (
    'staff', 'room', 'equipment', 'vehicle', 'location', 'capacity'
  )),
  title text not null check (char_length(title) between 1 and 200),
  state text not null default 'active' check (state in ('active', 'inactive')),
  exclusive boolean not null,
  capacity integer not null check (capacity between 1 and 100000),
  time_zone text not null check (char_length(time_zone) between 1 and 100),
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, stable_key),
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (not exclusive or capacity = 1)
);

create table public.builder_booking_resource_eligibility (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  service_revision_id uuid not null,
  resource_id uuid not null,
  selection_group text not null default 'default' check (
    selection_group ~ '^[a-z][a-z0-9._-]{0,63}$'
  ),
  minimum_required integer not null default 0 check (minimum_required >= 0),
  maximum_selected integer not null default 1 check (maximum_selected >= minimum_required),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, service_revision_id, resource_id, selection_group),
  foreign key (site_id, service_revision_id)
    references public.builder_booking_service_revisions(site_id, id) on delete cascade,
  foreign key (site_id, resource_id)
    references public.builder_booking_resources(site_id, id) on delete restrict
);

create table public.builder_booking_service_areas (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  service_revision_id uuid not null,
  kind text not null check (kind in ('zip', 'radius', 'listed')),
  definition jsonb not null check (
    jsonb_typeof(definition) = 'object'
    and octet_length(definition::text) <= 16384
  ),
  state text not null default 'active' check (state in ('active', 'inactive')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, service_revision_id)
    references public.builder_booking_service_revisions(site_id, id) on delete cascade,
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_booking_availability_rules (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('site', 'service', 'resource')),
  owner_id uuid not null,
  time_zone text not null check (char_length(time_zone) between 1 and 100),
  weekdays text[] not null check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array[
      'monday', 'tuesday', 'wednesday', 'thursday',
      'friday', 'saturday', 'sunday'
    ]::text[]
  ),
  starts_at_local time not null,
  ends_at_local time not null,
  effective_from date not null,
  effective_until date,
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (starts_at_local < ends_at_local),
  check (effective_until is null or effective_until >= effective_from)
);

create table public.builder_booking_availability_exceptions (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('site', 'service', 'resource')),
  owner_id uuid not null,
  effect text not null check (effect in ('available', 'unavailable')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (ends_at > starts_at)
);

create table public.builder_booking_closures (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('site', 'service', 'resource')),
  owner_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  public_label text check (public_label is null or char_length(public_label) <= 200),
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (ends_at > starts_at)
);

create table public.builder_booking_external_busy_periods (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  resource_id uuid not null,
  provider_connection_id uuid not null,
  provider_event_reference text not null check (
    char_length(provider_event_reference) between 1 and 500
  ),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  busy_state text not null default 'busy' check (busy_state in ('busy', 'tentative')),
  observed_at timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, provider_connection_id, provider_event_reference),
  foreign key (site_id, resource_id)
    references public.builder_booking_resources(site_id, id) on delete cascade,
  foreign key (site_id, provider_connection_id)
    references public.builder_provider_connections(site_id, id) on delete restrict,
  check (ends_at > starts_at)
);

create table public.builder_booking_holds (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  service_id uuid not null,
  service_revision_id uuid not null,
  requester_fingerprint text not null check (
    char_length(requester_fingerprint) between 1 and 500
  ),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  capacity_units integer not null check (capacity_units between 1 and 100000),
  resource_ids uuid[] not null default '{}'::uuid[],
  state text not null default 'active' check (
    state in ('active', 'consumed', 'expired', 'released')
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, service_id)
    references public.builder_booking_services(site_id, id) on delete restrict,
  foreign key (site_id, service_revision_id)
    references public.builder_booking_service_revisions(site_id, id) on delete restrict,
  check (ends_at > starts_at),
  check (expires_at <= starts_at)
);

create table public.builder_booking_price_snapshots (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  service_revision_id uuid not null,
  pricing_mode text not null check (pricing_mode in (
    'free', 'pay_later', 'deposit', 'full_payment', 'authorization_hold',
    'package', 'membership'
  )),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  allocation jsonb not null default '{}'::jsonb check (
    jsonb_typeof(allocation) = 'object' and octet_length(allocation::text) <= 16384
  ),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, service_revision_id)
    references public.builder_booking_service_revisions(site_id, id) on delete restrict,
  check (total_minor = subtotal_minor - discount_minor + tax_minor)
);

create table public.builder_booking_policy_snapshots (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  service_revision_id uuid not null,
  cancellation_policy jsonb not null check (
    jsonb_typeof(cancellation_policy) = 'object'
    and octet_length(cancellation_policy::text) <= 16384
  ),
  reschedule_policy jsonb not null check (
    jsonb_typeof(reschedule_policy) = 'object'
    and octet_length(reschedule_policy::text) <= 16384
  ),
  attendance_policy jsonb not null check (
    jsonb_typeof(attendance_policy) = 'object'
    and octet_length(attendance_policy::text) <= 16384
  ),
  disclosure_revision text not null check (
    char_length(disclosure_revision) between 1 and 255
  ),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, service_revision_id)
    references public.builder_booking_service_revisions(site_id, id) on delete restrict
);

create table public.builder_bookings (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  service_id uuid not null,
  service_revision_id uuid not null,
  contact_id uuid not null,
  primary_assignee_id uuid,
  hold_id uuid,
  status text not null check (status in (
    'draft', 'held', 'requested', 'approved', 'confirmed', 'checked_in',
    'completed', 'waitlisted', 'rescheduled', 'cancelled', 'declined',
    'no_show', 'expired'
  )),
  confirmation_mode text not null check (confirmation_mode in (
    'instant', 'approval_required', 'request_only', 'waitlist'
  )),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null check (char_length(time_zone) between 1 and 100),
  price_snapshot_id uuid not null,
  policy_snapshot_id uuid not null,
  previous_booking_id uuid,
  replacement_booking_id uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  version integer not null default 1 check (version > 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, service_id)
    references public.builder_booking_services(site_id, id) on delete restrict,
  foreign key (site_id, service_revision_id)
    references public.builder_booking_service_revisions(site_id, id) on delete restrict,
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, primary_assignee_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, hold_id)
    references public.builder_booking_holds(site_id, id) on delete restrict,
  foreign key (site_id, price_snapshot_id)
    references public.builder_booking_price_snapshots(site_id, id) on delete restrict,
  foreign key (site_id, policy_snapshot_id)
    references public.builder_booking_policy_snapshots(site_id, id) on delete restrict,
  foreign key (site_id, previous_booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, replacement_booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (ends_at > starts_at),
  check (previous_booking_id is null or previous_booking_id <> id),
  check (replacement_booking_id is null or replacement_booking_id <> id)
);

create table public.builder_booking_reservations (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  resource_id uuid not null,
  resource_kind text not null check (resource_kind in (
    'staff', 'room', 'equipment', 'vehicle', 'location', 'capacity'
  )),
  exclusive boolean not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity_units integer not null check (capacity_units between 1 and 100000),
  state text not null default 'active' check (state in ('active', 'released', 'superseded')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, booking_id, resource_id),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, resource_id)
    references public.builder_booking_resources(site_id, id) on delete restrict,
  check (ends_at > starts_at),
  constraint builder_booking_reservations_exclusive_range_excl
    exclude using gist (
      site_id with =,
      resource_id with =,
      tstzrange(starts_at, ends_at, '[)') with &&
    )
    where (exclusive and state = 'active')
);

create function builder_private.enforce_booking_resource_capacity()
returns trigger
language plpgsql
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_resource public.builder_booking_resources%rowtype;
  v_reserved bigint;
begin
  select *
  into v_resource
  from public.builder_booking_resources
  where site_id = new.site_id and id = new.resource_id
  for update;

  if not found or v_resource.state <> 'active' then
    raise exception 'booking resource is not active' using errcode = '23514';
  end if;
  if new.exclusive is distinct from v_resource.exclusive
    or new.resource_kind is distinct from v_resource.kind
  then
    raise exception 'booking reservation resource snapshot mismatch' using errcode = '23514';
  end if;
  if new.state <> 'active' or new.exclusive then return new; end if;

  select coalesce(sum(reservation.capacity_units), 0)
  into v_reserved
  from public.builder_booking_reservations reservation
  where reservation.site_id = new.site_id
    and reservation.resource_id = new.resource_id
    and reservation.state = 'active'
    and reservation.id <> new.id
    and tstzrange(reservation.starts_at, reservation.ends_at, '[)')
      && tstzrange(new.starts_at, new.ends_at, '[)');

  if v_reserved + new.capacity_units > v_resource.capacity then
    raise exception 'booking resource capacity exceeded' using errcode = '23P01';
  end if;
  return new;
end;
$$;

create trigger builder_booking_reservations_capacity_guard
before insert or update on public.builder_booking_reservations
for each row execute function builder_private.enforce_booking_resource_capacity();

create table public.builder_booking_participants (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  contact_id uuid not null,
  role text not null check (role in ('primary_customer', 'participant', 'guest')),
  attendance_status text not null default 'expected' check (
    attendance_status in ('expected', 'checked_in', 'attended', 'absent', 'no_show')
  ),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, booking_id, contact_id),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete cascade,
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict
);

create table public.builder_booking_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
  from_status text,
  to_status text,
  actor_id uuid,
  reason text check (reason is null or char_length(reason) <= 2000),
  evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 16384
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create trigger builder_booking_events_append_only
before update or delete on public.builder_booking_events
for each row execute function builder_private.reject_append_only_change();

create table public.builder_booking_intake_responses (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  form_revision_id uuid not null,
  response_revision_id uuid not null,
  consent_evidence_ids uuid[] not null default '{}'::uuid[],
  submitted_at timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, booking_id, form_revision_id),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict
);

create table public.builder_booking_waitlist_entries (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  service_id uuid not null,
  contact_id uuid not null,
  status text not null default 'waiting' check (
    status in ('waiting', 'offered', 'accepted', 'expired', 'cancelled', 'converted')
  ),
  preferred_starts_on date not null,
  preferred_ends_on date not null,
  preferred_time_windows jsonb not null default '[]'::jsonb check (
    jsonb_typeof(preferred_time_windows) = 'array'
    and jsonb_array_length(preferred_time_windows) <= 32
  ),
  preferred_resource_ids uuid[] not null default '{}'::uuid[],
  capacity_units integer not null check (capacity_units between 1 and 100000),
  price_preapproved boolean not null default false,
  policy_preapproved boolean not null default false,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, service_id)
    references public.builder_booking_services(site_id, id) on delete restrict,
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  check (preferred_ends_on >= preferred_starts_on)
);

create table public.builder_booking_waitlist_offers (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  waitlist_entry_id uuid not null,
  hold_id uuid not null,
  status text not null default 'offered' check (
    status in ('offered', 'accepted', 'expired', 'cancelled', 'converted')
  ),
  opening_key text not null check (char_length(opening_key) between 1 and 255),
  offered_at timestamptz not null,
  expires_at timestamptz not null,
  capacity_units integer not null check (capacity_units between 1 and 100000),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, waitlist_entry_id)
    references public.builder_booking_waitlist_entries(site_id, id) on delete restrict,
  foreign key (site_id, hold_id)
    references public.builder_booking_holds(site_id, id) on delete restrict,
  check (expires_at > offered_at)
);

create unique index builder_booking_waitlist_offers_one_active_idx
  on public.builder_booking_waitlist_offers (site_id, opening_key)
  where status = 'offered';

create table public.builder_appointment_work_sessions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  prior_session_id uuid,
  manager_reopen_reason text check (
    manager_reopen_reason is null or char_length(manager_reopen_reason) between 10 and 2000
  ),
  template_id uuid not null,
  template_revision_id uuid not null,
  state text not null default 'not_started' check (
    state in ('not_started', 'in_progress', 'ended')
  ),
  started_at timestamptz,
  resumed_at timestamptz,
  ended_at timestamptz,
  started_by uuid,
  ended_by uuid,
  outcome_id uuid,
  administrative_end_reason text check (
    administrative_end_reason is null or char_length(administrative_end_reason) <= 2000
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, prior_session_id)
    references public.builder_appointment_work_sessions(site_id, id) on delete restrict,
  foreign key (site_id, started_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, ended_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (
    (prior_session_id is null and manager_reopen_reason is null)
    or (prior_session_id is not null and manager_reopen_reason is not null)
  ),
  check (
    (state = 'not_started' and started_at is null and ended_at is null)
    or (state = 'in_progress' and started_at is not null and ended_at is null)
    or (state = 'ended' and started_at is not null and ended_at is not null)
  )
);

create unique index builder_appointment_work_sessions_one_active_idx
  on public.builder_appointment_work_sessions (site_id, booking_id)
  where state <> 'ended';

create table public.builder_appointment_checklist_revisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  work_session_id uuid not null,
  checklist_key text not null check (checklist_key ~ '^[a-z][a-z0-9._-]{0,127}$'),
  revision_number integer not null check (revision_number > 0),
  previous_revision_id uuid,
  state text not null check (state in ('pending', 'completed', 'skipped')),
  response jsonb not null default '{}'::jsonb check (
    jsonb_typeof(response) = 'object' and octet_length(response::text) <= 16384
  ),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, work_session_id, checklist_key, revision_number),
  foreign key (site_id, work_session_id)
    references public.builder_appointment_work_sessions(site_id, id) on delete restrict,
  foreign key (site_id, previous_revision_id)
    references public.builder_appointment_checklist_revisions(site_id, id) on delete restrict,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_appointment_field_response_revisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  work_session_id uuid not null,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9._-]{0,127}$'),
  revision_number integer not null check (revision_number > 0),
  previous_revision_id uuid,
  value jsonb not null check (octet_length(value::text) <= 16384),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, work_session_id, field_key, revision_number),
  foreign key (site_id, work_session_id)
    references public.builder_appointment_work_sessions(site_id, id) on delete restrict,
  foreign key (site_id, previous_revision_id)
    references public.builder_appointment_field_response_revisions(site_id, id) on delete restrict,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_appointment_note_revisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  work_session_id uuid not null,
  note_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  previous_revision_id uuid,
  visibility text not null check (visibility in ('assigned_staff', 'site_staff', 'managers')),
  body text not null check (char_length(body) between 1 and 8000),
  actor_id uuid not null,
  retention_archived_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, note_id, revision_number),
  foreign key (site_id, work_session_id)
    references public.builder_appointment_work_sessions(site_id, id) on delete restrict,
  foreign key (site_id, previous_revision_id)
    references public.builder_appointment_note_revisions(site_id, id) on delete restrict,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_appointment_item_references (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  work_session_id uuid not null,
  source_kind text not null check (source_kind in (
    'site_media', 'site_collection', 'business_catalog', 'external_catalog'
  )),
  source_instance_id text not null check (char_length(source_instance_id) between 1 and 500),
  source_configuration_revision integer not null check (
    source_configuration_revision > 0
  ),
  source_stable_id text not null check (char_length(source_stable_id) between 1 and 500),
  source_item_revision text,
  asset_revision_id uuid,
  object_reference text check (
    object_reference is null or char_length(object_reference) between 1 and 2000
  ),
  display_title text not null check (char_length(display_title) between 1 and 500),
  thumbnail_reference text,
  metadata_snapshot jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata_snapshot) = 'object'
    and octet_length(metadata_snapshot::text) <= 32768
  ),
  availability_state text not null default 'unknown' check (
    availability_state in ('available', 'limited', 'unavailable', 'unknown')
  ),
  source_health_state text not null default 'healthy' check (
    source_health_state in ('healthy', 'degraded', 'unavailable')
  ),
  sort_position integer not null default 0 check (sort_position >= 0),
  staff_note text check (staff_note is null or char_length(staff_note) <= 2000),
  selected_by uuid not null,
  selected_at timestamptz not null,
  archived_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, work_session_id, source_kind, source_instance_id, source_stable_id),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, work_session_id)
    references public.builder_appointment_work_sessions(site_id, id) on delete restrict,
  foreign key (site_id, selected_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (
    source_kind <> 'site_media'
    or (asset_revision_id is not null and object_reference is not null)
  )
);

create table public.builder_appointment_outcomes (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  work_session_id uuid not null,
  category text not null check (
    category in ('completed', 'partially_completed', 'follow_up_required')
  ),
  reason_code text check (reason_code is null or reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  owner_explanation text check (
    owner_explanation is null or char_length(owner_explanation) <= 4000
  ),
  follow_up_decision text not null check (follow_up_decision in (
    'create_task', 'request_booking', 'create_reminder_plan', 'no_further_action'
  )),
  follow_up_reference_type text,
  follow_up_reference_id uuid,
  supersedes_outcome_id uuid,
  supersession_reason text check (
    supersession_reason is null or char_length(supersession_reason) between 10 and 2000
  ),
  actor_id uuid not null,
  occurred_at timestamptz not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, work_session_id)
    references public.builder_appointment_work_sessions(site_id, id) on delete restrict,
  foreign key (site_id, supersedes_outcome_id)
    references public.builder_appointment_outcomes(site_id, id) on delete restrict,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (
    (category = 'completed')
    or (reason_code is not null and owner_explanation is not null)
  ),
  check (
    (supersedes_outcome_id is null and supersession_reason is null)
    or (supersedes_outcome_id is not null and supersession_reason is not null)
  )
);

create table public.builder_booking_follow_up_links (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  work_session_id uuid not null,
  outcome_id uuid not null,
  follow_up_kind text not null check (
    follow_up_kind in ('task', 'booking_request', 'reminder_plan')
  ),
  follow_up_resource_id uuid not null,
  state text not null default 'active' check (state in ('active', 'completed', 'cancelled')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, outcome_id, follow_up_kind, follow_up_resource_id),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, work_session_id)
    references public.builder_appointment_work_sessions(site_id, id) on delete restrict,
  foreign key (site_id, outcome_id)
    references public.builder_appointment_outcomes(site_id, id) on delete restrict,
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

alter table public.builder_appointment_work_sessions
  add constraint builder_appointment_work_sessions_outcome_fk
  foreign key (site_id, outcome_id)
  references public.builder_appointment_outcomes(site_id, id) on delete restrict;

create table public.builder_booking_reminder_defaults (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  scope text not null check (scope in ('business', 'service')),
  service_id uuid,
  revision_number integer not null check (revision_number > 0),
  previous_revision_id uuid,
  configuration jsonb not null check (
    jsonb_typeof(configuration) = 'object'
    and octet_length(configuration::text) <= 32768
  ),
  status text not null default 'published' check (status = 'published'),
  published_by uuid not null,
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, scope, service_id, revision_number),
  foreign key (site_id, service_id)
    references public.builder_booking_services(site_id, id) on delete restrict,
  foreign key (site_id, previous_revision_id)
    references public.builder_booking_reminder_defaults(site_id, id) on delete restrict,
  foreign key (site_id, published_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check ((scope = 'business' and service_id is null) or (scope = 'service' and service_id is not null))
);

create table public.builder_booking_reminder_overrides (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  previous_revision_id uuid,
  configuration jsonb not null check (
    jsonb_typeof(configuration) = 'object'
    and octet_length(configuration::text) <= 32768
  ),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, booking_id, revision_number),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, previous_revision_id)
    references public.builder_booking_reminder_overrides(site_id, id) on delete restrict,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_customer_reminder_overrides (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  previous_revision_id uuid,
  configuration jsonb not null check (
    jsonb_typeof(configuration) = 'object'
    and octet_length(configuration::text) <= 32768
  ),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, contact_id, revision_number),
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, previous_revision_id)
    references public.builder_customer_reminder_overrides(site_id, id) on delete restrict,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_booking_reminder_plans (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid,
  contact_id uuid not null,
  service_id uuid,
  outcome_id uuid,
  appointment_item_reference_id uuid,
  customer_preference_id uuid,
  participant_role text not null check (char_length(participant_role) between 1 and 200),
  consent_subject_id uuid not null,
  contact_point_reference uuid not null,
  customer_time_zone text not null check (char_length(customer_time_zone) between 1 and 100),
  time_zone_source text not null check (char_length(time_zone_source) between 1 and 200),
  purpose text not null check (purpose in (
    'appointment_required', 'service_follow_up', 'customer_requested_recurring',
    'marketing_reengagement'
  )),
  schedule_kind text not null check (schedule_kind in (
    'immediate', 'relative_to_appointment', 'absolute_local',
    'interval_days', 'interval_weeks', 'interval_months', 'interval_years',
    'monthly_day_of_month', 'monthly_weekday', 'anniversary'
  )),
  state text not null default 'draft' check (state in (
    'draft', 'published', 'active', 'paused', 'completed', 'cancelled',
    'suppressed', 'failed_review'
  )),
  channel text not null check (channel in ('email', 'sms')),
  resolved_configuration jsonb not null check (
    jsonb_typeof(resolved_configuration) = 'object'
    and octet_length(resolved_configuration::text) <= 32768
  ),
  published_revision_id uuid,
  business_default_revision_id uuid not null,
  service_default_revision_id uuid not null,
  customer_override_revision_id uuid not null,
  booking_override_revision_id uuid not null,
  next_occurrence_at timestamptz,
  activated_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  version integer not null default 1 check (version > 0),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, service_id)
    references public.builder_booking_services(site_id, id) on delete restrict,
  foreign key (site_id, outcome_id)
    references public.builder_appointment_outcomes(site_id, id) on delete restrict,
  foreign key (site_id, appointment_item_reference_id)
    references public.builder_appointment_item_references(site_id, id) on delete restrict,
  foreign key (site_id, consent_subject_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, contact_point_reference, contact_id)
    references public.builder_contact_identities(site_id, id, contact_id) on delete restrict,
  foreign key (site_id, business_default_revision_id)
    references public.builder_booking_reminder_defaults(site_id, id) on delete restrict,
  foreign key (site_id, service_default_revision_id)
    references public.builder_booking_reminder_defaults(site_id, id) on delete restrict,
  foreign key (site_id, customer_override_revision_id)
    references public.builder_customer_reminder_overrides(site_id, id) on delete restrict,
  foreign key (site_id, booking_override_revision_id)
    references public.builder_booking_reminder_overrides(site_id, id) on delete restrict,
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (
    state = 'draft'
    or published_revision_id is not null
  )
);

create table public.builder_booking_reminder_plan_revisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  plan_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  previous_revision_id uuid,
  resolved_configuration jsonb not null check (
    jsonb_typeof(resolved_configuration) = 'object'
    and octet_length(resolved_configuration::text) <= 32768
  ),
  business_default_revision_id uuid not null,
  service_default_revision_id uuid not null,
  customer_override_revision_id uuid not null,
  booking_override_revision_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, plan_id, revision_number),
  unique (site_id, plan_id, id),
  foreign key (site_id, plan_id)
    references public.builder_booking_reminder_plans(site_id, id) on delete restrict,
  foreign key (site_id, plan_id, previous_revision_id)
    references public.builder_booking_reminder_plan_revisions(site_id, plan_id, id)
    on delete restrict,
  foreign key (site_id, business_default_revision_id)
    references public.builder_booking_reminder_defaults(site_id, id) on delete restrict,
  foreign key (site_id, service_default_revision_id)
    references public.builder_booking_reminder_defaults(site_id, id) on delete restrict,
  foreign key (site_id, customer_override_revision_id)
    references public.builder_customer_reminder_overrides(site_id, id) on delete restrict,
  foreign key (site_id, booking_override_revision_id)
    references public.builder_booking_reminder_overrides(site_id, id) on delete restrict,
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (
    (revision_number = 1 and previous_revision_id is null)
    or (revision_number > 1 and previous_revision_id is not null)
  )
);

alter table public.builder_booking_reminder_plans
  add constraint builder_booking_reminder_plans_published_revision_fk
  foreign key (site_id, id, published_revision_id)
  references public.builder_booking_reminder_plan_revisions(site_id, plan_id, id)
  on delete restrict;

create function builder_private.enforce_booking_reminder_recipient()
returns trigger
language plpgsql
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_booking public.builder_bookings%rowtype;
begin
  if new.consent_subject_id <> new.contact_id then
    raise exception 'reminder consent subject must match the recipient'
      using errcode = '23514';
  end if;

  if new.booking_id is null then
    return new;
  end if;

  select *
  into v_booking
  from public.builder_bookings
  where site_id = new.site_id and id = new.booking_id;

  if not found then
    raise exception 'reminder booking does not exist' using errcode = '23503';
  end if;
  if new.service_id is not null and new.service_id <> v_booking.service_id then
    raise exception 'reminder service does not match the booking'
      using errcode = '23514';
  end if;
  if not (
    (
      new.contact_id = v_booking.contact_id
      and new.participant_role = 'primary_customer'
    )
    or exists (
      select 1
      from public.builder_booking_participants participant
      where participant.site_id = new.site_id
        and participant.booking_id = new.booking_id
        and participant.contact_id = new.contact_id
        and participant.role = new.participant_role
    )
  ) then
    raise exception 'reminder recipient is not attached to the booking'
      using errcode = '23514';
  end if;
  if new.purpose = 'appointment_required'
    and v_booking.status not in ('approved', 'confirmed', 'checked_in')
  then
    raise exception 'appointment reminder requires an accepted active booking'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger builder_booking_reminder_plans_recipient_guard
before insert or update of
  booking_id, contact_id, service_id, participant_role, consent_subject_id, purpose
on public.builder_booking_reminder_plans
for each row execute function builder_private.enforce_booking_reminder_recipient();

create trigger builder_booking_reminder_plan_revisions_immutable
before update or delete on public.builder_booking_reminder_plan_revisions
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_booking_reminder_occurrences (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  plan_id uuid not null,
  plan_revision_id uuid not null,
  booking_id uuid,
  recipient_contact_id uuid not null,
  participant_role text not null check (char_length(participant_role) between 1 and 200),
  consent_subject_id uuid not null,
  contact_point_reference uuid not null,
  channel text not null check (channel in ('email', 'sms')),
  customer_time_zone text not null check (char_length(customer_time_zone) between 1 and 100),
  time_zone_source text not null check (char_length(time_zone_source) between 1 and 200),
  time_zone_data_version text check (
    time_zone_data_version is null or char_length(time_zone_data_version) between 1 and 100
  ),
  intended_local_time timestamp not null,
  purpose text not null check (purpose in (
    'appointment_required', 'service_follow_up', 'customer_requested_recurring',
    'marketing_reengagement'
  )),
  scheduled_for timestamptz not null,
  latest_send_at timestamptz not null,
  appointment_starts_at timestamptz,
  recurrence_anchor timestamp not null,
  template_revision_id uuid not null,
  state text not null default 'scheduled' check (state in (
    'scheduled', 'held_for_quiet_hours', 'ready', 'claimed', 'sent',
    'delivered', 'skipped', 'suppressed', 'failed_retryable',
    'failed_review', 'cancelled'
  )),
  decision_evidence jsonb not null check (
    jsonb_typeof(decision_evidence) = 'object'
    and octet_length(decision_evidence::text) <= 32768
  ),
  resolved_lineage jsonb not null check (
    jsonb_typeof(resolved_lineage) = 'object'
    and octet_length(resolved_lineage::text) <= 16384
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  version integer not null default 1 check (version > 0),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  skip_reason text check (skip_reason is null or char_length(skip_reason) <= 2000),
  outbox_reference text check (
    outbox_reference is null or char_length(outbox_reference) <= 500
  ),
  provider_reference text check (
    provider_reference is null or char_length(provider_reference) <= 500
  ),
  failure_reason text check (
    failure_reason is null or char_length(failure_reason) <= 4000
  ),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  unique (site_id, plan_id, recipient_contact_id, scheduled_for),
  foreign key (site_id, plan_id)
    references public.builder_booking_reminder_plans(site_id, id) on delete cascade,
  constraint builder_booking_occurrence_plan_revision_fk
    foreign key (site_id, plan_id, plan_revision_id)
    references public.builder_booking_reminder_plan_revisions(site_id, plan_id, id)
    on delete restrict,
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, recipient_contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, consent_subject_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, contact_point_reference, recipient_contact_id)
    references public.builder_contact_identities(site_id, id, contact_id) on delete restrict,
  check (scheduled_for <= latest_send_at),
  check (
    purpose <> 'appointment_required'
    or (
      appointment_starts_at is not null
      and latest_send_at <= appointment_starts_at
    )
  ),
  check (
    (state = 'claimed') =
    (lease_owner is not null and lease_token is not null and lease_expires_at is not null)
  )
);

create table public.builder_booking_reminder_occurrence_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  occurrence_id uuid not null,
  plan_id uuid not null,
  event_type text not null check (
    event_type in (
      'materialized', 'claimed', 'deferred', 'sent', 'skipped',
      'suppressed', 'failed_retryable', 'failed_review', 'delivered',
      'cancelled'
    )
  ),
  from_state text,
  to_state text not null,
  reason_code text check (
    reason_code is null or reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 16384
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, occurrence_id)
    references public.builder_booking_reminder_occurrences(site_id, id) on delete restrict,
  foreign key (site_id, plan_id)
    references public.builder_booking_reminder_plans(site_id, id) on delete restrict
);

create table public.builder_customer_item_preferences (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  source_kind text not null check (source_kind in (
    'site_media', 'site_collection', 'business_catalog', 'external_catalog'
  )),
  source_instance_id text not null check (char_length(source_instance_id) between 1 and 500),
  source_configuration_revision integer not null check (
    source_configuration_revision > 0
  ),
  source_stable_id text not null check (char_length(source_stable_id) between 1 and 500),
  source_item_revision text,
  display_snapshot jsonb not null check (
    jsonb_typeof(display_snapshot) = 'object'
    and octet_length(display_snapshot::text) <= 32768
  ),
  preference_state text not null default 'active' check (
    preference_state in ('active', 'archived')
  ),
  note text check (note is null or char_length(note) <= 2000),
  originating_booking_id uuid,
  originating_work_session_id uuid,
  created_by uuid not null,
  archived_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, contact_id, source_kind, source_instance_id, source_stable_id),
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, originating_booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, originating_work_session_id)
    references public.builder_appointment_work_sessions(site_id, id) on delete restrict,
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

alter table public.builder_booking_reminder_plans
  add constraint builder_booking_reminder_plans_customer_preference_fk
  foreign key (site_id, customer_preference_id)
  references public.builder_customer_item_preferences(site_id, id) on delete restrict;

create table public.builder_booking_payment_references (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  contact_id uuid not null,
  price_snapshot_id uuid not null,
  kind text not null check (kind in (
    'deposit', 'authorization', 'capture', 'refund', 'cancellation_fee',
    'no_show_fee', 'dispute', 'receipt', 'balance'
  )),
  state text not null check (state in (
    'pending', 'authorized', 'captured', 'partially_refunded', 'refunded',
    'failed', 'voided', 'disputed', 'reconciliation_required'
  )),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9._-]{0,127}$'),
  provider_reference_type text not null check (
    char_length(provider_reference_type) between 1 and 100
  ),
  provider_reference_id text not null check (
    char_length(provider_reference_id) between 1 and 500
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  occurred_at timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  unique (site_id, provider_key, provider_reference_type, provider_reference_id),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, price_snapshot_id)
    references public.builder_booking_price_snapshots(site_id, id) on delete restrict
);

create table public.builder_booking_payment_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  payment_reference_id uuid not null,
  booking_id uuid not null,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9._-]{0,127}$'),
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 500),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
  event_digest text not null check (event_digest ~ '^[a-f0-9]{64}$'),
  reconciliation_state text not null check (
    reconciliation_state in ('applied', 'duplicate', 'ignored', 'manual_review')
  ),
  sanitized_evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(sanitized_evidence) = 'object'
    and octet_length(sanitized_evidence::text) <= 16384
  ),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, provider_key, provider_event_id),
  foreign key (site_id, payment_reference_id)
    references public.builder_booking_payment_references(site_id, id) on delete restrict,
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict
);

create table public.builder_booking_package_entitlements (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  package_revision_id uuid not null,
  state text not null check (state in ('active', 'exhausted', 'expired', 'cancelled')),
  credit_unit text not null check (credit_unit in (
    'appointment', 'class_seat', 'session', 'service'
  )),
  total_credits integer not null check (total_credits >= 0),
  reserved_credits integer not null default 0 check (reserved_credits >= 0),
  consumed_credits integer not null default 0 check (consumed_credits >= 0),
  eligible_service_revision_ids uuid[] not null,
  purchased_at timestamptz not null,
  expires_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  check (reserved_credits + consumed_credits <= total_credits)
);

create table public.builder_booking_membership_entitlements (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  membership_revision_id uuid not null,
  state text not null check (state in (
    'trialing', 'active', 'paused', 'past_due', 'cancelled', 'expired'
  )),
  credit_unit text not null check (credit_unit in (
    'appointment', 'class_seat', 'session', 'service'
  )),
  included_credits_per_period integer not null check (included_credits_per_period >= 0),
  reserved_credits integer not null default 0 check (reserved_credits >= 0),
  consumed_credits integer not null default 0 check (consumed_credits >= 0),
  eligible_service_revision_ids uuid[] not null,
  starts_at timestamptz not null,
  current_period_starts_at timestamptz not null,
  current_period_ends_at timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  check (reserved_credits + consumed_credits <= included_credits_per_period),
  check (current_period_ends_at > current_period_starts_at)
);

create table public.builder_booking_credit_reservations (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  booking_id uuid not null,
  service_revision_id uuid not null,
  source_kind text not null check (source_kind in ('package', 'membership')),
  source_entitlement_id uuid not null,
  quantity integer not null check (quantity > 0),
  state text not null default 'active' check (
    state in ('active', 'released', 'consumed', 'expired')
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  reserved_at timestamptz not null,
  expires_at timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, service_revision_id)
    references public.builder_booking_service_revisions(site_id, id) on delete restrict,
  check (expires_at > reserved_at)
);

create table public.builder_booking_credit_consumptions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  booking_id uuid not null,
  reservation_id uuid not null,
  source_kind text not null check (source_kind in ('package', 'membership')),
  source_entitlement_id uuid not null,
  quantity integer not null check (quantity > 0),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  consumed_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict,
  foreign key (site_id, reservation_id)
    references public.builder_booking_credit_reservations(site_id, id) on delete restrict
);

create trigger builder_booking_service_revisions_append_only
before update or delete on public.builder_booking_service_revisions
for each row execute function builder_private.reject_append_only_change();
create trigger builder_booking_price_snapshots_append_only
before update or delete on public.builder_booking_price_snapshots
for each row execute function builder_private.reject_append_only_change();
create trigger builder_booking_policy_snapshots_append_only
before update or delete on public.builder_booking_policy_snapshots
for each row execute function builder_private.reject_append_only_change();
create trigger builder_appointment_checklist_revisions_append_only
before update or delete on public.builder_appointment_checklist_revisions
for each row execute function builder_private.reject_append_only_change();
create trigger builder_appointment_field_revisions_append_only
before update or delete on public.builder_appointment_field_response_revisions
for each row execute function builder_private.reject_append_only_change();
create trigger builder_appointment_note_revisions_append_only
before update or delete on public.builder_appointment_note_revisions
for each row execute function builder_private.reject_append_only_change();
create trigger builder_appointment_outcomes_append_only
before update or delete on public.builder_appointment_outcomes
for each row execute function builder_private.reject_append_only_change();
create trigger builder_booking_reminder_occurrence_events_append_only
before update or delete on public.builder_booking_reminder_occurrence_events
for each row execute function builder_private.reject_append_only_change();
create trigger builder_booking_payment_events_append_only
before update or delete on public.builder_booking_payment_events
for each row execute function builder_private.reject_append_only_change();
create trigger builder_booking_credit_consumptions_append_only
before update or delete on public.builder_booking_credit_consumptions
for each row execute function builder_private.reject_append_only_change();

create index builder_booking_service_revisions_public_idx
  on public.builder_booking_service_revisions (
    site_id, public_visibility, service_mode, published_at desc
  );
create index builder_booking_resources_state_idx
  on public.builder_booking_resources (site_id, state, kind, title);
create index builder_booking_service_areas_revision_idx
  on public.builder_booking_service_areas (site_id, service_revision_id, state, kind);
create index builder_booking_availability_rules_owner_idx
  on public.builder_booking_availability_rules (site_id, owner_kind, owner_id, effective_from);
create index builder_booking_availability_exceptions_range_idx
  on public.builder_booking_availability_exceptions (site_id, owner_kind, owner_id, starts_at, ends_at);
create index builder_booking_closures_range_idx
  on public.builder_booking_closures (site_id, owner_kind, owner_id, starts_at, ends_at);
create index builder_booking_busy_periods_range_idx
  on public.builder_booking_external_busy_periods (site_id, resource_id, starts_at, ends_at);
create index builder_booking_holds_active_idx
  on public.builder_booking_holds (site_id, starts_at, ends_at, expires_at)
  where state = 'active';
create index builder_bookings_calendar_idx
  on public.builder_bookings (site_id, starts_at, status, primary_assignee_id);
create index builder_bookings_contact_idx
  on public.builder_bookings (site_id, contact_id, starts_at desc);
create index builder_booking_reservations_range_idx
  on public.builder_booking_reservations (site_id, resource_id, starts_at, ends_at)
  where state = 'active';
create index builder_booking_events_timeline_idx
  on public.builder_booking_events (site_id, booking_id, occurred_at desc);
create index builder_waitlist_queue_idx
  on public.builder_booking_waitlist_entries (site_id, service_id, status, created_at);
create index builder_appointment_items_session_idx
  on public.builder_appointment_item_references (
    site_id, work_session_id, archived_at, sort_position
  );
create index builder_booking_reminder_plans_next_idx
  on public.builder_booking_reminder_plans (site_id, state, next_occurrence_at);
create index builder_booking_reminder_plan_revisions_plan_idx
  on public.builder_booking_reminder_plan_revisions (
    site_id, plan_id, revision_number desc
  );
create index builder_booking_reminder_occurrences_due_idx
  on public.builder_booking_reminder_occurrences (site_id, state, scheduled_for)
  where state in ('scheduled', 'held_for_quiet_hours', 'ready', 'claimed');
create index builder_booking_reminder_occurrence_events_idx
  on public.builder_booking_reminder_occurrence_events (
    site_id, occurrence_id, occurred_at desc
  );
create index builder_booking_payment_references_booking_idx
  on public.builder_booking_payment_references (site_id, booking_id, occurred_at desc);
create index builder_booking_payment_events_booking_idx
  on public.builder_booking_payment_events (site_id, booking_id, occurred_at desc);

alter table public.builder_booking_services enable row level security;
alter table public.builder_booking_service_revisions enable row level security;
alter table public.builder_booking_resources enable row level security;
alter table public.builder_booking_resource_eligibility enable row level security;
alter table public.builder_booking_service_areas enable row level security;
alter table public.builder_booking_availability_rules enable row level security;
alter table public.builder_booking_availability_exceptions enable row level security;
alter table public.builder_booking_closures enable row level security;
alter table public.builder_booking_external_busy_periods enable row level security;
alter table public.builder_booking_holds enable row level security;
alter table public.builder_booking_policy_snapshots enable row level security;
alter table public.builder_bookings enable row level security;
alter table public.builder_booking_reservations enable row level security;
alter table public.builder_booking_participants enable row level security;
alter table public.builder_booking_events enable row level security;
alter table public.builder_booking_intake_responses enable row level security;
alter table public.builder_booking_waitlist_entries enable row level security;
alter table public.builder_booking_waitlist_offers enable row level security;
alter table public.builder_appointment_work_sessions enable row level security;
alter table public.builder_appointment_checklist_revisions enable row level security;
alter table public.builder_appointment_field_response_revisions enable row level security;
alter table public.builder_appointment_note_revisions enable row level security;
alter table public.builder_appointment_item_references enable row level security;
alter table public.builder_appointment_outcomes enable row level security;
alter table public.builder_booking_follow_up_links enable row level security;
alter table public.builder_booking_reminder_defaults enable row level security;
alter table public.builder_booking_reminder_overrides enable row level security;
alter table public.builder_booking_reminder_plans enable row level security;
alter table public.builder_booking_reminder_plan_revisions enable row level security;
alter table public.builder_booking_reminder_occurrences enable row level security;
alter table public.builder_booking_reminder_occurrence_events enable row level security;
alter table public.builder_booking_price_snapshots enable row level security;
alter table public.builder_booking_payment_references enable row level security;
alter table public.builder_booking_payment_events enable row level security;
alter table public.builder_booking_package_entitlements enable row level security;
alter table public.builder_booking_membership_entitlements enable row level security;
alter table public.builder_booking_credit_reservations enable row level security;
alter table public.builder_booking_credit_consumptions enable row level security;
alter table public.builder_customer_item_preferences enable row level security;
alter table public.builder_customer_reminder_overrides enable row level security;

create policy builder_booking_services_read on public.builder_booking_services
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_service_revisions_read on public.builder_booking_service_revisions
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_resources_read on public.builder_booking_resources
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_resource_eligibility_read on public.builder_booking_resource_eligibility
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_service_areas_read on public.builder_booking_service_areas
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_availability_rules_read on public.builder_booking_availability_rules
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_availability_exceptions_read on public.builder_booking_availability_exceptions
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_closures_read on public.builder_booking_closures
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_external_busy_periods_read on public.builder_booking_external_busy_periods
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_holds_read on public.builder_booking_holds
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_policy_snapshots_read on public.builder_booking_policy_snapshots
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_bookings_read on public.builder_bookings
for select to authenticated using (builder_private.booking_record_read_allowed(site_id, id));
create policy builder_booking_reservations_read on public.builder_booking_reservations
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_booking_participants_read on public.builder_booking_participants
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_booking_events_read on public.builder_booking_events
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_booking_intake_responses_read on public.builder_booking_intake_responses
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_booking_waitlist_entries_read on public.builder_booking_waitlist_entries
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_waitlist_offers_read on public.builder_booking_waitlist_offers
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_appointment_work_sessions_read on public.builder_appointment_work_sessions
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_appointment_checklist_revisions_read on public.builder_appointment_checklist_revisions
for select to authenticated using (
  exists (
    select 1 from public.builder_appointment_work_sessions session
    where session.site_id = builder_appointment_checklist_revisions.site_id
      and session.id = builder_appointment_checklist_revisions.work_session_id
      and builder_private.booking_record_read_allowed(session.site_id, session.booking_id)
  )
);
create policy builder_appointment_field_response_revisions_read on public.builder_appointment_field_response_revisions
for select to authenticated using (
  exists (
    select 1 from public.builder_appointment_work_sessions session
    where session.site_id = builder_appointment_field_response_revisions.site_id
      and session.id = builder_appointment_field_response_revisions.work_session_id
      and builder_private.booking_record_read_allowed(session.site_id, session.booking_id)
  )
);
create policy builder_appointment_note_revisions_read on public.builder_appointment_note_revisions
for select to authenticated using (
  exists (
    select 1 from public.builder_appointment_work_sessions session
    where session.site_id = builder_appointment_note_revisions.site_id
      and session.id = builder_appointment_note_revisions.work_session_id
      and builder_private.booking_record_read_allowed(session.site_id, session.booking_id)
  )
);
create policy builder_appointment_item_references_read on public.builder_appointment_item_references
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_appointment_outcomes_read on public.builder_appointment_outcomes
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_booking_follow_up_links_read on public.builder_booking_follow_up_links
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_booking_reminder_defaults_read on public.builder_booking_reminder_defaults
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_reminder_overrides_read on public.builder_booking_reminder_overrides
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_booking_reminder_plans_read on public.builder_booking_reminder_plans
for select to authenticated using (
  (
    booking_id is null
    and builder_private.booking_customer_record_read_allowed(site_id, contact_id)
  )
  or (
    booking_id is not null
    and builder_private.booking_record_read_allowed(site_id, booking_id)
  )
);
create policy builder_booking_reminder_plan_revisions_read
on public.builder_booking_reminder_plan_revisions
for select to authenticated using (
  exists (
    select 1
    from public.builder_booking_reminder_plans plan
    where plan.site_id = builder_booking_reminder_plan_revisions.site_id
      and plan.id = builder_booking_reminder_plan_revisions.plan_id
      and (
        (
          plan.booking_id is null
          and builder_private.booking_customer_record_read_allowed(
            plan.site_id,
            plan.contact_id
          )
        )
        or (
          plan.booking_id is not null
          and builder_private.booking_record_read_allowed(
            plan.site_id,
            plan.booking_id
          )
        )
      )
  )
);
create policy builder_booking_reminder_occurrences_read on public.builder_booking_reminder_occurrences
for select to authenticated using (
  (
    booking_id is null
    and builder_private.booking_customer_record_read_allowed(
      site_id,
      recipient_contact_id
    )
  )
  or (
    booking_id is not null
    and builder_private.booking_record_read_allowed(site_id, booking_id)
  )
);
create policy builder_booking_reminder_occurrence_events_read
on public.builder_booking_reminder_occurrence_events
for select to authenticated using (
  exists (
    select 1
    from public.builder_booking_reminder_occurrences occurrence
    where occurrence.site_id = builder_booking_reminder_occurrence_events.site_id
      and occurrence.id = builder_booking_reminder_occurrence_events.occurrence_id
      and (
        (
          occurrence.booking_id is null
          and builder_private.booking_customer_record_read_allowed(
            occurrence.site_id,
            occurrence.recipient_contact_id
          )
        )
        or builder_private.booking_record_read_allowed(
          occurrence.site_id,
          occurrence.booking_id
        )
      )
  )
);
create policy builder_booking_price_snapshots_read on public.builder_booking_price_snapshots
for select to authenticated using (builder_private.booking_site_read_allowed(site_id));
create policy builder_booking_payment_references_read on public.builder_booking_payment_references
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_booking_payment_events_read on public.builder_booking_payment_events
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_booking_package_entitlements_read on public.builder_booking_package_entitlements
for select to authenticated using (
  builder_private.member_can_access_growth_record(
    site_id, (select auth.uid()), 'customers.read', 'customer', contact_id
  )
);
create policy builder_booking_membership_entitlements_read on public.builder_booking_membership_entitlements
for select to authenticated using (
  builder_private.member_can_access_growth_record(
    site_id, (select auth.uid()), 'customers.read', 'customer', contact_id
  )
);
create policy builder_booking_credit_reservations_read on public.builder_booking_credit_reservations
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_booking_credit_consumptions_read on public.builder_booking_credit_consumptions
for select to authenticated using (
  builder_private.booking_record_read_allowed(site_id, booking_id)
);
create policy builder_customer_item_preferences_read on public.builder_customer_item_preferences
for select to authenticated using (
  builder_private.member_can_access_growth_record(
    site_id, (select auth.uid()), 'customers.read', 'customer', contact_id
  )
);
create policy builder_customer_reminder_overrides_read on public.builder_customer_reminder_overrides
for select to authenticated using (
  builder_private.member_can_access_growth_record(
    site_id, (select auth.uid()), 'customers.read', 'customer', contact_id
  )
);

revoke all on function builder_private.booking_site_read_allowed(uuid)
  from public, anon, authenticated;
revoke all on function builder_private.booking_record_read_allowed(uuid, uuid)
  from public, anon, authenticated;
revoke all on function builder_private.booking_customer_record_read_allowed(uuid, uuid)
  from public, anon, authenticated;
revoke all on function builder_private.enforce_booking_reminder_recipient()
  from public, anon, authenticated;
grant execute on function builder_private.booking_site_read_allowed(uuid) to authenticated;
grant execute on function builder_private.booking_record_read_allowed(uuid, uuid) to authenticated;
grant execute on function builder_private.booking_customer_record_read_allowed(uuid, uuid)
  to authenticated;

revoke all on
  public.builder_booking_services,
  public.builder_booking_service_revisions,
  public.builder_booking_resources,
  public.builder_booking_resource_eligibility,
  public.builder_booking_service_areas,
  public.builder_booking_availability_rules,
  public.builder_booking_availability_exceptions,
  public.builder_booking_closures,
  public.builder_booking_external_busy_periods,
  public.builder_booking_holds,
  public.builder_booking_policy_snapshots,
  public.builder_bookings,
  public.builder_booking_reservations,
  public.builder_booking_participants,
  public.builder_booking_events,
  public.builder_booking_intake_responses,
  public.builder_booking_waitlist_entries,
  public.builder_booking_waitlist_offers,
  public.builder_appointment_work_sessions,
  public.builder_appointment_checklist_revisions,
  public.builder_appointment_field_response_revisions,
  public.builder_appointment_note_revisions,
  public.builder_appointment_item_references,
  public.builder_appointment_outcomes,
  public.builder_booking_follow_up_links,
  public.builder_booking_reminder_defaults,
  public.builder_booking_reminder_overrides,
  public.builder_booking_reminder_plans,
  public.builder_booking_reminder_plan_revisions,
  public.builder_booking_reminder_occurrences,
  public.builder_booking_reminder_occurrence_events,
  public.builder_booking_price_snapshots,
  public.builder_booking_payment_references,
  public.builder_booking_payment_events,
  public.builder_booking_package_entitlements,
  public.builder_booking_membership_entitlements,
  public.builder_booking_credit_reservations,
  public.builder_booking_credit_consumptions,
  public.builder_customer_item_preferences,
  public.builder_customer_reminder_overrides
from anon, authenticated;

grant select on
  public.builder_booking_services,
  public.builder_booking_service_revisions,
  public.builder_booking_resources,
  public.builder_booking_resource_eligibility,
  public.builder_booking_service_areas,
  public.builder_booking_availability_rules,
  public.builder_booking_availability_exceptions,
  public.builder_booking_closures,
  public.builder_booking_external_busy_periods,
  public.builder_booking_holds,
  public.builder_booking_policy_snapshots,
  public.builder_bookings,
  public.builder_booking_reservations,
  public.builder_booking_participants,
  public.builder_booking_events,
  public.builder_booking_intake_responses,
  public.builder_booking_waitlist_entries,
  public.builder_booking_waitlist_offers,
  public.builder_appointment_work_sessions,
  public.builder_appointment_checklist_revisions,
  public.builder_appointment_field_response_revisions,
  public.builder_appointment_note_revisions,
  public.builder_appointment_item_references,
  public.builder_appointment_outcomes,
  public.builder_booking_follow_up_links,
  public.builder_booking_reminder_defaults,
  public.builder_booking_reminder_overrides,
  public.builder_booking_reminder_plans,
  public.builder_booking_reminder_plan_revisions,
  public.builder_booking_reminder_occurrences,
  public.builder_booking_reminder_occurrence_events,
  public.builder_booking_price_snapshots,
  public.builder_booking_payment_references,
  public.builder_booking_payment_events,
  public.builder_booking_package_entitlements,
  public.builder_booking_membership_entitlements,
  public.builder_booking_credit_reservations,
  public.builder_booking_credit_consumptions,
  public.builder_customer_item_preferences,
  public.builder_customer_reminder_overrides
to authenticated;

grant all on
  public.builder_booking_services,
  public.builder_booking_service_revisions,
  public.builder_booking_resources,
  public.builder_booking_resource_eligibility,
  public.builder_booking_service_areas,
  public.builder_booking_availability_rules,
  public.builder_booking_availability_exceptions,
  public.builder_booking_closures,
  public.builder_booking_external_busy_periods,
  public.builder_booking_holds,
  public.builder_booking_policy_snapshots,
  public.builder_bookings,
  public.builder_booking_reservations,
  public.builder_booking_participants,
  public.builder_booking_events,
  public.builder_booking_intake_responses,
  public.builder_booking_waitlist_entries,
  public.builder_booking_waitlist_offers,
  public.builder_appointment_work_sessions,
  public.builder_appointment_checklist_revisions,
  public.builder_appointment_field_response_revisions,
  public.builder_appointment_note_revisions,
  public.builder_appointment_item_references,
  public.builder_appointment_outcomes,
  public.builder_booking_follow_up_links,
  public.builder_booking_reminder_defaults,
  public.builder_booking_reminder_overrides,
  public.builder_booking_reminder_plans,
  public.builder_booking_reminder_plan_revisions,
  public.builder_booking_reminder_occurrences,
  public.builder_booking_reminder_occurrence_events,
  public.builder_booking_price_snapshots,
  public.builder_booking_payment_references,
  public.builder_booking_payment_events,
  public.builder_booking_package_entitlements,
  public.builder_booking_membership_entitlements,
  public.builder_booking_credit_reservations,
  public.builder_booking_credit_consumptions,
  public.builder_customer_item_preferences,
  public.builder_customer_reminder_overrides
to service_role;

set search_path = public;
