-- Eligibility may legitimately change between durable audience-walk checkpoints.
-- Restart that walk without spending its failure budget or issuing stale readiness.
-- Only the current, unexpired worker lease may supersede/requeue a running walk.
create function builder_private.restart_newsletter_reconciliation_epoch_v1(
  p_site_id uuid,
  p_job_id uuid,
  p_run_id uuid,
  p_worker_id uuid,
  p_fencing bigint,
  p_expected_epoch bigint
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_epoch bigint;
  v_changed integer;
begin
  if not exists (
    select 1
    from public.builder_newsletter_reconciliation_runs run
    join public.builder_newsletter_site_jobs job
      on job.site_id = run.site_id and job.id = run.job_id
    where run.site_id = p_site_id and run.id = p_run_id and run.job_id = p_job_id
      and run.state = 'running' and run.expected_eligibility_epoch = p_expected_epoch
      and job.state = 'leased' and job.lease_owner = p_worker_id
      and job.lease_fencing_token = p_fencing
      and job.lease_expires_at > clock_timestamp()
  ) then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;

  -- Hold the existing epoch row through the caller's remaining checkpoint/removal
  -- reservation. Every claimed run already has a site eligibility-epoch row.
  select epoch.epoch into v_epoch
  from public.builder_newsletter_eligibility_epochs epoch
  where epoch.site_id = p_site_id
  for update;
  if not found then
    raise exception 'newsletter eligibility epoch missing' using errcode = '55000';
  end if;
  if v_epoch = p_expected_epoch then
    return false;
  end if;

  -- Recheck the fence after waiting for the epoch lock. This update, the run
  -- supersession, and evidence cleanup commit together or roll back together.
  update public.builder_newsletter_site_jobs
  set state = 'queued', available_at = clock_timestamp(), lease_owner = null,
      lease_expires_at = null, consecutive_failure_count = 0,
      last_checkpoint_at = clock_timestamp(), updated_at = clock_timestamp()
  where site_id = p_site_id and id = p_job_id and state = 'leased'
    and lease_owner = p_worker_id and lease_fencing_token = p_fencing
    and lease_expires_at > clock_timestamp();
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;

  update public.builder_newsletter_reconciliation_runs
  set state = 'superseded', completed_at = clock_timestamp(), updated_at = clock_timestamp()
  where site_id = p_site_id and id = p_run_id and job_id = p_job_id
    and state = 'running' and expected_eligibility_epoch = p_expected_epoch;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;

  delete from public.builder_newsletter_reconciliation_members
  where site_id = p_site_id and run_id = p_run_id;
  return true;
end;
$$;

revoke all on function builder_private.restart_newsletter_reconciliation_epoch_v1(uuid, uuid, uuid, uuid, bigint, bigint)
  from public, anon, authenticated;
grant execute on function builder_private.restart_newsletter_reconciliation_epoch_v1(uuid, uuid, uuid, uuid, bigint, bigint)
  to service_role;

create or replace function public.builder_reserve_newsletter_segment_removal_v1(p_request jsonb)
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
  v_provider_contact_id text;
  v_subscription_id uuid;
  v_contact_generation integer;
  v_seen_local boolean;
  v_action_state text;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_job_id := (p_request ->> 'jobId')::uuid;
    v_run_id := (p_request ->> 'runId')::uuid;
    v_worker_id := (p_request ->> 'workerId')::uuid;
    v_fencing := (p_request ->> 'fencingToken')::bigint;
    v_expected_epoch := (p_request ->> 'expectedEligibilityEpoch')::bigint;
    v_provider_contact_id := p_request ->> 'providerContactId';
    v_subscription_id := nullif(p_request ->> 'subscriptionId', '')::uuid;
    v_contact_generation := nullif(p_request ->> 'contactGeneration', '')::integer;
    v_seen_local := coalesce((p_request ->> 'seenLocal')::boolean, false);
  exception when others then
    raise exception 'invalid newsletter segment removal reservation' using errcode = '22023';
  end;
  if (p_request ->> 'version') <> '1'
    or char_length(v_provider_contact_id) not between 1 and 200
    or (v_contact_generation is not null and v_contact_generation <= 0)
  then
    raise exception 'invalid newsletter segment removal reservation' using errcode = '22023';
  end if;

  if builder_private.restart_newsletter_reconciliation_epoch_v1(
    v_site_id, v_job_id, v_run_id, v_worker_id, v_fencing, v_expected_epoch
  ) then
    -- No reservation was recorded; callers must not perform a provider removal.
    return jsonb_build_object('version', 1, 'status', 'restarted');
  end if;
  if not exists (
    select 1
    from public.builder_newsletter_reconciliation_runs run
    join public.builder_newsletter_site_jobs job
      on job.site_id = run.site_id and job.id = run.job_id
    where run.site_id = v_site_id and run.id = v_run_id and run.job_id = v_job_id
      and run.state = 'running' and run.expected_eligibility_epoch = v_expected_epoch
      and job.state = 'leased' and job.lease_owner = v_worker_id
      and job.lease_fencing_token = v_fencing
      and job.lease_expires_at > clock_timestamp()
  ) then
    raise exception 'newsletter job lease lost' using errcode = '55000';
  end if;

  select member.action_state into v_action_state
  from public.builder_newsletter_reconciliation_members member
  where member.site_id = v_site_id and member.run_id = v_run_id
    and member.provider_contact_id = v_provider_contact_id
  for update;
  if found then
    return jsonb_build_object('version', 1, 'status', v_action_state);
  end if;

  insert into public.builder_newsletter_reconciliation_members (
    site_id, run_id, provider_contact_id, subscription_id, contact_generation,
    seen_provider, seen_local, eligible, disposition, action_state
  ) values (
    v_site_id, v_run_id, v_provider_contact_id, v_subscription_id, v_contact_generation,
    true, v_seen_local, false,
    case when v_subscription_id is null then 'provider_only' else 'locally_ineligible' end,
    'pending'
  );
  return jsonb_build_object('version', 1, 'status', 'reserved');
end;
$$;

create or replace function public.builder_checkpoint_newsletter_reconciliation_v1(p_request jsonb)
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

  if builder_private.restart_newsletter_reconciliation_epoch_v1(
    v_site_id, v_job_id, v_run_id, v_worker_id, v_fencing, v_expected_epoch
  ) then
    return jsonb_build_object('version', 1, 'status', 'restarted');
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

-- CREATE OR REPLACE retains privileges; restate the restricted RPC boundary.
revoke all on function public.builder_reserve_newsletter_segment_removal_v1(jsonb),
  public.builder_checkpoint_newsletter_reconciliation_v1(jsonb) from public, anon, authenticated;
grant execute on function public.builder_reserve_newsletter_segment_removal_v1(jsonb),
  public.builder_checkpoint_newsletter_reconciliation_v1(jsonb) to service_role;
