create function public.builder_dispatch_automation_event_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_event_id uuid;
  v_aggregate_id uuid;
  v_correlation_id uuid;
  v_occurred_at timestamptz;
  v_automation record;
  v_result jsonb;
  v_matched integer := 0;
  v_started integer := 0;
  v_replayed integer := 0;
  v_denied integer := 0;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'eventTopic', '') not in (
      'booking.requested',
      'booking.approved',
      'booking.confirmed',
      'booking.rescheduled',
      'booking.cancelled',
      'booking.completed',
      'booking.no_show',
      'waitlist.opening',
      'conversation.opened',
      'conversation.escalated',
      'customer.consent_changed',
      'campaign.scheduled',
      'appointment.outcome_recorded',
      'reminder.occurrence_due',
      'reminder.occurrence_skipped',
      'reminder.occurrence_suppressed'
    )
    or p_request ->> 'eventVersion' <> '1'
    or coalesce(p_request ->> 'aggregateType', '') !~
      '^[a-z][a-z0-9._-]{0,127}$'
    or char_length(coalesce(p_request ->> 'idempotencyKey', ''))
      not between 1 and 255
    or jsonb_typeof(coalesce(p_request -> 'payload', '{}'::jsonb)) <> 'object'
    or coalesce(p_request -> 'payload', '{}'::jsonb)::text ~*
      '"(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|private[_-]?key|providerPayload|secret)"[[:space:]]*:'
  then
    raise exception 'invalid growth integration event'
      using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_event_id := (p_request ->> 'eventId')::uuid;
    v_aggregate_id := (p_request ->> 'aggregateId')::uuid;
    v_correlation_id := (p_request ->> 'correlationId')::uuid;
    v_occurred_at := (p_request ->> 'occurredAt')::timestamptz;
  exception when others then
    raise exception 'invalid growth integration identifiers'
      using errcode = '22023';
  end;

  for v_automation in
    select automation.id
    from public.builder_automations automation
    join public.builder_automation_revisions revision
      on revision.site_id = automation.site_id
      and revision.id = automation.current_revision_id
      and revision.automation_id = automation.id
    where automation.site_id = v_site_id
      and automation.state = 'active'
      and revision.trigger_definition ->> 'type' =
        p_request ->> 'eventTopic'
      and exists (
        select 1
        from public.builder_automation_approvals approval
        where approval.site_id = automation.site_id
          and approval.automation_id = automation.id
          and approval.automation_revision_id = revision.id
          and approval.state = 'approved'
      )
    order by automation.id
  loop
    v_matched := v_matched + 1;
    v_result := public.builder_start_automation_run_v1(
      jsonb_build_object(
        'version', 1,
        'siteId', v_site_id,
        'automationId', v_automation.id,
        'eventId', v_event_id,
        'eventTopic', p_request ->> 'eventTopic',
        'eventVersion', 1,
        'aggregateType', p_request ->> 'aggregateType',
        'aggregateId', v_aggregate_id,
        'correlationId', v_correlation_id,
        'idempotencyKey',
          'growth-event:' || v_event_id::text ||
          ':automation:' || v_automation.id::text,
        'occurredAt', v_occurred_at,
        'payload', coalesce(p_request -> 'payload', '{}'::jsonb)
      )
    );

    if v_result ->> 'status' = 'started' then
      v_started := v_started + 1;
    elsif v_result ->> 'status' = 'replayed' then
      v_replayed := v_replayed + 1;
    else
      v_denied := v_denied + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'version', 1,
    'status', case
      when v_matched = 0 then 'ignored'
      else 'dispatched'
    end,
    'matchedCount', v_matched,
    'startedCount', v_started,
    'replayedCount', v_replayed,
    'deniedCount', v_denied
  );
end;
$$;

revoke all on function public.builder_dispatch_automation_event_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.builder_dispatch_automation_event_v1(jsonb)
  to service_role;
