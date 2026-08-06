set search_path = public, extensions;

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
      'growth.customers', 'growth.leads', 'growth.dashboard', 'growth.bookings'
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
    else false
  end;
end;
$$;

create function builder_private.booking_replay_result(p_claim jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_set(
    jsonb_set(p_claim -> 'result', '{status}', '"replayed"'::jsonb, true),
    '{replayed}',
    'true'::jsonb,
    true
  );
$$;

create function builder_private.complete_booking_conflict_v1(
  p_request jsonb,
  p_contract_key text,
  p_reason text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select builder_private.complete_operational_command_v1(
    p_request,
    p_contract_key,
    jsonb_build_object(
      'version', 1,
      'status', 'conflict',
      'reason', p_reason
    )
  );
$$;

create function builder_private.booking_hold_json(
  p_hold public.builder_booking_holds
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'siteId', p_hold.site_id,
    'holdId', p_hold.id,
    'serviceId', p_hold.service_id,
    'serviceRevisionId', p_hold.service_revision_id,
    'requesterFingerprint', p_hold.requester_fingerprint,
    'startsAt', p_hold.starts_at,
    'endsAt', p_hold.ends_at,
    'expiresAt', p_hold.expires_at,
    'capacityUnits', p_hold.capacity_units,
    'resourceIds', to_jsonb(p_hold.resource_ids),
    'state', p_hold.state,
    'version', p_hold.version
  );
$$;

create function builder_private.booking_json(
  p_booking public.builder_bookings
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'siteId', p_booking.site_id,
    'bookingId', p_booking.id,
    'serviceId', p_booking.service_id,
    'serviceRevisionId', p_booking.service_revision_id,
    'contactId', p_booking.contact_id,
    'primaryAssigneeId', p_booking.primary_assignee_id,
    'status', p_booking.status,
    'confirmationMode', p_booking.confirmation_mode,
    'startsAt', p_booking.starts_at,
    'endsAt', p_booking.ends_at,
    'timeZone', p_booking.time_zone,
    'participantIds', coalesce((
      select jsonb_agg(participant.id order by participant.id)
      from public.builder_booking_participants participant
      where participant.site_id = p_booking.site_id
        and participant.booking_id = p_booking.id
    ), '[]'::jsonb),
    'reservationIds', coalesce((
      select jsonb_agg(reservation.id order by reservation.id)
      from public.builder_booking_reservations reservation
      where reservation.site_id = p_booking.site_id
        and reservation.booking_id = p_booking.id
    ), '[]'::jsonb),
    'intakeResponseIds', coalesce((
      select jsonb_agg(intake.id order by intake.id)
      from public.builder_booking_intake_responses intake
      where intake.site_id = p_booking.site_id
        and intake.booking_id = p_booking.id
    ), '[]'::jsonb),
    'priceSnapshotId', p_booking.price_snapshot_id,
    'policySnapshotId', p_booking.policy_snapshot_id,
    'previousBookingId', p_booking.previous_booking_id,
    'replacementBookingId', p_booking.replacement_booking_id,
    'version', p_booking.version
  );
$$;

create function builder_private.booking_waitlist_entry_json(
  p_entry public.builder_booking_waitlist_entries
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'siteId', p_entry.site_id,
    'waitlistEntryId', p_entry.id,
    'serviceId', p_entry.service_id,
    'customerId', p_entry.contact_id,
    'status', p_entry.status,
    'preferredStartsOn', p_entry.preferred_starts_on,
    'preferredEndsOn', p_entry.preferred_ends_on,
    'preferredTimeWindows', p_entry.preferred_time_windows,
    'preferredResourceIds', to_jsonb(p_entry.preferred_resource_ids),
    'capacityUnits', p_entry.capacity_units,
    'pricePreapproved', p_entry.price_preapproved,
    'policyPreapproved', p_entry.policy_preapproved,
    'version', p_entry.version
  );
$$;

create function builder_private.booking_waitlist_offer_json(
  p_offer public.builder_booking_waitlist_offers
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'siteId', p_offer.site_id,
    'waitlistOfferId', p_offer.id,
    'waitlistEntryId', p_offer.waitlist_entry_id,
    'holdId', p_offer.hold_id,
    'status', p_offer.status,
    'offeredAt', p_offer.offered_at,
    'expiresAt', p_offer.expires_at,
    'capacityUnits', p_offer.capacity_units,
    'version', p_offer.version
  );
$$;

create function builder_private.booking_member_action_allowed(
  p_site_id uuid,
  p_actor_id uuid,
  p_capability text,
  p_booking_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
begin
  if not builder_private.dependent_action_allowed(
    p_site_id,
    'growth.customers',
    'growth.bookings',
    'write'
  ) then
    return false;
  end if;

  if p_booking_id is null then
    return builder_private.member_has_capability(
      p_site_id,
      p_actor_id,
      p_capability,
      'site'
    );
  end if;

  return builder_private.member_can_access_growth_record(
    p_site_id,
    p_actor_id,
    p_capability,
    'booking',
    p_booking_id
  );
end;
$$;

create function builder_private.booking_command_actor_id(
  p_request jsonb,
  p_allow_visitor boolean default false,
  p_allow_system boolean default false
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_actor_type text := p_request #>> '{actor,type}';
  v_actor_id uuid;
begin
  if v_actor_type = 'visitor' and p_allow_visitor then return null; end if;
  if v_actor_type = 'system' and p_allow_system then return null; end if;
  if v_actor_type <> 'member' then
    raise exception 'booking command actor is not allowed' using errcode = '42501';
  end if;
  v_actor_id := (p_request #>> '{actor,id}')::uuid;
  if not exists (
    select 1
    from public.builder_site_members
    where site_id = v_site_id and user_id = v_actor_id
  ) then
    raise exception 'booking command member is not active' using errcode = '42501';
  end if;
  return v_actor_id;
end;
$$;

create function builder_private.assert_booking_command_envelope(
  p_request jsonb,
  p_expected_type text
)
returns void
language plpgsql
stable
set search_path = pg_catalog
as $$
begin
  if jsonb_typeof(p_request) <> 'object'
    or coalesce((p_request ->> 'version')::integer, 0) <> 1
    or (p_request ->> 'commandId')::uuid is null
    or (p_request ->> 'siteId')::uuid is null
    or nullif(trim(p_request ->> 'idempotencyKey'), '') is null
    or (p_request ->> 'correlationId')::uuid is null
    or p_request ->> 'type' <> p_expected_type
    or jsonb_typeof(p_request -> 'payload') <> 'object'
  then
    raise exception 'invalid booking command envelope' using errcode = '22023';
  end if;
end;
$$;

revoke all on function builder_private.snapshot_module_action_allowed(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function builder_private.resource_exists(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function builder_private.booking_replay_result(jsonb)
  from public, anon, authenticated;
revoke all on function builder_private.complete_booking_conflict_v1(jsonb, text, text)
  from public, anon, authenticated;
revoke all on function builder_private.booking_hold_json(public.builder_booking_holds)
  from public, anon, authenticated;
revoke all on function builder_private.booking_json(public.builder_bookings)
  from public, anon, authenticated;
revoke all on function builder_private.booking_waitlist_entry_json(public.builder_booking_waitlist_entries)
  from public, anon, authenticated;
revoke all on function builder_private.booking_waitlist_offer_json(public.builder_booking_waitlist_offers)
  from public, anon, authenticated;
revoke all on function builder_private.booking_member_action_allowed(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function builder_private.booking_command_actor_id(jsonb, boolean, boolean)
  from public, anon, authenticated;
revoke all on function builder_private.assert_booking_command_envelope(jsonb, text)
  from public, anon, authenticated;

grant execute on function builder_private.snapshot_module_action_allowed(uuid, text, text, timestamptz)
  to service_role;
grant execute on function builder_private.resource_exists(uuid, text, uuid)
  to service_role;
grant execute on function builder_private.booking_replay_result(jsonb)
  to service_role;
grant execute on function builder_private.complete_booking_conflict_v1(jsonb, text, text)
  to service_role;
grant execute on function builder_private.booking_hold_json(public.builder_booking_holds)
  to service_role;
grant execute on function builder_private.booking_json(public.builder_bookings)
  to service_role;
grant execute on function builder_private.booking_waitlist_entry_json(public.builder_booking_waitlist_entries)
  to service_role;
grant execute on function builder_private.booking_waitlist_offer_json(public.builder_booking_waitlist_offers)
  to service_role;
grant execute on function builder_private.booking_member_action_allowed(uuid, uuid, text, uuid)
  to service_role;
grant execute on function builder_private.booking_command_actor_id(jsonb, boolean, boolean)
  to service_role;
grant execute on function builder_private.assert_booking_command_envelope(jsonb, text)
  to service_role;

create function public.builder_apply_booking_command_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private, extensions
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_type text := p_request ->> 'type';
  v_payload jsonb := p_request -> 'payload';
  v_expected_version integer;
  v_actor_id uuid;
  v_claim jsonb;
  v_result jsonb;
  v_hold public.builder_booking_holds%rowtype;
  v_booking public.builder_bookings%rowtype;
  v_prior_booking public.builder_bookings%rowtype;
  v_entry public.builder_booking_waitlist_entries%rowtype;
  v_offer public.builder_booking_waitlist_offers%rowtype;
  v_service_revision public.builder_booking_service_revisions%rowtype;
  v_resource public.builder_booking_resources%rowtype;
  v_resource_ids uuid[];
  v_booking_id uuid;
  v_event_status text;
  v_reason text;
begin
  perform builder_private.assert_booking_command_envelope(p_request, v_type);
  if v_type not in (
    'booking.hold.create', 'booking.hold.expire', 'booking.request',
    'booking.approve', 'booking.confirm', 'booking.check_in',
    'booking.complete', 'booking.reschedule', 'booking.cancel',
    'booking.decline', 'booking.no_show', 'booking.waitlist.join',
    'booking.waitlist.offer', 'booking.waitlist.accept',
    'booking.waitlist.expire_offer'
  ) then
    raise exception 'unknown booking command type' using errcode = '22023';
  end if;

  if not builder_private.dependent_action_allowed(
    v_site_id,
    'growth.customers',
    'growth.bookings',
    'write'
  ) then
    raise exception 'Bookings entitlement is inactive' using errcode = '42501';
  end if;

  if v_type in (
    'booking.hold.create', 'booking.request', 'booking.confirm',
    'booking.waitlist.join', 'booking.waitlist.accept'
  ) then
    v_actor_id := builder_private.booking_command_actor_id(p_request, true, false);
  elsif v_type in ('booking.hold.expire', 'booking.waitlist.expire_offer') then
    v_actor_id := builder_private.booking_command_actor_id(p_request, false, true);
  else
    v_actor_id := builder_private.booking_command_actor_id(p_request, false, false);
  end if;

  if v_actor_id is not null then
    if v_type in ('booking.hold.create', 'booking.request', 'booking.confirm') then
      if not builder_private.booking_member_action_allowed(
        v_site_id,
        v_actor_id,
        'bookings.create'
      ) then
        raise exception 'booking create capability is required' using errcode = '42501';
      end if;
    elsif v_type in (
      'booking.approve', 'booking.waitlist.offer',
      'booking.waitlist.expire_offer'
    ) then
      if not builder_private.booking_member_action_allowed(
        v_site_id,
        v_actor_id,
        'bookings.approve'
      ) then
        raise exception 'booking approval capability is required' using errcode = '42501';
      end if;
    elsif v_type = 'booking.check_in' then
      if not builder_private.booking_member_action_allowed(
        v_site_id,
        v_actor_id,
        'bookings.checkIn',
        (v_payload ->> 'bookingId')::uuid
      ) then
        raise exception 'booking check-in capability is required' using errcode = '42501';
      end if;
    elsif v_type in (
      'booking.complete', 'booking.reschedule', 'booking.cancel',
      'booking.decline', 'booking.no_show'
    ) then
      if not builder_private.booking_member_action_allowed(
        v_site_id,
        v_actor_id,
        'bookings.update',
        (v_payload ->> 'bookingId')::uuid
      ) then
        raise exception 'booking update capability is required' using errcode = '42501';
      end if;
    end if;
  end if;

  if v_type in ('booking.hold.create', 'booking.waitlist.join') then
    if p_request ? 'expectedVersion' then
      raise exception 'expectedVersion is forbidden for create commands'
        using errcode = '22023';
    end if;
  else
    if not p_request ? 'expectedVersion'
      or (p_request ->> 'expectedVersion')::integer < 1
    then
      raise exception 'expectedVersion is required' using errcode = '22023';
    end if;
    v_expected_version := (p_request ->> 'expectedVersion')::integer;
  end if;

  v_claim := builder_private.claim_operational_command_v1(
    p_request,
    'growth.booking.command.v1'
  );
  if v_claim ->> 'status' = 'replay' then
    return builder_private.booking_replay_result(v_claim);
  end if;

  if v_type = 'booking.hold.create' then
    select *
    into v_service_revision
    from public.builder_booking_service_revisions
    where site_id = v_site_id
      and id = (v_payload ->> 'serviceRevisionId')::uuid
      and service_id = (v_payload ->> 'serviceId')::uuid
      and public_visibility in ('public', 'unlisted')
    for share;

    if not found
      or not exists (
        select 1
        from public.builder_booking_services service
        where service.site_id = v_site_id
          and service.id = v_service_revision.service_id
          and service.current_revision_id = v_service_revision.id
          and service.state = 'active'
      )
    then
      raise exception 'booking service revision is not active' using errcode = '22023';
    end if;

    v_resource_ids := array(
      select value::uuid
      from jsonb_array_elements_text(
        coalesce(v_payload -> 'resourceIds', '[]'::jsonb)
      ) value
    );
    if cardinality(v_resource_ids) = 0 then
      raise exception 'at least one booking resource is required' using errcode = '22023';
    end if;
    if exists (
      select 1
      from unnest(v_resource_ids) resource_id
      where not exists (
        select 1
        from public.builder_booking_resources resource
        join public.builder_booking_resource_eligibility eligibility
          on eligibility.site_id = resource.site_id
         and eligibility.resource_id = resource.id
        where resource.site_id = v_site_id
          and resource.id = resource_id
          and resource.state = 'active'
          and eligibility.service_revision_id = v_service_revision.id
      )
    ) then
      raise exception 'booking resource is not eligible' using errcode = '22023';
    end if;
    if (v_payload ->> 'startsAt')::timestamptz <= statement_timestamp()
      or (v_payload ->> 'endsAt')::timestamptz
        <= (v_payload ->> 'startsAt')::timestamptz
      or (v_payload ->> 'expiresAt')::timestamptz <= statement_timestamp()
      or (v_payload ->> 'expiresAt')::timestamptz
        > (v_payload ->> 'startsAt')::timestamptz
    then
      raise exception 'invalid booking hold window' using errcode = '22023';
    end if;
    if exists (
      select 1
      from public.builder_booking_closures closure
      where closure.site_id = v_site_id
        and tstzrange(closure.starts_at, closure.ends_at, '[)')
          && tstzrange(
            (v_payload ->> 'startsAt')::timestamptz,
            (v_payload ->> 'endsAt')::timestamptz,
            '[)'
          )
        and (
          closure.owner_kind = 'site'
          or (
            closure.owner_kind = 'service'
            and closure.owner_id = v_service_revision.service_id
          )
          or (
            closure.owner_kind = 'resource'
            and closure.owner_id = any(v_resource_ids)
          )
        )
    ) then
      raise exception 'booking window is closed' using errcode = '23P01';
    end if;

    insert into public.builder_booking_holds (
      site_id, id, service_id, service_revision_id, requester_fingerprint,
      starts_at, ends_at, expires_at, capacity_units, resource_ids,
      state, idempotency_key
    ) values (
      v_site_id,
      (v_payload ->> 'holdId')::uuid,
      (v_payload ->> 'serviceId')::uuid,
      (v_payload ->> 'serviceRevisionId')::uuid,
      v_payload ->> 'requesterFingerprint',
      (v_payload ->> 'startsAt')::timestamptz,
      (v_payload ->> 'endsAt')::timestamptz,
      (v_payload ->> 'expiresAt')::timestamptz,
      (v_payload ->> 'capacityUnits')::integer,
      v_resource_ids,
      'active',
      p_request ->> 'idempotencyKey'
    )
    returning * into v_hold;

    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'hold',
        'hold', builder_private.booking_hold_json(v_hold)
      ),
      'replayed', false
    );

  elsif v_type = 'booking.hold.expire' then
    select *
    into v_hold
    from public.builder_booking_holds
    where site_id = v_site_id
      and id = (v_payload ->> 'holdId')::uuid
    for update;
    if not found then
      raise exception 'booking hold was not found' using errcode = '22023';
    end if;
    if v_hold.version <> v_expected_version then
      return builder_private.complete_booking_conflict_v1(
        p_request, 'growth.booking.command.v1', 'stale_version'
      );
    end if;
    update public.builder_booking_holds
    set state = case when state = 'active' then 'expired' else state end,
        version = version + case when state = 'active' then 1 else 0 end,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_hold.id
    returning * into v_hold;
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'hold',
        'hold', builder_private.booking_hold_json(v_hold)
      ),
      'replayed', false
    );

  elsif v_type = 'booking.request' then
    select *
    into v_hold
    from public.builder_booking_holds
    where site_id = v_site_id
      and id = (v_payload ->> 'holdId')::uuid
    for update;
    if not found
      or v_hold.state <> 'active'
      or v_hold.expires_at <= statement_timestamp()
    then
      raise exception 'booking hold is expired or unavailable' using errcode = '22023';
    end if;
    if v_hold.version <> v_expected_version then
      return builder_private.complete_booking_conflict_v1(
        p_request, 'growth.booking.command.v1', 'stale_version'
      );
    end if;
    if not exists (
      select 1
      from public.builder_booking_price_snapshots price
      where price.site_id = v_site_id
        and price.id = (v_payload ->> 'priceSnapshotId')::uuid
        and price.service_revision_id = v_hold.service_revision_id
    ) or not exists (
      select 1
      from public.builder_booking_policy_snapshots policy
      where policy.site_id = v_site_id
        and policy.id = (v_payload ->> 'policySnapshotId')::uuid
        and policy.service_revision_id = v_hold.service_revision_id
    ) then
      raise exception 'booking price or policy snapshot is stale' using errcode = '22023';
    end if;

    select *
    into v_service_revision
    from public.builder_booking_service_revisions
    where site_id = v_site_id and id = v_hold.service_revision_id;

    insert into public.builder_bookings (
      site_id, id, service_id, service_revision_id, contact_id, hold_id,
      status, confirmation_mode, starts_at, ends_at, time_zone,
      price_snapshot_id, policy_snapshot_id, idempotency_key, created_by
    ) values (
      v_site_id,
      (v_payload ->> 'bookingId')::uuid,
      v_hold.service_id,
      v_hold.service_revision_id,
      (v_payload ->> 'customerId')::uuid,
      v_hold.id,
      'requested',
      v_service_revision.confirmation_mode,
      v_hold.starts_at,
      v_hold.ends_at,
      coalesce(v_service_revision.definition ->> 'timeZone', 'UTC'),
      (v_payload ->> 'priceSnapshotId')::uuid,
      (v_payload ->> 'policySnapshotId')::uuid,
      p_request ->> 'idempotencyKey',
      v_actor_id
    )
    returning * into v_booking;

    insert into public.builder_booking_participants (
      site_id, booking_id, contact_id, role
    ) values (
      v_site_id,
      v_booking.id,
      v_booking.contact_id,
      'primary_customer'
    );
    insert into public.builder_booking_events (
      site_id, booking_id, event_type, from_status, to_status, actor_id,
      idempotency_key, occurred_at
    ) values (
      v_site_id,
      v_booking.id,
      'booking.requested',
      null,
      'requested',
      v_actor_id,
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

  elsif v_type = 'booking.confirm' then
    select *
    into v_booking
    from public.builder_bookings
    where site_id = v_site_id
      and id = (v_payload ->> 'bookingId')::uuid
    for update;
    if not found then
      raise exception 'booking was not found' using errcode = '22023';
    end if;
    if v_booking.version <> v_expected_version then
      return builder_private.complete_booking_conflict_v1(
        p_request, 'growth.booking.command.v1', 'stale_version'
      );
    end if;
    select *
    into v_hold
    from public.builder_booking_holds
    where site_id = v_site_id
      and id = (v_payload ->> 'holdId')::uuid
      and id = v_booking.hold_id
    for update;
    if not found
      or v_hold.state <> 'active'
      or v_hold.expires_at <= statement_timestamp()
      or v_hold.service_revision_id
        <> (v_payload ->> 'serviceRevisionId')::uuid
    then
      raise exception 'booking hold is expired or stale' using errcode = '22023';
    end if;

    foreach v_booking_id in array v_hold.resource_ids loop
      select *
      into v_resource
      from public.builder_booking_resources
      where site_id = v_site_id and id = v_booking_id
      for update;
      insert into public.builder_booking_reservations (
        site_id, booking_id, resource_id, resource_kind, exclusive,
        starts_at, ends_at, capacity_units, state
      ) values (
        v_site_id,
        v_booking.id,
        v_resource.id,
        v_resource.kind,
        v_resource.exclusive,
        v_booking.starts_at,
        v_booking.ends_at,
        v_hold.capacity_units,
        'active'
      );
    end loop;

    update public.builder_booking_holds
    set state = 'consumed',
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_hold.id;
    update public.builder_bookings
    set status = 'confirmed',
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_booking.id
    returning * into v_booking;
    insert into public.builder_booking_events (
      site_id, booking_id, event_type, from_status, to_status, actor_id,
      idempotency_key, occurred_at
    ) values (
      v_site_id,
      v_booking.id,
      'booking.confirmed',
      'requested',
      'confirmed',
      v_actor_id,
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

  elsif v_type = 'booking.reschedule' then
    select *
    into v_prior_booking
    from public.builder_bookings
    where site_id = v_site_id
      and id = (v_payload ->> 'bookingId')::uuid
    for update;
    if not found then
      raise exception 'booking was not found' using errcode = '22023';
    end if;
    if v_prior_booking.version <> v_expected_version then
      return builder_private.complete_booking_conflict_v1(
        p_request, 'growth.booking.command.v1', 'stale_version'
      );
    end if;
    select *
    into v_hold
    from public.builder_booking_holds
    where site_id = v_site_id
      and id = (v_payload ->> 'replacementHoldId')::uuid
    for update;
    if not found
      or v_hold.state <> 'active'
      or v_hold.expires_at <= statement_timestamp()
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
      v_actor_id
    )
    returning * into v_booking;

    insert into public.builder_booking_participants (
      site_id, booking_id, contact_id, role, attendance_status
    )
    select site_id, v_booking.id, contact_id, role, 'expected'
    from public.builder_booking_participants
    where site_id = v_site_id and booking_id = v_prior_booking.id;

    foreach v_booking_id in array v_hold.resource_ids loop
      select *
      into v_resource
      from public.builder_booking_resources
      where site_id = v_site_id and id = v_booking_id
      for update;
      insert into public.builder_booking_reservations (
        site_id, booking_id, resource_id, resource_kind, exclusive,
        starts_at, ends_at, capacity_units, state
      ) values (
        v_site_id,
        v_booking.id,
        v_resource.id,
        v_resource.kind,
        v_resource.exclusive,
        v_booking.starts_at,
        v_booking.ends_at,
        v_hold.capacity_units,
        'active'
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
      'confirmed',
      'rescheduled',
      v_actor_id,
      v_payload ->> 'reasonCode',
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

  elsif v_type = 'booking.waitlist.join' then
    insert into public.builder_booking_waitlist_entries (
      site_id, id, service_id, contact_id, status,
      preferred_starts_on, preferred_ends_on, preferred_time_windows,
      preferred_resource_ids, capacity_units, price_preapproved,
      policy_preapproved, idempotency_key
    ) values (
      v_site_id,
      (v_payload ->> 'waitlistEntryId')::uuid,
      (v_payload ->> 'serviceId')::uuid,
      (v_payload ->> 'customerId')::uuid,
      'waiting',
      (v_payload ->> 'preferredStartsOn')::date,
      (v_payload ->> 'preferredEndsOn')::date,
      coalesce(v_payload -> 'preferredTimeWindows', '[]'::jsonb),
      array(
        select value::uuid
        from jsonb_array_elements_text(
          coalesce(v_payload -> 'preferredResourceIds', '[]'::jsonb)
        ) value
      ),
      (v_payload ->> 'capacityUnits')::integer,
      coalesce((v_payload ->> 'pricePreapproved')::boolean, false),
      coalesce((v_payload ->> 'policyPreapproved')::boolean, false),
      p_request ->> 'idempotencyKey'
    )
    returning * into v_entry;
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'waitlist_entry',
        'waitlistEntry', builder_private.booking_waitlist_entry_json(v_entry)
      ),
      'replayed', false
    );

  elsif v_type = 'booking.waitlist.offer' then
    select *
    into v_entry
    from public.builder_booking_waitlist_entries
    where site_id = v_site_id
      and id = (v_payload ->> 'waitlistEntryId')::uuid
    for update;
    if not found then
      raise exception 'waitlist entry was not found' using errcode = '22023';
    end if;
    if v_entry.version <> v_expected_version then
      return builder_private.complete_booking_conflict_v1(
        p_request, 'growth.booking.command.v1', 'stale_version'
      );
    end if;
    if v_entry.status <> 'waiting' then
      raise exception 'stale waitlist entry' using errcode = '40001';
    end if;
    select *
    into v_hold
    from public.builder_booking_holds
    where site_id = v_site_id
      and id = (v_payload ->> 'holdId')::uuid
      and state = 'active'
      and expires_at > statement_timestamp()
    for update;
    if not found then
      raise exception 'waitlist hold is unavailable' using errcode = '22023';
    end if;
    insert into public.builder_booking_waitlist_offers (
      site_id, id, waitlist_entry_id, hold_id, status, opening_key,
      offered_at, expires_at, capacity_units, idempotency_key
    ) values (
      v_site_id,
      (v_payload ->> 'waitlistOfferId')::uuid,
      v_entry.id,
      v_hold.id,
      'offered',
      coalesce(v_payload ->> 'openingKey', v_hold.id::text),
      clock_timestamp(),
      (v_payload ->> 'expiresAt')::timestamptz,
      v_hold.capacity_units,
      p_request ->> 'idempotencyKey'
    )
    returning * into v_offer;
    update public.builder_booking_waitlist_entries
    set status = 'offered',
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_entry.id
    returning * into v_entry;
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'waitlist_offer',
        'waitlistEntry', builder_private.booking_waitlist_entry_json(v_entry),
        'waitlistOffer', builder_private.booking_waitlist_offer_json(v_offer)
      ),
      'replayed', false
    );

  elsif v_type = 'booking.waitlist.accept' then
    select *
    into v_offer
    from public.builder_booking_waitlist_offers
    where site_id = v_site_id
      and id = (v_payload ->> 'waitlistOfferId')::uuid
      and waitlist_entry_id = (v_payload ->> 'waitlistEntryId')::uuid
    for update;
    if not found then
      raise exception 'waitlist offer was not found' using errcode = '22023';
    end if;
    if v_offer.version <> v_expected_version then
      return builder_private.complete_booking_conflict_v1(
        p_request, 'growth.booking.command.v1', 'stale_version'
      );
    end if;
    if v_offer.status <> 'offered'
      or v_offer.expires_at <= statement_timestamp()
    then
      raise exception 'waitlist offer is stale or expired' using errcode = '40001';
    end if;
    select *
    into v_entry
    from public.builder_booking_waitlist_entries
    where site_id = v_site_id and id = v_offer.waitlist_entry_id
    for update;
    select *
    into v_hold
    from public.builder_booking_holds
    where site_id = v_site_id and id = v_offer.hold_id
    for update;
    select *
    into v_service_revision
    from public.builder_booking_service_revisions
    where site_id = v_site_id and id = v_hold.service_revision_id;

    insert into public.builder_bookings (
      site_id, id, service_id, service_revision_id, contact_id, hold_id,
      status, confirmation_mode, starts_at, ends_at, time_zone,
      price_snapshot_id, policy_snapshot_id, idempotency_key
    ) values (
      v_site_id,
      (v_payload ->> 'bookingId')::uuid,
      v_hold.service_id,
      v_hold.service_revision_id,
      v_entry.contact_id,
      v_hold.id,
      'requested',
      v_service_revision.confirmation_mode,
      v_hold.starts_at,
      v_hold.ends_at,
      coalesce(v_service_revision.definition ->> 'timeZone', 'UTC'),
      (v_payload ->> 'priceSnapshotId')::uuid,
      (v_payload ->> 'policySnapshotId')::uuid,
      p_request ->> 'idempotencyKey'
    )
    returning * into v_booking;
    insert into public.builder_booking_participants (
      site_id, booking_id, contact_id, role
    ) values (
      v_site_id, v_booking.id, v_booking.contact_id, 'primary_customer'
    );
    update public.builder_booking_waitlist_offers
    set status = 'accepted',
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_offer.id
    returning * into v_offer;
    update public.builder_booking_waitlist_entries
    set status = 'accepted',
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_entry.id
    returning * into v_entry;
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'waitlist_conversion',
        'waitlistEntry', builder_private.booking_waitlist_entry_json(v_entry),
        'waitlistOffer', builder_private.booking_waitlist_offer_json(v_offer),
        'booking', builder_private.booking_json(v_booking)
      ),
      'replayed', false
    );

  elsif v_type = 'booking.waitlist.expire_offer' then
    select *
    into v_offer
    from public.builder_booking_waitlist_offers
    where site_id = v_site_id
      and id = (v_payload ->> 'waitlistOfferId')::uuid
      and waitlist_entry_id = (v_payload ->> 'waitlistEntryId')::uuid
    for update;
    if not found then
      raise exception 'waitlist offer was not found' using errcode = '22023';
    end if;
    if v_offer.version <> v_expected_version then
      return builder_private.complete_booking_conflict_v1(
        p_request, 'growth.booking.command.v1', 'stale_version'
      );
    end if;
    update public.builder_booking_waitlist_offers
    set status = case when status = 'offered' then 'expired' else status end,
        version = version + case when status = 'offered' then 1 else 0 end,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_offer.id
    returning * into v_offer;
    update public.builder_booking_waitlist_entries
    set status = case when status = 'offered' then 'waiting' else status end,
        version = version + case when status = 'offered' then 1 else 0 end,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_offer.waitlist_entry_id
    returning * into v_entry;
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'waitlist_offer',
        'waitlistEntry', builder_private.booking_waitlist_entry_json(v_entry),
        'waitlistOffer', builder_private.booking_waitlist_offer_json(v_offer)
      ),
      'replayed', false
    );

  else
    v_booking_id := (v_payload ->> 'bookingId')::uuid;
    select *
    into v_booking
    from public.builder_bookings
    where site_id = v_site_id and id = v_booking_id
    for update;
    if not found then
      raise exception 'booking was not found' using errcode = '22023';
    end if;
    if v_booking.version <> v_expected_version then
      return builder_private.complete_booking_conflict_v1(
        p_request, 'growth.booking.command.v1', 'stale_version'
      );
    end if;

    v_event_status := case v_type
      when 'booking.approve' then 'approved'
      when 'booking.check_in' then 'checked_in'
      when 'booking.complete' then 'completed'
      when 'booking.cancel' then 'cancelled'
      when 'booking.decline' then 'declined'
      when 'booking.no_show' then 'no_show'
    end;
    if v_event_status is null then
      raise exception 'unsupported booking transition' using errcode = '22023';
    end if;
    if v_type = 'booking.approve' and v_booking.status <> 'requested' then
      raise exception 'booking is not awaiting approval' using errcode = '22023';
    end if;
    if v_type = 'booking.check_in' then
      update public.builder_booking_participants
      set attendance_status = 'checked_in',
          version = version + 1,
          updated_at = clock_timestamp()
      where site_id = v_site_id
        and booking_id = v_booking.id
        and (
          not v_payload ? 'participantIds'
          or id = any(array(
            select value::uuid
            from jsonb_array_elements_text(v_payload -> 'participantIds') value
          ))
        );
    end if;
    if v_event_status in ('cancelled', 'declined', 'no_show') then
      update public.builder_booking_reservations
      set state = 'released',
          version = version + 1,
          updated_at = clock_timestamp()
      where site_id = v_site_id
        and booking_id = v_booking.id
        and state = 'active';
    end if;
    update public.builder_bookings
    set status = v_event_status,
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_booking.id
    returning * into v_booking;
    v_reason := coalesce(v_payload ->> 'reasonCode', v_payload ->> 'outcomeCode');
    insert into public.builder_booking_events (
      site_id, booking_id, event_type, from_status, to_status, actor_id,
      reason, idempotency_key, occurred_at
    ) values (
      v_site_id,
      v_booking.id,
      replace(v_type, '_', '.'),
      null,
      v_event_status,
      v_actor_id,
      v_reason,
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
  end if;

  return builder_private.complete_operational_command_v1(
    p_request,
    'growth.booking.command.v1',
    v_result
  );
end;
$$;

revoke all on function public.builder_apply_booking_command_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_apply_booking_command_v1(jsonb) to service_role;

create function builder_private.appointment_session_json(
  p_session public.builder_appointment_work_sessions
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'siteId', p_session.site_id,
    'workSessionId', p_session.id,
    'bookingId', p_session.booking_id,
    'priorSessionId', p_session.prior_session_id,
    'templateId', p_session.template_id,
    'templateRevisionId', p_session.template_revision_id,
    'state', p_session.state,
    'startedAt', p_session.started_at,
    'resumedAt', p_session.resumed_at,
    'endedAt', p_session.ended_at,
    'outcomeId', p_session.outcome_id,
    'version', p_session.version
  );
$$;

create function builder_private.appointment_item_json(
  p_item public.builder_appointment_item_references
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'siteId', p_item.site_id,
    'itemReferenceId', p_item.id,
    'bookingId', p_item.booking_id,
    'workSessionId', p_item.work_session_id,
    'sourceKind', p_item.source_kind,
    'sourceInstanceId', p_item.source_instance_id,
    'sourceConfigurationRevision', p_item.source_configuration_revision,
    'sourceStableId', p_item.source_stable_id,
    'sourceItemRevision', p_item.source_item_revision,
    'assetRevisionId', p_item.asset_revision_id,
    'objectReference', p_item.object_reference,
    'displayTitle', p_item.display_title,
    'thumbnailReference', p_item.thumbnail_reference,
    'metadataSnapshot', p_item.metadata_snapshot,
    'availabilityState', p_item.availability_state,
    'sourceHealthState', p_item.source_health_state,
    'sortPosition', p_item.sort_position,
    'staffNote', p_item.staff_note,
    'archivedAt', p_item.archived_at,
    'version', p_item.version
  );
$$;

create function public.builder_apply_appointment_command_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_type text := p_request ->> 'type';
  v_payload jsonb := p_request -> 'payload';
  v_actor_id uuid;
  v_booking_id uuid := (p_request #>> '{payload,bookingId}')::uuid;
  v_expected_version integer;
  v_claim jsonb;
  v_result jsonb;
  v_session public.builder_appointment_work_sessions%rowtype;
  v_prior_session public.builder_appointment_work_sessions%rowtype;
  v_item public.builder_appointment_item_references%rowtype;
  v_outcome public.builder_appointment_outcomes%rowtype;
begin
  perform builder_private.assert_booking_command_envelope(p_request, v_type);
  if v_type not in (
    'appointment.start', 'appointment.session.update', 'appointment.session.end',
    'appointment.session.reopen', 'appointment.item.add', 'appointment.item.remove',
    'appointment.item.promote_to_customer_preference',
    'appointment.outcome.record', 'appointment.outcome.supersede'
  ) then
    raise exception 'unknown appointment command type' using errcode = '22023';
  end if;
  v_actor_id := builder_private.booking_command_actor_id(p_request, false, false);
  if not builder_private.booking_member_action_allowed(
    v_site_id,
    v_actor_id,
    case when v_type = 'appointment.start' then 'bookings.checkIn'
      else 'bookings.update'
    end,
    v_booking_id
  ) then
    raise exception 'appointment command is not authorized' using errcode = '42501';
  end if;
  if not p_request ? 'expectedVersion'
    or (p_request ->> 'expectedVersion')::integer < 1
  then
    raise exception 'expectedVersion is required' using errcode = '22023';
  end if;
  v_expected_version := (p_request ->> 'expectedVersion')::integer;

  if v_type = 'appointment.item.promote_to_customer_preference' then
    return public.builder_promote_appointment_item_preference_v1(
      jsonb_set(
        p_request,
        '{type}',
        to_jsonb('customer.item_preference.promote'::text),
        true
      )
    );
  end if;

  v_claim := builder_private.claim_operational_command_v1(
    p_request,
    'growth.appointment.command.v1'
  );
  if v_claim ->> 'status' = 'replay' then
    return builder_private.booking_replay_result(v_claim);
  end if;

  if v_type = 'appointment.start' then
    select booking.version
    into v_expected_version
    from public.builder_bookings booking
    where booking.site_id = v_site_id
      and booking.id = v_booking_id
      and booking.status in ('confirmed', 'checked_in')
      and booking.version = (p_request ->> 'expectedVersion')::integer;
    if not found then
      raise exception 'booking cannot start an appointment'
        using errcode = '40001';
    end if;
    insert into public.builder_appointment_work_sessions (
      site_id, id, booking_id, template_id, template_revision_id,
      state, started_at, started_by, idempotency_key
    ) values (
      v_site_id,
      (v_payload ->> 'sessionId')::uuid,
      v_booking_id,
      (v_payload ->> 'templateId')::uuid,
      (v_payload ->> 'templateRevisionId')::uuid,
      'in_progress',
      clock_timestamp(),
      v_actor_id,
      p_request ->> 'idempotencyKey'
    )
    returning * into v_session;
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'work_session',
        'workSession', builder_private.appointment_session_json(v_session)
      ),
      'replayed', false
    );

  elsif v_type = 'appointment.session.reopen' then
    select *
    into v_prior_session
    from public.builder_appointment_work_sessions
    where site_id = v_site_id
      and id = (v_payload ->> 'priorSessionId')::uuid
      and booking_id = v_booking_id
    for update;
    if not found
      or v_prior_session.state <> 'ended'
      or v_prior_session.version <> v_expected_version
    then
      raise exception 'appointment session cannot be reopened'
        using errcode = '40001';
    end if;
    insert into public.builder_appointment_work_sessions (
      site_id, id, booking_id, prior_session_id, manager_reopen_reason,
      template_id, template_revision_id, state, started_at, started_by,
      idempotency_key
    ) values (
      v_site_id,
      (v_payload ->> 'sessionId')::uuid,
      v_booking_id,
      v_prior_session.id,
      v_payload ->> 'reason',
      v_prior_session.template_id,
      v_prior_session.template_revision_id,
      'in_progress',
      clock_timestamp(),
      v_actor_id,
      p_request ->> 'idempotencyKey'
    )
    returning * into v_session;
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'work_session',
        'workSession', builder_private.appointment_session_json(v_session)
      ),
      'replayed', false
    );

  elsif v_type in ('appointment.item.add', 'appointment.item.remove') then
    select *
    into v_session
    from public.builder_appointment_work_sessions
    where site_id = v_site_id
      and id = (v_payload ->> 'workSessionId')::uuid
      and booking_id = v_booking_id
    for update;
    if not found
      or v_session.state <> 'in_progress'
      or v_session.version <> v_expected_version
    then
      raise exception 'appointment work session is stale' using errcode = '40001';
    end if;
    if v_type = 'appointment.item.add' then
      insert into public.builder_appointment_item_references (
        site_id, id, booking_id, work_session_id, source_kind,
        source_instance_id, source_configuration_revision, source_stable_id,
        source_item_revision, asset_revision_id, object_reference,
        display_title, thumbnail_reference,
        metadata_snapshot, availability_state, source_health_state,
        sort_position, staff_note, selected_by, selected_at
      ) values (
        v_site_id,
        (v_payload ->> 'itemReferenceId')::uuid,
        v_booking_id,
        v_session.id,
        v_payload ->> 'sourceKind',
        v_payload ->> 'sourceInstanceId',
        (v_payload ->> 'sourceConfigurationRevision')::integer,
        v_payload ->> 'sourceStableId',
        v_payload ->> 'sourceItemRevision',
        (v_payload ->> 'assetRevisionId')::uuid,
        v_payload ->> 'objectReference',
        v_payload ->> 'displayTitle',
        v_payload ->> 'thumbnailReference',
        coalesce(v_payload -> 'metadataSnapshot', '{}'::jsonb),
        coalesce(v_payload ->> 'availabilityState', 'unknown'),
        coalesce(v_payload ->> 'sourceHealthState', 'healthy'),
        coalesce((v_payload ->> 'sortPosition')::integer, 0),
        v_payload ->> 'staffNote',
        v_actor_id,
        clock_timestamp()
      )
      returning * into v_item;
    else
      update public.builder_appointment_item_references
      set archived_at = clock_timestamp(),
          version = version + 1,
          updated_at = clock_timestamp()
      where site_id = v_site_id
        and id = (v_payload ->> 'itemReferenceId')::uuid
        and booking_id = v_booking_id
        and work_session_id = v_session.id
        and version = (v_payload ->> 'itemVersion')::integer
      returning * into v_item;
      if not found then
        raise exception 'appointment item is stale' using errcode = '40001';
      end if;
    end if;
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'item_reference',
        'itemReference', builder_private.appointment_item_json(v_item)
      ),
      'replayed', false
    );

  elsif v_type in ('appointment.outcome.record', 'appointment.outcome.supersede') then
    select *
    into v_session
    from public.builder_appointment_work_sessions
    where site_id = v_site_id
      and id = (v_payload ->> 'workSessionId')::uuid
      and booking_id = v_booking_id
    for update;
    if not found or v_session.version <> v_expected_version then
      raise exception 'appointment work session is stale' using errcode = '40001';
    end if;
    insert into public.builder_appointment_outcomes (
      site_id, id, booking_id, work_session_id, category, reason_code,
      owner_explanation, follow_up_decision, follow_up_reference_type,
      follow_up_reference_id, supersedes_outcome_id, supersession_reason,
      actor_id, occurred_at, idempotency_key
    ) values (
      v_site_id,
      (v_payload ->> 'outcomeId')::uuid,
      v_booking_id,
      v_session.id,
      v_payload ->> 'category',
      v_payload ->> 'reasonCode',
      v_payload ->> 'ownerExplanation',
      v_payload ->> 'followUpDecision',
      v_payload ->> 'followUpReferenceType',
      (v_payload ->> 'followUpReferenceId')::uuid,
      case when v_type = 'appointment.outcome.supersede'
        then (v_payload ->> 'supersedesOutcomeId')::uuid
      end,
      case when v_type = 'appointment.outcome.supersede'
        then v_payload ->> 'supersessionReason'
      end,
      v_actor_id,
      clock_timestamp(),
      p_request ->> 'idempotencyKey'
    )
    returning * into v_outcome;
    update public.builder_appointment_work_sessions
    set outcome_id = v_outcome.id,
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_session.id
    returning * into v_session;
    if v_outcome.follow_up_reference_id is not null then
      insert into public.builder_booking_follow_up_links (
        site_id, booking_id, work_session_id, outcome_id, follow_up_kind,
        follow_up_resource_id, created_by
      ) values (
        v_site_id,
        v_booking_id,
        v_session.id,
        v_outcome.id,
        case v_outcome.follow_up_reference_type
          when 'task' then 'task'
          when 'booking_request' then 'booking_request'
          else 'reminder_plan'
        end,
        v_outcome.follow_up_reference_id,
        v_actor_id
      );
    end if;
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'appointment_outcome',
        'outcome', to_jsonb(v_outcome),
        'workSession', builder_private.appointment_session_json(v_session)
      ),
      'replayed', false
    );

  else
    select *
    into v_session
    from public.builder_appointment_work_sessions
    where site_id = v_site_id
      and id = (v_payload ->> 'sessionId')::uuid
      and booking_id = v_booking_id
    for update;
    if not found or v_session.version <> v_expected_version then
      raise exception 'appointment work session is stale' using errcode = '40001';
    end if;
    if v_type = 'appointment.session.update' then
      if v_session.state <> 'in_progress' then
        raise exception 'only an active appointment can resume'
          using errcode = '22023';
      end if;
      update public.builder_appointment_work_sessions
      set resumed_at = clock_timestamp(),
          version = version + 1,
          updated_at = clock_timestamp()
      where site_id = v_site_id and id = v_session.id
      returning * into v_session;
    else
      if v_session.state <> 'in_progress' then
        raise exception 'only an active appointment can end'
          using errcode = '22023';
      end if;
      update public.builder_appointment_work_sessions
      set state = 'ended',
          ended_at = clock_timestamp(),
          ended_by = v_actor_id,
          administrative_end_reason = v_payload ->> 'administrativeEndReason',
          version = version + 1,
          updated_at = clock_timestamp()
      where site_id = v_site_id and id = v_session.id
      returning * into v_session;
    end if;
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'applied',
      'effect', jsonb_build_object(
        'kind', 'work_session',
        'workSession', builder_private.appointment_session_json(v_session)
      ),
      'replayed', false
    );
  end if;

  return builder_private.complete_operational_command_v1(
    p_request,
    'growth.appointment.command.v1',
    v_result
  );
end;
$$;

create function public.builder_promote_appointment_item_preference_v1(
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_payload jsonb := p_request -> 'payload';
  v_actor_id uuid;
  v_item public.builder_appointment_item_references%rowtype;
  v_preference public.builder_customer_item_preferences%rowtype;
  v_claim jsonb;
  v_result jsonb;
begin
  perform builder_private.assert_booking_command_envelope(
    p_request,
    'customer.item_preference.promote'
  );
  v_actor_id := builder_private.booking_command_actor_id(p_request, false, false);
  select *
  into v_item
  from public.builder_appointment_item_references
  where site_id = v_site_id
    and id = (v_payload ->> 'itemReferenceId')::uuid;
  if not found
    or not builder_private.booking_member_action_allowed(
      v_site_id,
      v_actor_id,
      'bookings.update',
      v_item.booking_id
    )
    or not builder_private.module_action_allowed(
      v_site_id,
      'growth.customers',
      'write'
    )
    or not builder_private.member_can_access_growth_record(
      v_site_id,
      v_actor_id,
      'customers.update',
      'customer',
      (v_payload ->> 'contactId')::uuid
    )
  then
    raise exception 'item preference promotion is not authorized'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.builder_bookings booking
    where booking.site_id = v_site_id
      and booking.id = v_item.booking_id
      and booking.contact_id = (v_payload ->> 'contactId')::uuid
  ) then
    raise exception 'item preference customer mismatch' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.builder_contacts contact
    where contact.site_id = v_site_id
      and contact.id = (v_payload ->> 'contactId')::uuid
      and contact.version = (v_payload ->> 'expectedCustomerVersion')::integer
  ) then
    raise exception 'customer item preference is stale' using errcode = '40001';
  end if;

  v_claim := builder_private.claim_operational_command_v1(
    p_request,
    'growth.appointment.item-preference.promote.v1'
  );
  if v_claim ->> 'status' = 'replay' then
    return builder_private.booking_replay_result(v_claim);
  end if;

  insert into public.builder_customer_item_preferences (
    site_id, id, contact_id, source_kind, source_instance_id,
    source_configuration_revision, source_stable_id, source_item_revision,
    display_snapshot, preference_state, note, originating_booking_id,
    originating_work_session_id, created_by
  ) values (
    v_site_id,
    (v_payload ->> 'preferenceId')::uuid,
    (v_payload ->> 'contactId')::uuid,
    v_item.source_kind,
    v_item.source_instance_id,
    v_item.source_configuration_revision,
    v_item.source_stable_id,
    v_item.source_item_revision,
    jsonb_build_object(
      'title', v_item.display_title,
      'thumbnailReference', v_item.thumbnail_reference,
      'metadata', v_item.metadata_snapshot
    ),
    'active',
    v_payload ->> 'note',
    v_item.booking_id,
    v_item.work_session_id,
    v_actor_id
  )
  on conflict (
    site_id, contact_id, source_kind, source_instance_id, source_stable_id
  ) do update
  set preference_state = excluded.preference_state,
      note = excluded.note,
      display_snapshot = excluded.display_snapshot,
      archived_at = null,
      version = public.builder_customer_item_preferences.version + 1,
      updated_at = clock_timestamp()
  returning * into v_preference;

  v_result := jsonb_build_object(
    'version', 1,
    'status', 'applied',
    'effect', jsonb_build_object(
      'kind', 'customer_item_preference',
      'preference', jsonb_build_object(
        'preferenceId', v_preference.id,
        'contactId', v_preference.contact_id,
        'preferenceState', v_preference.preference_state,
        'sourceKind', v_preference.source_kind,
        'sourceStableId', v_preference.source_stable_id,
        'version', v_preference.version
      )
    ),
    'replayed', false
  );
  return builder_private.complete_operational_command_v1(
    p_request,
    'growth.appointment.item-preference.promote.v1',
    v_result
  );
end;
$$;

revoke all on function builder_private.appointment_session_json(public.builder_appointment_work_sessions)
  from public, anon, authenticated;
revoke all on function builder_private.appointment_item_json(public.builder_appointment_item_references)
  from public, anon, authenticated;
grant execute on function builder_private.appointment_session_json(public.builder_appointment_work_sessions)
  to service_role;
grant execute on function builder_private.appointment_item_json(public.builder_appointment_item_references)
  to service_role;
revoke all on function public.builder_apply_appointment_command_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_apply_appointment_command_v1(jsonb) to service_role;
revoke all on function public.builder_promote_appointment_item_preference_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_promote_appointment_item_preference_v1(jsonb) to service_role;

create function builder_private.booking_reminder_plan_json(
  p_plan public.builder_booking_reminder_plans
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'siteId', p_plan.site_id,
    'planId', p_plan.id,
    'bookingId', p_plan.booking_id,
    'customerId', p_plan.contact_id,
    'serviceId', p_plan.service_id,
    'outcomeId', p_plan.outcome_id,
    'appointmentItemReferenceId', p_plan.appointment_item_reference_id,
    'customerPreferenceId', p_plan.customer_preference_id,
    'participantRole', p_plan.participant_role,
    'consentSubjectId', p_plan.consent_subject_id,
    'contactPointReference', p_plan.contact_point_reference,
    'purpose', p_plan.purpose,
    'scheduleKind', p_plan.schedule_kind,
    'state', p_plan.state,
    'channel', p_plan.channel,
    'customerTimeZone', p_plan.customer_time_zone,
    'timeZoneSource', p_plan.time_zone_source,
    'publishedRevisionId', case
      when p_plan.state = 'draft' then null
      else p_plan.published_revision_id
    end,
    'resolvedConfiguration', case
      when p_plan.state = 'draft' then null
      else p_plan.resolved_configuration
    end,
    'sourceRevisionLineage', case
      when p_plan.state = 'draft' then null
      else jsonb_build_array(
        jsonb_build_object(
          'scope', 'business',
          'revisionId', p_plan.business_default_revision_id
        ),
        jsonb_build_object(
          'scope', 'service',
          'revisionId', p_plan.service_default_revision_id
        ),
        jsonb_build_object(
          'scope', 'customer',
          'revisionId', p_plan.customer_override_revision_id
        ),
        jsonb_build_object(
          'scope', 'booking',
          'revisionId', p_plan.booking_override_revision_id
        )
      )
    end,
    'nextOccurrenceAt', p_plan.next_occurrence_at,
    'version', p_plan.version
  ));
$$;

create function builder_private.booking_reminder_base_allowed(
  p_site_id uuid,
  p_actor_id uuid,
  p_booking_id uuid,
  p_contact_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
begin
  if p_booking_id is not null then
    return builder_private.booking_member_action_allowed(
      p_site_id,
      p_actor_id,
      'bookings.update',
      p_booking_id
    );
  end if;
  return builder_private.dependent_action_allowed(
      p_site_id,
      'growth.customers',
      'growth.bookings',
      'write'
    )
    and builder_private.member_can_access_growth_record(
      p_site_id,
      p_actor_id,
      'customers.update',
      'customer',
      p_contact_id
    );
end;
$$;

create function builder_private.booking_reminder_send_allowed(
  p_site_id uuid,
  p_actor_id uuid,
  p_booking_id uuid,
  p_contact_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
begin
  if builder_private.member_has_capability(
    p_site_id,
    p_actor_id,
    'messages.send',
    'site'
  ) then
    return true;
  end if;
  if not builder_private.member_has_capability(
    p_site_id,
    p_actor_id,
    'messages.send',
    'assigned'
  ) then
    return false;
  end if;
  return builder_private.booking_reminder_base_allowed(
    p_site_id,
    p_actor_id,
    p_booking_id,
    p_contact_id
  );
end;
$$;

create function builder_private.booking_reminder_block_reason(
  p_site_id uuid,
  p_booking_id uuid,
  p_contact_id uuid,
  p_participant_role text,
  p_contact_point_reference uuid,
  p_channel text,
  p_purpose text
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_consent_purpose text;
  v_booking public.builder_bookings%rowtype;
begin
  if not builder_private.dependent_action_allowed(
    p_site_id,
    'growth.customers',
    'growth.bookings',
    'outbound'
  ) then
    return 'entitlement_blocked';
  end if;
  if exists (
    select 1
    from public.builder_emergency_pauses pause
    where pause.site_id = p_site_id
      and pause.active
      and (
        (pause.scope = 'site' and pause.scope_key = p_site_id::text)
        or (pause.scope = 'module' and pause.scope_key = 'growth.bookings')
        or (pause.scope = 'channel' and pause.scope_key = p_channel)
      )
  ) then
    return 'emergency_pause';
  end if;
  if exists (
    select 1
    from public.builder_suppressions suppression
    where suppression.site_id = p_site_id
      and suppression.contact_id = p_contact_id
      and suppression.channel = p_channel
      and suppression.active
  ) then
    return 'recipient_suppressed';
  end if;
  if not exists (
    select 1
    from public.builder_contact_identities identity
    where identity.site_id = p_site_id
      and identity.id = p_contact_point_reference
      and identity.contact_id = p_contact_id
      and identity.kind = case p_channel when 'email' then 'email' else 'phone' end
      and identity.verification_state <> 'invalid'
  ) then
    return 'contact_point_invalid';
  end if;
  if p_purpose = 'appointment_required' then
    if p_booking_id is null then
      return 'appointment_authority_missing';
    end if;
    select *
    into v_booking
    from public.builder_bookings
    where site_id = p_site_id and id = p_booking_id;
    if not found
      or v_booking.status not in ('approved', 'confirmed', 'checked_in')
      or not (
        (
          v_booking.contact_id = p_contact_id
          and p_participant_role = 'primary_customer'
        )
        or exists (
          select 1
          from public.builder_booking_participants participant
          where participant.site_id = p_site_id
            and participant.booking_id = p_booking_id
            and participant.contact_id = p_contact_id
            and participant.role = p_participant_role
        )
      )
    then
      return 'appointment_authority_missing';
    end if;
    return null;
  end if;

  v_consent_purpose := case p_channel
    when 'email' then 'marketing_email'
    else 'marketing_sms'
  end;
  if not exists (
    select 1
    from public.builder_consents consent
    where consent.site_id = p_site_id
      and consent.contact_id = p_contact_id
      and consent.channel = p_channel
      and consent.purpose = v_consent_purpose
      and consent.state = 'granted'
      and not exists (
        select 1
        from public.builder_consents later
        where later.site_id = consent.site_id
          and later.contact_id = consent.contact_id
          and later.channel = consent.channel
          and later.purpose = consent.purpose
          and later.captured_at > consent.captured_at
      )
  ) then
    return 'consent_missing';
  end if;
  return null;
end;
$$;

create function public.builder_apply_booking_reminder_command_v1(
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_type text := p_request ->> 'type';
  v_payload jsonb := p_request -> 'payload';
  v_actor_id uuid;
  v_plan public.builder_booking_reminder_plans%rowtype;
  v_claim jsonb;
  v_result jsonb;
  v_expected_version integer;
  v_target_state text;
  v_revision_number integer;
begin
  perform builder_private.assert_booking_command_envelope(p_request, v_type);
  if v_type not in (
    'reminder.plan.create_draft', 'reminder.plan.update_draft',
    'reminder.plan.publish',
    'reminder.plan.activate', 'reminder.plan.migrate',
    'reminder.plan.pause', 'reminder.plan.resume',
    'reminder.plan.complete', 'reminder.plan.reactivate',
    'reminder.plan.resolve_review', 'reminder.plan.cancel'
  ) then
    raise exception 'unknown reminder command type' using errcode = '22023';
  end if;
  v_actor_id := builder_private.booking_command_actor_id(p_request, false, false);

  if v_type = 'reminder.plan.create_draft' then
    if p_request ? 'expectedVersion' then
      raise exception 'expectedVersion is forbidden for reminder draft'
        using errcode = '22023';
    end if;
    if not builder_private.booking_reminder_base_allowed(
      v_site_id,
      v_actor_id,
      (v_payload ->> 'bookingId')::uuid,
      (v_payload ->> 'contactId')::uuid
    ) then
      raise exception 'reminder base authority is required' using errcode = '42501';
    end if;
    if coalesce(v_payload #>> '{resolvedConfiguration,purpose}', '')
      <> coalesce(v_payload ->> 'purpose', '')
    then
      raise exception 'resolved reminder purpose does not match the plan'
        using errcode = '22023';
    end if;
  else
    if not p_request ? 'expectedVersion'
      or (p_request ->> 'expectedVersion')::integer < 1
    then
      raise exception 'expectedVersion is required' using errcode = '22023';
    end if;
    v_expected_version := (p_request ->> 'expectedVersion')::integer;
    select *
    into v_plan
    from public.builder_booking_reminder_plans
    where site_id = v_site_id
      and id = (v_payload ->> 'planId')::uuid
    for update;
    if not found then
      raise exception 'reminder plan is stale' using errcode = '40001';
    end if;
    if not builder_private.booking_reminder_base_allowed(
      v_site_id,
      v_actor_id,
      v_plan.booking_id,
      v_plan.contact_id
    ) then
      raise exception 'reminder base authority is required' using errcode = '42501';
    end if;
    if coalesce(
      v_payload #>> '{resolvedConfiguration,purpose}',
      v_plan.resolved_configuration ->> 'purpose',
      ''
    ) <> v_plan.purpose then
      raise exception 'resolved reminder purpose does not match the plan'
        using errcode = '22023';
    end if;
  end if;

  if v_type in (
    'reminder.plan.publish', 'reminder.plan.activate',
    'reminder.plan.migrate', 'reminder.plan.resume',
    'reminder.plan.reactivate', 'reminder.plan.resolve_review'
  ) and not builder_private.booking_reminder_send_allowed(
    v_site_id,
    v_actor_id,
    case when v_type = 'reminder.plan.create_draft'
      then (v_payload ->> 'bookingId')::uuid
      else v_plan.booking_id
    end,
    case when v_type = 'reminder.plan.create_draft'
      then (v_payload ->> 'contactId')::uuid
      else v_plan.contact_id
    end
  ) then
    raise exception 'messages.send capability is required' using errcode = '42501';
  end if;

  v_claim := builder_private.claim_operational_command_v1(
    p_request,
    'growth.booking.reminder-command.v1'
  );
  if v_claim ->> 'status' = 'replay' then
    return builder_private.booking_replay_result(v_claim);
  end if;

  if v_type <> 'reminder.plan.create_draft'
    and v_plan.version <> v_expected_version
  then
    raise exception 'reminder plan is stale' using errcode = '40001';
  end if;

  if v_type = 'reminder.plan.create_draft' then
    insert into public.builder_booking_reminder_plans (
      site_id, id, booking_id, contact_id, service_id, outcome_id,
      appointment_item_reference_id, customer_preference_id,
      participant_role, consent_subject_id, contact_point_reference,
      customer_time_zone, time_zone_source, purpose, schedule_kind,
      state, channel, resolved_configuration,
      business_default_revision_id, service_default_revision_id,
      customer_override_revision_id, booking_override_revision_id,
      next_occurrence_at, idempotency_key, created_by
    ) values (
      v_site_id,
      (v_payload ->> 'planId')::uuid,
      (v_payload ->> 'bookingId')::uuid,
      (v_payload ->> 'contactId')::uuid,
      (v_payload ->> 'serviceId')::uuid,
      (v_payload ->> 'outcomeId')::uuid,
      (v_payload ->> 'appointmentItemReferenceId')::uuid,
      (v_payload ->> 'customerPreferenceId')::uuid,
      v_payload ->> 'participantRole',
      (v_payload ->> 'consentSubjectId')::uuid,
      (v_payload ->> 'contactPointReference')::uuid,
      v_payload ->> 'customerTimeZone',
      v_payload ->> 'timeZoneSource',
      v_payload ->> 'purpose',
      v_payload ->> 'scheduleKind',
      'draft',
      v_payload ->> 'channel',
      v_payload -> 'resolvedConfiguration',
      (v_payload ->> 'businessDefaultRevisionId')::uuid,
      (v_payload ->> 'serviceDefaultRevisionId')::uuid,
      (v_payload ->> 'customerOverrideRevisionId')::uuid,
      (v_payload ->> 'bookingOverrideRevisionId')::uuid,
      (v_payload ->> 'nextOccurrenceAt')::timestamptz,
      p_request ->> 'idempotencyKey',
      v_actor_id
    )
    returning * into v_plan;
  elsif v_type = 'reminder.plan.update_draft' then
    if v_plan.state <> 'draft' then
      raise exception 'only reminder drafts can be updated' using errcode = '22023';
    end if;
    update public.builder_booking_reminder_plans
    set resolved_configuration = coalesce(
          v_payload -> 'resolvedConfiguration',
          resolved_configuration
        ),
        participant_role = coalesce(v_payload ->> 'participantRole', participant_role),
        consent_subject_id = coalesce(
          (v_payload ->> 'consentSubjectId')::uuid,
          consent_subject_id
        ),
        contact_point_reference = coalesce(
          (v_payload ->> 'contactPointReference')::uuid,
          contact_point_reference
        ),
        customer_time_zone = coalesce(
          v_payload ->> 'customerTimeZone',
          customer_time_zone
        ),
        time_zone_source = coalesce(v_payload ->> 'timeZoneSource', time_zone_source),
        business_default_revision_id = coalesce(
          (v_payload ->> 'businessDefaultRevisionId')::uuid,
          business_default_revision_id
        ),
        service_default_revision_id = coalesce(
          (v_payload ->> 'serviceDefaultRevisionId')::uuid,
          service_default_revision_id
        ),
        customer_override_revision_id = coalesce(
          (v_payload ->> 'customerOverrideRevisionId')::uuid,
          customer_override_revision_id
        ),
        booking_override_revision_id = coalesce(
          (v_payload ->> 'bookingOverrideRevisionId')::uuid,
          booking_override_revision_id
        ),
        next_occurrence_at = coalesce(
          (v_payload ->> 'nextOccurrenceAt')::timestamptz,
          next_occurrence_at
        ),
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_plan.id
    returning * into v_plan;
  else
    v_target_state := case v_type
      when 'reminder.plan.publish' then 'published'
      when 'reminder.plan.activate' then 'active'
      when 'reminder.plan.migrate' then 'published'
      when 'reminder.plan.pause' then 'paused'
      when 'reminder.plan.resume' then 'active'
      when 'reminder.plan.complete' then 'completed'
      when 'reminder.plan.reactivate' then 'active'
      when 'reminder.plan.resolve_review' then 'published'
      when 'reminder.plan.cancel' then 'cancelled'
    end;
    if v_type = 'reminder.plan.activate'
      and v_plan.state <> 'published'
    then
      raise exception 'reminder plan cannot be activated' using errcode = '22023';
    end if;
    if v_type = 'reminder.plan.resume' and v_plan.state <> 'paused' then
      raise exception 'reminder plan is not paused' using errcode = '22023';
    end if;
    if v_type = 'reminder.plan.reactivate'
      and v_plan.state <> 'suppressed'
    then
      raise exception 'reminder plan cannot be reactivated' using errcode = '22023';
    end if;
    if v_type = 'reminder.plan.publish' and v_plan.state <> 'draft' then
      raise exception 'only reminder drafts can be published' using errcode = '22023';
    end if;
    if v_type = 'reminder.plan.migrate'
      and v_plan.state not in ('active', 'paused', 'suppressed', 'failed_review')
    then
      raise exception 'reminder plan cannot be migrated' using errcode = '22023';
    end if;
    if v_type = 'reminder.plan.pause' and v_plan.state <> 'active' then
      raise exception 'only active reminder plans can be paused' using errcode = '22023';
    end if;
    if v_type = 'reminder.plan.complete'
      and v_plan.state not in ('published', 'active', 'paused')
    then
      raise exception 'reminder plan cannot be completed' using errcode = '22023';
    end if;
    if v_type = 'reminder.plan.resolve_review'
      and v_plan.state <> 'failed_review'
    then
      raise exception 'reminder review cannot be resolved' using errcode = '22023';
    end if;
    if v_type = 'reminder.plan.cancel'
      and v_plan.state not in (
        'draft', 'published', 'active', 'paused', 'suppressed', 'failed_review'
      )
    then
      raise exception 'reminder plan cannot be cancelled' using errcode = '22023';
    end if;

    if v_type in ('reminder.plan.publish', 'reminder.plan.migrate')
      or (
        v_type = 'reminder.plan.resolve_review'
        and v_payload ? 'publishedRevisionId'
      )
    then
      select coalesce(max(revision_number), 0) + 1
      into v_revision_number
      from public.builder_booking_reminder_plan_revisions
      where site_id = v_site_id and plan_id = v_plan.id;

      insert into public.builder_booking_reminder_plan_revisions (
        site_id, id, plan_id, revision_number, previous_revision_id,
        resolved_configuration, business_default_revision_id,
        service_default_revision_id, customer_override_revision_id,
        booking_override_revision_id, created_by
      ) values (
        v_site_id,
        (v_payload ->> 'publishedRevisionId')::uuid,
        v_plan.id,
        v_revision_number,
        v_plan.published_revision_id,
        case
          when v_type = 'reminder.plan.migrate'
            then v_payload -> 'resolvedConfiguration'
          else v_plan.resolved_configuration
        end,
        case
          when v_type = 'reminder.plan.migrate'
            then (v_payload ->> 'businessDefaultRevisionId')::uuid
          else v_plan.business_default_revision_id
        end,
        case
          when v_type = 'reminder.plan.migrate'
            then (v_payload ->> 'serviceDefaultRevisionId')::uuid
          else v_plan.service_default_revision_id
        end,
        case
          when v_type = 'reminder.plan.migrate'
            then (v_payload ->> 'customerOverrideRevisionId')::uuid
          else v_plan.customer_override_revision_id
        end,
        case
          when v_type = 'reminder.plan.migrate'
            then (v_payload ->> 'bookingOverrideRevisionId')::uuid
          else v_plan.booking_override_revision_id
        end,
        v_actor_id
      );
    end if;

    update public.builder_booking_reminder_plans
    set state = v_target_state,
        published_revision_id = case
          when v_type in ('reminder.plan.publish', 'reminder.plan.migrate')
            or (
              v_type = 'reminder.plan.resolve_review'
              and v_payload ? 'publishedRevisionId'
            )
            then (v_payload ->> 'publishedRevisionId')::uuid
          else published_revision_id
        end,
        resolved_configuration = case
          when v_type = 'reminder.plan.migrate'
            then v_payload -> 'resolvedConfiguration'
          else resolved_configuration
        end,
        business_default_revision_id = case
          when v_type = 'reminder.plan.migrate'
            then (v_payload ->> 'businessDefaultRevisionId')::uuid
          else business_default_revision_id
        end,
        service_default_revision_id = case
          when v_type = 'reminder.plan.migrate'
            then (v_payload ->> 'serviceDefaultRevisionId')::uuid
          else service_default_revision_id
        end,
        customer_override_revision_id = case
          when v_type = 'reminder.plan.migrate'
            then (v_payload ->> 'customerOverrideRevisionId')::uuid
          else customer_override_revision_id
        end,
        booking_override_revision_id = case
          when v_type = 'reminder.plan.migrate'
            then (v_payload ->> 'bookingOverrideRevisionId')::uuid
          else booking_override_revision_id
        end,
        next_occurrence_at = coalesce(
          (v_payload ->> 'nextOccurrenceAt')::timestamptz,
          next_occurrence_at
        ),
        activated_at = case
          when v_target_state = 'active' then clock_timestamp()
          else activated_at
        end,
        paused_at = case
          when v_target_state = 'paused' then clock_timestamp()
          when v_target_state = 'active' then null
          else paused_at
        end,
        completed_at = case
          when v_target_state = 'completed' then clock_timestamp()
          when v_target_state = 'active' then null
          else completed_at
        end,
        cancelled_at = case
          when v_target_state = 'cancelled' then clock_timestamp()
          when v_target_state = 'active' then null
          else cancelled_at
        end,
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_plan.id
    returning * into v_plan;
  end if;

  v_result := jsonb_build_object(
    'version', 1,
    'status', 'applied',
    'effect', jsonb_build_object(
      'kind', 'reminder_plan',
      'plan', builder_private.booking_reminder_plan_json(v_plan)
    ),
    'replayed', false
  );
  return builder_private.complete_operational_command_v1(
    p_request,
    'growth.booking.reminder-command.v1',
    v_result
  );
end;
$$;

create function public.builder_skip_booking_reminder_occurrence_v1(
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_payload jsonb := p_request -> 'payload';
  v_actor_id uuid;
  v_occurrence public.builder_booking_reminder_occurrences%rowtype;
  v_plan public.builder_booking_reminder_plans%rowtype;
  v_from_state text;
  v_claim jsonb;
  v_result jsonb;
begin
  perform builder_private.assert_booking_command_envelope(
    p_request,
    'reminder.plan.skip_occurrence'
  );
  if not p_request ? 'expectedVersion' then
    raise exception 'expectedVersion is required' using errcode = '22023';
  end if;
  v_actor_id := builder_private.booking_command_actor_id(p_request, false, false);
  select *
  into v_occurrence
  from public.builder_booking_reminder_occurrences
  where site_id = v_site_id
    and id = (v_payload ->> 'occurrenceId')::uuid
    and plan_id = (v_payload ->> 'planId')::uuid
  for update;
  if not found
    or v_occurrence.recipient_contact_id
      <> (v_payload ->> 'recipientContactId')::uuid
  then
    raise exception 'reminder occurrence is stale or terminal'
      using errcode = '40001';
  end if;
  select *
  into v_plan
  from public.builder_booking_reminder_plans
  where site_id = v_site_id and id = v_occurrence.plan_id;
  if not builder_private.booking_reminder_base_allowed(
    v_site_id,
    v_actor_id,
    v_plan.booking_id,
    v_plan.contact_id
  ) then
    raise exception 'reminder base authority is required' using errcode = '42501';
  end if;

  v_claim := builder_private.claim_operational_command_v1(
    p_request,
    'growth.booking.reminder-occurrence.skip.v1'
  );
  if v_claim ->> 'status' = 'replay' then
    return builder_private.booking_replay_result(v_claim);
  end if;
  if v_occurrence.version <> (p_request ->> 'expectedVersion')::integer
    or v_occurrence.state not in (
      'scheduled', 'held_for_quiet_hours', 'ready', 'claimed'
    )
  then
    raise exception 'reminder occurrence is stale or terminal'
      using errcode = '40001';
  end if;

  v_from_state := v_occurrence.state;
  update public.builder_booking_reminder_occurrences
  set state = 'skipped',
      skip_reason = v_payload ->> 'reason',
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      version = version + 1,
      updated_at = clock_timestamp()
  where site_id = v_site_id and id = v_occurrence.id
  returning * into v_occurrence;
  insert into public.builder_booking_reminder_occurrence_events (
    site_id, occurrence_id, plan_id, event_type, from_state, to_state,
    reason_code, idempotency_key, occurred_at
  ) values (
    v_site_id,
    v_occurrence.id,
    v_occurrence.plan_id,
    'skipped',
    v_from_state,
    'skipped',
    'owner_skip',
    (p_request ->> 'idempotencyKey') || ':event',
    clock_timestamp()
  );
  v_result := jsonb_build_object(
    'version', 1,
    'status', 'applied',
    'effect', jsonb_build_object(
      'kind', 'reminder_occurrence',
      'occurrence', to_jsonb(v_occurrence)
    ),
    'replayed', false
  );
  return builder_private.complete_operational_command_v1(
    p_request,
    'growth.booking.reminder-occurrence.skip.v1',
    v_result
  );
end;
$$;

create function public.builder_expire_booking_holds_v1(
  p_site_id uuid,
  p_now timestamptz,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  with candidates as (
    select site_id, id
    from public.builder_booking_holds
    where site_id = p_site_id
      and state = 'active'
      and expires_at <= p_now
    order by expires_at, id
    for update skip locked
    limit greatest(1, least(p_limit, 500))
  )
  update public.builder_booking_holds hold
  set state = 'expired',
      version = hold.version + 1,
      updated_at = clock_timestamp()
  from candidates
  where hold.site_id = candidates.site_id and hold.id = candidates.id;
  get diagnostics v_count = row_count;
  return jsonb_build_object('version', 1, 'expiredCount', v_count);
end;
$$;

create function public.builder_materialize_booking_reminder_occurrences_v1(
  p_site_id uuid,
  p_now timestamptz,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_plan public.builder_booking_reminder_plans%rowtype;
  v_occurrence public.builder_booking_reminder_occurrences%rowtype;
  v_reason text;
  v_state text;
  v_appointment_starts_at timestamptz;
  v_latest_send_at timestamptz;
  v_recurrence_anchor timestamp;
  v_template_revision_id uuid;
  v_count integer := 0;
begin
  for v_plan in
    select plan.*
    from public.builder_booking_reminder_plans plan
    where plan.site_id = p_site_id
      and plan.state = 'active'
      and plan.next_occurrence_at is not null
      and plan.next_occurrence_at <= p_now
    order by plan.next_occurrence_at, plan.id
    for update skip locked
    limit greatest(1, least(p_limit, 500))
  loop
    v_reason := builder_private.booking_reminder_block_reason(
      v_plan.site_id,
      v_plan.booking_id,
      v_plan.contact_id,
      v_plan.participant_role,
      v_plan.contact_point_reference,
      v_plan.channel,
      v_plan.purpose
    );
    select booking.starts_at
    into v_appointment_starts_at
    from public.builder_bookings booking
    where booking.site_id = v_plan.site_id and booking.id = v_plan.booking_id;
    v_latest_send_at := coalesce(
      (v_plan.resolved_configuration ->> 'latestSendAt')::timestamptz,
      case
        when v_plan.purpose = 'appointment_required' then v_appointment_starts_at
        else v_plan.next_occurrence_at + interval '1 hour'
      end
    );
    v_recurrence_anchor := coalesce(
      (v_plan.resolved_configuration ->> 'recurrenceAnchor')::timestamp,
      v_plan.next_occurrence_at at time zone v_plan.customer_time_zone
    );
    v_template_revision_id :=
      (v_plan.resolved_configuration ->> 'templateRevisionId')::uuid;
    if v_plan.published_revision_id is null
      or v_latest_send_at is null
      or v_template_revision_id is null
    then
      raise exception 'published reminder evidence is incomplete'
        using errcode = '23514';
    end if;
    v_state := case when v_reason is null then 'ready' else 'suppressed' end;
    insert into public.builder_booking_reminder_occurrences (
      site_id, plan_id, plan_revision_id, booking_id, recipient_contact_id,
      participant_role, consent_subject_id, contact_point_reference, channel,
      customer_time_zone, time_zone_source, intended_local_time, purpose,
      scheduled_for, latest_send_at, appointment_starts_at, recurrence_anchor,
      template_revision_id, state, decision_evidence, resolved_lineage,
      idempotency_key, skip_reason
    ) values (
      v_plan.site_id,
      v_plan.id,
      v_plan.published_revision_id,
      v_plan.booking_id,
      v_plan.contact_id,
      v_plan.participant_role,
      v_plan.consent_subject_id,
      v_plan.contact_point_reference,
      v_plan.channel,
      v_plan.customer_time_zone,
      v_plan.time_zone_source,
      v_plan.next_occurrence_at at time zone v_plan.customer_time_zone,
      v_plan.purpose,
      v_plan.next_occurrence_at,
      v_latest_send_at,
      v_appointment_starts_at,
      v_recurrence_anchor,
      v_template_revision_id,
      v_state,
      jsonb_build_object(
        'evaluatedAt', p_now,
        'eligible', v_reason is null,
        'reasonCode', v_reason,
        'consent', case when v_reason = 'consent_missing' then 'blocked' else 'eligible' end,
        'suppression', case when v_reason = 'recipient_suppressed' then 'blocked' else 'clear' end
      ),
      jsonb_build_object(
        'businessDefaultRevisionId', v_plan.business_default_revision_id,
        'serviceDefaultRevisionId', v_plan.service_default_revision_id,
        'customerOverrideRevisionId', v_plan.customer_override_revision_id,
        'bookingOverrideRevisionId', v_plan.booking_override_revision_id,
        'planRevisionId', v_plan.published_revision_id,
        'planVersion', v_plan.version
      ),
      'reminder:' || v_plan.id::text || ':' || v_plan.next_occurrence_at::text,
      v_reason
    )
    on conflict (site_id, plan_id, recipient_contact_id, scheduled_for)
      do nothing
    returning * into v_occurrence;
    if found then
      insert into public.builder_booking_reminder_occurrence_events (
        site_id, occurrence_id, plan_id, event_type, from_state, to_state,
        reason_code, idempotency_key, occurred_at
      ) values (
        v_plan.site_id,
        v_occurrence.id,
        v_plan.id,
        case when v_state = 'ready' then 'materialized' else 'suppressed' end,
        null,
        v_state,
        v_reason,
        v_occurrence.idempotency_key || ':materialized',
        clock_timestamp()
      );
      v_count := v_count + 1;
    end if;
    update public.builder_booking_reminder_plans
    set next_occurrence_at = case
          when schedule_kind = 'interval_days' then next_occurrence_at
            + make_interval(days => greatest(1, least(
                coalesce((resolved_configuration ->> 'interval')::integer, 1),
                365
              )))
          when schedule_kind = 'interval_weeks' then next_occurrence_at
            + make_interval(weeks => greatest(1, least(
                coalesce((resolved_configuration ->> 'interval')::integer, 1),
                52
              )))
          when schedule_kind = 'interval_months' then next_occurrence_at
            + make_interval(months => greatest(1, least(
                coalesce((resolved_configuration ->> 'interval')::integer, 1),
                24
              )))
          when schedule_kind = 'interval_years' then next_occurrence_at
            + make_interval(years => greatest(1, least(
                coalesce((resolved_configuration ->> 'interval')::integer, 1),
                10
              )))
          when schedule_kind in ('monthly_day_of_month', 'monthly_weekday')
            then next_occurrence_at + interval '1 month'
          when schedule_kind = 'anniversary' then next_occurrence_at + interval '1 year'
          else null
        end,
        updated_at = clock_timestamp()
    where site_id = v_plan.site_id and id = v_plan.id;
  end loop;
  return jsonb_build_object('version', 1, 'materializedCount', v_count);
end;
$$;

create function public.builder_claim_booking_reminder_occurrences_v1(
  p_site_id uuid,
  p_worker text,
  p_now timestamptz,
  p_lease_seconds integer,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_occurrence public.builder_booking_reminder_occurrences%rowtype;
  v_reason text;
  v_items jsonb := '[]'::jsonb;
  v_token uuid;
begin
  if p_site_id is null
    or nullif(trim(p_worker), '') is null
    or p_lease_seconds not between 1 and 3600
    or p_limit not between 1 and 100
  then
    raise exception 'invalid reminder occurrence claim' using errcode = '22023';
  end if;
  for v_occurrence in
    select occurrence.*
    from public.builder_booking_reminder_occurrences occurrence
    join public.builder_booking_reminder_plans plan
      on plan.site_id = occurrence.site_id and plan.id = occurrence.plan_id
    where occurrence.site_id = p_site_id
      and plan.state = 'active'
      and occurrence.scheduled_for <= p_now
      and (
        occurrence.state = 'ready'
        or (
          occurrence.state = 'claimed'
          and occurrence.lease_expires_at < p_now
        )
      )
    order by occurrence.scheduled_for, occurrence.id
    for update of occurrence skip locked
    limit p_limit
  loop
    v_reason := builder_private.booking_reminder_block_reason(
      v_occurrence.site_id,
      v_occurrence.booking_id,
      v_occurrence.recipient_contact_id,
      v_occurrence.participant_role,
      v_occurrence.contact_point_reference,
      v_occurrence.channel,
      v_occurrence.purpose
    );
    if v_reason is not null then
      update public.builder_booking_reminder_occurrences
      set state = 'suppressed',
          skip_reason = v_reason,
          lease_owner = null,
          lease_token = null,
          lease_expires_at = null,
          version = version + 1,
          updated_at = clock_timestamp()
      where site_id = v_occurrence.site_id and id = v_occurrence.id;
      insert into public.builder_booking_reminder_occurrence_events (
        site_id, occurrence_id, plan_id, event_type, from_state, to_state,
        reason_code, idempotency_key, occurred_at
      ) values (
        v_occurrence.site_id,
        v_occurrence.id,
        v_occurrence.plan_id,
        'suppressed',
        v_occurrence.state,
        'suppressed',
        v_reason,
        v_occurrence.idempotency_key || ':claim-suppressed',
        clock_timestamp()
      ) on conflict (site_id, idempotency_key) do nothing;
      continue;
    end if;
    v_token := gen_random_uuid();
    update public.builder_booking_reminder_occurrences
    set state = 'claimed',
        lease_owner = p_worker,
        lease_token = v_token,
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1,
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_occurrence.site_id and id = v_occurrence.id
    returning * into v_occurrence;
    insert into public.builder_booking_reminder_occurrence_events (
      site_id, occurrence_id, plan_id, event_type, from_state, to_state,
      idempotency_key, occurred_at
    ) values (
      v_occurrence.site_id,
      v_occurrence.id,
      v_occurrence.plan_id,
      'claimed',
      'ready',
      'claimed',
      v_occurrence.idempotency_key || ':claim:' || v_occurrence.attempt_count,
      clock_timestamp()
    );
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'occurrenceId', v_occurrence.id,
      'planId', v_occurrence.plan_id,
      'planRevisionId', v_occurrence.plan_revision_id,
      'bookingId', v_occurrence.booking_id,
      'customerId', v_occurrence.recipient_contact_id,
      'participantRole', v_occurrence.participant_role,
      'consentSubjectId', v_occurrence.consent_subject_id,
      'contactPointReference', v_occurrence.contact_point_reference,
      'channel', v_occurrence.channel,
      'customerTimeZone', v_occurrence.customer_time_zone,
      'timeZoneSource', v_occurrence.time_zone_source,
      'timeZoneDataVersion', v_occurrence.time_zone_data_version,
      'intendedLocalTime', v_occurrence.intended_local_time,
      'purpose', v_occurrence.purpose,
      'scheduledFor', v_occurrence.scheduled_for,
      'latestSendAt', v_occurrence.latest_send_at,
      'appointmentStartsAt', v_occurrence.appointment_starts_at,
      'recurrenceAnchor', v_occurrence.recurrence_anchor,
      'templateRevisionId', v_occurrence.template_revision_id,
      'decisionEvidence', v_occurrence.decision_evidence,
      'leaseToken', v_token,
      'version', v_occurrence.version
    ));
  end loop;
  return jsonb_build_object('version', 1, 'items', v_items);
end;
$$;

create function public.builder_complete_booking_reminder_occurrence_v1(
  p_site_id uuid,
  p_occurrence_id uuid,
  p_worker text,
  p_lease_token uuid,
  p_expected_version integer,
  p_now timestamptz,
  p_status text,
  p_provider_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_occurrence public.builder_booking_reminder_occurrences%rowtype;
  v_reason text;
  v_final_state text;
begin
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
  if p_status not in ('sent', 'failed_retryable', 'failed_review') then
    raise exception 'invalid reminder occurrence completion status'
      using errcode = '22023';
  end if;
  v_reason := builder_private.booking_reminder_block_reason(
    v_occurrence.site_id,
    v_occurrence.booking_id,
    v_occurrence.recipient_contact_id,
    v_occurrence.participant_role,
    v_occurrence.contact_point_reference,
    v_occurrence.channel,
    v_occurrence.purpose
  );
  v_final_state := case
    when v_reason is not null then 'suppressed'
    else p_status
  end;
  update public.builder_booking_reminder_occurrences
  set state = v_final_state,
      skip_reason = v_reason,
      provider_reference = case
        when v_final_state = 'sent' then p_provider_reference
        else provider_reference
      end,
      failure_reason = case
        when v_final_state in ('failed_retryable', 'failed_review')
          then coalesce(p_provider_reference, 'provider_failure')
        else failure_reason
      end,
      sent_at = case when v_final_state = 'sent' then p_now else sent_at end,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      version = version + 1,
      updated_at = clock_timestamp()
  where site_id = p_site_id and id = p_occurrence_id
  returning * into v_occurrence;
  insert into public.builder_booking_reminder_occurrence_events (
    site_id, occurrence_id, plan_id, event_type, from_state, to_state,
    reason_code, evidence, idempotency_key, occurred_at
  ) values (
    v_occurrence.site_id,
    v_occurrence.id,
    v_occurrence.plan_id,
    v_final_state,
    'claimed',
    v_final_state,
    v_reason,
    jsonb_build_object('providerReference', p_provider_reference),
    v_occurrence.idempotency_key || ':complete:' || v_occurrence.attempt_count,
    p_now
  );
  if v_final_state = 'sent' then
    update public.builder_booking_reminder_plans
    set state = case
          when next_occurrence_at is null
            then 'completed'
          else state
        end,
        completed_at = case
          when next_occurrence_at is null
            then p_now
          else completed_at
        end,
        updated_at = clock_timestamp()
    where site_id = v_occurrence.site_id and id = v_occurrence.plan_id;
  end if;
  return jsonb_build_object(
    'version', 1,
    'status', v_final_state,
    'occurrenceId', v_occurrence.id,
    'occurrenceVersion', v_occurrence.version
  );
end;
$$;

create function public.builder_reconcile_booking_reminder_delivery_v1(
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_payload jsonb := p_request -> 'payload';
  v_target_state text := v_payload ->> 'targetState';
  v_provider_event_key text :=
    'reminder-provider:' || coalesce(v_payload ->> 'providerEventId', '');
  v_claim jsonb;
  v_occurrence public.builder_booking_reminder_occurrences%rowtype;
  v_existing public.builder_booking_reminder_occurrence_events%rowtype;
  v_from_state text;
  v_result jsonb;
begin
  perform builder_private.assert_booking_command_envelope(
    p_request,
    'booking.provider.reminder_delivery.reconcile'
  );
  perform builder_private.booking_command_actor_id(p_request, false, true);

  if coalesce(v_payload ->> 'occurrenceId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or char_length(coalesce(v_payload ->> 'providerEventId', '')) not between 1 and 500
    or coalesce(v_payload ->> 'eventDigest', '') !~ '^[a-f0-9]{64}$'
    or v_target_state not in ('delivered', 'failed_retryable', 'failed_review')
    or char_length(coalesce(v_payload ->> 'providerReference', '')) not between 1 and 500
    or (v_payload ->> 'occurredAt')::timestamptz is null
  then
    raise exception 'invalid booking reminder delivery event'
      using errcode = '22023';
  end if;

  v_claim := builder_private.claim_operational_command_v1(
    p_request,
    'growth.booking.reminder-delivery.reconcile.v1'
  );
  if v_claim ->> 'status' = 'replay' then
    return builder_private.booking_replay_result(v_claim);
  end if;

  select *
  into v_existing
  from public.builder_booking_reminder_occurrence_events
  where site_id = v_site_id and idempotency_key = v_provider_event_key;
  if found then
    if v_existing.evidence ->> 'eventDigest' <> v_payload ->> 'eventDigest'
      or v_existing.occurrence_id <> (v_payload ->> 'occurrenceId')::uuid
    then
      raise exception 'booking reminder provider event conflicts with prior evidence'
        using errcode = '23505';
    end if;
    v_result := jsonb_build_object(
      'version', 1,
      'status', 'replayed',
      'effect', jsonb_build_object(
        'kind', 'reminder_delivery',
        'occurrenceId', v_existing.occurrence_id,
        'state', v_existing.to_state,
        'providerEventId', v_payload ->> 'providerEventId'
      ),
      'replayed', true
    );
    return builder_private.complete_operational_command_v1(
      p_request,
      'growth.booking.reminder-delivery.reconcile.v1',
      v_result
    );
  end if;

  select *
  into v_occurrence
  from public.builder_booking_reminder_occurrences
  where site_id = v_site_id
    and id = (v_payload ->> 'occurrenceId')::uuid
  for update;
  if not found then
    raise exception 'booking reminder occurrence does not exist'
      using errcode = 'P0002';
  end if;
  if not (
    (v_target_state = 'delivered'
      and v_occurrence.state in ('sent', 'failed_retryable'))
    or (
      v_target_state in ('failed_retryable', 'failed_review')
      and v_occurrence.state in ('sent', 'failed_retryable')
    )
  ) then
    raise exception 'booking reminder delivery transition is invalid'
      using errcode = '22023';
  end if;

  v_from_state := v_occurrence.state;
  update public.builder_booking_reminder_occurrences
  set state = v_target_state,
      provider_reference = v_payload ->> 'providerReference',
      failure_reason = case
        when v_target_state in ('failed_retryable', 'failed_review')
          then coalesce(v_payload ->> 'failureReason', 'provider_delivery_failure')
        else null
      end,
      version = version + 1,
      updated_at = clock_timestamp()
  where site_id = v_site_id and id = v_occurrence.id
  returning * into v_occurrence;

  insert into public.builder_booking_reminder_occurrence_events (
    site_id, occurrence_id, plan_id, event_type, from_state, to_state,
    reason_code, evidence, idempotency_key, occurred_at
  ) values (
    v_site_id,
    v_occurrence.id,
    v_occurrence.plan_id,
    v_target_state,
    v_from_state,
    v_target_state,
    case
      when v_target_state = 'delivered' then 'provider_delivered'
      else 'provider_delivery_failure'
    end,
    jsonb_build_object(
      'providerEventId', v_payload ->> 'providerEventId',
      'eventDigest', v_payload ->> 'eventDigest',
      'providerReference', v_payload ->> 'providerReference'
    ),
    v_provider_event_key,
    (v_payload ->> 'occurredAt')::timestamptz
  );

  v_result := jsonb_build_object(
    'version', 1,
    'status', 'applied',
    'effect', jsonb_build_object(
      'kind', 'reminder_delivery',
      'occurrenceId', v_occurrence.id,
      'state', v_occurrence.state,
      'providerEventId', v_payload ->> 'providerEventId'
    ),
    'replayed', false
  );
  return builder_private.complete_operational_command_v1(
    p_request,
    'growth.booking.reminder-delivery.reconcile.v1',
    v_result
  );
end;
$$;

revoke all on function builder_private.booking_reminder_plan_json(public.builder_booking_reminder_plans)
  from public, anon, authenticated;
revoke all on function builder_private.booking_reminder_base_allowed(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function builder_private.booking_reminder_send_allowed(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function builder_private.booking_reminder_block_reason(uuid, uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function builder_private.booking_reminder_plan_json(public.builder_booking_reminder_plans)
  to service_role;
grant execute on function builder_private.booking_reminder_base_allowed(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function builder_private.booking_reminder_send_allowed(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function builder_private.booking_reminder_block_reason(uuid, uuid, uuid, text, uuid, text, text)
  to service_role;

revoke all on function public.builder_apply_booking_reminder_command_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_apply_booking_reminder_command_v1(jsonb) to service_role;
revoke all on function public.builder_skip_booking_reminder_occurrence_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_skip_booking_reminder_occurrence_v1(jsonb) to service_role;
revoke all on function public.builder_expire_booking_holds_v1(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.builder_expire_booking_holds_v1(uuid, timestamptz, integer)
  to service_role;
revoke all on function public.builder_materialize_booking_reminder_occurrences_v1(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.builder_materialize_booking_reminder_occurrences_v1(uuid, timestamptz, integer)
  to service_role;
revoke all on function public.builder_claim_booking_reminder_occurrences_v1(uuid,text,timestamptz,integer,integer)
  from public, anon, authenticated;
grant execute on function public.builder_claim_booking_reminder_occurrences_v1(uuid,text,timestamptz,integer,integer)
  to service_role;
revoke all on function public.builder_complete_booking_reminder_occurrence_v1(uuid,uuid,text,uuid,integer,timestamptz,text,text)
  from public, anon, authenticated;
grant execute on function public.builder_complete_booking_reminder_occurrence_v1(uuid,uuid,text,uuid,integer,timestamptz,text,text)
  to service_role;
revoke all on function public.builder_reconcile_booking_reminder_delivery_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_reconcile_booking_reminder_delivery_v1(jsonb) to service_role;

create function public.builder_reconcile_booking_provider_event_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_payload jsonb := p_request -> 'payload';
  v_claim jsonb;
  v_result jsonb;
  v_payment public.builder_booking_payment_references%rowtype;
  v_existing public.builder_booking_payment_events%rowtype;
  v_target_state text := v_payload ->> 'targetState';
  v_reconciliation_state text;
begin
  perform builder_private.assert_booking_command_envelope(
    p_request,
    'booking.provider.payment.reconcile'
  );
  perform builder_private.booking_command_actor_id(p_request, false, true);

  if not builder_private.dependent_action_allowed(
      v_site_id,
      'growth.customers',
      'growth.bookings',
      'write'
    )
    or coalesce(v_payload ->> 'paymentReferenceId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_payload ->> 'providerKey', '')
      !~ '^[a-z][a-z0-9._-]{0,127}$'
    or char_length(coalesce(v_payload ->> 'providerEventId', '')) not between 1 and 500
    or coalesce(v_payload ->> 'eventType', '')
      !~ '^[a-z][a-z0-9._-]{0,127}$'
    or coalesce(v_payload ->> 'eventDigest', '') !~ '^[a-f0-9]{64}$'
    or v_target_state not in (
      'pending', 'authorized', 'captured', 'partially_refunded', 'refunded',
      'failed', 'voided', 'disputed', 'reconciliation_required'
    )
    or jsonb_typeof(v_payload -> 'sanitizedEvidence') <> 'object'
    or octet_length((v_payload -> 'sanitizedEvidence')::text) > 16384
    or (v_payload ->> 'occurredAt')::timestamptz is null
  then
    raise exception 'invalid booking provider event' using errcode = '22023';
  end if;

  v_claim := builder_private.claim_operational_command_v1(
    p_request,
    'growth.booking.provider-event.reconcile.v1'
  );
  if v_claim ->> 'status' = 'replay' then
    return builder_private.booking_replay_result(v_claim);
  end if;

  select *
  into v_payment
  from public.builder_booking_payment_references
  where site_id = v_site_id
    and id = (v_payload ->> 'paymentReferenceId')::uuid
  for update;

  if not found or v_payment.provider_key <> v_payload ->> 'providerKey' then
    raise exception 'booking payment reference is not reconcilable'
      using errcode = '22023';
  end if;

  select *
  into v_existing
  from public.builder_booking_payment_events
  where site_id = v_site_id
    and provider_key = v_payload ->> 'providerKey'
    and provider_event_id = v_payload ->> 'providerEventId';

  if found then
    if v_existing.payment_reference_id <> v_payment.id
      or v_existing.event_digest <> v_payload ->> 'eventDigest'
    then
      update public.builder_booking_payment_references
      set state = 'reconciliation_required',
          version = version + 1,
          updated_at = clock_timestamp()
      where site_id = v_site_id and id = v_payment.id
      returning * into v_payment;
      v_result := jsonb_build_object(
        'version', 1,
        'status', 'reconciliation_required',
        'effect', jsonb_build_object(
          'kind', 'payment_reconciliation',
          'providerEventId', v_payload ->> 'providerEventId',
          'paymentReference', jsonb_build_object(
            'paymentReferenceId', v_payment.id,
            'bookingId', v_payment.booking_id,
            'state', v_payment.state,
            'version', v_payment.version
          )
        ),
        'replayed', false
      );
    else
      v_result := jsonb_build_object(
        'version', 1,
        'status', 'replayed',
        'effect', jsonb_build_object(
          'kind', 'payment_reconciliation',
          'providerEventId', v_existing.provider_event_id,
          'paymentReference', jsonb_build_object(
            'paymentReferenceId', v_payment.id,
            'bookingId', v_payment.booking_id,
            'state', v_payment.state,
            'version', v_payment.version
          )
        ),
        'replayed', true
      );
    end if;
    return builder_private.complete_operational_command_v1(
      p_request,
      'growth.booking.provider-event.reconcile.v1',
      v_result
    );
  end if;

  if not (
    v_target_state = v_payment.state
    or (v_payment.state = 'pending' and v_target_state in (
      'authorized', 'captured', 'failed', 'voided', 'reconciliation_required'
    ))
    or (v_payment.state = 'authorized' and v_target_state in (
      'captured', 'failed', 'voided', 'reconciliation_required'
    ))
    or (v_payment.state = 'captured' and v_target_state in (
      'partially_refunded', 'refunded', 'disputed', 'reconciliation_required'
    ))
    or (v_payment.state = 'partially_refunded' and v_target_state in (
      'refunded', 'disputed', 'reconciliation_required'
    ))
    or (
      v_payment.state in ('refunded', 'failed', 'voided', 'disputed')
      and v_target_state = 'reconciliation_required'
    )
  ) then
    v_target_state := 'reconciliation_required';
    v_reconciliation_state := 'manual_review';
  else
    v_reconciliation_state := 'applied';
  end if;

  if v_payment.state <> v_target_state then
    update public.builder_booking_payment_references
    set state = v_target_state,
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_payment.id
    returning * into v_payment;
  end if;

  insert into public.builder_booking_payment_events (
    site_id, payment_reference_id, booking_id, provider_key,
    provider_event_id, event_type, event_digest, reconciliation_state,
    sanitized_evidence, occurred_at
  ) values (
    v_site_id,
    v_payment.id,
    v_payment.booking_id,
    v_payload ->> 'providerKey',
    v_payload ->> 'providerEventId',
    v_payload ->> 'eventType',
    v_payload ->> 'eventDigest',
    v_reconciliation_state,
    v_payload -> 'sanitizedEvidence',
    (v_payload ->> 'occurredAt')::timestamptz
  );

  v_result := jsonb_build_object(
    'version', 1,
    'status', case
      when v_reconciliation_state = 'manual_review'
        then 'reconciliation_required'
      else 'applied'
    end,
    'effect', jsonb_build_object(
      'kind', 'payment_reconciliation',
      'providerEventId', v_payload ->> 'providerEventId',
      'paymentReference', jsonb_build_object(
        'paymentReferenceId', v_payment.id,
        'bookingId', v_payment.booking_id,
        'state', v_payment.state,
        'version', v_payment.version
      )
    ),
    'replayed', false
  );
  return builder_private.complete_operational_command_v1(
    p_request,
    'growth.booking.provider-event.reconcile.v1',
    v_result
  );
end;
$$;

revoke all on function public.builder_reconcile_booking_provider_event_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_reconcile_booking_provider_event_v1(jsonb) to service_role;

create function public.builder_list_public_booking_availability_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private, extensions
as $$
declare
  v_site_id uuid;
  v_service_id uuid;
  v_requested_from timestamptz;
  v_requested_to timestamptz;
  v_from timestamptz;
  v_to timestamptz;
  v_limit integer;
  v_revision public.builder_booking_service_revisions%rowtype;
  v_items jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array[
      'version', 'siteId', 'serviceId', 'startsAt', 'endsAt'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_request) key
      where key not in (
        'version', 'siteId', 'serviceId', 'startsAt', 'endsAt', 'limit'
      )
    )
    or coalesce(p_request ->> 'siteId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'serviceId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (
      p_request ? 'limit'
      and jsonb_typeof(p_request -> 'limit') <> 'number'
    )
  then
    raise exception 'invalid public booking availability payload'
      using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_service_id := (p_request ->> 'serviceId')::uuid;
    v_requested_from := (p_request ->> 'startsAt')::timestamptz;
    v_requested_to := (p_request ->> 'endsAt')::timestamptz;
    v_limit := coalesce((p_request ->> 'limit')::integer, 100);
  exception
    when invalid_text_representation or datetime_field_overflow
      or numeric_value_out_of_range
  then
    raise exception 'invalid public booking availability payload'
      using errcode = '22023';
  end;

  if v_limit not between 1 and 500
    or v_requested_from >= v_requested_to
    or v_requested_to - v_requested_from > interval '31 days'
  then
    raise exception 'invalid public booking availability payload'
      using errcode = '22023';
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
      'service', null,
      'items', '[]'::jsonb
    );
  end if;

  select revision.*
  into v_revision
  from public.builder_booking_services service
  join public.builder_booking_service_revisions revision
    on revision.site_id = service.site_id
    and revision.id = service.current_revision_id
  where service.site_id = v_site_id
    and service.id = v_service_id
    and service.state = 'active'
    and revision.public_visibility = 'public';

  if not found then
    return jsonb_build_object(
      'version', 1,
      'status', 'not_found',
      'service', null,
      'items', '[]'::jsonb
    );
  end if;

  v_from := greatest(
    v_requested_from,
    statement_timestamp() + make_interval(mins => v_revision.minimum_notice_minutes)
  );
  v_to := least(
    v_requested_to,
    statement_timestamp() + make_interval(days => v_revision.booking_horizon_days)
  );

  if v_from >= v_to then
    return jsonb_build_object(
      'version', 1,
      'status', 'available',
      'service', jsonb_build_object(
        'serviceId', v_service_id,
        'serviceRevisionId', v_revision.id,
        'title', v_revision.title,
        'durationMinutes', v_revision.duration_minutes,
        'confirmationMode', v_revision.confirmation_mode,
        'pricingMode', v_revision.pricing_mode
      ),
      'items', '[]'::jsonb
    );
  end if;

  with slots as (
    select slot_start,
      slot_start + make_interval(mins => v_revision.duration_minutes) as slot_end
    from generate_series(
      v_from,
      v_to - make_interval(mins => v_revision.duration_minutes),
      make_interval(mins => v_revision.slot_interval_minutes)
    ) slot_start
  ),
  eligible_slots as (
    select slot.slot_start, slot.slot_end
    from slots slot
    where exists (
      select 1
      from public.builder_booking_availability_rules rule
      where rule.site_id = v_site_id
        and (
          (rule.owner_kind = 'site' and rule.owner_id = v_site_id)
          or (rule.owner_kind = 'service' and rule.owner_id = v_service_id)
        )
        and (slot.slot_start at time zone rule.time_zone)::date
          between rule.effective_from and coalesce(rule.effective_until, 'infinity'::date)
        and lower(trim(to_char(
          slot.slot_start at time zone rule.time_zone,
          'Day'
        ))) = any(rule.weekdays)
        and (slot.slot_start at time zone rule.time_zone)::time
          >= rule.starts_at_local
        and (slot.slot_end at time zone rule.time_zone)::time
          <= rule.ends_at_local
    )
      and not exists (
        select 1
        from public.builder_booking_closures closure
        where closure.site_id = v_site_id
          and (
            (closure.owner_kind = 'site' and closure.owner_id = v_site_id)
            or (
              closure.owner_kind = 'service'
              and closure.owner_id = v_service_id
            )
          )
          and tstzrange(closure.starts_at, closure.ends_at, '[)')
            && tstzrange(slot.slot_start, slot.slot_end, '[)')
      )
      and not exists (
        select 1
        from public.builder_booking_availability_exceptions exception
        where exception.site_id = v_site_id
          and exception.effect = 'unavailable'
          and (
            (exception.owner_kind = 'site' and exception.owner_id = v_site_id)
            or (
              exception.owner_kind = 'service'
              and exception.owner_id = v_service_id
            )
          )
          and tstzrange(exception.starts_at, exception.ends_at, '[)')
            && tstzrange(slot.slot_start, slot.slot_end, '[)')
      )
      and not exists (
        select 1
        from (
          select eligibility.selection_group,
            max(eligibility.minimum_required) as minimum_required
          from public.builder_booking_resource_eligibility eligibility
          where eligibility.site_id = v_site_id
            and eligibility.service_revision_id = v_revision.id
          group by eligibility.selection_group
        ) requirement
        where (
          select count(*)
          from public.builder_booking_resource_eligibility eligibility
          join public.builder_booking_resources resource
            on resource.site_id = eligibility.site_id
            and resource.id = eligibility.resource_id
          where eligibility.site_id = v_site_id
            and eligibility.service_revision_id = v_revision.id
            and eligibility.selection_group = requirement.selection_group
            and resource.state = 'active'
            and not exists (
              select 1
              from public.builder_booking_closures closure
              where closure.site_id = resource.site_id
                and closure.owner_kind = 'resource'
                and closure.owner_id = resource.id
                and tstzrange(closure.starts_at, closure.ends_at, '[)')
                  && tstzrange(slot.slot_start, slot.slot_end, '[)')
            )
            and not exists (
              select 1
              from public.builder_booking_external_busy_periods busy
              where busy.site_id = resource.site_id
                and busy.resource_id = resource.id
                and tstzrange(busy.starts_at, busy.ends_at, '[)')
                  && tstzrange(slot.slot_start, slot.slot_end, '[)')
            )
            and (
              (
                resource.exclusive
                and not exists (
                  select 1
                  from public.builder_booking_reservations reservation
                  where reservation.site_id = resource.site_id
                    and reservation.resource_id = resource.id
                    and reservation.state = 'active'
                    and tstzrange(
                      reservation.starts_at,
                      reservation.ends_at,
                      '[)'
                    ) && tstzrange(slot.slot_start, slot.slot_end, '[)')
                )
                and not exists (
                  select 1
                  from public.builder_booking_holds hold
                  where hold.site_id = resource.site_id
                    and hold.state = 'active'
                    and hold.expires_at > statement_timestamp()
                    and resource.id = any(hold.resource_ids)
                    and tstzrange(hold.starts_at, hold.ends_at, '[)')
                      && tstzrange(slot.slot_start, slot.slot_end, '[)')
                )
              )
              or (
                not resource.exclusive
                and (
                  coalesce((
                    select sum(reservation.capacity_units)
                    from public.builder_booking_reservations reservation
                    where reservation.site_id = resource.site_id
                      and reservation.resource_id = resource.id
                      and reservation.state = 'active'
                      and tstzrange(
                        reservation.starts_at,
                        reservation.ends_at,
                        '[)'
                      ) && tstzrange(slot.slot_start, slot.slot_end, '[)')
                  ), 0)
                  + coalesce((
                    select sum(hold.capacity_units)
                    from public.builder_booking_holds hold
                    where hold.site_id = resource.site_id
                      and hold.state = 'active'
                      and hold.expires_at > statement_timestamp()
                      and resource.id = any(hold.resource_ids)
                      and tstzrange(hold.starts_at, hold.ends_at, '[)')
                        && tstzrange(slot.slot_start, slot.slot_end, '[)')
                  ), 0)
                ) < resource.capacity
              )
            )
        ) < requirement.minimum_required
      )
    order by slot.slot_start
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slotKey', encode(digest(
      v_site_id::text || ':' || v_service_id::text || ':' || slot_start::text,
      'sha256'
    ), 'hex'),
    'startsAt', slot_start,
    'endsAt', slot_end
  ) order by slot_start), '[]'::jsonb)
  into v_items
  from eligible_slots;

  return jsonb_build_object(
    'version', 1,
    'status', 'available',
    'service', jsonb_build_object(
      'serviceId', v_service_id,
      'serviceRevisionId', v_revision.id,
      'title', v_revision.title,
      'durationMinutes', v_revision.duration_minutes,
      'confirmationMode', v_revision.confirmation_mode,
      'pricingMode', v_revision.pricing_mode
    ),
    'items', v_items
  );
end;
$$;

revoke all on function public.builder_list_public_booking_availability_v1(jsonb) from public;
grant execute on function public.builder_list_public_booking_availability_v1(jsonb) to anon, authenticated, service_role;

create function public.builder_list_owner_booking_calendar_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_state text;
  v_items jsonb;
begin
  perform builder_private.phase2c_validate_request(
    p_request,
    array['version', 'siteId', 'actorId', 'startsAt', 'endsAt'],
    array['version', 'siteId', 'actorId', 'startsAt', 'endsAt'],
    'invalid owner booking calendar payload'
  );
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_starts_at := (p_request ->> 'startsAt')::timestamptz;
    v_ends_at := (p_request ->> 'endsAt')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow
  then
    raise exception 'invalid owner booking calendar payload'
      using errcode = '22023';
  end;
  if v_starts_at >= v_ends_at
    or v_ends_at - v_starts_at > interval '366 days'
  then
    raise exception 'invalid owner booking calendar payload'
      using errcode = '22023';
  end if;

  v_state := builder_private.phase2c_growth_access_state(
    v_site_id,
    v_actor_id,
    'growth.bookings',
    'growth.customers',
    'bookings.read'
  );
  if v_state = 'restricted' then
    return jsonb_build_object(
      'version', 1,
      'status', 'restricted',
      'items', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'bookingId', booking.id,
    'serviceId', booking.service_id,
    'serviceRevisionId', booking.service_revision_id,
    'serviceTitle', revision.title,
    'customerId', booking.contact_id,
    'customerDisplayName', contact.display_name,
    'primaryAssigneeId', booking.primary_assignee_id,
    'status', booking.status,
    'startsAt', booking.starts_at,
    'endsAt', booking.ends_at,
    'timeZone', booking.time_zone,
    'participantCount', (
      select count(*)
      from public.builder_booking_participants participant
      where participant.site_id = booking.site_id
        and participant.booking_id = booking.id
    ),
    'resourceSummary', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', resource.kind,
        'title', resource.title
      ) order by resource.kind, resource.title), '[]'::jsonb)
      from public.builder_booking_reservations reservation
      join public.builder_booking_resources resource
        on resource.site_id = reservation.site_id
        and resource.id = reservation.resource_id
      where reservation.site_id = booking.site_id
        and reservation.booking_id = booking.id
        and reservation.state = 'active'
    ),
    'version', booking.version
  ) order by booking.starts_at, booking.id), '[]'::jsonb)
  into v_items
  from public.builder_bookings booking
  join public.builder_booking_service_revisions revision
    on revision.site_id = booking.site_id
    and revision.id = booking.service_revision_id
  join public.builder_contacts contact
    on contact.site_id = booking.site_id
    and contact.id = booking.contact_id
  where booking.site_id = v_site_id
    and booking.starts_at < v_ends_at
    and booking.ends_at > v_starts_at
    and builder_private.member_can_access_growth_record(
      v_site_id,
      v_actor_id,
      'bookings.read',
      'booking',
      booking.id
    );

  return jsonb_build_object(
    'version', 1,
    'status', v_state,
    'range', jsonb_build_object(
      'startsAt', v_starts_at,
      'endsAt', v_ends_at
    ),
    'items', v_items
  );
end;
$$;

create function public.builder_list_bookings_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_limit integer;
  v_search text;
  v_statuses jsonb;
  v_starts_from timestamptz;
  v_starts_to timestamptz;
  v_state text;
  v_items jsonb;
begin
  perform builder_private.phase2c_validate_request(
    p_request,
    array[
      'version', 'siteId', 'actorId', 'limit', 'search', 'statuses',
      'startsFrom', 'startsTo'
    ],
    array['version', 'siteId', 'actorId', 'limit'],
    'invalid booking list payload'
  );
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_limit := (p_request ->> 'limit')::integer;
    v_search := nullif(btrim(coalesce(p_request ->> 'search', '')), '');
    v_statuses := p_request -> 'statuses';
    v_starts_from := nullif(p_request ->> 'startsFrom', '')::timestamptz;
    v_starts_to := nullif(p_request ->> 'startsTo', '')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow
      or numeric_value_out_of_range
  then
    raise exception 'invalid booking list payload' using errcode = '22023';
  end;
  if v_limit not between 1 and 100
    or (v_search is not null and char_length(v_search) > 200)
    or (
      v_statuses is not null
      and (
        jsonb_typeof(v_statuses) <> 'array'
        or jsonb_array_length(v_statuses) > 20
        or exists (
          select 1
          from jsonb_array_elements_text(v_statuses) status
          where status not in (
            'draft', 'held', 'requested', 'approved', 'confirmed',
            'checked_in', 'completed', 'waitlisted', 'rescheduled',
            'cancelled', 'declined', 'no_show', 'expired'
          )
        )
      )
    )
    or (
      v_starts_from is not null
      and v_starts_to is not null
      and v_starts_from >= v_starts_to
    )
  then
    raise exception 'invalid booking list payload' using errcode = '22023';
  end if;

  v_state := builder_private.phase2c_growth_access_state(
    v_site_id,
    v_actor_id,
    'growth.bookings',
    'growth.customers',
    'bookings.read'
  );
  if v_state = 'restricted' then
    return jsonb_build_object(
      'version', 1,
      'status', 'restricted',
      'items', '[]'::jsonb,
      'nextCursor', null
    );
  end if;

  with candidates as (
    select booking.*, revision.title as service_title,
      contact.display_name as customer_display_name,
      payment.state as payment_state,
      reminder.state as reminder_state
    from public.builder_bookings booking
    join public.builder_booking_service_revisions revision
      on revision.site_id = booking.site_id
      and revision.id = booking.service_revision_id
    join public.builder_contacts contact
      on contact.site_id = booking.site_id
      and contact.id = booking.contact_id
    left join lateral (
      select reference.state
      from public.builder_booking_payment_references reference
      where reference.site_id = booking.site_id
        and reference.booking_id = booking.id
      order by reference.occurred_at desc, reference.id desc
      limit 1
    ) payment on true
    left join lateral (
      select plan.state
      from public.builder_booking_reminder_plans plan
      where plan.site_id = booking.site_id
        and plan.booking_id = booking.id
      order by plan.updated_at desc, plan.id desc
      limit 1
    ) reminder on true
    where booking.site_id = v_site_id
      and builder_private.member_can_access_growth_record(
        v_site_id,
        v_actor_id,
        'bookings.read',
        'booking',
        booking.id
      )
      and (
        v_search is null
        or revision.title ilike '%' || v_search || '%'
        or contact.display_name ilike '%' || v_search || '%'
      )
      and (
        v_statuses is null
        or booking.status in (
          select jsonb_array_elements_text(v_statuses)
        )
      )
      and (v_starts_from is null or booking.starts_at >= v_starts_from)
      and (v_starts_to is null or booking.starts_at < v_starts_to)
    order by booking.starts_at desc, booking.id desc
    limit v_limit + 1
  ),
  numbered as (
    select *,
      row_number() over (order by starts_at desc, id desc) as row_number,
      count(*) over () as page_count
    from candidates
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'bookingId', item.id,
    'customerId', item.contact_id,
    'customerDisplayName', item.customer_display_name,
    'serviceId', item.service_id,
    'serviceTitle', item.service_title,
    'status', item.status,
    'primaryAssigneeId', item.primary_assignee_id,
    'startsAt', item.starts_at,
    'endsAt', item.ends_at,
    'timeZone', item.time_zone,
    'paymentState', item.payment_state,
    'reminderState', item.reminder_state,
    'intakeResponseCount', (
      select count(*)
      from public.builder_booking_intake_responses intake
      where intake.site_id = v_site_id and intake.booking_id = item.id
    ),
    'version', item.version,
    'updatedAt', item.updated_at
  ) order by item.row_number)
    filter (where item.row_number <= v_limit), '[]'::jsonb)
  into v_items
  from numbered item;

  return jsonb_build_object(
    'version', 1,
    'status', v_state,
    'items', v_items,
    'nextCursor', null
  );
end;
$$;

create function public.builder_get_appointment_workroom_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_booking_id uuid;
  v_state text;
  v_result jsonb;
begin
  perform builder_private.phase2c_validate_request(
    p_request,
    array['version', 'siteId', 'actorId', 'bookingId'],
    array['version', 'siteId', 'actorId', 'bookingId'],
    'invalid appointment workroom payload'
  );
  if coalesce(p_request ->> 'bookingId', '')
    !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'invalid appointment workroom payload'
      using errcode = '22023';
  end if;
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_booking_id := (p_request ->> 'bookingId')::uuid;
  v_state := builder_private.phase2c_growth_access_state(
    v_site_id,
    v_actor_id,
    'growth.bookings',
    'growth.customers',
    'bookings.read'
  );
  if v_state = 'restricted'
    or not builder_private.member_can_access_growth_record(
      v_site_id,
      v_actor_id,
      'bookings.read',
      'booking',
      v_booking_id
    )
  then
    return '{"version":1,"status":"not_found"}'::jsonb;
  end if;

  select jsonb_build_object(
    'version', 1,
    'status', v_state,
    'booking', builder_private.booking_json(booking),
    'service', jsonb_build_object(
      'serviceId', booking.service_id,
      'serviceRevisionId', revision.id,
      'title', revision.title,
      'description', revision.description,
      'category', revision.category,
      'definition', revision.definition
    ),
    'customer', jsonb_build_object(
      'customerId', contact.id,
      'displayName', contact.display_name,
      'preferredContactMethod', contact.preferred_contact_method,
      'serviceZipCode', contact.service_zip_code
    ),
    'workSession', (
      select jsonb_build_object(
        'workSessionId', session.id,
        'priorSessionId', session.prior_session_id,
        'templateId', session.template_id,
        'templateRevisionId', session.template_revision_id,
        'state', session.state,
        'startedAt', session.started_at,
        'resumedAt', session.resumed_at,
        'endedAt', session.ended_at,
        'startedBy', session.started_by,
        'endedBy', session.ended_by,
        'outcomeId', session.outcome_id,
        'version', session.version
      )
      from public.builder_appointment_work_sessions session
      where session.site_id = booking.site_id
        and session.booking_id = booking.id
      order by (session.state <> 'ended') desc, session.created_at desc
      limit 1
    ),
    'checklist', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'revisionId', checklist.id,
        'checklistKey', checklist.checklist_key,
        'revisionNumber', checklist.revision_number,
        'state', checklist.state,
        'response', checklist.response,
        'actorId', checklist.actor_id,
        'createdAt', checklist.created_at
      ) order by checklist.checklist_key), '[]'::jsonb)
      from (
        select distinct on (entry.work_session_id, entry.checklist_key) entry.*
        from public.builder_appointment_checklist_revisions entry
        join public.builder_appointment_work_sessions session
          on session.site_id = entry.site_id
          and session.id = entry.work_session_id
        where entry.site_id = booking.site_id
          and session.booking_id = booking.id
        order by entry.work_session_id, entry.checklist_key,
          entry.revision_number desc
      ) checklist
    ),
    'fields', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'revisionId', field.id,
        'fieldKey', field.field_key,
        'revisionNumber', field.revision_number,
        'value', field.value,
        'actorId', field.actor_id,
        'createdAt', field.created_at
      ) order by field.field_key), '[]'::jsonb)
      from (
        select distinct on (entry.work_session_id, entry.field_key) entry.*
        from public.builder_appointment_field_response_revisions entry
        join public.builder_appointment_work_sessions session
          on session.site_id = entry.site_id
          and session.id = entry.work_session_id
        where entry.site_id = booking.site_id
          and session.booking_id = booking.id
        order by entry.work_session_id, entry.field_key,
          entry.revision_number desc
      ) field
    ),
    'notes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'revisionId', note.id,
        'noteId', note.note_id,
        'revisionNumber', note.revision_number,
        'visibility', note.visibility,
        'body', note.body,
        'actorId', note.actor_id,
        'createdAt', note.created_at
      ) order by note.created_at, note.note_id), '[]'::jsonb)
      from (
        select distinct on (entry.note_id) entry.*
        from public.builder_appointment_note_revisions entry
        join public.builder_appointment_work_sessions session
          on session.site_id = entry.site_id
          and session.id = entry.work_session_id
        where entry.site_id = booking.site_id
          and session.booking_id = booking.id
          and entry.retention_archived_at is null
          and (
            entry.visibility = 'assigned_staff'
            or (
              entry.visibility = 'site_staff'
              and builder_private.member_has_capability(
                v_site_id,
                v_actor_id,
                'bookings.read',
                'site'
              )
            )
            or (
              entry.visibility = 'managers'
              and builder_private.member_has_capability(
                v_site_id,
                v_actor_id,
                'bookings.update',
                'site'
              )
            )
          )
        order by entry.note_id, entry.revision_number desc
      ) note
    ),
    'itemReferences', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'itemReferenceId', item.id,
        'workSessionId', item.work_session_id,
        'sourceKind', item.source_kind,
        'sourceInstanceId', item.source_instance_id,
        'sourceConfigurationRevision', item.source_configuration_revision,
        'sourceStableId', item.source_stable_id,
        'sourceItemRevision', item.source_item_revision,
        'assetRevisionId', item.asset_revision_id,
        'displayTitle', item.display_title,
        'thumbnailReference', item.thumbnail_reference,
        'metadataSnapshot', item.metadata_snapshot,
        'availabilityState', item.availability_state,
        'sourceHealthState', item.source_health_state,
        'sortPosition', item.sort_position,
        'staffNote', item.staff_note,
        'version', item.version
      ) order by item.sort_position, item.selected_at, item.id), '[]'::jsonb)
      from public.builder_appointment_item_references item
      where item.site_id = booking.site_id
        and item.booking_id = booking.id
        and item.archived_at is null
    ),
    'outcomes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'outcomeId', outcome.id,
        'workSessionId', outcome.work_session_id,
        'category', outcome.category,
        'reasonCode', outcome.reason_code,
        'ownerExplanation', outcome.owner_explanation,
        'followUpDecision', outcome.follow_up_decision,
        'followUpReferenceType', outcome.follow_up_reference_type,
        'followUpReferenceId', outcome.follow_up_reference_id,
        'supersedesOutcomeId', outcome.supersedes_outcome_id,
        'actorId', outcome.actor_id,
        'occurredAt', outcome.occurred_at
      ) order by outcome.occurred_at, outcome.id), '[]'::jsonb)
      from public.builder_appointment_outcomes outcome
      where outcome.site_id = booking.site_id
        and outcome.booking_id = booking.id
    ),
    'followUps', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'followUpLinkId', follow_up.id,
        'outcomeId', follow_up.outcome_id,
        'kind', follow_up.follow_up_kind,
        'resourceId', follow_up.follow_up_resource_id,
        'state', follow_up.state,
        'createdAt', follow_up.created_at
      ) order by follow_up.created_at, follow_up.id), '[]'::jsonb)
      from public.builder_booking_follow_up_links follow_up
      where follow_up.site_id = booking.site_id
        and follow_up.booking_id = booking.id
    ),
    'customerItemPreferences', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'preferenceId', preference.id,
        'sourceKind', preference.source_kind,
        'sourceInstanceId', preference.source_instance_id,
        'sourceStableId', preference.source_stable_id,
        'displaySnapshot', preference.display_snapshot,
        'preferenceState', preference.preference_state,
        'version', preference.version
      ) order by preference.updated_at desc, preference.id), '[]'::jsonb)
      from public.builder_customer_item_preferences preference
      where preference.site_id = booking.site_id
        and preference.contact_id = booking.contact_id
        and preference.archived_at is null
    ),
    'reminderPlans', (
      select coalesce(jsonb_agg(
        builder_private.booking_reminder_plan_json(plan)
        order by plan.created_at, plan.id
      ), '[]'::jsonb)
      from public.builder_booking_reminder_plans plan
      where plan.site_id = booking.site_id
        and plan.booking_id = booking.id
    )
  )
  into v_result
  from public.builder_bookings booking
  join public.builder_booking_service_revisions revision
    on revision.site_id = booking.site_id
    and revision.id = booking.service_revision_id
  join public.builder_contacts contact
    on contact.site_id = booking.site_id
    and contact.id = booking.contact_id
  where booking.site_id = v_site_id and booking.id = v_booking_id;

  return coalesce(v_result, '{"version":1,"status":"not_found"}'::jsonb);
end;
$$;

create function public.builder_get_booking_reminder_health_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_state text;
  v_plan_counts jsonb;
  v_occurrence_counts jsonb;
begin
  perform builder_private.phase2c_validate_request(
    p_request,
    array['version', 'siteId', 'actorId'],
    array['version', 'siteId', 'actorId'],
    'invalid booking reminder health payload'
  );
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_state := builder_private.phase2c_growth_access_state(
    v_site_id,
    v_actor_id,
    'growth.bookings',
    'growth.customers',
    'bookings.read',
    'site'
  );
  if v_state = 'restricted' then
    return jsonb_build_object(
      'version', 1,
      'status', 'restricted',
      'plans', '{}'::jsonb,
      'occurrences', '{}'::jsonb,
      'warnings', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_object_agg(state, state_count), '{}'::jsonb)
  into v_plan_counts
  from (
    select state, count(*) as state_count
    from public.builder_booking_reminder_plans
    where site_id = v_site_id
    group by state
  ) counts;

  select coalesce(jsonb_object_agg(state, state_count), '{}'::jsonb)
  into v_occurrence_counts
  from (
    select state, count(*) as state_count
    from public.builder_booking_reminder_occurrences
    where site_id = v_site_id
    group by state
  ) counts;

  return jsonb_build_object(
    'version', 1,
    'status', v_state,
    'plans', v_plan_counts,
    'occurrences', v_occurrence_counts,
    'dueCount', (
      select count(*)
      from public.builder_booking_reminder_occurrences occurrence
      where occurrence.site_id = v_site_id
        and occurrence.state in (
          'scheduled', 'held_for_quiet_hours', 'ready', 'claimed'
        )
        and occurrence.scheduled_for <= statement_timestamp()
    ),
    'staleLeaseCount', (
      select count(*)
      from public.builder_booking_reminder_occurrences occurrence
      where occurrence.site_id = v_site_id
        and occurrence.state = 'claimed'
        and occurrence.lease_expires_at < statement_timestamp()
    ),
    'warnings', (
      select coalesce(jsonb_agg(warning order by warning ->> 'code'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'code', 'failed_retryable_occurrences',
          'count', count(*)
        ) as warning
        from public.builder_booking_reminder_occurrences
        where site_id = v_site_id and state = 'failed_retryable'
        having count(*) > 0
        union all
        select jsonb_build_object(
          'code', 'failed_review_occurrences',
          'count', count(*)
        )
        from public.builder_booking_reminder_occurrences
        where site_id = v_site_id and state = 'failed_review'
        having count(*) > 0
        union all
        select jsonb_build_object(
          'code', 'failed_review_plans',
          'count', count(*)
        )
        from public.builder_booking_reminder_plans
        where site_id = v_site_id and state = 'failed_review'
        having count(*) > 0
      ) health_warnings
    )
  );
end;
$$;

create function public.builder_list_customer_booking_timeline_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_contact_id uuid;
  v_limit integer;
  v_booking_state text;
  v_customer_state text;
  v_state text;
  v_items jsonb;
begin
  perform builder_private.phase2c_validate_request(
    p_request,
    array['version', 'siteId', 'actorId', 'contactId', 'limit'],
    array['version', 'siteId', 'actorId', 'contactId', 'limit'],
    'invalid customer booking timeline payload'
  );
  if coalesce(p_request ->> 'contactId', '')
    !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_request -> 'limit') <> 'number'
  then
    raise exception 'invalid customer booking timeline payload'
      using errcode = '22023';
  end if;
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_contact_id := (p_request ->> 'contactId')::uuid;
    v_limit := (p_request ->> 'limit')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range
  then
    raise exception 'invalid customer booking timeline payload'
      using errcode = '22023';
  end;
  if v_limit not between 1 and 100 then
    raise exception 'invalid customer booking timeline payload'
      using errcode = '22023';
  end if;

  v_booking_state := builder_private.phase2c_growth_access_state(
    v_site_id,
    v_actor_id,
    'growth.bookings',
    'growth.customers',
    'bookings.read'
  );
  v_customer_state := builder_private.phase2c_growth_access_state(
    v_site_id,
    v_actor_id,
    'growth.customers',
    null,
    'customers.read'
  );
  if v_booking_state = 'restricted'
    or v_customer_state = 'restricted'
    or not builder_private.member_can_access_growth_record(
      v_site_id,
      v_actor_id,
      'customers.read',
      'customer',
      v_contact_id
    )
  then
    return jsonb_build_object(
      'version', 1,
      'status', 'restricted',
      'customerId', v_contact_id,
      'items', '[]'::jsonb
    );
  end if;
  v_state := case
    when v_booking_state = 'read_only' or v_customer_state = 'read_only'
      then 'read_only'
    else 'allowed'
  end;

  with accessible_bookings as (
    select booking.*
    from public.builder_bookings booking
    where booking.site_id = v_site_id
      and booking.contact_id = v_contact_id
      and builder_private.member_can_access_growth_record(
        v_site_id,
        v_actor_id,
        'bookings.read',
        'booking',
        booking.id
      )
  ),
  timeline as (
    select booking.created_at as occurred_at,
      'booking.created'::text as event_type,
      booking.id as booking_id,
      booking.id as event_id,
      jsonb_build_object(
        'status', booking.status,
        'startsAt', booking.starts_at,
        'endsAt', booking.ends_at,
        'serviceId', booking.service_id
      ) as detail
    from accessible_bookings booking
    union all
    select event.occurred_at,
      event.event_type,
      event.booking_id,
      event.id,
      jsonb_build_object(
        'fromStatus', event.from_status,
        'toStatus', event.to_status,
        'reason', event.reason,
        'actorId', event.actor_id,
        'evidence', event.evidence
      )
    from public.builder_booking_events event
    join accessible_bookings booking on booking.id = event.booking_id
    where event.site_id = v_site_id
    union all
    select outcome.occurred_at,
      'appointment.outcome.' || outcome.category,
      outcome.booking_id,
      outcome.id,
      jsonb_build_object(
        'category', outcome.category,
        'reasonCode', outcome.reason_code,
        'followUpDecision', outcome.follow_up_decision,
        'followUpReferenceType', outcome.follow_up_reference_type,
        'followUpReferenceId', outcome.follow_up_reference_id
      )
    from public.builder_appointment_outcomes outcome
    join accessible_bookings booking on booking.id = outcome.booking_id
    where outcome.site_id = v_site_id
    union all
    select occurrence.created_at,
      'reminder.' || occurrence.state,
      occurrence.booking_id,
      occurrence.id,
      jsonb_build_object(
        'planId', occurrence.plan_id,
        'channel', occurrence.channel,
        'purpose', occurrence.purpose,
        'scheduledFor', occurrence.scheduled_for,
        'state', occurrence.state,
        'sentAt', occurrence.sent_at
      )
    from public.builder_booking_reminder_occurrences occurrence
    join accessible_bookings booking on booking.id = occurrence.booking_id
    where occurrence.site_id = v_site_id
  ),
  bounded as (
    select *
    from timeline
    order by occurred_at desc, event_id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', event_id,
    'bookingId', booking_id,
    'eventType', event_type,
    'detail', detail,
    'occurredAt', occurred_at
  ) order by occurred_at desc, event_id desc), '[]'::jsonb)
  into v_items
  from bounded;

  return jsonb_build_object(
    'version', 1,
    'status', v_state,
    'customerId', v_contact_id,
    'items', v_items
  );
end;
$$;

revoke all on function public.builder_list_owner_booking_calendar_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_list_bookings_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_get_appointment_workroom_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_get_booking_reminder_health_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_list_customer_booking_timeline_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_list_owner_booking_calendar_v1(jsonb) to service_role;
grant execute on function public.builder_list_bookings_v1(jsonb) to service_role;
grant execute on function public.builder_get_appointment_workroom_v1(jsonb) to service_role;
grant execute on function public.builder_get_booking_reminder_health_v1(jsonb) to service_role;
grant execute on function public.builder_list_customer_booking_timeline_v1(jsonb) to service_role;

set search_path = public, extensions;
