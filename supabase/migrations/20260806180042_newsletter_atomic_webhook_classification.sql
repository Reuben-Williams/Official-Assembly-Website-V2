create or replace function public.builder_reconcile_newsletter_webhook_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_receipt_id uuid;
  v_existing public.builder_newsletter_webhook_receipts%rowtype;
  v_disposition text;
  v_classification jsonb;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
  exception when others then
    raise exception 'invalid newsletter webhook' using errcode = '22023';
  end;
  v_disposition := p_request ->> 'disposition';
  if (p_request ->> 'version') <> '1'
    or nullif(p_request ->> 'providerScopeId', '') is null
    or nullif(p_request ->> 'svixId', '') is null
    or (p_request ->> 'digest') !~ '^[a-f0-9]{64}$'
    or v_disposition not in ('ignored', 'matched', 'incident')
  then
    raise exception 'invalid newsletter webhook' using errcode = '22023';
  end if;

  select receipt.* into v_existing
  from public.builder_newsletter_webhook_receipts receipt
  where receipt.site_id = v_site_id
    and receipt.provider_scope_id = p_request ->> 'providerScopeId'
    and receipt.svix_id = p_request ->> 'svixId';
  if found then
    return jsonb_build_object(
      'version', 1, 'replayed', true, 'disposition', v_existing.disposition,
      'receiptId', v_existing.id
    );
  end if;

  insert into public.builder_newsletter_webhook_receipts (
    site_id, provider_scope_id, svix_id, event_type, provider_created_at,
    provider_message_id, provider_broadcast_id, disposition, safe_digest
  ) values (
    v_site_id,
    p_request ->> 'providerScopeId',
    p_request ->> 'svixId',
    p_request ->> 'eventType',
    (p_request ->> 'providerCreatedAt')::timestamptz,
    nullif(p_request ->> 'providerMessageId', ''),
    nullif(p_request ->> 'providerBroadcastId', ''),
    v_disposition,
    p_request ->> 'digest'
  ) returning id into v_receipt_id;

  if pg_catalog.current_setting('builder.newsletter_test_failure', true) = 'after_webhook_receipt' then
    raise exception 'newsletter injected rollback' using errcode = 'P2N99';
  end if;

  if coalesce((p_request ->> 'classificationRequested')::boolean, false) then
    v_classification := public.builder_classify_newsletter_broadcast_v1(jsonb_build_object(
      'version', 1,
      'siteId', v_site_id,
      'providerScopeId', p_request ->> 'providerScopeId',
      'providerBroadcastId', p_request ->> 'providerBroadcastId',
      'validationId', p_request ->> 'validationId',
      'digest', p_request ->> 'digest',
      'providerStatus', p_request ->> 'providerStatus',
      'sentAt', p_request ->> 'sentAt',
      'evidenceSource', 'webhook',
      'evidenceId', p_request ->> 'svixId'
    ));
    v_disposition := case
      when v_classification ->> 'disposition' = 'consumed_matching' then 'matched'
      else 'incident'
    end;
    update public.builder_newsletter_webhook_receipts
    set disposition = v_disposition
    where site_id = v_site_id and id = v_receipt_id;
  elsif v_disposition = 'incident' then
    if nullif(p_request ->> 'providerBroadcastId', '') is null
      or (p_request ->> 'incidentReason') not in ('unvalidated', 'mismatch', 'expired', 'provider_anomaly')
    then
      raise exception 'invalid newsletter incident' using errcode = '22023';
    end if;
    insert into public.builder_newsletter_broadcast_incidents (
      site_id, provider_scope_id, provider_broadcast_id, reason,
      first_evidence_id, last_evidence_id
    ) values (
      v_site_id,
      p_request ->> 'providerScopeId',
      p_request ->> 'providerBroadcastId',
      p_request ->> 'incidentReason',
      p_request ->> 'svixId',
      p_request ->> 'svixId'
    )
    on conflict (site_id, provider_scope_id, provider_broadcast_id) do update
    set occurrence_count = public.builder_newsletter_broadcast_incidents.occurrence_count + 1,
        last_evidence_id = excluded.last_evidence_id,
        last_seen_at = clock_timestamp();
  end if;

  return jsonb_build_object(
    'version', 1, 'replayed', false,
    'disposition', v_disposition, 'receiptId', v_receipt_id
  );
end;
$$;

revoke all on function public.builder_reconcile_newsletter_webhook_v1(jsonb)
from public, anon, authenticated;
grant execute on function public.builder_reconcile_newsletter_webhook_v1(jsonb)
to service_role;
