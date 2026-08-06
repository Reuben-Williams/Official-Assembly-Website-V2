create table public.builder_installation_worker_leases (
  installation_id uuid primary key,
  site_id uuid not null unique references public.builder_sites(id) on delete restrict,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  lease_owner uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((lease_owner is null) = (lease_expires_at is null)),
  check (updated_at >= created_at)
);

alter table public.builder_installation_worker_leases enable row level security;
revoke all on public.builder_installation_worker_leases
  from public, anon, authenticated, service_role;

create function public.builder_get_runtime_site_identity(p_site_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_key text;
begin
  select site.site_key
  into v_site_key
  from public.builder_sites as site
  where site.id = p_site_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'site_data_plane_identity_mismatch';
  end if;

  return jsonb_build_object(
    'version', 1,
    'siteId', p_site_id::text,
    'siteKey', v_site_key
  );
end;
$$;

create function public.builder_acquire_installation_worker_lease(
  p_site_id uuid,
  p_expected_site_key text,
  p_installation_id uuid,
  p_lease_owner uuid,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.builder_installation_worker_leases%rowtype;
begin
  if p_lease_seconds < 60 or p_lease_seconds > 300 then
    raise exception using
      errcode = '22023',
      message = 'site_installation_lease_duration_invalid';
  end if;

  perform 1
  from public.builder_sites as site
  where site.id = p_site_id
    and site.site_key = p_expected_site_key;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'site_data_plane_identity_mismatch';
  end if;

  insert into public.builder_installation_worker_leases (installation_id, site_id)
  values (p_installation_id, p_site_id)
  on conflict do nothing;

  select lease.*
  into v_lease
  from public.builder_installation_worker_leases as lease
  where lease.installation_id = p_installation_id
  for update;

  if not found or v_lease.site_id <> p_site_id then
    raise exception using
      errcode = '23514',
      message = 'site_installation_lease_binding_mismatch';
  end if;

  if v_lease.lease_owner is not null
     and v_lease.lease_expires_at > clock_timestamp() then
    return jsonb_build_object(
      'version', 1,
      'acquired', false,
      'siteId', p_site_id::text,
      'installationId', p_installation_id::text,
      'leaseOwner', null,
      'fencingToken', null,
      'leaseExpiresAt', null
    );
  end if;

  if v_lease.fencing_token = 9223372036854775807 then
    raise exception using
      errcode = '22003',
      message = 'site_installation_fencing_token_exhausted';
  end if;

  update public.builder_installation_worker_leases as lease
  set fencing_token = lease.fencing_token + 1,
      lease_owner = p_lease_owner,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  where lease.installation_id = p_installation_id
  returning lease.* into v_lease;

  return jsonb_build_object(
    'version', 1,
    'acquired', true,
    'siteId', v_lease.site_id::text,
    'installationId', v_lease.installation_id::text,
    'leaseOwner', v_lease.lease_owner::text,
    'fencingToken', v_lease.fencing_token::text,
    'leaseExpiresAt', v_lease.lease_expires_at
  );
end;
$$;

create function public.builder_renew_installation_worker_lease(
  p_site_id uuid,
  p_expected_site_key text,
  p_installation_id uuid,
  p_lease_owner uuid,
  p_fencing_token bigint,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.builder_installation_worker_leases%rowtype;
begin
  if p_lease_seconds < 60 or p_lease_seconds > 300 then
    raise exception using
      errcode = '22023',
      message = 'site_installation_lease_duration_invalid';
  end if;

  perform 1
  from public.builder_sites as site
  where site.id = p_site_id
    and site.site_key = p_expected_site_key;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'site_data_plane_identity_mismatch';
  end if;

  update public.builder_installation_worker_leases as lease
  set lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  where lease.installation_id = p_installation_id
    and lease.site_id = p_site_id
    and lease.lease_owner = p_lease_owner
    and lease.fencing_token = p_fencing_token
    and lease.lease_expires_at > clock_timestamp()
  returning lease.* into v_lease;

  if not found then
    return jsonb_build_object(
      'version', 1,
      'acquired', false,
      'siteId', p_site_id::text,
      'installationId', p_installation_id::text,
      'leaseOwner', null,
      'fencingToken', null,
      'leaseExpiresAt', null
    );
  end if;

  return jsonb_build_object(
    'version', 1,
    'acquired', true,
    'siteId', v_lease.site_id::text,
    'installationId', v_lease.installation_id::text,
    'leaseOwner', v_lease.lease_owner::text,
    'fencingToken', v_lease.fencing_token::text,
    'leaseExpiresAt', v_lease.lease_expires_at
  );
end;
$$;

create function public.builder_release_installation_worker_lease(
  p_site_id uuid,
  p_expected_site_key text,
  p_installation_id uuid,
  p_lease_owner uuid,
  p_fencing_token bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.builder_sites as site
  where site.id = p_site_id
    and site.site_key = p_expected_site_key;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'site_data_plane_identity_mismatch';
  end if;

  update public.builder_installation_worker_leases as lease
  set lease_owner = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where lease.installation_id = p_installation_id
    and lease.site_id = p_site_id
    and lease.lease_owner = p_lease_owner
    and lease.fencing_token = p_fencing_token;

  return found;
end;
$$;

alter function public.builder_get_runtime_site_identity(uuid) owner to postgres;
alter function public.builder_acquire_installation_worker_lease(uuid, text, uuid, uuid, integer) owner to postgres;
alter function public.builder_renew_installation_worker_lease(uuid, text, uuid, uuid, bigint, integer) owner to postgres;
alter function public.builder_release_installation_worker_lease(uuid, text, uuid, uuid, bigint) owner to postgres;

revoke all on function public.builder_get_runtime_site_identity(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.builder_acquire_installation_worker_lease(uuid, text, uuid, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.builder_renew_installation_worker_lease(uuid, text, uuid, uuid, bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.builder_release_installation_worker_lease(uuid, text, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;

grant execute on function public.builder_get_runtime_site_identity(uuid) to service_role;
grant execute on function public.builder_acquire_installation_worker_lease(uuid, text, uuid, uuid, integer) to service_role;
grant execute on function public.builder_renew_installation_worker_lease(uuid, text, uuid, uuid, bigint, integer) to service_role;
grant execute on function public.builder_release_installation_worker_lease(uuid, text, uuid, uuid, bigint) to service_role;
