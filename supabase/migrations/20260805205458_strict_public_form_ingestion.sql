create function public.builder_ingest_form_submission_strict_v3(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_template_id text;
  v_idempotency_key uuid;
  v_base_response jsonb;
  v_submission_id uuid;
  v_receipt_id uuid;
  v_prior_result public.builder_form_submission_results%rowtype;
  v_contact_id uuid;
  v_email text;
  v_first_name text;
  v_display_name text;
  v_consent_id uuid;
  v_captured_at timestamptz;
  v_strict_result_exists boolean;
begin
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_template_id := p_request ->> 'templateId';
    v_idempotency_key := (p_request ->> 'idempotencyKey')::uuid;
  exception when others then
    raise exception 'invalid strict ingestion payload' using errcode = '22023';
  end;

  if v_template_id not in ('local-business.contact', 'local-business.newsletter-signup') then
    raise exception 'strict ingestion template is unsupported' using errcode = '22023';
  end if;

  if v_template_id = 'local-business.contact' then
    if not builder_private.dependent_action_allowed(
      v_site_id,
      'growth.customers',
      'growth.leads',
      'write'
    ) then
      raise exception 'strict ingestion unavailable' using errcode = 'P2F39';
    end if;
  elsif not builder_private.module_action_allowed(v_site_id, 'growth.customers', 'write') then
    raise exception 'strict ingestion unavailable' using errcode = 'P2F39';
  end if;

  v_base_response := public.builder_ingest_form_submission_v2(p_request);
  v_submission_id := (v_base_response ->> 'submissionId')::uuid;
  v_receipt_id := (v_base_response ->> 'receiptId')::uuid;

  if (v_base_response ->> 'result') = 'replayed' then
    select exists (
      select 1
      from public.builder_form_submission_results result
      where result.site_id = v_site_id
        and result.submission_id = v_submission_id
        and result.result_code = 'enhanced'
        and result.safe_metadata @> jsonb_build_object(
          'strictAtomic', true,
          'profile', 'official-assembly-live-v1'
        )
    ) into v_strict_result_exists;
    if not v_strict_result_exists then
      raise exception 'strict ingestion replay is incompatible' using errcode = 'P2F09';
    end if;
    return v_base_response;
  end if;

  select result.* into v_prior_result
  from public.builder_form_submission_results result
  where result.site_id = v_site_id and result.submission_id = v_submission_id
  order by result.version desc
  limit 1;
  if not found or v_prior_result.version <> 1 then
    raise exception 'strict ingestion unavailable' using errcode = 'P2F39';
  end if;

  if v_template_id = 'local-business.contact' then
    if v_prior_result.result_code <> 'enhanced'
      or v_prior_result.contact_id is null
      or v_prior_result.lead_id is null
    then
      raise exception 'strict ingestion unavailable' using errcode = 'P2F39';
    end if;
    v_contact_id := v_prior_result.contact_id;
  else
    v_email := nullif(lower(btrim(p_request #>> '{payload,email}')), '');
    v_first_name := nullif(btrim(p_request #>> '{payload,firstName}'), '');
    v_captured_at := (p_request #>> '{consentEvidence,capturedAt}')::timestamptz;
    if v_email is null
      or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or (p_request #>> '{consentEvidence,purpose}') <> 'marketing_email'
    then
      raise exception 'invalid strict newsletter payload' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_site_id::text || ':email:' || v_email, 0)
    );
    select identity.contact_id into v_contact_id
    from public.builder_contact_identities identity
    where identity.site_id = v_site_id
      and identity.kind = 'email'
      and identity.normalized_value = v_email;

    if v_contact_id is null then
      v_contact_id := gen_random_uuid();
      v_display_name := coalesce(v_first_name, v_email);
      insert into public.builder_contacts (
        site_id,
        id,
        display_name,
        preferred_contact_method
      ) values (
        v_site_id,
        v_contact_id,
        v_display_name,
        'email'
      );
      insert into public.builder_contact_identities (
        site_id,
        contact_id,
        kind,
        normalized_value,
        verification_state,
        source
      ) values (
        v_site_id,
        v_contact_id,
        'email',
        v_email,
        'unverified',
        'public_form'
      );
    end if;

    select consent.id into v_consent_id
    from public.builder_form_submission_consents consent
    where consent.site_id = v_site_id and consent.submission_id = v_submission_id;
    if v_consent_id is null then
      raise exception 'strict newsletter consent is unavailable' using errcode = 'P2F39';
    end if;
    insert into public.builder_consents (
      site_id,
      contact_id,
      base_consent_id,
      purpose,
      channel,
      state,
      captured_at
    ) values (
      v_site_id,
      v_contact_id,
      v_consent_id,
      'marketing_email',
      'email',
      'granted',
      v_captured_at
    );
  end if;

  insert into public.builder_form_submission_results (
    site_id,
    submission_id,
    version,
    prior_result_id,
    result_code,
    contact_id,
    lead_id,
    safe_metadata
  ) values (
    v_site_id,
    v_submission_id,
    2,
    v_prior_result.id,
    'enhanced',
    v_contact_id,
    v_prior_result.lead_id,
    jsonb_build_object(
      'safeCode', 'enhanced',
      'strictAtomic', true,
      'profile', 'official-assembly-live-v1'
    )
  );

  update builder_private.builder_ingestion_receipts
  set safe_result_code = 'enhanced', entitlement_decision = 'enhanced'
  where site_id = v_site_id
    and id = v_receipt_id
    and idempotency_key = v_idempotency_key::text;
  if not found then
    raise exception 'strict ingestion receipt is unavailable' using errcode = 'P2F39';
  end if;

  return jsonb_build_object(
    'version', 2,
    'accepted', true,
    'receiptId', v_receipt_id,
    'submissionId', v_submission_id,
    'qualificationResult', v_base_response ->> 'qualificationResult',
    'result', 'accepted',
    'processing', 'enhanced'
  );
end;
$$;

revoke all on function public.builder_ingest_form_submission_strict_v3(jsonb)
from public, anon, authenticated;
grant execute on function public.builder_ingest_form_submission_strict_v3(jsonb)
to service_role;
