-- Delivery evidence is not login completion, membership or newsletter consent.
create table public.builder_staff_auth_requests (
  id uuid primary key,
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  membership_generation integer not null,
  recipient_digest text not null check (recipient_digest ~ '^[a-f0-9]{64}$'),
  policy_version text not null default 'resend-staff-auth-delivery-v1' check (policy_version='resend-staff-auth-delivery-v1'),
  state text not null default 'reserved' check (state in ('reserved','accepted','failed','uncertain')),
  reserved_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz,
  outcome_code text,
  finalized_at timestamptz,
  check ((state='accepted' and accepted_at between reserved_at and reserved_at+interval '20 seconds') or (state<>'accepted' and accepted_at is null)),
  unique (site_id,id)
);
create index builder_staff_auth_requests_target_time_idx on public.builder_staff_auth_requests(site_id,recipient_digest,reserved_at);
create index builder_staff_auth_requests_pending_idx on public.builder_staff_auth_requests(reserved_at) where state='reserved';

create table public.builder_staff_auth_accounting_jobs (
  request_id uuid primary key references public.builder_staff_auth_requests(id) on delete restrict,
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  state text not null default 'queued' check (state in ('queued','leased','completed','unresolved')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 12),
  fencing_token bigint not null default 0,
  worker_id uuid,
  lease_until timestamptz,
  available_at timestamptz not null default clock_timestamp(),
  deadline_at timestamptz not null,
  last_code text,
  check ((state='leased' and worker_id is not null and lease_until is not null) or (state<>'leased' and worker_id is null and lease_until is null))
);
create index builder_staff_auth_jobs_due_idx on public.builder_staff_auth_accounting_jobs(site_id,available_at) where state in ('queued','leased');

create table public.builder_staff_auth_delivery_evidence (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  provider_scope_id text not null check (provider_scope_id='resend-team-production'),
  policy_version text not null check (policy_version='resend-staff-auth-delivery-v1'),
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 200),
  target_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_digest text not null check (recipient_digest ~ '^[a-f0-9]{64}$'),
  purpose text not null check (purpose in ('staff_sign_in','account_confirmation')),
  provenance text not null check (provenance in ('tracked_request','owner_approved_history')),
  request_id uuid references public.builder_staff_auth_requests(id) on delete restrict,
  provider_created_at timestamptz not null,
  sender text not null check (sender='no-reply@updates.assemblywomanmorales.com'),
  subject text not null,
  sent_receipt_id uuid not null,
  delivered_receipt_id uuid not null,
  metadata_digest text not null check (metadata_digest ~ '^[a-f0-9]{64}$'),
  audit_correlation text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (site_id,provider_message_id), unique (site_id,request_id),
  foreign key (site_id,sent_receipt_id) references public.builder_newsletter_webhook_receipts(site_id,id) on delete restrict,
  foreign key (site_id,delivered_receipt_id) references public.builder_newsletter_webhook_receipts(site_id,id) on delete restrict,
  check (sent_receipt_id<>delivered_receipt_id),
  check ((provenance='tracked_request' and request_id is not null and purpose='staff_sign_in' and subject='Your sign-in link')
    or (provenance='owner_approved_history' and request_id is null))
);
alter table public.builder_staff_auth_requests enable row level security;
alter table public.builder_staff_auth_accounting_jobs enable row level security;
alter table public.builder_staff_auth_delivery_evidence enable row level security;
revoke all on public.builder_staff_auth_requests,public.builder_staff_auth_accounting_jobs,public.builder_staff_auth_delivery_evidence from public,anon,authenticated,service_role;
grant select on public.builder_staff_auth_requests,public.builder_staff_auth_accounting_jobs,public.builder_staff_auth_delivery_evidence to service_role;
create function public.builder_staff_auth_reject_evidence_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'immutable_delivery_evidence' using errcode='55000'; end;
$$;
create trigger builder_staff_auth_evidence_immutable before update or delete on public.builder_staff_auth_delivery_evidence
  for each row execute function public.builder_staff_auth_reject_evidence_change();

-- Compact ordered arrays match JSON.stringify; preserve whitespace inside strings.
create function public.builder_staff_compact_json(p_value jsonb) returns text language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value)='array' then
    '[' || coalesce((select string_agg(public.builder_staff_compact_json(v),',' order by n) from jsonb_array_elements(p_value) with ordinality as t(v,n)),'') || ']'
    else p_value::text end;
$$;
create function public.builder_staff_delivery_canonical(p_row jsonb) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_array(1,p_row->>'policyVersion',p_row->>'siteId',p_row->>'providerScopeId',p_row->>'providerMessageId',
    p_row->>'sender',p_row->>'recipientDigest',p_row->>'subject',
    to_char((p_row->>'providerCreatedAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    p_row->>'targetUserId',p_row->>'purpose',p_row->>'provenance',p_row->>'requestId',p_row->>'sentReceiptId',p_row->>'deliveredReceiptId');
$$;
create function public.builder_staff_sha256(p_value text) returns text language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(p_value,'UTF8')),'hex');
$$;
create function public.builder_staff_auth_conflict(p_site uuid,p_message text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.builder_newsletter_jobs where site_id=p_site and provider_message_id=p_message and kind='newsletter.confirmation.send')
    or exists(select 1 from public.builder_newsletter_staff_test_observations where site_id=p_site and provider_message_id=p_message and state in ('provisional_test','confirmed_test'))
    or exists(select 1 from public.builder_newsletter_auth_smtp_proofs where site_id=p_site and provider_message_id=p_message)
    or exists(select 1 from public.builder_newsletter_provider_history_reconciliations where site_id=p_site and provider_message_id=p_message)
    or exists(select 1 from public.builder_newsletter_webhook_receipts where site_id=p_site and provider_message_id=p_message and provider_broadcast_id is not null);
$$;

create function public.builder_staff_auth_reserve(p_site_key text,p_email text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_site uuid; v_user uuid; v_generation integer; v_digest text; v_now timestamptz;
begin
  select s.id,u.id,m.session_generation into v_site,v_user,v_generation
    from public.builder_sites s join public.builder_site_members m on m.site_id=s.id join auth.users u on u.id=m.user_id
    where s.site_key=p_site_key and lower(btrim(u.email))=lower(btrim(p_email)) and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and m.role::text in ('owner','editor','contributor','viewer');
  if v_user is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_site::text,6434));
  v_now:=clock_timestamp(); v_digest:=public.builder_staff_sha256(lower(btrim(p_email)));
  if exists(select 1 from public.builder_staff_auth_requests where site_id=v_site and recipient_digest=v_digest and reserved_at>v_now-interval '60 seconds')
    or (select count(*) from public.builder_staff_auth_requests where site_id=v_site and recipient_digest=v_digest and reserved_at>v_now-interval '1 hour')>=6
    or (select count(*) from public.builder_staff_auth_requests where site_id=v_site and reserved_at>v_now-interval '1 hour')>=20 then return null; end if;
  -- Recheck membership while holding the reservation lock; no client role/time is trusted.
  if not exists(select 1 from public.builder_site_members where site_id=v_site and user_id=v_user and session_generation=v_generation and role::text in ('owner','editor','contributor','viewer')) then return null; end if;
  insert into public.builder_staff_auth_requests(id,site_id,target_user_id,membership_generation,recipient_digest,reserved_at)
    values(p_request_id,v_site,v_user,v_generation,v_digest,v_now);
  return jsonb_build_object('id',p_request_id,'reserved_at',v_now);
end;
$$;
create function public.builder_staff_auth_finalize(p_request_id uuid,p_state text,p_code text) returns text language plpgsql security definer set search_path='' as $$
declare r public.builder_staff_auth_requests; v_now timestamptz; v_state text;
begin
  select * into r from public.builder_staff_auth_requests where id=p_request_id;
  if r.id is null then raise exception 'request_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.site_id::text,6434));
  select * into r from public.builder_staff_auth_requests where id=p_request_id for update;
  if p_state not in ('accepted','failed','uncertain') or p_code not in ('auth_accepted','auth_rejected','auth_uncertain','dispatch_expired_no_send','outcome_unpersisted') then raise exception 'invalid_outcome'; end if;
  if r.state<>'reserved' then
    if r.state=p_state and r.outcome_code=p_code then return r.state; end if;
    raise exception 'outcome_conflict';
  end if;
  v_now:=clock_timestamp(); v_state:=p_state;
  if p_state='accepted' and (v_now>r.reserved_at+interval '20 seconds' or not exists(select 1 from public.builder_site_members
    where site_id=r.site_id and user_id=r.target_user_id and session_generation=r.membership_generation and role::text in ('owner','editor','contributor','viewer'))) then v_state:='uncertain'; end if;
  update public.builder_staff_auth_requests set state=v_state,accepted_at=case when v_state='accepted' then v_now else null end,
    finalized_at=v_now,outcome_code=case when p_state='accepted' and v_state='uncertain' then 'late_or_stale_acceptance' else p_code end where id=p_request_id;
  if v_state='accepted' then insert into public.builder_staff_auth_accounting_jobs(request_id,site_id,available_at,deadline_at)
    values(r.id,r.site_id,v_now,v_now+interval '7 days'); end if;
  -- Check again after the atomic queue write; a slow transaction is not accepted.
  if v_state='accepted' and clock_timestamp()>r.reserved_at+interval '20 seconds' then
    delete from public.builder_staff_auth_accounting_jobs where request_id=r.id;
    update public.builder_staff_auth_requests set state='uncertain',accepted_at=null,finalized_at=clock_timestamp(),
      outcome_code='late_or_stale_acceptance' where id=r.id;
    v_state:='uncertain';
  end if;
  return v_state;
end;
$$;
create function public.builder_staff_auth_housekeeping() returns void language plpgsql security definer set search_path='' as $$
begin
  update public.builder_staff_auth_requests set state='uncertain',finalized_at=clock_timestamp(),outcome_code='interrupted_reservation'
    where state='reserved' and reserved_at<clock_timestamp()-interval '30 seconds';
  update public.builder_staff_auth_accounting_jobs set state='unresolved',worker_id=null,lease_until=null,last_code='accounting_exhausted',fencing_token=fencing_token+1
    where state in ('queued','leased') and (deadline_at<=clock_timestamp() or (attempt_count>=12 and (state='queued' or lease_until<=clock_timestamp())));
end;
$$;
create function public.builder_staff_auth_claim(p_site_id uuid,p_worker_id uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.builder_staff_auth_accounting_jobs; result jsonb:='[]';
begin
  perform public.builder_staff_auth_housekeeping();
  for j in select * from public.builder_staff_auth_accounting_jobs where site_id=p_site_id and deadline_at>clock_timestamp() and attempt_count<12
    and ((state='queued' and available_at<=clock_timestamp()) or (state='leased' and lease_until<=clock_timestamp()))
    order by available_at,request_id for update skip locked limit greatest(0,least(p_limit,2)) loop
    update public.builder_staff_auth_accounting_jobs set state='leased',attempt_count=attempt_count+1,fencing_token=fencing_token+1,
      worker_id=p_worker_id,lease_until=clock_timestamp()+interval '60 seconds' where request_id=j.request_id returning * into j;
    result:=result||jsonb_build_array(to_jsonb(j));
  end loop;
  return result;
end;
$$;
create function public.builder_staff_auth_fail(p_request_id uuid,p_worker_id uuid,p_fencing_token bigint,p_code text) returns void language plpgsql security definer set search_path='' as $$
declare j public.builder_staff_auth_accounting_jobs; v_now timestamptz:=clock_timestamp();
begin
  select * into j from public.builder_staff_auth_accounting_jobs where request_id=p_request_id for update;
  if j.state is distinct from 'leased' or j.worker_id is distinct from p_worker_id or j.fencing_token is distinct from p_fencing_token or j.lease_until<=v_now then raise exception 'stale_claim'; end if;
  if p_code not in ('missing_receipts','ambiguous_delivery','metadata_unavailable','database_unavailable','budget_exhausted') then p_code:='database_unavailable'; end if;
  update public.builder_staff_auth_accounting_jobs set state=case when attempt_count>=12 or deadline_at<=v_now then 'unresolved' else 'queued' end,
    worker_id=null,lease_until=null,last_code=p_code,
    available_at=v_now+make_interval(secs=>least(60*power(2,j.attempt_count-1),21600)::integer) where request_id=p_request_id;
end;
$$;

-- Internal insert: called only from fenced worker or exact-five owner operation.
create function public.builder_staff_auth_insert(p_row jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare v_site uuid:=(p_row->>'siteId')::uuid; v_msg text:=p_row->>'providerMessageId'; v_digest text;
  v_sent uuid; v_delivered uuid; existing public.builder_staff_auth_delivery_evidence;
begin
  v_digest:=public.builder_staff_sha256(public.builder_staff_compact_json(public.builder_staff_delivery_canonical(p_row)));
  if p_row->>'metadataDigest' is distinct from v_digest or p_row->>'policyVersion' is distinct from 'resend-staff-auth-delivery-v1'
    or p_row->>'providerScopeId' is distinct from 'resend-team-production' or p_row->>'sender' is distinct from 'no-reply@updates.assemblywomanmorales.com'
    or public.builder_staff_auth_conflict(v_site,v_msg) then raise exception 'delivery_evidence_invalid'; end if;
  if exists(select 1 from public.builder_newsletter_webhook_receipts where site_id=v_site and provider_message_id=v_msg and
    (provider_scope_id is distinct from 'resend-team-production' or disposition is distinct from 'matched' or provider_broadcast_id is not null
      or event_type not in ('email.sent','email.delivered','email.opened','email.clicked') or event_type is null)) then raise exception 'unsafe_receipt'; end if;
  if (select count(*) from public.builder_newsletter_webhook_receipts where site_id=v_site and provider_message_id=v_msg and event_type='email.sent')<>1
    or (select count(*) from public.builder_newsletter_webhook_receipts where site_id=v_site and provider_message_id=v_msg and event_type='email.delivered')<>1 then raise exception 'missing_receipts'; end if;
  select id into v_sent from public.builder_newsletter_webhook_receipts where site_id=v_site and provider_message_id=v_msg and event_type='email.sent';
  select id into v_delivered from public.builder_newsletter_webhook_receipts where site_id=v_site and provider_message_id=v_msg and event_type='email.delivered';
  if v_sent is distinct from (p_row->>'sentReceiptId')::uuid or v_delivered is distinct from (p_row->>'deliveredReceiptId')::uuid then raise exception 'receipt_identity_mismatch'; end if;
  select * into existing from public.builder_staff_auth_delivery_evidence where site_id=v_site and provider_message_id=v_msg;
  if existing.id is not null then
    if existing.metadata_digest=v_digest then return false; end if;
    raise exception 'evidence_conflict';
  end if;
  insert into public.builder_staff_auth_delivery_evidence(site_id,provider_scope_id,policy_version,provider_message_id,target_user_id,recipient_digest,purpose,provenance,request_id,
    provider_created_at,sender,subject,sent_receipt_id,delivered_receipt_id,metadata_digest,audit_correlation)
    values(v_site,p_row->>'providerScopeId',p_row->>'policyVersion',v_msg,(p_row->>'targetUserId')::uuid,p_row->>'recipientDigest',p_row->>'purpose',p_row->>'provenance',
      (p_row->>'requestId')::uuid,(p_row->>'providerCreatedAt')::timestamptz,p_row->>'sender',p_row->>'subject',v_sent,v_delivered,v_digest,p_row->>'auditCorrelation');
  return true;
end;
$$;
create function public.builder_staff_auth_record(p_request_id uuid,p_worker_id uuid,p_fencing_token bigint,p_row jsonb) returns text language plpgsql security definer set search_path='' as $$
declare r public.builder_staff_auth_requests; j public.builder_staff_auth_accounting_jobs; v_created timestamptz:=(p_row->>'providerCreatedAt')::timestamptz; added boolean;
begin
  select * into r from public.builder_staff_auth_requests where id=p_request_id;
  if r.id is null then raise exception 'request_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.site_id::text,6434));
  lock table public.builder_newsletter_webhook_receipts in share mode;
  select * into j from public.builder_staff_auth_accounting_jobs where request_id=p_request_id for update;
  if j.state is distinct from 'leased' or j.worker_id is distinct from p_worker_id or j.fencing_token is distinct from p_fencing_token
    or j.lease_until<=clock_timestamp() or j.deadline_at<=clock_timestamp() then raise exception 'stale_claim'; end if;
  select * into r from public.builder_staff_auth_requests where id=p_request_id for update;
  if r.state<>'accepted' or r.accepted_at is null or r.accepted_at>r.reserved_at+interval '20 seconds'
    or p_row->>'requestId' is distinct from r.id::text or p_row->>'siteId' is distinct from r.site_id::text
    or p_row->>'targetUserId' is distinct from r.target_user_id::text or p_row->>'recipientDigest' is distinct from r.recipient_digest
    or p_row->>'purpose' is distinct from 'staff_sign_in' or p_row->>'subject' is distinct from 'Your sign-in link'
    or p_row->>'provenance' is distinct from 'tracked_request' or v_created<r.reserved_at-interval '5 seconds' or v_created>r.accepted_at+interval '5 seconds'
    or exists(select 1 from public.builder_staff_auth_requests where site_id=r.site_id and recipient_digest=r.recipient_digest and state in ('reserved','uncertain'))
    or (select count(*) from public.builder_staff_auth_requests where site_id=r.site_id and recipient_digest=r.recipient_digest and state='accepted'
      and v_created between reserved_at-interval '5 seconds' and accepted_at+interval '5 seconds')<>1 then raise exception 'ambiguous_delivery'; end if;
  added:=public.builder_staff_auth_insert(p_row);
  if added then insert into public.builder_audit_events(site_id,action,actor_id,summary,correlation_id,after_value)
    values(r.site_id,'staff_auth.delivery_recorded',r.target_user_id,'Staff sign-in email delivery accounted; not login redemption.',p_row->>'auditCorrelation',
      jsonb_build_object('policy',r.policy_version,'execution_source','automatic_delivery_accounting','request_id',r.id,'metadata_digest',p_row->>'metadataDigest')); end if;
  if j.lease_until<=clock_timestamp() then raise exception 'stale_claim'; end if;
  update public.builder_staff_auth_accounting_jobs set state='completed',worker_id=null,lease_until=null,last_code='delivery_recorded' where request_id=p_request_id;
  return case when added then 'recorded' else 'already_recorded' end;
end;
$$;

create function public.builder_staff_auth_history_apply(p_site_id uuid,p_owner_id uuid,p_entries jsonb,p_digest text,p_execution_source text) returns text language plpgsql security definer set search_path='' as $$
declare manifest jsonb:=jsonb_build_array(
  jsonb_build_array('01a10f46-0578-7ea0-bb40-9b0a67302246',public.builder_staff_sha256('damonyoung@dtvprods.com'),'Your sign-in link','staff_sign_in'),
  jsonb_build_array('01a10f42-92f2-7c6a-92d7-af4105f4f749',public.builder_staff_sha256('damonyoung@dtvprods.com'),'Your sign-in link','staff_sign_in'),
  jsonb_build_array('01a10466-178c-721d-8b68-48cc14ca8238',public.builder_staff_sha256('damonyoung@dtvprods.com'),'Your sign-in link','staff_sign_in'),
  jsonb_build_array('01a0fb38-5f40-755d-ada4-e820dd4fc50b',public.builder_staff_sha256('damonyoung@dtvprods.com'),'Confirm your email address','account_confirmation'),
  jsonb_build_array('01a0fb38-b3bc-7d96-9065-8fe8ef2a7b9e',public.builder_staff_sha256('anotherstory713@gmail.com'),'Your sign-in link','staff_sign_in'));
  m jsonb; e jsonb; ordered jsonb; target uuid; added integer:=0; actual text;
begin
  if p_execution_source is null or p_execution_source not in ('owner_approved_management_operation','owner_authenticated_website_operation') then raise exception 'invalid_execution_source'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_site_id::text,6434));
  lock table public.builder_newsletter_webhook_receipts in share mode;
  if not exists(select 1 from public.builder_site_members where site_id=p_site_id and user_id=p_owner_id and role::text='owner') then raise exception 'owner_required'; end if;
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)<>5
    or (select count(distinct x->>'providerMessageId') from jsonb_array_elements(p_entries) x)<>5 then raise exception 'history_boundary_mismatch'; end if;
  select jsonb_agg(public.builder_staff_delivery_canonical(x) order by x->>'providerMessageId') into ordered from jsonb_array_elements(p_entries) x;
  actual:=public.builder_staff_sha256(public.builder_staff_compact_json(jsonb_build_array(1,'resend-staff-auth-delivery-v1',p_site_id::text,p_owner_id::text,manifest,ordered)));
  if p_digest is distinct from actual then raise exception 'plan_digest_mismatch'; end if;
  for m in select value from jsonb_array_elements(manifest) loop
    select value into e from jsonb_array_elements(p_entries) where value->>'providerMessageId'=m->>0;
    select u.id into target from auth.users u join public.builder_site_members s on s.user_id=u.id and s.site_id=p_site_id
      where public.builder_staff_sha256(lower(btrim(u.email)))=m->>1 and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false);
    if e is null or target is null or e->>'targetUserId' is distinct from target::text or e->>'siteId' is distinct from p_site_id::text
      or e->>'recipientDigest' is distinct from m->>1 or e->>'subject' is distinct from m->>2 or e->>'purpose' is distinct from m->>3
      or e->>'provenance' is distinct from 'owner_approved_history' or e->>'requestId' is not null then raise exception 'history_evidence_mismatch'; end if;
    if public.builder_staff_auth_insert(e) then added:=added+1; end if;
  end loop;
  if added not in (0,5) then raise exception 'partial_history_conflict'; end if;
  if added=5 then insert into public.builder_audit_events(site_id,action,actor_id,summary,correlation_id,after_value)
    values(p_site_id,'staff_auth.history_reconciled',p_owner_id,'Five owner-approved authentication deliveries reconciled; no login or consent claimed.',actual,
      jsonb_build_object('policy','resend-staff-auth-delivery-v1','execution_source',p_execution_source,'count',5,'plan_digest',actual)); end if;
  return case when added=5 then 'recorded' else 'already_recorded' end;
end;
$$;
create function public.builder_staff_auth_recover(p_site_id uuid,p_owner_id uuid,p_request_id uuid,p_command_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare r public.builder_staff_auth_requests; j public.builder_staff_auth_accounting_jobs;
begin
  if not exists(select 1 from public.builder_site_members where site_id=p_site_id and user_id=p_owner_id and role::text='owner') then raise exception 'owner_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_site_id::text,6434));
  select * into r from public.builder_staff_auth_requests where id=p_request_id and site_id=p_site_id for update;
  select * into j from public.builder_staff_auth_accounting_jobs where request_id=p_request_id and site_id=p_site_id for update;
  if r.state is distinct from 'accepted' or j.request_id is null or j.deadline_at<=clock_timestamp() or j.state='completed' then raise exception 'review_required'; end if;
  if exists(select 1 from public.builder_audit_events where site_id=p_site_id and action='staff_auth.accounting_recovered' and correlation_id=p_command_id::text) then return 'already_recorded'; end if;
  update public.builder_staff_auth_accounting_jobs set state='queued',attempt_count=0,fencing_token=fencing_token+1,worker_id=null,lease_until=null,
    available_at=clock_timestamp(),last_code='owner_recovery' where request_id=p_request_id;
  insert into public.builder_audit_events(site_id,action,actor_id,summary,correlation_id,after_value)
    values(p_site_id,'staff_auth.accounting_recovered',p_owner_id,'Accepted sign-in delivery accounting requeued without resending.',p_command_id::text,
      jsonb_build_object('request_id',p_request_id,'execution_source','owner_authenticated_website_operation'));
  return 'queued';
end;
$$;

-- Default function grants are deliberately revoked, including internal helpers.
revoke all on function public.builder_staff_auth_reject_evidence_change(),public.builder_staff_compact_json(jsonb),public.builder_staff_delivery_canonical(jsonb),public.builder_staff_sha256(text),
  public.builder_staff_auth_conflict(uuid,text),public.builder_staff_auth_insert(jsonb),public.builder_staff_auth_reserve(text,text,uuid),
  public.builder_staff_auth_finalize(uuid,text,text),public.builder_staff_auth_housekeeping(),public.builder_staff_auth_claim(uuid,uuid,integer),
  public.builder_staff_auth_fail(uuid,uuid,bigint,text),public.builder_staff_auth_record(uuid,uuid,bigint,jsonb),
  public.builder_staff_auth_history_apply(uuid,uuid,jsonb,text,text),public.builder_staff_auth_recover(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.builder_staff_auth_reserve(text,text,uuid),public.builder_staff_auth_finalize(uuid,text,text),
  public.builder_staff_auth_housekeeping(),public.builder_staff_auth_claim(uuid,uuid,integer),public.builder_staff_auth_fail(uuid,uuid,bigint,text),
  public.builder_staff_auth_record(uuid,uuid,bigint,jsonb),public.builder_staff_auth_history_apply(uuid,uuid,jsonb,text,text),
  public.builder_staff_auth_recover(uuid,uuid,uuid,uuid) to service_role;
