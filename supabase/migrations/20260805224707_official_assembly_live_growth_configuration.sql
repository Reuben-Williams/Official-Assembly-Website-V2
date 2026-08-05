create function public.builder_apply_official_assembly_live_growth_configuration(
  p_site_id uuid,
  p_installation_id uuid,
  p_lease_owner uuid,
  p_fencing_token bigint,
  p_command_id uuid,
  p_module_id text,
  p_module_version text,
  p_config_version integer,
  p_configuration text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_config_version <> 1
    or p_configuration <> 'official-assembly-live-v1'
    or (p_module_id, p_module_version) not in (
      ('growth.customers', '1.0.1'),
      ('growth.leads', '1.0.1'),
      ('growth.dashboard', '2.0.1')
    ) then
    raise exception using errcode = '22023', message = 'official_assembly_growth_configuration_invalid';
  end if;

  perform 1
  from public.builder_installation_worker_leases as lease
  where lease.site_id = p_site_id
    and lease.installation_id = p_installation_id
    and lease.lease_owner = p_lease_owner
    and lease.fencing_token = p_fencing_token
    and lease.lease_expires_at > clock_timestamp()
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'site_installation_lease_lost';
  end if;

  perform 1
  from public.builder_command_receipts as receipt
  where receipt.site_id = p_site_id
    and receipt.command_id = p_command_id
    and receipt.command_type = p_module_id || '.configure'
    and receipt.command_version = 1
    and receipt.status = 'received'
    and receipt.lease_expires_at > clock_timestamp()
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'site_command_receipt_not_owned';
  end if;

  insert into public.builder_module_configurations (
    site_id,
    module_id,
    module_version,
    config_version,
    setup_status,
    entitlement_state,
    disabled_by_default,
    configuration,
    last_configuration_command_id,
    updated_at
  ) values (
    p_site_id,
    p_module_id,
    p_module_version,
    p_config_version,
    'configured',
    'active',
    true,
    jsonb_build_object(
      'configuration', p_configuration,
      'moduleVersion', p_module_version,
      'configVersion', p_config_version
    ),
    p_command_id,
    clock_timestamp()
  ) on conflict (site_id, module_id) do update
  set module_version = excluded.module_version,
      config_version = excluded.config_version,
      setup_status = 'configured',
      entitlement_state = 'active',
      disabled_by_default = true,
      configuration = excluded.configuration,
      last_configuration_command_id = excluded.last_configuration_command_id,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'moduleId', p_module_id,
    'moduleVersion', p_module_version,
    'configVersion', p_config_version::text,
    'configuration', p_configuration
  );
end;
$$;

alter function public.builder_apply_official_assembly_live_growth_configuration(
  uuid, uuid, uuid, bigint, uuid, text, text, integer, text
) owner to postgres;

revoke all on function public.builder_apply_official_assembly_live_growth_configuration(
  uuid, uuid, uuid, bigint, uuid, text, text, integer, text
) from public, anon, authenticated, service_role;

grant execute on function public.builder_apply_official_assembly_live_growth_configuration(
  uuid, uuid, uuid, bigint, uuid, text, text, integer, text
) to service_role;
