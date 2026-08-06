do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'builder_retention_worker') then
    create role builder_retention_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end;
$$;

grant builder_retention_worker to postgres;

create table public.builder_form_submission_consent_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  submission_id uuid not null,
  base_consent_id uuid not null,
  event_kind text not null check (event_kind in ('granted', 'withdrawn')),
  policy_version text not null check (policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  purpose text not null check (purpose ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  language_digest text not null check (language_digest ~ '^[a-f0-9]{64}$'),
  source text not null check (source in ('public_form', 'verified_verbal', 'verified_written', 'unsubscribe')),
  actor_id uuid,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'),
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  subject_identity_hmac text check (subject_identity_hmac is null or subject_identity_hmac ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, submission_id) references public.builder_form_submissions(site_id, id) on delete restrict,
  foreign key (site_id, base_consent_id) references public.builder_form_submission_consents(site_id, id) on delete restrict,
  foreign key (site_id, actor_id) references public.builder_site_members(site_id, user_id) on delete restrict,
  check ((event_kind = 'granted' and reason_code is null) or (event_kind = 'withdrawn' and reason_code is not null))
);

create table public.builder_submission_retention_policies (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  version integer not null check (version > 0),
  raw_retention_days integer not null check (raw_retention_days between 30 and 730),
  effective_at timestamptz not null,
  prior_policy_id uuid,
  authority_kind text not null check (authority_kind in ('provisioning', 'owner_command', 'reviewed_provisioning')),
  authority_receipt_id uuid not null,
  actor_id uuid,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'),
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, version),
  unique (site_id, idempotency_key),
  foreign key (site_id, prior_policy_id) references public.builder_submission_retention_policies(site_id, id) on delete restrict,
  foreign key (site_id, actor_id) references public.builder_site_members(site_id, user_id) on delete restrict,
  check ((version = 1 and prior_policy_id is null and authority_kind = 'provisioning') or (version > 1 and prior_policy_id is not null))
);

create table public.builder_submission_retention_policy_cancellations (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  policy_id uuid not null,
  actor_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'),
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  aal2_verified_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, policy_id),
  unique (site_id, idempotency_key),
  foreign key (site_id, policy_id) references public.builder_submission_retention_policies(site_id, id) on delete restrict,
  foreign key (site_id, actor_id) references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_form_submission_deletion_requests (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  submission_id uuid not null,
  request_kind text not null check (request_kind in ('manual', 'retention', 'offboarding')),
  state text not null default 'pending' check (state in ('pending', 'processing', 'completed', 'failed')),
  requester_id uuid,
  retention_policy_id uuid,
  authority_receipt_id uuid,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'),
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  subject_identity_hmac text not null check (subject_identity_hmac ~ '^[a-f0-9]{64}$'),
  aal2_verified_at timestamptz,
  due_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  safe_result_code text check (safe_result_code is null or safe_result_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, requester_id) references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, retention_policy_id) references public.builder_submission_retention_policies(site_id, id) on delete restrict,
  check ((request_kind = 'manual') = (requester_id is not null and aal2_verified_at is not null)),
  check ((request_kind = 'retention') = (retention_policy_id is not null)),
  check ((state = 'completed') = (completed_at is not null))
);

create table builder_private.builder_form_privacy_tombstones (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  deletion_request_id uuid not null,
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  retention_policy_version integer,
  subject_identity_hmac text not null check (subject_identity_hmac ~ '^[a-f0-9]{64}$'),
  deleted_counts jsonb not null check (jsonb_typeof(deleted_counts) = 'object' and octet_length(deleted_counts::text) <= 4096),
  executed_at timestamptz not null,
  expires_at timestamptz not null,
  unique (site_id, deletion_request_id),
  check (expires_at > executed_at)
);

create table builder_private.builder_withdrawn_consent_proofs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  deletion_request_id uuid not null,
  policy_version text not null,
  purpose text not null,
  language_digest text not null check (language_digest ~ '^[a-f0-9]{64}$'),
  granted_at timestamptz not null,
  withdrawn_at timestamptz not null,
  source text not null,
  subject_identity_hmac text not null check (subject_identity_hmac ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  unique (site_id, deletion_request_id, purpose, policy_version),
  check (withdrawn_at >= granted_at and expires_at > withdrawn_at)
);

create table builder_private.builder_form_notification_queue (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  submission_id uuid not null,
  event_type text not null default 'form.submission.accepted',
  state text not null default 'pending' check (state in ('pending', 'projected', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  safe_code text check (safe_code is null or safe_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (site_id, id),
  unique (site_id, submission_id, event_type),
  foreign key (site_id, submission_id) references public.builder_form_submissions(site_id, id) on delete restrict
);

create table builder_private.builder_form_notification_projection_receipts (
  site_id uuid not null,
  queue_id uuid not null,
  recipient_id uuid not null,
  notification_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, queue_id, recipient_id)
);

alter table public.builder_data_exports
  add column idempotency_key text,
  add column command_digest text,
  add column revoked_at timestamptz,
  add column downloaded_at timestamptz,
  add constraint builder_data_exports_form_idempotency_check check (
    (idempotency_key is null and command_digest is null)
    or (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$' and command_digest ~ '^[a-f0-9]{64}$')
  );

create unique index builder_data_exports_form_idempotency_idx
on public.builder_data_exports(site_id, idempotency_key)
where idempotency_key is not null;
create index builder_form_consent_events_history_idx
on public.builder_form_submission_consent_events(site_id, submission_id, occurred_at, id);
create index builder_retention_policies_effective_idx
on public.builder_submission_retention_policies(site_id, effective_at desc, version desc);
create index builder_form_deletion_requests_due_idx
on public.builder_form_submission_deletion_requests(state, due_at, site_id, id)
where state in ('pending', 'failed');
create index builder_form_notification_queue_due_idx
on builder_private.builder_form_notification_queue(state, next_attempt_at, site_id, id)
where state in ('pending', 'failed');

create trigger builder_form_submission_consent_events_append_only
before update or delete on public.builder_form_submission_consent_events
for each row execute function builder_private.reject_append_only_change();
create trigger builder_submission_retention_policies_append_only
before update or delete on public.builder_submission_retention_policies
for each row execute function builder_private.reject_append_only_change();
create trigger builder_submission_retention_policy_cancellations_append_only
before update or delete on public.builder_submission_retention_policy_cancellations
for each row execute function builder_private.reject_append_only_change();

alter table public.builder_form_submission_consent_events enable row level security;
alter table public.builder_submission_retention_policies enable row level security;
alter table public.builder_submission_retention_policy_cancellations enable row level security;
alter table public.builder_form_submission_deletion_requests enable row level security;

create policy builder_form_consent_events_capability_read
on public.builder_form_submission_consent_events for select to authenticated
using (builder_private.current_member_has_website_capability(site_id, 'submissions.read'));
create policy builder_retention_policies_owner_read
on public.builder_submission_retention_policies for select to authenticated
using (builder_private.current_member_has_website_capability(site_id, 'submissions.manageRetention'));
create policy builder_retention_cancellations_owner_read
on public.builder_submission_retention_policy_cancellations for select to authenticated
using (builder_private.current_member_has_website_capability(site_id, 'submissions.manageRetention'));
create policy builder_form_deletion_requests_owner_read
on public.builder_form_submission_deletion_requests for select to authenticated
using (builder_private.current_member_has_website_capability(site_id, 'submissions.deleteRequest'));

revoke all on public.builder_form_submission_consent_events,
  public.builder_submission_retention_policies,
  public.builder_submission_retention_policy_cancellations,
  public.builder_form_submission_deletion_requests
from public, anon, authenticated, service_role;
grant select on public.builder_form_submission_consent_events,
  public.builder_submission_retention_policies,
  public.builder_submission_retention_policy_cancellations,
  public.builder_form_submission_deletion_requests
to authenticated, service_role;

revoke all on builder_private.builder_form_privacy_tombstones,
  builder_private.builder_withdrawn_consent_proofs,
  builder_private.builder_form_notification_queue,
  builder_private.builder_form_notification_projection_receipts
from public, anon, authenticated, service_role, builder_retention_worker;

create function builder_private.forms_recent_aal2(p_verified_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_verified_at is not null
    and p_verified_at >= statement_timestamp() - interval '5 minutes'
    and p_verified_at <= statement_timestamp() + interval '1 minute';
$$;

create function builder_private.capture_initial_form_consent_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.builder_form_submissions submission
    where submission.site_id = new.site_id and submission.id = new.submission_id
      and submission.ingestion_contract_version = 2
  ) then
    insert into public.builder_form_submission_consent_events (
      site_id, submission_id, base_consent_id, event_kind, policy_version,
      purpose, language_digest, source, idempotency_key, occurred_at
    ) values (
      new.site_id, new.submission_id, new.id, 'granted', new.policy_version,
      new.purpose, new.language_digest, 'public_form',
      'consent.granted:' || new.id::text, new.captured_at
    ) on conflict (site_id, idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger builder_form_submission_consents_capture_event
after insert on public.builder_form_submission_consents
for each row execute function builder_private.capture_initial_form_consent_event();

create function builder_private.reject_withdrawn_consent_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.builder_form_submission_consent_events event
    where event.site_id = new.site_id
      and event.base_consent_id = new.base_consent_id
      and event.event_kind = 'withdrawn'
  ) then
    raise exception 'withdrawn form consent cannot be imported' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger builder_consents_reject_withdrawn_form_consent
before insert on public.builder_consents
for each row execute function builder_private.reject_withdrawn_consent_projection();

create function builder_private.queue_form_submission_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ingestion_contract_version = 2 then
    insert into builder_private.builder_form_notification_queue(site_id, submission_id)
    values (new.site_id, new.id)
    on conflict (site_id, submission_id, event_type) do nothing;
  end if;
  return new;
end;
$$;

create trigger builder_form_submissions_queue_notification
after insert on public.builder_form_submissions
for each row execute function builder_private.queue_form_submission_notification();

create function builder_private.effective_submission_retention_policy(
  p_site_id uuid,
  p_at timestamptz default statement_timestamp()
)
returns public.builder_submission_retention_policies
language sql
stable
security definer
set search_path = ''
as $$
  select policy
  from public.builder_submission_retention_policies policy
  where policy.site_id = p_site_id
    and policy.effective_at <= p_at
    and not exists (
      select 1 from public.builder_submission_retention_policy_cancellations cancellation
      where cancellation.site_id = policy.site_id and cancellation.policy_id = policy.id
    )
  order by policy.version desc
  limit 1;
$$;

create function public.builder_initialize_submission_retention_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_receipt_id uuid;
  v_existing public.builder_submission_retention_policies%rowtype;
  v_policy_id uuid;
begin
  if jsonb_typeof(p_request) <> 'object'
    or not (p_request ?& array['version','siteId','authorityReceiptId','idempotencyKey'])
    or (p_request ->> 'version') <> '1'
    or (p_request ->> 'idempotencyKey') !~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'
  then raise exception 'invalid retention initialization request' using errcode = '22023'; end if;
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_receipt_id := (p_request ->> 'authorityReceiptId')::uuid;
  exception when others then
    raise exception 'invalid retention initialization request' using errcode = '22023';
  end;
  if not exists(select 1 from public.builder_sites where id=v_site_id) then
    raise exception 'retention site is unknown' using errcode = '22023';
  end if;
  select * into v_existing from public.builder_submission_retention_policies
  where site_id=v_site_id and idempotency_key=p_request->>'idempotencyKey';
  if found then
    if v_existing.version<>1 or v_existing.raw_retention_days<>730 or v_existing.authority_receipt_id<>v_receipt_id then
      raise exception 'retention initialization conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('version',1,'status','replayed','policyId',v_existing.id,'policyVersion',1,'rawRetentionDays',730);
  end if;
  if exists(select 1 from public.builder_submission_retention_policies where site_id=v_site_id) then
    raise exception 'retention policy is already initialized' using errcode = '22023';
  end if;
  v_policy_id:=gen_random_uuid();
  insert into public.builder_submission_retention_policies(
    site_id,id,version,raw_retention_days,effective_at,authority_kind,
    authority_receipt_id,idempotency_key,reason_code
  ) values (
    v_site_id,v_policy_id,1,730,statement_timestamp(),'provisioning',
    v_receipt_id,p_request->>'idempotencyKey','INITIAL_PROVISIONING'
  );
  return jsonb_build_object('version',1,'status','created','policyId',v_policy_id,'policyVersion',1,'rawRetentionDays',730);
end;
$$;

create function public.builder_update_submission_retention_policy_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_command_id uuid;
  v_expected_version integer;
  v_days integer;
  v_aal2 timestamptz;
  v_current public.builder_submission_retention_policies%rowtype;
  v_existing public.builder_submission_retention_policies%rowtype;
  v_policy_id uuid;
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','commandId','idempotencyKey','siteId','actorId','expectedVersion','rawRetentionDays','reasonCode','aal2VerifiedAt'])
    or (p_request->>'version')<>'1'
    or (p_request->>'reasonCode')!~'^[A-Z][A-Z0-9_]{0,63}$'
  then raise exception 'invalid retention update request' using errcode='22023';end if;
  begin
    v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;
    v_command_id:=(p_request->>'commandId')::uuid;v_expected_version:=(p_request->>'expectedVersion')::integer;
    v_days:=(p_request->>'rawRetentionDays')::integer;v_aal2:=(p_request->>'aal2VerifiedAt')::timestamptz;
  exception when others then raise exception 'invalid retention update request' using errcode='22023';end;
  if not builder_private.member_has_website_capability(v_site_id,v_actor_id,'submissions.manageRetention')
    or not builder_private.forms_recent_aal2(v_aal2)
  then raise exception 'retention update is not authorized' using errcode='42501';end if;
  select * into v_existing from public.builder_submission_retention_policies
  where site_id=v_site_id and idempotency_key=p_request->>'idempotencyKey';
  if found then
    if v_existing.authority_receipt_id<>v_command_id or v_existing.raw_retention_days<>v_days then
      raise exception 'retention update idempotency conflict' using errcode='22023';end if;
    return jsonb_build_object('version',1,'status','replayed','policyId',v_existing.id,'policyVersion',v_existing.version,'effectiveAt',v_existing.effective_at);
  end if;
  select * into v_current from public.builder_submission_retention_policies
  where site_id=v_site_id order by version desc limit 1 for update;
  if not found or v_current.version<>v_expected_version then raise exception 'retention policy version conflict' using errcode='40001';end if;
  if v_days<30 or v_days>=v_current.raw_retention_days then
    raise exception 'owner retention updates may only shorten the current policy' using errcode='22023';end if;
  v_policy_id:=gen_random_uuid();
  insert into public.builder_submission_retention_policies(
    site_id,id,version,raw_retention_days,effective_at,prior_policy_id,authority_kind,
    authority_receipt_id,actor_id,idempotency_key,reason_code
  ) values (
    v_site_id,v_policy_id,v_current.version+1,v_days,statement_timestamp()+interval '7 days',v_current.id,
    'owner_command',v_command_id,v_actor_id,p_request->>'idempotencyKey',p_request->>'reasonCode'
  );
  return jsonb_build_object('version',1,'status','pending','policyId',v_policy_id,'policyVersion',v_current.version+1,'effectiveAt',statement_timestamp()+interval '7 days');
end;
$$;

create function public.builder_review_submission_retention_extension_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_receipt uuid;
  v_expected integer;
  v_days integer;
  v_current public.builder_submission_retention_policies%rowtype;
  v_id uuid:=gen_random_uuid();
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','siteId','authorityReceiptId','expectedVersion','rawRetentionDays','idempotencyKey'])
    or (p_request->>'version')<>'1'
    or (p_request->>'idempotencyKey')!~'^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'
  then raise exception 'invalid reviewed retention request' using errcode='22023';end if;
  begin
    v_site_id:=(p_request->>'siteId')::uuid;v_receipt:=(p_request->>'authorityReceiptId')::uuid;
    v_expected:=(p_request->>'expectedVersion')::integer;v_days:=(p_request->>'rawRetentionDays')::integer;
  exception when others then raise exception 'invalid reviewed retention request' using errcode='22023';end;
  if v_days not between 30 and 730 then raise exception 'invalid reviewed retention request' using errcode='22023';end if;
  select * into v_current from public.builder_submission_retention_policies
  where site_id=v_site_id order by version desc limit 1 for update;
  if not found or v_current.version<>v_expected then raise exception 'retention policy version conflict' using errcode='40001';end if;
  if exists(select 1 from public.builder_submission_retention_policies where site_id=v_site_id and idempotency_key=p_request->>'idempotencyKey') then
    return jsonb_build_object('version',1,'status','replayed');end if;
  insert into public.builder_submission_retention_policies(
    site_id,id,version,raw_retention_days,effective_at,prior_policy_id,authority_kind,
    authority_receipt_id,idempotency_key,reason_code
  ) values (
    v_site_id,v_id,v_current.version+1,v_days,statement_timestamp(),v_current.id,
    'reviewed_provisioning',v_receipt,p_request->>'idempotencyKey','REVIEWED_EXTENSION'
  );
  return jsonb_build_object('version',1,'status','effective','policyId',v_id,'policyVersion',v_current.version+1);
end;
$$;

create function public.builder_cancel_submission_retention_policy_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_policy_id uuid;
  v_aal2 timestamptz;
  v_id uuid:=gen_random_uuid();
  v_policy public.builder_submission_retention_policies%rowtype;
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','siteId','actorId','policyId','idempotencyKey','reasonCode','aal2VerifiedAt'])
    or (p_request->>'version')<>'1'
    or (p_request->>'reasonCode')!~'^[A-Z][A-Z0-9_]{0,63}$'
  then raise exception 'invalid retention cancellation request' using errcode='22023';end if;
  begin
    v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;
    v_policy_id:=(p_request->>'policyId')::uuid;v_aal2:=(p_request->>'aal2VerifiedAt')::timestamptz;
  exception when others then raise exception 'invalid retention cancellation request' using errcode='22023';end;
  if not builder_private.member_has_website_capability(v_site_id,v_actor_id,'submissions.manageRetention')
    or not builder_private.forms_recent_aal2(v_aal2)
  then raise exception 'retention cancellation is not authorized' using errcode='42501';end if;
  select * into v_policy from public.builder_submission_retention_policies where site_id=v_site_id and id=v_policy_id;
  if not found or v_policy.effective_at<=statement_timestamp() then
    raise exception 'only a pending retention policy may be cancelled' using errcode='22023';end if;
  if exists(select 1 from public.builder_submission_retention_policy_cancellations where site_id=v_site_id and idempotency_key=p_request->>'idempotencyKey') then
    return jsonb_build_object('version',1,'status','replayed','policyId',v_policy_id);end if;
  insert into public.builder_submission_retention_policy_cancellations(
    site_id,id,policy_id,actor_id,idempotency_key,reason_code,aal2_verified_at
  ) values(v_site_id,v_id,v_policy_id,v_actor_id,p_request->>'idempotencyKey',p_request->>'reasonCode',v_aal2);
  return jsonb_build_object('version',1,'status','cancelled','policyId',v_policy_id,'cancellationId',v_id);
end;
$$;

create function public.builder_withdraw_form_submission_consent_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_submission_id uuid;
  v_base_consent_id uuid;
  v_aal2 timestamptz;
  v_base public.builder_form_submission_consents%rowtype;
  v_existing public.builder_form_submission_consent_events%rowtype;
  v_id uuid:=gen_random_uuid();
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','commandId','idempotencyKey','siteId','actorId','submissionId','baseConsentId','source','reasonCode','subjectIdentityHmac','aal2VerifiedAt'])
    or (p_request->>'version')<>'1'
    or (p_request->>'source') not in ('verified_verbal','verified_written','unsubscribe')
    or (p_request->>'reasonCode')!~'^[A-Z][A-Z0-9_]{0,63}$'
    or (p_request->>'subjectIdentityHmac')!~'^[a-f0-9]{64}$'
  then raise exception 'invalid consent withdrawal request' using errcode='22023';end if;
  begin
    v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;
    v_submission_id:=(p_request->>'submissionId')::uuid;v_base_consent_id:=(p_request->>'baseConsentId')::uuid;
    v_aal2:=(p_request->>'aal2VerifiedAt')::timestamptz;
  exception when others then raise exception 'invalid consent withdrawal request' using errcode='22023';end;
  if not builder_private.member_has_website_capability(v_site_id,v_actor_id,'submissions.manageConsent')
    or not builder_private.forms_recent_aal2(v_aal2)
  then raise exception 'consent withdrawal is not authorized' using errcode='42501';end if;
  select * into v_existing from public.builder_form_submission_consent_events
  where site_id=v_site_id and idempotency_key=p_request->>'idempotencyKey';
  if found then
    if v_existing.submission_id<>v_submission_id or v_existing.base_consent_id<>v_base_consent_id then
      raise exception 'consent withdrawal idempotency conflict' using errcode='22023';end if;
    return jsonb_build_object('version',1,'status','replayed','consentEventId',v_existing.id);
  end if;
  select * into v_base from public.builder_form_submission_consents
  where site_id=v_site_id and id=v_base_consent_id and submission_id=v_submission_id;
  if not found then raise exception 'base consent evidence not found' using errcode='22023';end if;
  if exists(select 1 from public.builder_form_submission_consent_events where site_id=v_site_id and base_consent_id=v_base_consent_id and event_kind='withdrawn') then
    raise exception 'consent is already withdrawn' using errcode='22023';end if;
  insert into public.builder_form_submission_consent_events(
    site_id,id,submission_id,base_consent_id,event_kind,policy_version,purpose,
    language_digest,source,actor_id,idempotency_key,reason_code,subject_identity_hmac,occurred_at
  ) values(
    v_site_id,v_id,v_submission_id,v_base_consent_id,'withdrawn',v_base.policy_version,v_base.purpose,
    v_base.language_digest,p_request->>'source',v_actor_id,p_request->>'idempotencyKey',
    p_request->>'reasonCode',p_request->>'subjectIdentityHmac',statement_timestamp()
  );
  return jsonb_build_object('version',1,'status','withdrawn','consentEventId',v_id,'submissionId',v_submission_id);
end;
$$;

create function public.builder_request_form_submission_export_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_aal2 timestamptz;
  v_digest text;
  v_existing public.builder_data_exports%rowtype;
  v_id uuid:=gen_random_uuid();
  v_scope jsonb;
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','commandId','idempotencyKey','siteId','actorId','aal2VerifiedAt','filters'])
    or (p_request->>'version')<>'1' or jsonb_typeof(p_request->'filters')<>'object'
    or octet_length((p_request->'filters')::text)>16384
  then raise exception 'invalid form submission export request' using errcode='22023';end if;
  begin v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_aal2:=(p_request->>'aal2VerifiedAt')::timestamptz;
  exception when others then raise exception 'invalid form submission export request' using errcode='22023';end;
  if not builder_private.member_has_website_capability(v_site_id,v_actor_id,'submissions.export')
    or not builder_private.forms_recent_aal2(v_aal2)
  then raise exception 'form submission export is not authorized' using errcode='42501';end if;
  v_digest:=encode(extensions.digest(convert_to(p_request::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from public.builder_data_exports where site_id=v_site_id and idempotency_key=p_request->>'idempotencyKey';
  if found then
    if v_existing.command_digest<>v_digest then raise exception 'form export idempotency conflict' using errcode='22023';end if;
    return jsonb_build_object('version',1,'status','replayed','exportId',v_existing.id,'state',v_existing.state);
  end if;
  v_scope:=p_request->'filters';
  insert into public.builder_data_exports(
    site_id,id,requester_id,domain,frozen_scope,state,schema_version,idempotency_key,command_digest
  ) values(v_site_id,v_id,v_actor_id,'base_submissions',v_scope,'requested',2,p_request->>'idempotencyKey',v_digest);
  return jsonb_build_object('version',1,'status','requested','exportId',v_id,'state','requested');
end;
$$;

create function public.builder_revoke_form_submission_export_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_export_id uuid;
  v_aal2 timestamptz;
begin
  if jsonb_typeof(p_request)<>'object' or not(p_request?&array['version','siteId','actorId','exportId','aal2VerifiedAt'])
    or (p_request->>'version')<>'1' then raise exception 'invalid form export revocation request' using errcode='22023';end if;
  begin
    v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;
    v_export_id:=(p_request->>'exportId')::uuid;v_aal2:=(p_request->>'aal2VerifiedAt')::timestamptz;
  exception when others then raise exception 'invalid form export revocation request' using errcode='22023';end;
  if not builder_private.member_has_website_capability(v_site_id,v_actor_id,'submissions.export')
    or not builder_private.forms_recent_aal2(v_aal2)
  then raise exception 'form export revocation is not authorized' using errcode='42501';end if;
  update public.builder_data_exports set state='expired',object_reference=null,object_expires_at=null,
    revoked_at=statement_timestamp(),updated_at=statement_timestamp()
  where site_id=v_site_id and id=v_export_id and domain='base_submissions' and state<>'expired';
  if not found and not exists(select 1 from public.builder_data_exports where site_id=v_site_id and id=v_export_id and state='expired') then
    raise exception 'form export not found' using errcode='22023';end if;
  return jsonb_build_object('version',1,'status','revoked','exportId',v_export_id);
end;
$$;

create function public.builder_get_form_submission_export_download_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_export_id uuid;
  v_aal2 timestamptz;
  v_export public.builder_data_exports%rowtype;
begin
  if jsonb_typeof(p_request)<>'object' or not(p_request?&array['version','siteId','actorId','exportId','aal2VerifiedAt'])
    or (p_request->>'version')<>'1' then raise exception 'invalid form export download request' using errcode='22023';end if;
  begin
    v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;
    v_export_id:=(p_request->>'exportId')::uuid;v_aal2:=(p_request->>'aal2VerifiedAt')::timestamptz;
  exception when others then raise exception 'invalid form export download request' using errcode='22023';end;
  if not builder_private.member_has_website_capability(v_site_id,v_actor_id,'submissions.export')
    or not builder_private.forms_recent_aal2(v_aal2)
  then raise exception 'form export download is not authorized' using errcode='42501';end if;
  select * into v_export from public.builder_data_exports
  where site_id=v_site_id and id=v_export_id and domain='base_submissions' for update;
  if not found or v_export.state<>'completed' or v_export.revoked_at is not null
    or v_export.object_expires_at<=statement_timestamp()
  then raise exception 'form export is unavailable' using errcode='22023';end if;
  update public.builder_data_exports set downloaded_at=statement_timestamp(),updated_at=statement_timestamp()
  where site_id=v_site_id and id=v_export_id;
  return jsonb_build_object('version',1,'status','available','exportId',v_export_id,
    'objectReference',v_export.object_reference,'expiresAt',v_export.object_expires_at);
end;
$$;

create function public.builder_request_form_submission_deletion_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_submission_id uuid;
  v_command_id uuid;
  v_aal2 timestamptz;
  v_existing public.builder_form_submission_deletion_requests%rowtype;
  v_id uuid:=gen_random_uuid();
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','commandId','idempotencyKey','siteId','actorId','submissionId','reasonCode','subjectIdentityHmac','aal2VerifiedAt'])
    or (p_request->>'version')<>'1'
    or (p_request->>'reasonCode')!~'^[A-Z][A-Z0-9_]{0,63}$'
    or (p_request->>'subjectIdentityHmac')!~'^[a-f0-9]{64}$'
  then raise exception 'invalid form submission deletion request' using errcode='22023';end if;
  begin
    v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;
    v_submission_id:=(p_request->>'submissionId')::uuid;v_command_id:=(p_request->>'commandId')::uuid;
    v_aal2:=(p_request->>'aal2VerifiedAt')::timestamptz;
  exception when others then raise exception 'invalid form submission deletion request' using errcode='22023';end;
  if not builder_private.member_has_website_capability(v_site_id,v_actor_id,'submissions.deleteRequest')
    or not builder_private.forms_recent_aal2(v_aal2)
  then raise exception 'form submission deletion is not authorized' using errcode='42501';end if;
  select * into v_existing from public.builder_form_submission_deletion_requests
  where site_id=v_site_id and idempotency_key=p_request->>'idempotencyKey';
  if found then
    if v_existing.submission_id<>v_submission_id or v_existing.authority_receipt_id<>v_command_id then
      raise exception 'form deletion idempotency conflict' using errcode='22023';end if;
    return jsonb_build_object('version',1,'status','replayed','deletionRequestId',v_existing.id,'state',v_existing.state);
  end if;
  if not exists(select 1 from public.builder_form_submissions where site_id=v_site_id and id=v_submission_id) then
    raise exception 'form submission not found' using errcode='22023';end if;
  insert into public.builder_form_submission_deletion_requests(
    site_id,id,submission_id,request_kind,state,requester_id,authority_receipt_id,
    idempotency_key,reason_code,subject_identity_hmac,aal2_verified_at,due_at
  ) values(
    v_site_id,v_id,v_submission_id,'manual','pending',v_actor_id,v_command_id,
    p_request->>'idempotencyKey',p_request->>'reasonCode',p_request->>'subjectIdentityHmac',v_aal2,statement_timestamp()
  );
  return jsonb_build_object('version',1,'status','pending','deletionRequestId',v_id,'submissionId',v_submission_id);
end;
$$;

create function public.builder_project_form_notifications_v1(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue builder_private.builder_form_notification_queue%rowtype;
  v_member record;
  v_notification_id uuid;
  v_projected integer:=0;
  v_degraded integer:=0;
begin
  if p_limit not between 1 and 500 then raise exception 'invalid notification projection limit' using errcode='22023';end if;
  for v_queue in
    select * from builder_private.builder_form_notification_queue queue
    where queue.state in ('pending','failed') and queue.next_attempt_at<=statement_timestamp()
    order by queue.created_at,queue.id limit p_limit for update skip locked
  loop
    begin
      for v_member in
        select member.user_id from public.builder_site_members member
        where member.site_id=v_queue.site_id and member.role in ('owner','editor')
      loop
        if not exists(
          select 1 from builder_private.builder_form_notification_projection_receipts receipt
          where receipt.site_id=v_queue.site_id and receipt.queue_id=v_queue.id and receipt.recipient_id=v_member.user_id
        ) then
          v_notification_id:=gen_random_uuid();
          insert into public.builder_in_app_notifications(
            site_id,id,recipient_id,event_type,preview_text
          ) values(
            v_queue.site_id,v_notification_id,v_member.user_id,v_queue.event_type,'New website form submission'
          );
          insert into builder_private.builder_form_notification_projection_receipts(
            site_id,queue_id,recipient_id,notification_id
          ) values(v_queue.site_id,v_queue.id,v_member.user_id,v_notification_id);
        end if;
      end loop;
      update builder_private.builder_form_notification_queue
      set state='projected',attempt_count=attempt_count+1,safe_code=null,updated_at=statement_timestamp()
      where site_id=v_queue.site_id and id=v_queue.id;
      v_projected:=v_projected+1;
    exception when others then
      update builder_private.builder_form_notification_queue
      set state='failed',attempt_count=attempt_count+1,safe_code='IN_APP_NOTIFICATION_DEGRADED',
        next_attempt_at=statement_timestamp()+least(interval '1 hour',interval '1 minute'*(2^least(attempt_count,6))),
        updated_at=statement_timestamp()
      where site_id=v_queue.site_id and id=v_queue.id;
      insert into public.builder_health_checks(site_id,check_kind,status,safe_code,observed_at)
      values(v_queue.site_id,'forms.notification_projection','degraded','IN_APP_NOTIFICATION_DEGRADED',statement_timestamp());
      v_degraded:=v_degraded+1;
    end;
  end loop;
  return jsonb_build_object('version',1,'projectedCount',v_projected,'degradedCount',v_degraded);
end;
$$;

create or replace function builder_private.reject_append_only_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('role',true)='builder_retention_worker'
    and current_setting('builder.retention_purge',true)='authorized'
  then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode='55000';
end;
$$;

create function builder_private.schedule_due_form_submission_purges_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_hmac_key text;
  v_policy public.builder_submission_retention_policies%rowtype;
  v_submission record;
  v_count integer:=0;
begin
  if current_setting('role',true)<>'builder_retention_worker' then
    raise exception 'retention worker role required' using errcode='42501';end if;
  if jsonb_typeof(p_request)<>'object' or not(p_request?&array['version','siteId','hmacKey'])
    or (p_request->>'version')<>'1' then
    raise exception 'invalid retention scheduling request' using errcode='22023';end if;
  begin v_site_id:=(p_request->>'siteId')::uuid;v_hmac_key:=p_request->>'hmacKey';
  exception when others then raise exception 'invalid retention scheduling request' using errcode='22023';end;
  if char_length(v_hmac_key)<32 then raise exception 'invalid retention scheduling request' using errcode='22023';end if;
  select * into v_policy from builder_private.effective_submission_retention_policy(v_site_id,statement_timestamp());
  if not found then raise exception 'effective retention policy not found' using errcode='22023';end if;
  for v_submission in
    select submission.id from public.builder_form_submissions submission
    where submission.site_id=v_site_id
      and submission.received_at<=statement_timestamp()-make_interval(days=>v_policy.raw_retention_days)
      and not exists(
        select 1 from public.builder_form_submission_deletion_requests request
        where request.site_id=submission.site_id and request.submission_id=submission.id
          and request.state in ('pending','processing','completed')
      )
    order by submission.received_at,submission.id limit 500
  loop
    insert into public.builder_form_submission_deletion_requests(
      site_id,submission_id,request_kind,state,retention_policy_id,authority_receipt_id,
      idempotency_key,reason_code,subject_identity_hmac,due_at
    ) values(
      v_site_id,v_submission.id,'retention','pending',v_policy.id,v_policy.authority_receipt_id,
      'retention:'||v_policy.version::text||':'||v_submission.id::text,'RETENTION_EXPIRED',
      encode(extensions.hmac(convert_to(v_submission.id::text,'UTF8'),convert_to(v_hmac_key,'UTF8'),'sha256'),'hex'),
      statement_timestamp()
    ) on conflict(site_id,idempotency_key) do nothing;
    if found then v_count:=v_count+1;end if;
  end loop;
  return jsonb_build_object('version',1,'siteId',v_site_id,'policyVersion',v_policy.version,'scheduledCount',v_count);
end;
$$;

create function builder_private.builder_purge_form_submission_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_request_id uuid;
  v_request public.builder_form_submission_deletion_requests%rowtype;
  v_policy_version integer;
  v_results integer:=0;
  v_events integer:=0;
  v_consents integer:=0;
  v_consent_events integer:=0;
  v_growth_consents integer:=0;
  v_notifications integer:=0;
  v_withdrawal record;
  v_counts jsonb;
begin
  if current_setting('role',true)<>'builder_retention_worker' then
    raise exception 'retention worker role required' using errcode='42501';end if;
  if jsonb_typeof(p_request)<>'object' or not(p_request?&array['version','siteId','deletionRequestId'])
    or (p_request->>'version')<>'1' then
    raise exception 'invalid form purge request' using errcode='22023';end if;
  begin v_site_id:=(p_request->>'siteId')::uuid;v_request_id:=(p_request->>'deletionRequestId')::uuid;
  exception when others then raise exception 'invalid form purge request' using errcode='22023';end;
  select * into v_request from public.builder_form_submission_deletion_requests
  where site_id=v_site_id and id=v_request_id for update;
  if not found or v_request.state not in ('pending','failed') or v_request.due_at>statement_timestamp() then
    raise exception 'form purge request is not due' using errcode='22023';end if;
  if v_request.request_kind='retention' then
    select policy.version into v_policy_version from public.builder_submission_retention_policies policy
    where policy.site_id=v_site_id and policy.id=v_request.retention_policy_id
      and policy.authority_receipt_id=v_request.authority_receipt_id;
    if not found then raise exception 'retention purge authority is invalid' using errcode='42501';end if;
  end if;
  if not exists(select 1 from public.builder_form_submissions where site_id=v_site_id and id=v_request.submission_id) then
    raise exception 'purge submission not found' using errcode='22023';end if;

  update public.builder_form_submission_deletion_requests
  set state='processing',attempt_count=attempt_count+1,updated_at=statement_timestamp()
  where site_id=v_site_id and id=v_request_id;
  perform set_config('builder.retention_purge','authorized',true);

  for v_withdrawal in
    select withdrawn.policy_version,withdrawn.purpose,withdrawn.language_digest,
      granted.occurred_at granted_at,withdrawn.occurred_at withdrawn_at,withdrawn.source
    from public.builder_form_submission_consent_events withdrawn
    join public.builder_form_submission_consent_events granted
      on granted.site_id=withdrawn.site_id and granted.base_consent_id=withdrawn.base_consent_id and granted.event_kind='granted'
    where withdrawn.site_id=v_site_id and withdrawn.submission_id=v_request.submission_id
      and withdrawn.event_kind='withdrawn' and withdrawn.purpose='marketing_email'
  loop
    insert into builder_private.builder_withdrawn_consent_proofs(
      site_id,deletion_request_id,policy_version,purpose,language_digest,granted_at,
      withdrawn_at,source,subject_identity_hmac,expires_at
    ) values(
      v_site_id,v_request_id,v_withdrawal.policy_version,v_withdrawal.purpose,
      v_withdrawal.language_digest,v_withdrawal.granted_at,v_withdrawal.withdrawn_at,
      v_withdrawal.source,v_request.subject_identity_hmac,v_withdrawal.withdrawn_at+interval '5 years'
    ) on conflict(site_id,deletion_request_id,purpose,policy_version) do nothing;
  end loop;

  update public.builder_data_exports
  set state='expired',object_reference=null,object_expires_at=null,revoked_at=coalesce(revoked_at,statement_timestamp()),updated_at=statement_timestamp()
  where site_id=v_site_id and domain='base_submissions' and state<>'expired'
    and frozen_scope @> jsonb_build_object('submissionIds',jsonb_build_array(v_request.submission_id::text));

  delete from builder_private.builder_form_notification_projection_receipts receipt
  using builder_private.builder_form_notification_queue queue
  where queue.site_id=v_site_id and queue.submission_id=v_request.submission_id
    and receipt.site_id=queue.site_id and receipt.queue_id=queue.id;
  delete from builder_private.builder_form_notification_queue
  where site_id=v_site_id and submission_id=v_request.submission_id;
  get diagnostics v_notifications=row_count;

  delete from public.builder_consents growth_consent
  using public.builder_form_submission_consents base_consent
  where base_consent.site_id=v_site_id and base_consent.submission_id=v_request.submission_id
    and growth_consent.site_id=base_consent.site_id and growth_consent.base_consent_id=base_consent.id;
  get diagnostics v_growth_consents=row_count;

  delete from public.builder_form_submission_results where site_id=v_site_id and submission_id=v_request.submission_id;
  get diagnostics v_results=row_count;
  delete from public.builder_form_submission_events where site_id=v_site_id and submission_id=v_request.submission_id;
  get diagnostics v_events=row_count;
  delete from public.builder_form_submission_consent_events where site_id=v_site_id and submission_id=v_request.submission_id;
  get diagnostics v_consent_events=row_count;
  delete from public.builder_form_submission_consents where site_id=v_site_id and submission_id=v_request.submission_id;
  get diagnostics v_consents=row_count;
  update builder_private.builder_ingestion_receipts set submission_id=null
  where site_id=v_site_id and submission_id=v_request.submission_id;
  delete from public.builder_form_submissions where site_id=v_site_id and id=v_request.submission_id;

  v_counts:=jsonb_build_object(
    'submissions',1,'results',v_results,'reviewEvents',v_events,'consents',v_consents,
    'consentEvents',v_consent_events,'growthConsentLinks',v_growth_consents,'notificationQueue',v_notifications
  );
  insert into builder_private.builder_form_privacy_tombstones(
    site_id,deletion_request_id,reason_code,retention_policy_version,subject_identity_hmac,
    deleted_counts,executed_at,expires_at
  ) values(
    v_site_id,v_request_id,v_request.reason_code,v_policy_version,v_request.subject_identity_hmac,
    v_counts,statement_timestamp(),statement_timestamp()+interval '36 months'
  ) on conflict(site_id,deletion_request_id) do nothing;
  update public.builder_form_submission_deletion_requests
  set state='completed',safe_result_code='PURGE_COMPLETED',completed_at=statement_timestamp(),updated_at=statement_timestamp()
  where site_id=v_site_id and id=v_request_id;
  return jsonb_build_object('version',1,'status','completed','deletionRequestId',v_request_id,'deletedCounts',v_counts);
end;
$$;

revoke all on function builder_private.forms_recent_aal2(timestamptz) from public,anon,authenticated,service_role,builder_retention_worker;
revoke all on function builder_private.capture_initial_form_consent_event() from public,anon,authenticated,service_role,builder_retention_worker;
revoke all on function builder_private.reject_withdrawn_consent_projection() from public,anon,authenticated,service_role,builder_retention_worker;
revoke all on function builder_private.queue_form_submission_notification() from public,anon,authenticated,service_role,builder_retention_worker;
revoke all on function builder_private.effective_submission_retention_policy(uuid,timestamptz) from public,anon,authenticated,service_role,builder_retention_worker;
revoke all on function public.builder_initialize_submission_retention_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_update_submission_retention_policy_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_review_submission_retention_extension_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_cancel_submission_retention_policy_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_withdraw_form_submission_consent_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_request_form_submission_export_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_revoke_form_submission_export_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_get_form_submission_export_download_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_request_form_submission_deletion_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_project_form_notifications_v1(integer) from public,anon,authenticated;
revoke all on function builder_private.schedule_due_form_submission_purges_v1(jsonb) from public,anon,authenticated,service_role,builder_retention_worker;
revoke all on function builder_private.builder_purge_form_submission_v1(jsonb) from public,anon,authenticated,service_role,builder_retention_worker;

grant execute on function public.builder_initialize_submission_retention_v1(jsonb),
  public.builder_update_submission_retention_policy_v1(jsonb),
  public.builder_review_submission_retention_extension_v1(jsonb),
  public.builder_cancel_submission_retention_policy_v1(jsonb),
  public.builder_withdraw_form_submission_consent_v1(jsonb),
  public.builder_request_form_submission_export_v1(jsonb),
  public.builder_revoke_form_submission_export_v1(jsonb),
  public.builder_get_form_submission_export_download_v1(jsonb),
  public.builder_request_form_submission_deletion_v1(jsonb),
  public.builder_project_form_notifications_v1(integer)
to service_role;

grant usage on schema builder_private to builder_retention_worker;
grant execute on function builder_private.schedule_due_form_submission_purges_v1(jsonb),
  builder_private.builder_purge_form_submission_v1(jsonb)
to builder_retention_worker;
