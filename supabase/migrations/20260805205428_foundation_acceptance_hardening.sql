grant execute on function builder_private.has_site_role(uuid, text[]) to authenticated;

alter function public.builder_transition_post(text, text, jsonb, text) security definer;
alter function public.builder_create_post(text, uuid, jsonb, text) security definer;

create or replace function public.digest(p_data bytea, p_type text)
returns bytea
language sql
immutable
strict
parallel safe
set search_path = pg_catalog, extensions
as $$
  select extensions.digest(p_data, p_type);
$$;

revoke all on function public.digest(bytea, text) from public, anon, authenticated;

create or replace function public.builder_reserve_command_receipt(
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

  return jsonb_build_object('status', 'conflict');
end;
$$;
