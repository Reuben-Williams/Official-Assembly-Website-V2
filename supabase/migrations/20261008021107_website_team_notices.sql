-- Additive, disabled until an explicit service activation. No historic backfill.
create table builder_private.builder_team_notice_activation (
  site_id uuid primary key references public.builder_sites(id),
  cutoff timestamptz not null default clock_timestamp(),
  epoch uuid not null default gen_random_uuid(),
  enabled boolean not null default false,
  worker_until timestamptz,
  worker_id uuid
);
create table builder_private.builder_team_notice_tests (
  site_id uuid not null, submission_id uuid not null,
  primary key(site_id,submission_id),
  foreign key(site_id,submission_id) references public.builder_form_submissions(site_id,id) on delete cascade
);
create table builder_private.builder_team_notice_deliveries (
  site_id uuid not null references public.builder_sites(id),
  id uuid not null default gen_random_uuid(), queue_id uuid,
  epoch uuid not null, policy_version text not null check(policy_version='website-team-notice-v1'),
  provider_scope text not null check(provider_scope='resend-team-production'),
  correlation uuid not null default gen_random_uuid(), idempotency_key text not null,
  payload jsonb not null,
  state text not null default 'pending' check(state in ('pending','leased','accepted','failed','review')),
  outcome text not null default 'pending' check(outcome in ('pending','accepted','delivered','failed','bounced','suppressed')),
  provider_message_id text,
  first_attempt_at timestamptz, last_attempt_at timestamptz, attempt_times timestamptz[] not null default '{}',
  retry_deadline timestamptz, next_attempt_at timestamptz not null default clock_timestamp(),
  attempt_count int not null default 0, worker_id uuid, fence bigint not null default 0, lease_until timestamptz,
  safe_code text, conflicting_ids text[] not null default '{}', created_at timestamptz not null default clock_timestamp(),
  primary key(site_id,id), unique(site_id,queue_id), unique(correlation), unique(idempotency_key),
  unique(provider_scope,provider_message_id),
  foreign key(site_id,queue_id) references builder_private.builder_form_notification_queue(site_id,id) on delete set null (queue_id)
);
create index builder_team_notice_claim_idx on builder_private.builder_team_notice_deliveries(site_id,state,next_attempt_at);
create table builder_private.builder_team_notice_receipts (
  site_id uuid not null, job_id uuid not null, svix_id text not null, event_type text not null,
  event_created_at timestamptz not null, provider_message_id text not null,
  primary key(site_id,svix_id),
  foreign key(site_id,job_id) references builder_private.builder_team_notice_deliveries(site_id,id)
);
create table builder_private.builder_team_notice_reviews (
  site_id uuid not null, job_id uuid not null, actor_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(site_id,job_id) references builder_private.builder_team_notice_deliveries(site_id,id)
);

alter table builder_private.builder_team_notice_activation enable row level security;
alter table builder_private.builder_team_notice_tests enable row level security;
alter table builder_private.builder_team_notice_deliveries enable row level security;
alter table builder_private.builder_team_notice_receipts enable row level security;
alter table builder_private.builder_team_notice_reviews enable row level security;
revoke all on builder_private.builder_team_notice_activation, builder_private.builder_team_notice_tests,
  builder_private.builder_team_notice_deliveries, builder_private.builder_team_notice_receipts,
  builder_private.builder_team_notice_reviews from public, anon, authenticated, service_role;

-- Fixed notice contains no resident information or identifier. No browser access.
create function public.builder_team_notices_v1(p_site_id uuid, p_operation text, p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  a builder_private.builder_team_notice_activation%rowtype;
  j builder_private.builder_team_notice_deliveries%rowtype;
  q record;
  v_now timestamptz := clock_timestamp();
  v_id uuid; v_worker uuid; v_correlation uuid; v_key text; v_payload jsonb;
  v_result jsonb := '[]'; v_outcome text; v_email_id text; v_event text;
  v_email_time timestamptz; v_event_time timestamptz;
  v_text text := E'A new website form submission is available. Sign in to the Staff Portal to review it securely.\n\nhttps://www.assemblywomanmorales.com/admin/editor?workspace=website.submissions\n\nResident details are available only in the authorized Staff Portal.';
  v_html text := '<p>A new website form submission is available.</p><p><a href="https://www.assemblywomanmorales.com/admin/editor?workspace=website.submissions">Sign in to the Staff Portal</a> to review it securely.</p><p>Resident details are available only in the authorized Staff Portal.</p>';
begin
  if auth.role() is distinct from 'service_role' then raise exception 'NOTICE_SERVICE_ONLY' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text)>8192 then raise exception 'INVALID_NOTICE_REQUEST'; end if;

  if p_operation='activation' then
    insert into builder_private.builder_team_notice_activation(site_id,enabled)
      values(p_site_id,coalesce((p_input->>'enabled')::boolean,false))
      on conflict(site_id) do update set enabled=excluded.enabled;
    select * into a from builder_private.builder_team_notice_activation where site_id=p_site_id;
    return jsonb_build_object('enabled',a.enabled,'cutoff',a.cutoff,'epoch',a.epoch);
  elsif p_operation='mark_test' then
    -- Only trusted service metadata; never infer a test from resident-entered fields.
    insert into builder_private.builder_team_notice_tests values(p_site_id,(p_input->>'submissionId')::uuid) on conflict do nothing;
    return 'true';
  elsif p_operation='message_ids' then
    select coalesce(jsonb_agg(d.provider_message_id),'[]') into v_result from (
      select provider_message_id from builder_private.builder_team_notice_deliveries
      where site_id=p_site_id and provider_scope='resend-team-production' and policy_version='website-team-notice-v1'
        and provider_message_id is not null and first_attempt_at is not null
        and payload->'to'='["aswcmoralesteam@gmail.com"]'::jsonb
      order by id limit 1000 offset greatest(0,least(100000,coalesce((p_input->>'offset')::int,0)))
    ) d; return v_result;
  elsif p_operation='status' then
    select * into a from builder_private.builder_team_notice_activation where site_id=p_site_id;
    select jsonb_build_object('enabled',coalesce(a.enabled,false),'cutoff',a.cutoff,
      'pending',count(*) filter(where state in ('pending','leased')),
      'accepted',count(*) filter(where state='accepted'),
      'delivered',count(*) filter(where outcome='delivered'),
      'failed',count(*) filter(where outcome in ('failed','bounced','suppressed') or state='failed'),
      'reviewRequired',count(*) filter(where state='review')) into v_result
    from builder_private.builder_team_notice_deliveries where site_id=p_site_id;
    return v_result||jsonb_build_object('reviewJobs',coalesce((select jsonb_agg(x) from (
      select id, safe_code as "safeCode", outcome from builder_private.builder_team_notice_deliveries
      where site_id=p_site_id and state='review' order by created_at limit 10) x),'[]'));
  elsif p_operation='claim' then
    select * into a from builder_private.builder_team_notice_activation where site_id=p_site_id for update;
    if not found or not a.enabled or a.worker_until>v_now then return '[]'; end if;
    v_worker := (p_input->>'workerId')::uuid;
    if v_worker is null then raise exception 'INVALID_NOTICE_REQUEST'; end if;
    update builder_private.builder_team_notice_activation set worker_until=v_now+interval '60 seconds',worker_id=v_worker where site_id=p_site_id;
    for q in select nq.id from builder_private.builder_form_notification_queue nq
      join public.builder_form_submissions s on s.site_id=nq.site_id and s.id=nq.submission_id
      where nq.site_id=p_site_id and nq.event_type='form.submission.accepted'
        and nq.created_at>=a.cutoff and s.created_at>=a.cutoff and s.received_at>=a.cutoff
        and s.source='public_form' and s.template_id in ('local-business.contact','local-business.newsletter-signup')
        and not exists(select 1 from builder_private.builder_team_notice_tests t where t.site_id=s.site_id and t.submission_id=s.id)
        and not exists(select 1 from builder_private.builder_team_notice_deliveries d where d.site_id=nq.site_id and d.queue_id=nq.id)
      order by nq.created_at,nq.id limit 100
    loop
      v_id:=gen_random_uuid();v_correlation:=gen_random_uuid();
      v_key:='team-notice/'||p_site_id::text||'/'||a.epoch::text||'/'||q.id::text;
      v_payload:=jsonb_build_object('from','Office of Assemblywoman Carmen Morales <newsletter@updates.assemblywomanmorales.com>',
        'to',jsonb_build_array('aswcmoralesteam@gmail.com'),'subject','New website submission — Morales Staff Portal',
        'text',v_text,'html',v_html,'tags',jsonb_build_array(
          jsonb_build_object('name','purpose','value','website_team_notice'),
          jsonb_build_object('name','policy','value','website-team-notice-v1'),
          jsonb_build_object('name','notice_correlation','value',v_correlation::text)));
      insert into builder_private.builder_team_notice_deliveries(site_id,id,queue_id,epoch,policy_version,provider_scope,correlation,idempotency_key,payload)
        values(p_site_id,v_id,q.id,a.epoch,'website-team-notice-v1','resend-team-production',v_correlation,v_key,v_payload) on conflict do nothing;
    end loop;
    update builder_private.builder_team_notice_deliveries set state='review',safe_code='retry_window_expired',lease_until=null
      where site_id=p_site_id and state in ('pending','leased') and retry_deadline<=v_now and coalesce(lease_until,v_now)<=v_now;
    for j in select * from builder_private.builder_team_notice_deliveries
      where site_id=p_site_id and state in ('pending','leased') and next_attempt_at<=clock_timestamp()
        and coalesce(lease_until,v_now)<=v_now and (retry_deadline is null or retry_deadline>v_now)
      order by created_at,id limit 2 for update skip locked
    loop
      update builder_private.builder_team_notice_deliveries set state='leased',worker_id=v_worker,fence=fence+1,lease_until=v_now+interval '60 seconds'
        where site_id=p_site_id and id=j.id returning * into j;
      v_result:=v_result||jsonb_build_array(jsonb_build_object('id',j.id,'fence',j.fence,'payload',j.payload,
        'idempotencyKey',j.idempotency_key,'firstAttemptAt',j.first_attempt_at,'retryDeadline',j.retry_deadline));
    end loop; return v_result;
  elsif p_operation='receipt' then
    -- Caller is the signature-verifying webhook endpoint. Scope is endpoint configuration, not event data.
    if p_input->>'providerScope' is distinct from 'resend-team-production'
      or nullif(p_input->>'broadcastId','') is not null
      or p_input->'tags'->>'purpose' is distinct from 'website_team_notice'
      or p_input->'tags'->>'policy' is distinct from 'website-team-notice-v1'
      or coalesce(p_input->'tags'->>'notice_correlation','') !~ '^[a-f0-9-]{36}$'
    then return '{"matched":false}'; end if;
    select * into j from builder_private.builder_team_notice_deliveries
      where site_id=p_site_id and correlation::text=p_input->'tags'->>'notice_correlation' for update;
    if not found or j.first_attempt_at is null then return '{"matched":false}'; end if;
    v_email_id:=p_input->>'emailId';v_event:=p_input->>'eventType';
    begin v_email_time:=(p_input->>'emailCreatedAt')::timestamptz;v_event_time:=(p_input->>'eventCreatedAt')::timestamptz;
    exception when others then return '{"matched":false}'; end;
    if v_email_id is null or length(v_email_id)<1 or length(v_email_id)>200 or nullif(p_input->>'svixId','') is null
      or v_event not in ('email.sent','email.delivered','email.failed','email.bounced','email.suppressed','email.complained','email.delivery_delayed')
      or p_input->>'from' is distinct from j.payload->>'from'
      or p_input->'to' is distinct from j.payload->'to'
      or p_input->>'subject' is distinct from j.payload->>'subject'
      or v_event_time is null or v_email_time is null
      or not exists(select 1 from unnest(j.attempt_times) t where v_email_time between t-interval '60 seconds' and t+interval '10 minutes')
    then return '{"matched":false}'; end if;
    if (j.provider_message_id is not null and j.provider_message_id<>v_email_id)
      or exists(select 1 from builder_private.builder_team_notice_deliveries d where d.provider_scope=j.provider_scope and d.provider_message_id=v_email_id and d.id<>j.id)
    then
      update builder_private.builder_team_notice_deliveries set state='review',safe_code='provider_id_conflict',conflicting_ids=array_append(conflicting_ids,v_email_id)
        where site_id=p_site_id and id=j.id and not(v_email_id=any(conflicting_ids));
      return '{"matched":false,"review":true}';
    end if;
    insert into builder_private.builder_team_notice_receipts(site_id,job_id,svix_id,event_type,event_created_at,provider_message_id)
      values(p_site_id,j.id,p_input->>'svixId',v_event,v_event_time,v_email_id) on conflict do nothing;
    v_outcome:=case v_event when 'email.delivered' then 'delivered' when 'email.failed' then 'failed'
      when 'email.bounced' then 'bounced' when 'email.suppressed' then 'suppressed' when 'email.complained' then 'suppressed' else 'accepted' end;
    update builder_private.builder_team_notice_deliveries set provider_message_id=v_email_id,
      outcome=case when outcome in ('failed','bounced','suppressed') then outcome
        when v_outcome in ('failed','bounced','suppressed') then v_outcome
        when outcome='delivered' then outcome else v_outcome end,
      state=case when state='review' then state else 'accepted' end
      where site_id=p_site_id and id=j.id;
    return '{"matched":true}';
  elsif p_operation in ('begin','finish','investigate') then
    select * into j from builder_private.builder_team_notice_deliveries where site_id=p_site_id and id=(p_input->>'jobId')::uuid for update;
    if not found then return null; end if;
    if p_operation='investigate' then
      insert into builder_private.builder_team_notice_reviews(site_id,job_id,actor_id) values(p_site_id,j.id,(p_input->>'actorId')::uuid);
      -- Investigation is recorded, not a resend or evidence bypass.
      return jsonb_build_object('status',j.state,'outcome',j.outcome,'safeCode',j.safe_code);
    end if;
    if j.worker_id is distinct from (p_input->>'workerId')::uuid or j.fence is distinct from (p_input->>'fence')::bigint or coalesce(j.lease_until,v_now)<=v_now
    then raise exception 'STALE_NOTICE_LEASE'; end if;
    if p_operation='begin' then
      if j.provider_message_id is not null then return null; end if;
      if j.state<>'leased' or j.retry_deadline<=v_now or j.attempt_count>=8 then
        update builder_private.builder_team_notice_deliveries set state='review',safe_code='retry_window_expired' where site_id=p_site_id and id=j.id;
        return null;
      end if;
      update builder_private.builder_team_notice_deliveries set first_attempt_at=coalesce(first_attempt_at,v_now),last_attempt_at=v_now,
        retry_deadline=coalesce(retry_deadline,v_now+interval '23 hours'),attempt_times=array_append(attempt_times,v_now),attempt_count=attempt_count+1
        where site_id=p_site_id and id=j.id returning * into j;
      return jsonb_build_object('firstAttemptAt',j.first_attempt_at,'retryDeadline',j.retry_deadline);
    end if;
    v_email_id:=nullif(p_input->>'providerMessageId','');
    if v_email_id is not null then
      if j.first_attempt_at is null then raise exception 'NOTICE_ATTEMPT_REQUIRED'; end if;
      if (j.provider_message_id is not null and j.provider_message_id<>v_email_id)
        or exists(select 1 from builder_private.builder_team_notice_deliveries d where d.provider_scope=j.provider_scope and d.provider_message_id=v_email_id and d.id<>j.id)
      then update builder_private.builder_team_notice_deliveries set state='review',safe_code='provider_id_conflict' where site_id=p_site_id and id=j.id;return '"review"'; end if;
      update builder_private.builder_team_notice_deliveries set provider_message_id=v_email_id,state=case when state='review' then state else 'accepted' end,
        outcome=case when outcome='pending' then 'accepted' else outcome end,lease_until=null
        where site_id=p_site_id and id=j.id;
    elsif j.provider_message_id is not null then
      update builder_private.builder_team_notice_deliveries set lease_until=null where site_id=p_site_id and id=j.id;
    else
      update builder_private.builder_team_notice_deliveries set state=case when p_input->>'code'='terminal' then 'failed' when attempt_count>=8 or retry_deadline<=v_now then 'review' else 'pending' end,
        safe_code=case when p_input->>'code'='terminal' then 'provider_rejected' else 'provider_retryable' end,
        next_attempt_at=v_now+(least(3600,60*power(2,least(attempt_count,6)))::text||' seconds')::interval,lease_until=null
        where site_id=p_site_id and id=j.id;
    end if;
    return '"recorded"';
  end if;
  raise exception 'INVALID_NOTICE_OPERATION';
end;
$$;
revoke all on function public.builder_team_notices_v1(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.builder_team_notices_v1(uuid,text,jsonb) to service_role;

-- Database-level protection too: staff notices cannot be reclassified as login evidence.
create function builder_private.reject_team_notice_auth_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from builder_private.builder_team_notice_deliveries
    where site_id=new.site_id and provider_message_id=new.provider_message_id)
  then raise exception 'NOTICE_AUTH_EVIDENCE_CONFLICT' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function builder_private.reject_team_notice_auth_evidence() from public,anon,authenticated,service_role;
do $$
begin
  if to_regclass('public.builder_staff_auth_delivery_evidence') is not null then
    create trigger builder_staff_auth_notice_exclusion before insert or update on public.builder_staff_auth_delivery_evidence
      for each row execute function builder_private.reject_team_notice_auth_evidence();
  end if;
  if to_regclass('public.builder_newsletter_auth_login_evidence') is not null then
    create trigger builder_owner_auth_notice_exclusion before insert or update on public.builder_newsletter_auth_login_evidence
      for each row execute function builder_private.reject_team_notice_auth_evidence();
  end if;
end;
$$;
