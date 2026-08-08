create table builder_private.builder_booking_self_service_grants (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null check (
    cardinality(scopes) between 1 and 6
    and scopes <@ array[
      'booking.read',
      'booking.reschedule',
      'booking.cancel',
      'booking.pay',
      'booking.intake',
      'booking.join_meeting'
    ]::text[]
  ),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text check (
    revocation_reason is null or char_length(revocation_reason) between 1 and 500
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  use_count integer not null default 0 check (use_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, token_hash),
  unique (site_id, idempotency_key),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete cascade,
  check (
    (revoked_at is null and revocation_reason is null)
    or (revoked_at is not null and revocation_reason is not null)
  )
);

create index builder_booking_self_service_grants_expiry_idx
  on builder_private.builder_booking_self_service_grants(site_id, expires_at)
  where revoked_at is null;

create table public.builder_booking_external_event_references (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  connection_id uuid not null,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9._-]{0,127}$'),
  stable_external_id text not null check (
    char_length(stable_external_id) between 1 and 500
  ),
  provider_reference_id text not null check (
    char_length(provider_reference_id) between 1 and 500
  ),
  state text not null check (state in ('active', 'deleted', 'reconciliation_required')),
  event_digest text not null check (event_digest ~ '^[a-f0-9]{64}$'),
  last_synced_at timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, provider_key, stable_external_id),
  unique (site_id, provider_key, provider_reference_id),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete cascade,
  foreign key (site_id, connection_id)
    references public.builder_provider_connections(site_id, id)
    on delete restrict
);

create table public.builder_booking_virtual_meeting_references (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  connection_id uuid not null,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9._-]{0,127}$'),
  provider_reference_id text not null check (
    char_length(provider_reference_id) between 1 and 500
  ),
  join_secret_reference text not null check (
    char_length(join_secret_reference) between 1 and 500
  ),
  state text not null check (state in ('active', 'cancelled', 'reconciliation_required')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  last_synced_at timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, booking_id),
  unique (site_id, provider_key, provider_reference_id),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete cascade,
  foreign key (site_id, connection_id)
    references public.builder_provider_connections(site_id, id)
    on delete restrict,
  check (ends_at > starts_at)
);

create table public.builder_booking_provider_operation_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid,
  operation text not null check (operation ~ '^[a-z][a-z0-9._-]{0,127}$'),
  provider_kind text not null check (
    provider_kind in ('payment', 'external-calendar', 'virtual-meeting')
  ),
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9._-]{0,127}$'),
  provider_reference_id text not null check (
    char_length(provider_reference_id) between 1 and 500
  ),
  result_state text not null check (
    result_state in ('applied', 'replayed', 'ignored', 'reconciliation_required')
  ),
  sanitized_evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(sanitized_evidence) = 'object'
    and octet_length(sanitized_evidence::text) <= 16384
  ),
  event_digest text not null check (event_digest ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, booking_id)
    references public.builder_bookings(site_id, id) on delete restrict
);

create trigger builder_booking_provider_operation_events_append_only
before update or delete on public.builder_booking_provider_operation_events
for each row execute function builder_private.reject_append_only_change();

alter table public.builder_booking_external_event_references enable row level security;
alter table public.builder_booking_virtual_meeting_references enable row level security;
alter table public.builder_booking_provider_operation_events enable row level security;

revoke all on table public.builder_booking_external_event_references from public, anon, authenticated;
revoke all on table public.builder_booking_virtual_meeting_references from public, anon, authenticated;
revoke all on table public.builder_booking_provider_operation_events from public, anon, authenticated;
grant all on table public.builder_booking_external_event_references to service_role;
grant all on table public.builder_booking_virtual_meeting_references to service_role;
grant all on table public.builder_booking_provider_operation_events to service_role;

create function public.builder_list_public_booking_services_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_limit integer;
  v_items jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array['version', 'siteId'])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in ('version', 'siteId', 'limit')
    )
    or coalesce(p_request ->> 'siteId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (
      p_request ? 'limit'
      and jsonb_typeof(p_request -> 'limit') <> 'number'
    )
  then
    raise exception 'invalid public booking services payload' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_limit := coalesce((p_request ->> 'limit')::integer, 50);
  exception
    when invalid_text_representation or numeric_value_out_of_range
  then
    raise exception 'invalid public booking services payload' using errcode = '22023';
  end;

  if v_limit not between 1 and 100 then
    raise exception 'invalid public booking services payload' using errcode = '22023';
  end if;

  if not builder_private.dependent_action_allowed(
    v_site_id,
    'growth.customers',
    'growth.bookings',
    'read'
  ) then
    return jsonb_build_object(
      'version', 1,
      'status', 'unavailable',
      'items', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(item.payload order by item.stable_key), '[]'::jsonb)
  into v_items
  from (
    select service.stable_key,
      jsonb_build_object(
        'serviceId', service.id,
        'serviceRevisionId', revision.id,
        'stableKey', service.stable_key,
        'title', revision.title,
        'description', revision.description,
        'category', revision.category,
        'serviceMode', revision.service_mode,
        'confirmationMode', revision.confirmation_mode,
        'durationMinutes', revision.duration_minutes,
        'pricingMode', revision.pricing_mode
      ) as payload
    from public.builder_booking_services service
    join public.builder_booking_service_revisions revision
      on revision.site_id = service.site_id
      and revision.id = service.current_revision_id
    where service.site_id = v_site_id
      and service.state = 'active'
      and revision.public_visibility = 'public'
    order by service.stable_key
    limit v_limit
  ) item;

  return jsonb_build_object(
    'version', 1,
    'status', 'available',
    'items', v_items
  );
end;
$$;

revoke all on function public.builder_list_public_booking_services_v1(jsonb) from public;
grant execute on function public.builder_list_public_booking_services_v1(jsonb) to anon, authenticated, service_role;

create function public.builder_consume_public_booking_rate_limit_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_bucket_key_hmac text;
  v_window_started_at timestamptz;
  v_window_ends_at timestamptz;
  v_limit integer;
  v_count integer;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array[
      'version', 'siteId', 'bucketKeyHmac', 'windowStartedAt',
      'windowEndsAt', 'limit'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in (
        'version', 'siteId', 'bucketKeyHmac', 'windowStartedAt',
        'windowEndsAt', 'limit'
      )
    )
    or coalesce(p_request ->> 'siteId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'bucketKeyHmac', '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_request -> 'limit') <> 'number'
  then
    raise exception 'invalid booking rate limit payload' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_bucket_key_hmac := p_request ->> 'bucketKeyHmac';
    v_window_started_at := (p_request ->> 'windowStartedAt')::timestamptz;
    v_window_ends_at := (p_request ->> 'windowEndsAt')::timestamptz;
    v_limit := (p_request ->> 'limit')::integer;
  exception
    when invalid_text_representation or datetime_field_overflow
      or numeric_value_out_of_range
  then
    raise exception 'invalid booking rate limit payload' using errcode = '22023';
  end;

  if v_limit not between 1 and 1000
    or v_window_ends_at <= v_window_started_at
    or v_window_ends_at - v_window_started_at > interval '24 hours'
  then
    raise exception 'invalid booking rate limit payload' using errcode = '22023';
  end if;

  insert into builder_private.builder_rate_limit_buckets (
    site_id,
    bucket_key_hmac,
    window_started_at,
    window_ends_at,
    request_count,
    updated_at
  ) values (
    v_site_id,
    v_bucket_key_hmac,
    v_window_started_at,
    v_window_ends_at,
    1,
    clock_timestamp()
  )
  on conflict (site_id, bucket_key_hmac, window_started_at)
  do update
  set request_count = builder_private.builder_rate_limit_buckets.request_count + 1,
      updated_at = clock_timestamp()
  where builder_private.builder_rate_limit_buckets.request_count < v_limit
    and builder_private.builder_rate_limit_buckets.window_ends_at = excluded.window_ends_at
  returning request_count into v_count;

  if v_count is null then
    select request_count
    into v_count
    from builder_private.builder_rate_limit_buckets
    where site_id = v_site_id
      and bucket_key_hmac = v_bucket_key_hmac
      and window_started_at = v_window_started_at;
    return jsonb_build_object(
      'version', 1,
      'allowed', false,
      'remaining', 0
    );
  end if;

  return jsonb_build_object(
    'version', 1,
    'allowed', true,
    'remaining', greatest(v_limit - v_count, 0)
  );
end;
$$;

revoke all on function public.builder_consume_public_booking_rate_limit_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_consume_public_booking_rate_limit_v1(jsonb) to service_role;

create function public.builder_issue_booking_self_service_grant_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_booking_id uuid;
  v_token_hash text;
  v_scopes text[];
  v_expires_at timestamptz;
  v_idempotency_key text;
  v_grant builder_private.builder_booking_self_service_grants%rowtype;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array[
      'version', 'siteId', 'bookingId', 'tokenHash', 'scopes',
      'expiresAt', 'idempotencyKey'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in (
        'version', 'siteId', 'bookingId', 'tokenHash', 'scopes',
        'expiresAt', 'idempotencyKey'
      )
    )
    or jsonb_typeof(p_request -> 'scopes') <> 'array'
    or coalesce(p_request ->> 'tokenHash', '') !~ '^[a-f0-9]{64}$'
  then
    raise exception 'invalid booking self-service grant' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_booking_id := (p_request ->> 'bookingId')::uuid;
    v_token_hash := p_request ->> 'tokenHash';
    v_scopes := array(
      select value
      from jsonb_array_elements_text(p_request -> 'scopes') value
    );
    v_expires_at := (p_request ->> 'expiresAt')::timestamptz;
    v_idempotency_key := p_request ->> 'idempotencyKey';
  exception
    when invalid_text_representation or datetime_field_overflow
  then
    raise exception 'invalid booking self-service grant' using errcode = '22023';
  end;

  if cardinality(v_scopes) not between 1 and 6
    or cardinality(v_scopes) <> (
      select count(distinct scope)
      from unnest(v_scopes) scope
    )
    or not v_scopes <@ array[
      'booking.read',
      'booking.reschedule',
      'booking.cancel',
      'booking.pay',
      'booking.intake',
      'booking.join_meeting'
    ]::text[]
    or char_length(v_idempotency_key) not between 1 and 255
    or v_expires_at <= statement_timestamp()
    or v_expires_at > statement_timestamp() + interval '180 days'
    or not builder_private.dependent_action_allowed(
      v_site_id,
      'growth.customers',
      'growth.bookings',
      'write'
    )
  then
    raise exception 'invalid booking self-service grant' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.builder_bookings
    where site_id = v_site_id and id = v_booking_id
  ) then
    raise exception 'booking was not found' using errcode = 'P0002';
  end if;

  insert into builder_private.builder_booking_self_service_grants (
    site_id,
    booking_id,
    token_hash,
    scopes,
    expires_at,
    idempotency_key
  ) values (
    v_site_id,
    v_booking_id,
    v_token_hash,
    v_scopes,
    v_expires_at,
    v_idempotency_key
  )
  on conflict (site_id, idempotency_key)
  do nothing
  returning * into v_grant;

  if not found then
    select *
    into v_grant
    from builder_private.builder_booking_self_service_grants
    where site_id = v_site_id and idempotency_key = v_idempotency_key;
    if v_grant.booking_id <> v_booking_id
      or v_grant.token_hash <> v_token_hash
      or v_grant.scopes <> v_scopes
      or v_grant.expires_at <> v_expires_at
    then
      raise exception 'self-service idempotency conflict' using errcode = '40001';
    end if;
  end if;

  return jsonb_build_object(
    'version', 1,
    'grantId', v_grant.id,
    'expiresAt', v_grant.expires_at
  );
end;
$$;

revoke all on function public.builder_issue_booking_self_service_grant_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_issue_booking_self_service_grant_v1(jsonb) to service_role;

create function public.builder_resolve_booking_self_service_grant_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_token_hash text;
  v_required_scope text;
  v_grant builder_private.builder_booking_self_service_grants%rowtype;
  v_booking public.builder_bookings%rowtype;
  v_service_title text;
  v_payment_state text;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array[
      'version', 'siteId', 'tokenHash', 'requiredScope', 'now'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in ('version', 'siteId', 'tokenHash', 'requiredScope', 'now')
    )
    or coalesce(p_request ->> 'tokenHash', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_request ->> 'requiredScope', '') not in (
      'booking.read',
      'booking.reschedule',
      'booking.cancel',
      'booking.pay',
      'booking.intake',
      'booking.join_meeting'
    )
  then
    raise exception 'invalid booking self-service lookup' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_token_hash := p_request ->> 'tokenHash';
    v_required_scope := p_request ->> 'requiredScope';
    perform (p_request ->> 'now')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow
  then
    raise exception 'invalid booking self-service lookup' using errcode = '22023';
  end;

  select *
  into v_grant
  from builder_private.builder_booking_self_service_grants
  where site_id = v_site_id
    and token_hash = v_token_hash
    and revoked_at is null
    and expires_at > statement_timestamp()
    and v_required_scope = any(scopes)
  for update;

  if not found then return null; end if;

  update builder_private.builder_booking_self_service_grants
  set use_count = use_count + 1,
      last_used_at = clock_timestamp()
  where site_id = v_grant.site_id and id = v_grant.id;

  select *
  into v_booking
  from public.builder_bookings
  where site_id = v_grant.site_id and id = v_grant.booking_id;

  select title
  into v_service_title
  from public.builder_booking_service_revisions
  where site_id = v_booking.site_id and id = v_booking.service_revision_id;

  select case
    when not exists (
      select 1
      from public.builder_booking_payment_references payment
      where payment.site_id = v_booking.site_id
        and payment.booking_id = v_booking.id
    ) then 'not-required'
    when exists (
      select 1
      from public.builder_booking_payment_references payment
      where payment.site_id = v_booking.site_id
        and payment.booking_id = v_booking.id
        and payment.state in ('failed', 'reconciliation_required')
    ) then 'failed'
    when exists (
      select 1
      from public.builder_booking_payment_references payment
      where payment.site_id = v_booking.site_id
        and payment.booking_id = v_booking.id
        and payment.state in ('captured', 'partially_refunded')
    ) then 'paid'
    when exists (
      select 1
      from public.builder_booking_payment_references payment
      where payment.site_id = v_booking.site_id
        and payment.booking_id = v_booking.id
        and payment.state = 'refunded'
    ) then 'refunded'
    when exists (
      select 1
      from public.builder_booking_payment_references payment
      where payment.site_id = v_booking.site_id
        and payment.booking_id = v_booking.id
        and payment.state = 'authorized'
    ) then 'authorized'
    else 'pending'
  end
  into v_payment_state;

  return jsonb_build_object(
    'grantId', v_grant.id,
    'siteId', v_grant.site_id,
    'bookingId', v_grant.booking_id,
    'scopes', to_jsonb(v_grant.scopes),
    'expiresAt', v_grant.expires_at,
    'booking', jsonb_build_object(
      'version', 1,
      'kind', 'booking',
      'generatedAt', statement_timestamp(),
      'bookingReference', v_booking.id,
      'status', v_booking.status,
      'serviceTitle', v_service_title,
      'startsAt', v_booking.starts_at,
      'endsAt', v_booking.ends_at,
      'timezone', v_booking.time_zone,
      'paymentState', v_payment_state
    )
  );
end;
$$;

revoke all on function public.builder_resolve_booking_self_service_grant_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_resolve_booking_self_service_grant_v1(jsonb) to service_role;

create function public.builder_revoke_booking_self_service_grant_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_grant_id uuid;
  v_reason text;
  v_row_count integer;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array[
      'version', 'siteId', 'grantId', 'reason', 'idempotencyKey'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in ('version', 'siteId', 'grantId', 'reason', 'idempotencyKey')
    )
  then
    raise exception 'invalid booking self-service revocation' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_grant_id := (p_request ->> 'grantId')::uuid;
    v_reason := btrim(p_request ->> 'reason');
  exception
    when invalid_text_representation
  then
    raise exception 'invalid booking self-service revocation' using errcode = '22023';
  end;

  if char_length(v_reason) not between 1 and 500
    or char_length(p_request ->> 'idempotencyKey') not between 1 and 255
  then
    raise exception 'invalid booking self-service revocation' using errcode = '22023';
  end if;

  update builder_private.builder_booking_self_service_grants
  set revoked_at = clock_timestamp(),
      revocation_reason = v_reason
  where site_id = v_site_id
    and id = v_grant_id
    and revoked_at is null;
  get diagnostics v_row_count = row_count;

  if v_row_count = 0 and not exists (
    select 1
    from builder_private.builder_booking_self_service_grants
    where site_id = v_site_id and id = v_grant_id and revoked_at is not null
  ) then
    raise exception 'booking self-service grant was not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'version', 1,
    'status', case when v_row_count = 1 then 'applied' else 'replayed' end
  );
end;
$$;

revoke all on function public.builder_revoke_booking_self_service_grant_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_revoke_booking_self_service_grant_v1(jsonb) to service_role;

create function public.builder_apply_self_service_booking_command_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_booking_id uuid;
  v_type text;
  v_scope text;
  v_expected_version integer;
  v_payload jsonb;
  v_claim jsonb;
  v_result jsonb;
  v_grant builder_private.builder_booking_self_service_grants%rowtype;
  v_booking public.builder_bookings%rowtype;
  v_prior_booking public.builder_bookings%rowtype;
  v_hold public.builder_booking_holds%rowtype;
  v_resource public.builder_booking_resources%rowtype;
  v_resource_id uuid;
  v_from_status text;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array[
      'version', 'siteId', 'tokenHash', 'requiredScope', 'now',
      'commandId', 'correlationId', 'type', 'expectedVersion',
      'idempotencyKey', 'payload'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in (
        'version', 'siteId', 'tokenHash', 'requiredScope', 'now',
        'commandId', 'correlationId', 'type', 'expectedVersion',
        'idempotencyKey', 'payload'
      )
    )
    or jsonb_typeof(p_request -> 'payload') <> 'object'
  then
    raise exception 'invalid self-service booking command' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_type := p_request ->> 'type';
    v_scope := p_request ->> 'requiredScope';
    v_expected_version := (p_request ->> 'expectedVersion')::integer;
    v_payload := p_request -> 'payload';
    v_booking_id := (v_payload ->> 'bookingId')::uuid;
    perform (p_request ->> 'commandId')::uuid;
    perform (p_request ->> 'correlationId')::uuid;
    perform (p_request ->> 'now')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow
  then
    raise exception 'invalid self-service booking command' using errcode = '22023';
  end;

  if coalesce(p_request ->> 'tokenHash', '') !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(p_request ->> 'idempotencyKey', '')) not between 1 and 255
    or v_expected_version < 1
    or v_type not in ('booking.cancel', 'booking.reschedule')
    or (v_type = 'booking.cancel' and v_scope <> 'booking.cancel')
    or (v_type = 'booking.reschedule' and v_scope <> 'booking.reschedule')
  then
    raise exception 'invalid self-service booking command' using errcode = '22023';
  end if;

  select grant_row.*
  into v_grant
  from builder_private.builder_booking_self_service_grants grant_row
  where grant_row.site_id = v_site_id
    and grant_row.booking_id = v_booking_id
    and grant_row.token_hash = p_request ->> 'tokenHash'
    and v_scope = any(grant_row.scopes)
    and grant_row.revoked_at is null
    and grant_row.expires_at > statement_timestamp()
  for update;
  if not found then
    raise exception 'self-service grant is invalid' using errcode = '42501';
  end if;

  v_claim := builder_private.claim_operational_command_v1(
    p_request,
    'growth.booking.self-service-command.v1'
  );
  if v_claim ->> 'status' = 'replay' then
    return builder_private.booking_replay_result(v_claim);
  end if;

  select *
  into v_prior_booking
  from public.builder_bookings
  where site_id = v_site_id and id = v_booking_id
  for update;
  if not found then
    raise exception 'booking was not found' using errcode = '22023';
  end if;
  if v_prior_booking.version <> v_expected_version then
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'conflict',
      'reason', 'stale_version'
    );
    return builder_private.complete_operational_command_v1(
      p_request,
      'growth.booking.self-service-command.v1',
      v_result
    );
  end if;

  if v_type = 'booking.cancel' then
    if v_prior_booking.status in (
      'completed', 'cancelled', 'declined', 'no_show', 'rescheduled'
    ) then
      raise exception 'booking cannot be cancelled' using errcode = '22023';
    end if;
    update public.builder_booking_reservations
    set state = 'released',
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id
      and booking_id = v_booking_id
      and state = 'active';
    update public.builder_bookings
    set status = 'cancelled',
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_booking_id
    returning * into v_booking;
    insert into public.builder_booking_events (
      site_id, booking_id, event_type, from_status, to_status, actor_id,
      reason, idempotency_key, occurred_at
    ) values (
      v_site_id,
      v_booking.id,
      'booking.cancel',
      v_prior_booking.status,
      'cancelled',
      null,
      coalesce(v_payload ->> 'reasonCode', 'customer_requested'),
      (p_request ->> 'idempotencyKey') || ':event',
      clock_timestamp()
    );
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'booking',
        'booking', builder_private.booking_json(v_booking)
      ),
      'replayed', false
    );
  else
    v_from_status := v_prior_booking.status;
    select *
    into v_hold
    from public.builder_booking_holds
    where site_id = v_site_id
      and id = (v_payload ->> 'replacementHoldId')::uuid
    for update;
    if not found
      or v_hold.state <> 'active'
      or v_hold.expires_at <= statement_timestamp()
      or v_hold.service_id <> v_prior_booking.service_id
    then
      raise exception 'replacement hold is expired or unavailable'
        using errcode = '22023';
    end if;

    insert into public.builder_bookings (
      site_id, id, service_id, service_revision_id, contact_id, hold_id,
      status, confirmation_mode, starts_at, ends_at, time_zone,
      price_snapshot_id, policy_snapshot_id, previous_booking_id,
      idempotency_key, created_by
    ) values (
      v_site_id,
      (v_payload ->> 'replacementBookingId')::uuid,
      v_hold.service_id,
      v_hold.service_revision_id,
      v_prior_booking.contact_id,
      v_hold.id,
      'confirmed',
      v_prior_booking.confirmation_mode,
      v_hold.starts_at,
      v_hold.ends_at,
      v_prior_booking.time_zone,
      v_prior_booking.price_snapshot_id,
      v_prior_booking.policy_snapshot_id,
      v_prior_booking.id,
      p_request ->> 'idempotencyKey',
      v_prior_booking.created_by
    )
    returning * into v_booking;

    insert into public.builder_booking_participants (
      site_id, booking_id, contact_id, role, attendance_status
    )
    select site_id, v_booking.id, contact_id, role, 'expected'
    from public.builder_booking_participants
    where site_id = v_site_id and booking_id = v_prior_booking.id;

    foreach v_resource_id in array v_hold.resource_ids loop
      select *
      into v_resource
      from public.builder_booking_resources
      where site_id = v_site_id and id = v_resource_id
      for update;
      insert into public.builder_booking_reservations (
        site_id, booking_id, resource_id, resource_kind, exclusive,
        starts_at, ends_at, capacity_units, state
      ) values (
        v_site_id, v_booking.id, v_resource.id, v_resource.kind,
        v_resource.exclusive, v_booking.starts_at, v_booking.ends_at,
        v_hold.capacity_units, 'active'
      );
    end loop;

    update public.builder_booking_reservations
    set state = 'superseded',
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id
      and booking_id = v_prior_booking.id
      and state = 'active';
    update public.builder_booking_holds
    set state = 'consumed',
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_hold.id;
    update public.builder_bookings
    set status = 'rescheduled',
        replacement_booking_id = v_booking.id,
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_prior_booking.id
    returning * into v_prior_booking;
    insert into public.builder_booking_events (
      site_id, booking_id, event_type, from_status, to_status, actor_id,
      reason, idempotency_key, occurred_at
    ) values (
      v_site_id,
      v_prior_booking.id,
      'booking.rescheduled',
      v_from_status,
      'rescheduled',
      null,
      coalesce(v_payload ->> 'reasonCode', 'customer_requested'),
      (p_request ->> 'idempotencyKey') || ':event',
      clock_timestamp()
    );
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'booking_reschedule',
        'priorBooking', builder_private.booking_json(v_prior_booking),
        'replacementBooking', builder_private.booking_json(v_booking)
      ),
      'replayed', false
    );
  end if;

  update builder_private.builder_booking_self_service_grants
  set use_count = use_count + 1,
      last_used_at = clock_timestamp()
  where site_id = v_site_id and id = v_grant.id;

  return builder_private.complete_operational_command_v1(
    p_request,
    'growth.booking.self-service-command.v1',
    v_result
  );
end;
$$;

revoke all on function public.builder_apply_self_service_booking_command_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.builder_apply_self_service_booking_command_v1(jsonb)
  to service_role;

create function public.builder_get_booking_detail_v1(p_request jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_booking_id uuid;
  v_booking public.builder_bookings%rowtype;
  v_service_title text;
  v_customer_name text;
  v_event_count integer;
  v_last_changed_at timestamptz;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array['version', 'siteId', 'actorId', 'bookingId'])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in ('version', 'siteId', 'actorId', 'bookingId')
    )
  then
    raise exception 'invalid booking detail query' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_booking_id := (p_request ->> 'bookingId')::uuid;
  exception
    when invalid_text_representation
  then
    raise exception 'invalid booking detail query' using errcode = '22023';
  end;

  if not builder_private.booking_member_action_allowed(
    v_site_id,
    v_actor_id,
    'bookings.read',
    v_booking_id
  ) then
    raise exception 'booking read capability is required' using errcode = '42501';
  end if;

  select *
  into v_booking
  from public.builder_bookings
  where site_id = v_site_id and id = v_booking_id;
  if not found then return jsonb_build_object('version', 1, 'status', 'not_found'); end if;

  select revision.title
  into v_service_title
  from public.builder_booking_service_revisions revision
  where revision.site_id = v_booking.site_id
    and revision.id = v_booking.service_revision_id;

  select contact.display_name
  into v_customer_name
  from public.builder_contacts contact
  where contact.site_id = v_booking.site_id
    and contact.id = v_booking.contact_id;

  select count(*), max(event.occurred_at)
  into v_event_count, v_last_changed_at
  from public.builder_booking_events event
  where event.site_id = v_booking.site_id
    and event.booking_id = v_booking.id;

  return jsonb_build_object(
    'version', 1,
    'status', 'allowed',
    'data', jsonb_strip_nulls(jsonb_build_object(
      'version', 1,
      'audience', 'owner',
      'kind', 'booking-detail',
      'generatedAt', clock_timestamp(),
      'siteId', v_booking.site_id,
      'bookingId', v_booking.id,
      'appointmentFacts', jsonb_build_object(
        'serviceTitle', v_service_title,
        'status', v_booking.status,
        'startsAt', v_booking.starts_at,
        'endsAt', v_booking.ends_at,
        'timeZone', v_booking.time_zone
      ),
      'customerSummary', jsonb_build_object(
        'customerId', v_booking.contact_id,
        'displayName', v_customer_name,
        'participantRole', 'primary_customer'
      ),
      'intakeSummary', '[]'::jsonb,
      'preparation', jsonb_build_object(
        'shortlistedItemCount', (
          select count(*)
          from public.builder_appointment_item_references item
          where item.site_id = v_booking.site_id
            and item.booking_id = v_booking.id
        ),
        'permanentPreferenceCount', (
          select count(*)
          from public.builder_customer_item_preferences preference
          where preference.site_id = v_booking.site_id
            and preference.contact_id = v_booking.contact_id
            and preference.preference_state = 'active'
        ),
        'incompleteChecklistCount', 0
      ),
      'reminders', jsonb_build_object(
        'planCount', (
          select count(*)
          from public.builder_booking_reminder_plans plan
          where plan.site_id = v_booking.site_id
            and plan.booking_id = v_booking.id
        ),
        'attentionCount', (
          select count(*)
          from public.builder_booking_reminder_plans plan
          where plan.site_id = v_booking.site_id
            and plan.booking_id = v_booking.id
            and plan.state in ('suppressed', 'failed_review')
        )
      ),
      'staffWork', jsonb_build_object(
        'noteCount', (
          select count(*)
          from public.builder_appointment_note_revisions note
          join public.builder_appointment_work_sessions session
            on session.site_id = note.site_id
            and session.id = note.work_session_id
          where note.site_id = v_booking.site_id
            and session.booking_id = v_booking.id
        ),
        'taskCount', (
          select count(*)
          from public.builder_booking_follow_up_links follow_up
          where follow_up.site_id = v_booking.site_id
            and follow_up.booking_id = v_booking.id
        )
      ),
      'history', jsonb_strip_nulls(jsonb_build_object(
        'eventCount', v_event_count,
        'lastChangedAt', v_last_changed_at
      )),
      'permittedActions', jsonb_build_array(
        'view',
        'start_appointment',
        'update_session',
        'toggle_shortlist',
        'promote_customer_preference',
        'record_outcome',
        'update_reminders'
      )
    ))
  );
end;
$$;

revoke all on function public.builder_get_booking_detail_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_get_booking_detail_v1(jsonb) to service_role;

create function builder_private.builder_enqueue_booking_provider_work_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_topic text;
begin
  v_topic := case new.event_type
    when 'booking.confirmed' then 'growth.booking.confirmed'
    when 'booking.rescheduled' then 'growth.booking.rescheduled'
    when 'booking.cancel' then 'growth.booking.cancelled'
    else null
  end;
  if v_topic is null then return new; end if;

  insert into public.builder_outbox (
    site_id,
    topic,
    payload,
    idempotency_key,
    schema_version,
    aggregate_type,
    aggregate_id,
    correlation_id
  ) values (
    new.site_id,
    v_topic,
    jsonb_build_object(
      'version', 1,
      'bookingId', new.booking_id,
      'bookingEventId', new.id,
      'eventType', new.event_type,
      'occurredAt', new.occurred_at
    ),
    'growth.booking:' || new.id::text,
    1,
    'booking',
    new.booking_id,
    new.id
  )
  on conflict (site_id, idempotency_key) do nothing;
  return new;
end;
$$;

create trigger builder_booking_events_enqueue_provider_work
after insert on public.builder_booking_events
for each row execute function builder_private.builder_enqueue_booking_provider_work_v1();

create function builder_private.builder_enqueue_booking_waitlist_offer_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.builder_outbox (
    site_id,
    topic,
    payload,
    idempotency_key,
    schema_version,
    aggregate_type,
    aggregate_id,
    correlation_id
  ) values (
    new.site_id,
    'growth.booking.waitlist.offer',
    jsonb_build_object(
      'version', 1,
      'waitlistOfferId', new.id,
      'waitlistEntryId', new.waitlist_entry_id,
      'holdId', new.hold_id,
      'expiresAt', new.expires_at,
      'occurredAt', new.offered_at
    ),
    'growth.booking-waitlist-offer:' || new.id::text,
    1,
    'booking_waitlist_entry',
    new.waitlist_entry_id,
    new.id
  )
  on conflict (site_id, idempotency_key) do nothing;
  return new;
end;
$$;

create trigger builder_booking_waitlist_offers_enqueue_delivery
after insert on public.builder_booking_waitlist_offers
for each row execute function builder_private.builder_enqueue_booking_waitlist_offer_v1();

create function public.builder_skip_booking_reminder_occurrence_v1(
  p_site_id uuid,
  p_occurrence_id uuid,
  p_worker text,
  p_lease_token uuid,
  p_expected_version integer,
  p_now timestamptz,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_occurrence public.builder_booking_reminder_occurrences%rowtype;
begin
  if p_site_id is null
    or p_occurrence_id is null
    or nullif(trim(p_worker), '') is null
    or p_lease_token is null
    or p_expected_version < 1
    or p_now is null
    or p_reason_code !~ '^[a-z][a-z0-9._-]{0,127}$'
  then
    raise exception 'invalid reminder skip' using errcode = '22023';
  end if;
  select *
  into v_occurrence
  from public.builder_booking_reminder_occurrences
  where site_id = p_site_id and id = p_occurrence_id
  for update;
  if not found
    or v_occurrence.state <> 'claimed'
    or v_occurrence.lease_owner <> p_worker
    or v_occurrence.lease_token <> p_lease_token
    or v_occurrence.lease_expires_at < p_now
    or v_occurrence.version <> p_expected_version
  then
    raise exception 'reminder occurrence lease is stale' using errcode = '40001';
  end if;
  update public.builder_booking_reminder_occurrences
  set state = 'skipped',
      skip_reason = p_reason_code,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      version = version + 1,
      updated_at = clock_timestamp()
  where site_id = p_site_id and id = p_occurrence_id
  returning * into v_occurrence;
  insert into public.builder_booking_reminder_occurrence_events (
    site_id, occurrence_id, plan_id, event_type, from_state, to_state,
    reason_code, idempotency_key, occurred_at
  ) values (
    v_occurrence.site_id,
    v_occurrence.id,
    v_occurrence.plan_id,
    'skipped',
    'claimed',
    'skipped',
    p_reason_code,
    v_occurrence.idempotency_key || ':skip:' || v_occurrence.attempt_count,
    p_now
  ) on conflict (site_id, idempotency_key) do nothing;
  return jsonb_build_object(
    'version', 1,
    'status', 'skipped',
    'occurrenceId', v_occurrence.id,
    'occurrenceVersion', v_occurrence.version
  );
end;
$$;

revoke all on function public.builder_skip_booking_reminder_occurrence_v1(
  uuid, uuid, text, uuid, integer, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.builder_skip_booking_reminder_occurrence_v1(
  uuid, uuid, text, uuid, integer, timestamptz, text
) to service_role;

create function public.builder_update_booking_provider_connection_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_connection_id uuid;
  v_operation text;
  v_state text;
  v_checked_at timestamptz;
  v_connection public.builder_provider_connections%rowtype;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array[
      'version', 'siteId', 'connectionId', 'operation', 'state', 'checkedAt'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in (
        'version', 'siteId', 'connectionId', 'operation', 'state',
        'checkedAt', 'lastSuccessfulAt', 'sanitizedReasonCode'
      )
    )
  then
    raise exception 'invalid booking provider connection update' using errcode = '22023';
  end if;
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_connection_id := (p_request ->> 'connectionId')::uuid;
    v_operation := p_request ->> 'operation';
    v_state := p_request ->> 'state';
    v_checked_at := (p_request ->> 'checkedAt')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow
  then
    raise exception 'invalid booking provider connection update' using errcode = '22023';
  end;
  if v_operation not in ('checked', 'refreshed', 'disconnected', 'revoked')
    or v_state not in ('ready', 'degraded', 'disconnected', 'revoked')
    or (v_operation = 'refreshed' and v_state not in ('ready', 'degraded'))
    or (v_operation = 'disconnected' and v_state <> 'disconnected')
    or (v_operation = 'revoked' and v_state <> 'revoked')
    or (
      nullif(p_request ->> 'sanitizedReasonCode', '') is not null
      and p_request ->> 'sanitizedReasonCode' !~ '^[a-z][a-z0-9._-]{0,127}$'
    )
  then
    raise exception 'invalid booking provider connection update' using errcode = '22023';
  end if;
  select *
  into v_connection
  from public.builder_provider_connections
  where site_id = v_site_id
    and id = v_connection_id
    and provider_kind in ('payment', 'external-calendar', 'virtual-meeting')
  for update;
  if not found then
    raise exception 'booking provider connection was not found' using errcode = 'P0002';
  end if;
  if v_connection.state = 'revoked' and v_operation <> 'revoked' then
    raise exception 'revoked provider connection cannot be restored' using errcode = '22023';
  end if;
  if v_operation = 'refreshed' and not exists (
    select 1
    from builder_private.builder_provider_connection_secrets secret_ref
    where secret_ref.site_id = v_site_id
      and secret_ref.connection_id = v_connection_id
  ) then
    raise exception 'provider credential reference is missing' using errcode = '23514';
  end if;
  update public.builder_provider_connections
  set state = v_state,
      checked_at = v_checked_at,
      last_successful_at = case
        when p_request ? 'lastSuccessfulAt'
          then (p_request ->> 'lastSuccessfulAt')::timestamptz
        when v_state = 'ready'
          then v_checked_at
        else last_successful_at
      end,
      sanitized_reason_code = nullif(p_request ->> 'sanitizedReasonCode', ''),
      disconnected_at = case when v_state = 'disconnected' then v_checked_at else null end,
      revoked_at = case when v_state = 'revoked' then v_checked_at else null end,
      version = version + 1,
      updated_at = clock_timestamp()
  where site_id = v_site_id and id = v_connection_id
  returning * into v_connection;
  return jsonb_build_object(
    'version', 1,
    'status', 'applied',
    'connectionId', v_connection.id,
    'connectionState', v_connection.state,
    'connectionVersion', v_connection.version
  );
end;
$$;

revoke all on function public.builder_update_booking_provider_connection_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.builder_update_booking_provider_connection_v1(jsonb)
  to service_role;

create function public.builder_replace_booking_external_busy_periods_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid;
  v_connection_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_observed_at timestamptz;
  v_item jsonb;
  v_count integer := 0;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array[
      'version', 'siteId', 'connectionId', 'providerKey',
      'startsAt', 'endsAt', 'observedAt', 'items'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in (
        'version', 'siteId', 'connectionId', 'providerKey',
        'startsAt', 'endsAt', 'observedAt', 'items'
      )
    )
    or jsonb_typeof(p_request -> 'items') <> 'array'
    or jsonb_array_length(p_request -> 'items') > 500
  then
    raise exception 'invalid external busy period replacement' using errcode = '22023';
  end if;
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_connection_id := (p_request ->> 'connectionId')::uuid;
    v_starts_at := (p_request ->> 'startsAt')::timestamptz;
    v_ends_at := (p_request ->> 'endsAt')::timestamptz;
    v_observed_at := (p_request ->> 'observedAt')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow
  then
    raise exception 'invalid external busy period replacement' using errcode = '22023';
  end;
  if v_ends_at <= v_starts_at
    or v_ends_at - v_starts_at > interval '31 days'
    or p_request ->> 'providerKey' !~ '^[a-z][a-z0-9._-]{0,127}$'
    or not exists (
      select 1
      from public.builder_provider_connections connection
      where connection.site_id = v_site_id
        and connection.id = v_connection_id
        and connection.provider_kind = 'external-calendar'
        and connection.provider_key = p_request ->> 'providerKey'
        and connection.state in ('ready', 'degraded')
    )
  then
    raise exception 'invalid external busy period replacement' using errcode = '22023';
  end if;

  delete from public.builder_booking_external_busy_periods busy
  where busy.site_id = v_site_id
    and busy.provider_connection_id = v_connection_id
    and busy.starts_at < v_ends_at
    and busy.ends_at > v_starts_at
    and not exists (
      select 1
      from jsonb_array_elements(p_request -> 'items') item
      where item ->> 'providerEventReference' = busy.provider_event_reference
    );

  for v_item in
    select value from jsonb_array_elements(p_request -> 'items')
  loop
    if jsonb_typeof(v_item) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_item) key
        where key not in (
          'resourceId', 'providerEventReference', 'startsAt', 'endsAt', 'busyState'
        )
      )
      or char_length(coalesce(v_item ->> 'providerEventReference', '')) not between 1 and 500
      or coalesce(v_item ->> 'busyState', '') not in ('busy', 'tentative')
      or (v_item ->> 'endsAt')::timestamptz <= (v_item ->> 'startsAt')::timestamptz
      or (v_item ->> 'startsAt')::timestamptz < v_starts_at
      or (v_item ->> 'endsAt')::timestamptz > v_ends_at
    then
      raise exception 'invalid external busy period item' using errcode = '22023';
    end if;
    insert into public.builder_booking_external_busy_periods (
      site_id, resource_id, provider_connection_id, provider_event_reference,
      starts_at, ends_at, busy_state, observed_at
    ) values (
      v_site_id,
      (v_item ->> 'resourceId')::uuid,
      v_connection_id,
      v_item ->> 'providerEventReference',
      (v_item ->> 'startsAt')::timestamptz,
      (v_item ->> 'endsAt')::timestamptz,
      v_item ->> 'busyState',
      v_observed_at
    )
    on conflict (site_id, provider_connection_id, provider_event_reference)
    do update
    set resource_id = excluded.resource_id,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        busy_state = excluded.busy_state,
        observed_at = excluded.observed_at,
        version = public.builder_booking_external_busy_periods.version + 1,
        updated_at = clock_timestamp();
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object(
    'version', 1,
    'status', 'applied',
    'busyPeriodCount', v_count
  );
end;
$$;

revoke all on function public.builder_replace_booking_external_busy_periods_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.builder_replace_booking_external_busy_periods_v1(jsonb)
  to service_role;

create function public.builder_record_booking_provider_webhook_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_connection_id uuid;
  v_receipt builder_private.builder_provider_webhook_receipts%rowtype;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array[
      'version', 'siteId', 'connectionId', 'providerEventId',
      'replayKey', 'signatureVerified', 'receivedAt', 'payloadDigest'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in (
        'version', 'siteId', 'connectionId', 'providerEventId',
        'replayKey', 'signatureVerified', 'occurredAt',
        'receivedAt', 'payloadDigest'
      )
    )
    or p_request -> 'signatureVerified' is distinct from 'true'::jsonb
    or coalesce(p_request ->> 'payloadDigest', '') !~ '^[a-f0-9]{64}$'
  then
    raise exception 'invalid verified booking provider webhook' using errcode = '22023';
  end if;
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_connection_id := (p_request ->> 'connectionId')::uuid;
  exception
    when invalid_text_representation
  then
    raise exception 'invalid verified booking provider webhook' using errcode = '22023';
  end;
  insert into builder_private.builder_provider_webhook_receipts (
    site_id, connection_id, provider_event_id, replay_key,
    signature_verified, occurred_at, received_at, payload_digest
  ) values (
    v_site_id,
    v_connection_id,
    p_request ->> 'providerEventId',
    p_request ->> 'replayKey',
    true,
    nullif(p_request ->> 'occurredAt', '')::timestamptz,
    (p_request ->> 'receivedAt')::timestamptz,
    p_request ->> 'payloadDigest'
  )
  on conflict (site_id, connection_id, replay_key) do nothing
  returning * into v_receipt;
  if not found then
    select *
    into v_receipt
    from builder_private.builder_provider_webhook_receipts
    where site_id = v_site_id
      and connection_id = v_connection_id
      and replay_key = p_request ->> 'replayKey';
    if v_receipt.provider_event_id <> p_request ->> 'providerEventId'
      or v_receipt.payload_digest <> p_request ->> 'payloadDigest'
    then
      raise exception 'booking provider webhook replay conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('version', 1, 'status', 'replayed');
  end if;
  return jsonb_build_object('version', 1, 'status', 'applied');
end;
$$;

revoke all on function public.builder_record_booking_provider_webhook_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.builder_record_booking_provider_webhook_v1(jsonb)
  to service_role;

create function public.builder_reconcile_booking_provider_operation_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_booking_id uuid;
  v_operation text;
  v_provider_kind text;
  v_provider_key text;
  v_provider_reference_id text;
  v_result_state text;
  v_event_digest text;
  v_idempotency_key text;
  v_occurred_at timestamptz;
  v_evidence jsonb;
  v_artifact jsonb;
  v_connection_id uuid;
  v_existing public.builder_booking_provider_operation_events%rowtype;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array[
      'version', 'siteId', 'operation', 'providerKind', 'providerKey',
      'providerReferenceId', 'resultState', 'eventDigest',
      'idempotencyKey', 'occurredAt', 'sanitizedEvidence'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in (
        'version', 'siteId', 'bookingId', 'operation', 'providerKind',
        'providerKey', 'providerReferenceId', 'resultState', 'eventDigest',
        'idempotencyKey', 'occurredAt', 'sanitizedEvidence', 'artifact'
      )
    )
    or jsonb_typeof(p_request -> 'sanitizedEvidence') <> 'object'
    or (
      p_request ? 'artifact'
      and jsonb_typeof(p_request -> 'artifact') <> 'object'
    )
  then
    raise exception 'invalid booking provider operation' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_booking_id := nullif(p_request ->> 'bookingId', '')::uuid;
    v_operation := p_request ->> 'operation';
    v_provider_kind := p_request ->> 'providerKind';
    v_provider_key := p_request ->> 'providerKey';
    v_provider_reference_id := p_request ->> 'providerReferenceId';
    v_result_state := p_request ->> 'resultState';
    v_event_digest := p_request ->> 'eventDigest';
    v_idempotency_key := p_request ->> 'idempotencyKey';
    v_occurred_at := (p_request ->> 'occurredAt')::timestamptz;
    v_evidence := p_request -> 'sanitizedEvidence';
    v_artifact := p_request -> 'artifact';
  exception
    when invalid_text_representation or datetime_field_overflow
  then
    raise exception 'invalid booking provider operation' using errcode = '22023';
  end;

  if v_operation !~ '^[a-z][a-z0-9._-]{0,127}$'
    or v_provider_kind not in ('payment', 'external-calendar', 'virtual-meeting')
    or v_provider_key !~ '^[a-z][a-z0-9._-]{0,127}$'
    or char_length(v_provider_reference_id) not between 1 and 500
    or v_result_state not in ('applied', 'replayed', 'ignored', 'reconciliation_required')
    or v_event_digest !~ '^[a-f0-9]{64}$'
    or char_length(v_idempotency_key) not between 1 and 255
    or octet_length(v_evidence::text) > 16384
  then
    raise exception 'invalid booking provider operation' using errcode = '22023';
  end if;

  insert into public.builder_booking_provider_operation_events (
    site_id,
    booking_id,
    operation,
    provider_kind,
    provider_key,
    provider_reference_id,
    result_state,
    sanitized_evidence,
    event_digest,
    idempotency_key,
    occurred_at
  ) values (
    v_site_id,
    v_booking_id,
    v_operation,
    v_provider_kind,
    v_provider_key,
    v_provider_reference_id,
    v_result_state,
    v_evidence,
    v_event_digest,
    v_idempotency_key,
    v_occurred_at
  )
  on conflict (site_id, idempotency_key) do nothing
  returning * into v_existing;

  if not found then
    select *
    into v_existing
    from public.builder_booking_provider_operation_events
    where site_id = v_site_id and idempotency_key = v_idempotency_key;
    if v_existing.event_digest <> v_event_digest
      or v_existing.operation <> v_operation
      or v_existing.provider_reference_id <> v_provider_reference_id
    then
      raise exception 'booking provider idempotency conflict' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'version', 1,
      'status', 'replayed',
      'operationEventId', v_existing.id
    );
  end if;

  if v_artifact is not null and v_result_state in ('applied', 'reconciliation_required') then
    if v_provider_kind = 'payment' then
      insert into public.builder_booking_payment_references (
        site_id, booking_id, contact_id, price_snapshot_id, kind, state,
        amount_minor, currency, provider_key, provider_reference_type,
        provider_reference_id, idempotency_key, occurred_at
      ) values (
        v_site_id,
        v_booking_id,
        (v_artifact ->> 'contactId')::uuid,
        (v_artifact ->> 'priceSnapshotId')::uuid,
        v_artifact ->> 'kind',
        case
          when v_result_state = 'reconciliation_required'
            then 'reconciliation_required'
          else v_artifact ->> 'state'
        end,
        (v_artifact ->> 'amountMinor')::bigint,
        v_artifact ->> 'currency',
        v_provider_key,
        v_artifact ->> 'referenceType',
        v_provider_reference_id,
        v_idempotency_key,
        v_occurred_at
      )
      on conflict (site_id, idempotency_key) do update
      set state = excluded.state,
          amount_minor = excluded.amount_minor,
          occurred_at = excluded.occurred_at,
          version = public.builder_booking_payment_references.version + 1,
          updated_at = clock_timestamp();
    elsif v_provider_kind = 'external-calendar' then
      v_connection_id := (v_artifact ->> 'connectionId')::uuid;
      if not exists (
        select 1
        from public.builder_provider_connections connection
        where connection.site_id = v_site_id
          and connection.id = v_connection_id
          and connection.provider_kind = 'external-calendar'
          and connection.provider_key = v_provider_key
      ) then
        raise exception 'calendar connection does not match provider'
          using errcode = '23514';
      end if;
      insert into public.builder_booking_external_event_references (
        site_id, booking_id, connection_id, provider_key, stable_external_id,
        provider_reference_id, state, event_digest, last_synced_at
      ) values (
        v_site_id,
        v_booking_id,
        v_connection_id,
        v_provider_key,
        v_artifact ->> 'stableExternalId',
        v_provider_reference_id,
        case
          when v_result_state = 'reconciliation_required'
            then 'reconciliation_required'
          else v_artifact ->> 'state'
        end,
        v_event_digest,
        (v_artifact ->> 'lastSyncedAt')::timestamptz
      )
      on conflict (site_id, provider_key, stable_external_id) do update
      set provider_reference_id = excluded.provider_reference_id,
          state = excluded.state,
          event_digest = excluded.event_digest,
          last_synced_at = excluded.last_synced_at,
          version = public.builder_booking_external_event_references.version + 1,
          updated_at = clock_timestamp();
    elsif v_provider_kind = 'virtual-meeting' then
      v_connection_id := (v_artifact ->> 'connectionId')::uuid;
      if not exists (
        select 1
        from public.builder_provider_connections connection
        where connection.site_id = v_site_id
          and connection.id = v_connection_id
          and connection.provider_kind = 'virtual-meeting'
          and connection.provider_key = v_provider_key
      ) then
        raise exception 'meeting connection does not match provider'
          using errcode = '23514';
      end if;
      insert into public.builder_booking_virtual_meeting_references (
        site_id, booking_id, connection_id, provider_key,
        provider_reference_id, join_secret_reference, state,
        starts_at, ends_at, last_synced_at
      ) values (
        v_site_id,
        v_booking_id,
        v_connection_id,
        v_provider_key,
        v_provider_reference_id,
        v_artifact ->> 'joinSecretReference',
        case
          when v_result_state = 'reconciliation_required'
            then 'reconciliation_required'
          else v_artifact ->> 'state'
        end,
        (v_artifact ->> 'startsAt')::timestamptz,
        (v_artifact ->> 'endsAt')::timestamptz,
        (v_artifact ->> 'lastSyncedAt')::timestamptz
      )
      on conflict (site_id, booking_id) do update
      set provider_reference_id = excluded.provider_reference_id,
          join_secret_reference = excluded.join_secret_reference,
          state = excluded.state,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          last_synced_at = excluded.last_synced_at,
          version = public.builder_booking_virtual_meeting_references.version + 1,
          updated_at = clock_timestamp();
    end if;
  end if;

  return jsonb_build_object(
    'version', 1,
    'status', 'applied',
    'operationEventId', v_existing.id
  );
end;
$$;

revoke all on function public.builder_reconcile_booking_provider_operation_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_reconcile_booking_provider_operation_v1(jsonb) to service_role;
