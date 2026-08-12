create table public.builder_command_receipts (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  command_id uuid not null,
  idempotency_key text not null check (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'
  ),
  command_type text not null check (
    command_type ~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'
  ),
  command_version integer not null check (command_version > 0),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'received' check (
    status in ('received', 'succeeded', 'failed', 'retry')
  ),
  sanitized_result jsonb not null default '{}'::jsonb check (
    jsonb_typeof(sanitized_result) = 'object'
  ),
  sanitized_evidence jsonb not null default '{"version":1,"codes":[],"metrics":{},"flags":{},"digests":{}}'::jsonb check (
    jsonb_typeof(sanitized_evidence) = 'object'
  ),
  attempt integer not null default 1 check (attempt > 0),
  lease_token uuid default gen_random_uuid(),
  lease_expires_at timestamptz default (clock_timestamp() + interval '30 seconds'),
  retry_at timestamptz,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, command_id),
  unique (site_id, idempotency_key),
  check (
    (status = 'received' and completed_at is null and lease_token is not null
      and lease_expires_at is not null and retry_at is null)
    or (status = 'retry' and completed_at is not null and lease_token is null
      and lease_expires_at is null and retry_at is not null)
    or (status in ('succeeded', 'failed') and completed_at is not null and lease_token is null
      and lease_expires_at is null and retry_at is null)
  )
);

create table public.builder_module_configurations (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  module_id text not null check (
    module_id ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  ),
  config_version integer not null default 1 check (config_version > 0),
  setup_status text not null default 'pending' check (
    setup_status in ('pending', 'setup_required', 'configured', 'failed')
  ),
  entitlement_state text not null default 'provisioning' check (
    entitlement_state in (
      'provisioning', 'provisioning_error', 'setup_required', 'trialing', 'active',
      'payment_attention', 'grace_period', 'suspended', 'offboarding',
      'termination_failed', 'terminated'
    )
  ),
  disabled_by_default boolean not null default true check (disabled_by_default),
  configuration jsonb not null default '{}'::jsonb check (
    jsonb_typeof(configuration) = 'object'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, module_id)
);

create index builder_command_receipts_status_idx
  on public.builder_command_receipts (site_id, status, retry_at, lease_expires_at);
create index builder_module_configurations_status_idx
  on public.builder_module_configurations (site_id, entitlement_state, setup_status);

create function public.builder_reserve_command_receipt(
  p_site_id uuid,
  p_command_id uuid,
  p_idempotency_key text,
  p_command_type text,
  p_command_version integer,
  p_payload_hash text,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_receipt public.builder_command_receipts%rowtype;
begin
  if p_lease_seconds < 5 or p_lease_seconds > 300 then
    return jsonb_build_object('status', 'conflict');
  end if;

  loop
    select receipt.*
    into v_receipt
    from public.builder_command_receipts receipt
    where receipt.site_id = p_site_id
      and (
        receipt.command_id = p_command_id
        or receipt.idempotency_key = p_idempotency_key
      )
    order by receipt.command_id
    limit 1
    for update;

    if found then
      if v_receipt.command_id <> p_command_id
        or v_receipt.idempotency_key <> p_idempotency_key
        or v_receipt.command_type <> p_command_type
        or v_receipt.command_version <> p_command_version
        or v_receipt.payload_hash <> p_payload_hash
      then
        return jsonb_build_object('status', 'conflict');
      end if;
      if v_receipt.status = 'received' and v_receipt.lease_expires_at > clock_timestamp() then
        return jsonb_build_object(
          'status', 'in_progress',
          'retryAt', v_receipt.lease_expires_at
        );
      end if;
      if v_receipt.status = 'retry' and v_receipt.retry_at > clock_timestamp() then
        return jsonb_build_object(
          'status', 'replay',
          'result', v_receipt.sanitized_result
        );
      end if;
      if v_receipt.status = 'received'
        or (v_receipt.status = 'retry' and v_receipt.retry_at <= clock_timestamp())
      then
        update public.builder_command_receipts receipt
        set status = 'received',
            sanitized_result = '{}'::jsonb,
            sanitized_evidence = '{"version":1,"codes":[],"metrics":{},"flags":{},"digests":{}}'::jsonb,
            attempt = receipt.attempt + 1,
            lease_token = gen_random_uuid(),
            lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
            retry_at = null,
            received_at = clock_timestamp(),
            completed_at = null,
            updated_at = clock_timestamp()
        where receipt.site_id = p_site_id
          and receipt.command_id = p_command_id
        returning receipt.* into v_receipt;

        return jsonb_build_object(
          'status', 'acquired',
          'leaseToken', v_receipt.lease_token,
          'leaseExpiresAt', v_receipt.lease_expires_at
        );
      end if;
      return jsonb_build_object(
        'status', 'replay',
        'result', v_receipt.sanitized_result
      );
    end if;

    begin
      insert into public.builder_command_receipts (
        site_id,
        command_id,
        idempotency_key,
        command_type,
        command_version,
        payload_hash,
        lease_token,
        lease_expires_at
      ) values (
        p_site_id,
        p_command_id,
        p_idempotency_key,
        p_command_type,
        p_command_version,
        p_payload_hash,
        gen_random_uuid(),
        clock_timestamp() + make_interval(secs => p_lease_seconds)
      ) returning * into v_receipt;
      return jsonb_build_object(
        'status', 'acquired',
        'leaseToken', v_receipt.lease_token,
        'leaseExpiresAt', v_receipt.lease_expires_at
      );
    exception when unique_violation then
      -- A concurrent reservation won. Re-read it under lock.
    end;
  end loop;
end;
$$;

create function public.builder_complete_command_receipt(
  p_site_id uuid,
  p_command_id uuid,
  p_idempotency_key text,
  p_command_type text,
  p_command_version integer,
  p_payload_hash text,
  p_lease_token uuid,
  p_result jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_evidence jsonb;
  v_outcome text;
  v_retry_at timestamptz;
begin
  if jsonb_typeof(p_result) <> 'object' or octet_length(p_result::text) > 32768 then
    return false;
  end if;

  v_outcome := p_result ->> 'outcome';
  v_evidence := p_result -> 'evidence';
  if v_outcome is null
    or v_outcome not in ('succeeded', 'failed', 'retry')
    or jsonb_typeof(v_evidence) <> 'object'
    or (select count(*) from jsonb_object_keys(v_evidence)) <> 5
    or not (v_evidence ?& array['version', 'codes', 'metrics', 'flags', 'digests'])
    or v_evidence -> 'version' <> '1'::jsonb
  then return false;
  end if;

  if jsonb_typeof(v_evidence -> 'codes') <> 'array' then return false;
  end if;
  if jsonb_array_length(v_evidence -> 'codes') > 64
    or exists (
      select 1 from jsonb_array_elements(v_evidence -> 'codes') code
      where jsonb_typeof(code) <> 'string'
        or code #>> '{}' !~ '^[A-Z][A-Z0-9_]{0,63}$'
    )
  then return false;
  end if;

  if jsonb_typeof(v_evidence -> 'metrics') <> 'object' then return false;
  end if;
  if (select count(*) from jsonb_object_keys(v_evidence -> 'metrics')) > 64
    or exists (
      select 1 from jsonb_each(v_evidence -> 'metrics') metric
      where metric.key !~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,63}$'
        or jsonb_typeof(metric.value) <> 'number'
        or case when jsonb_typeof(metric.value) = 'number' then
          (metric.value #>> '{}')::numeric <> trunc((metric.value #>> '{}')::numeric)
          or (metric.value #>> '{}')::numeric < 0
          or (metric.value #>> '{}')::numeric > 1000000000
        else true end
    )
  then return false;
  end if;

  if jsonb_typeof(v_evidence -> 'flags') <> 'object' then return false;
  end if;
  if (select count(*) from jsonb_object_keys(v_evidence -> 'flags')) > 64
    or exists (
      select 1 from jsonb_each(v_evidence -> 'flags') flag
      where flag.key !~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,63}$'
        or jsonb_typeof(flag.value) <> 'boolean'
    )
  then return false;
  end if;

  if jsonb_typeof(v_evidence -> 'digests') <> 'object' then return false;
  end if;
  if (select count(*) from jsonb_object_keys(v_evidence -> 'digests')) > 64
    or exists (
      select 1 from jsonb_each(v_evidence -> 'digests') digest
      where digest.key !~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,63}$'
        or jsonb_typeof(digest.value) <> 'string'
        or digest.value #>> '{}' !~ '^[a-f0-9]{64}$'
    )
  then return false;
  end if;

  if v_outcome = 'succeeded' then
    if (select count(*) from jsonb_object_keys(p_result)) <> 3
      or not (p_result ?& array['outcome', 'resultCode', 'evidence'])
      or p_result ->> 'resultCode' !~ '^[A-Z][A-Z0-9_]{0,63}$'
    then return false;
    end if;
  elsif v_outcome = 'failed' then
    if (select count(*) from jsonb_object_keys(p_result)) <> 3
      or not (p_result ?& array['outcome', 'errorCode', 'evidence'])
      or p_result ->> 'errorCode' !~ '^[A-Z][A-Z0-9_]{0,63}$'
    then return false;
    end if;
  else
    if (select count(*) from jsonb_object_keys(p_result)) <> 4
      or not (p_result ?& array['outcome', 'errorCode', 'retryAt', 'evidence'])
      or p_result ->> 'errorCode' !~ '^[A-Z][A-Z0-9_]{0,63}$'
      or p_result ->> 'retryAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    then return false;
    end if;
    begin
      v_retry_at := (p_result ->> 'retryAt')::timestamptz;
    exception when others then
      return false;
    end;
    if v_retry_at <= clock_timestamp() then return false;
    end if;
  end if;

  update public.builder_command_receipts receipt
  set status = v_outcome,
      sanitized_result = p_result,
      sanitized_evidence = v_evidence,
      lease_token = null,
      lease_expires_at = null,
      retry_at = case when v_outcome = 'retry' then v_retry_at else null end,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where receipt.site_id = p_site_id
    and receipt.command_id = p_command_id
    and receipt.idempotency_key = p_idempotency_key
    and receipt.command_type = p_command_type
    and receipt.command_version = p_command_version
    and receipt.payload_hash = p_payload_hash
    and receipt.status = 'received'
    and receipt.lease_token = p_lease_token
    and receipt.lease_expires_at > clock_timestamp();

  return found;
end;
$$;

create function public.builder_find_command_receipt(
  p_site_id uuid,
  p_command_id uuid,
  p_idempotency_key text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'siteId', receipt.site_id,
    'commandId', receipt.command_id,
    'idempotencyKey', receipt.idempotency_key,
    'type', receipt.command_type,
    'version', receipt.command_version,
    'payloadHash', receipt.payload_hash,
    'result', receipt.sanitized_result
  )
  from public.builder_command_receipts receipt
  where receipt.site_id = p_site_id
    and receipt.command_id = p_command_id
    and receipt.idempotency_key = p_idempotency_key
    and receipt.status <> 'received';
$$;

revoke all on function public.builder_reserve_command_receipt(uuid, uuid, text, text, integer, text, integer)
  from public, anon, authenticated;
revoke all on function public.builder_complete_command_receipt(uuid, uuid, text, text, integer, text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.builder_find_command_receipt(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.builder_reserve_command_receipt(uuid, uuid, text, text, integer, text, integer)
  to service_role;
grant execute on function public.builder_complete_command_receipt(uuid, uuid, text, text, integer, text, uuid, jsonb)
  to service_role;
grant execute on function public.builder_find_command_receipt(uuid, uuid, text)
  to service_role;

alter table public.builder_command_receipts enable row level security;
alter table public.builder_module_configurations enable row level security;

create policy builder_command_receipts_owner_read
on public.builder_command_receipts
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner']));

create policy builder_module_configurations_owner_read
on public.builder_module_configurations
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner']));

create policy builder_module_configurations_owner_setup_update
on public.builder_module_configurations
for update to authenticated
using (
  entitlement_state = 'setup_required'
  and builder_private.has_site_role(site_id, array['owner'])
)
with check (
  entitlement_state = 'setup_required'
  and setup_status in ('setup_required', 'configured')
  and disabled_by_default
  and builder_private.has_site_role(site_id, array['owner'])
);

revoke all on public.builder_command_receipts from anon, authenticated;
revoke all on public.builder_module_configurations from anon, authenticated;

grant select on public.builder_command_receipts to authenticated;
grant select on public.builder_module_configurations to authenticated;
grant update (configuration, setup_status, updated_at)
  on public.builder_module_configurations to authenticated;

grant all on public.builder_command_receipts to service_role;
grant all on public.builder_module_configurations to service_role;
