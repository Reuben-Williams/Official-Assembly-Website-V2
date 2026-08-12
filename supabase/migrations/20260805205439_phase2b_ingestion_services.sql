create function public.builder_ingest_form_submission_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_idempotency_key uuid;
  v_receipt_id uuid;
  v_submitted_at timestamptz;
  v_captured_at timestamptz;
  v_form_id text;
  v_zip_code text;
  v_locale text;
  v_request_fingerprint text;
  v_rate_limits jsonb;
  v_network_rate jsonb;
  v_identity_rate jsonb;
  v_network_bucket_key_hmac text;
  v_identity_bucket_key_hmac text;
  v_network_window_started_at timestamptz;
  v_network_window_ends_at timestamptz;
  v_identity_window_started_at timestamptz;
  v_identity_window_ends_at timestamptz;
  v_network_rate_limit integer;
  v_identity_rate_limit integer;
  v_claim_kind text;
  v_claim_bucket_key_hmac text;
  v_claim_window_started_at timestamptz;
  v_claim_window_ends_at timestamptz;
  v_claim_rate_limit integer;
  v_rate_count integer;
  v_payload jsonb;
  v_consent jsonb;
  v_configuration jsonb;
  v_first_name text;
  v_last_name text;
  v_display_name text;
  v_email text;
  v_phone text;
  v_service text;
  v_message text;
  v_urgency text;
  v_policy_version text;
  v_purpose text;
  v_language_digest text;
  v_existing_receipt builder_private.builder_ingestion_receipts%rowtype;
  v_submission_id uuid := gen_random_uuid();
  v_base_consent_id uuid := gen_random_uuid();
  v_result_id uuid := gen_random_uuid();
  v_email_contact_id uuid;
  v_phone_contact_id uuid;
  v_review_contact_id uuid;
  v_contact_id uuid;
  v_lead_id uuid;
  v_result_code text := 'base_only';
  v_safe_code text := 'enhancement_unavailable';
  v_entitlement_decision text := 'base_only';
  v_channel text;
  v_constraint_name text;
begin
  if jsonb_typeof(p_request) <> 'object'
    or octet_length(p_request::text) > 65536
    or not (p_request ?& array[
      'version', 'siteId', 'formId', 'idempotencyKey', 'submittedAt', 'zipCode', 'locale',
      'payload', 'consentEvidence', 'securityReceiptId', 'requestFingerprint', 'rateLimits'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_request) as request_key(key)
      where request_key.key <> all(array[
        'version', 'siteId', 'formId', 'idempotencyKey', 'submittedAt', 'zipCode', 'locale',
        'payload', 'consentEvidence', 'securityReceiptId', 'requestFingerprint', 'rateLimits'
      ])
    )
  then
    raise exception 'invalid ingestion payload' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_idempotency_key := (p_request ->> 'idempotencyKey')::uuid;
    v_receipt_id := (p_request ->> 'securityReceiptId')::uuid;
    v_submitted_at := (p_request ->> 'submittedAt')::timestamptz;
    v_form_id := p_request ->> 'formId';
    v_zip_code := p_request ->> 'zipCode';
    v_locale := p_request ->> 'locale';
    v_request_fingerprint := p_request ->> 'requestFingerprint';
    v_payload := p_request -> 'payload';
    v_consent := p_request -> 'consentEvidence';
    v_rate_limits := p_request -> 'rateLimits';
    v_captured_at := (v_consent ->> 'capturedAt')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'invalid ingestion payload' using errcode = '22023';
  end;

  if v_site_id is null
    or v_idempotency_key is null
    or v_receipt_id is null
    or v_submitted_at is null
    or v_captured_at is null
    or v_form_id is null
    or v_zip_code is null
    or v_locale is null
    or v_request_fingerprint is null
    or (p_request ->> 'version') <> '1'
    or v_form_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or v_zip_code !~ '^[0-9]{5}(-[0-9]{4})?$'
    or v_locale !~ '^[A-Za-z]{2}(-[A-Za-z0-9]{2,8})?$'
    or v_request_fingerprint !~ '^[a-f0-9]{64}$'
    or v_submitted_at < statement_timestamp() - interval '24 hours'
    or v_submitted_at > statement_timestamp() + interval '5 minutes'
    or v_captured_at < v_submitted_at - interval '5 minutes'
    or v_captured_at > statement_timestamp() + interval '5 minutes'
  then
    raise exception 'invalid ingestion payload' using errcode = '22023';
  end if;

  if jsonb_typeof(v_rate_limits) <> 'array'
    or jsonb_array_length(v_rate_limits) <> 2
  then
    raise exception 'invalid ingestion rate limits' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_rate_limits) as rate_entry(value)
    where jsonb_typeof(rate_entry.value) <> 'object'
  ) then
    raise exception 'invalid ingestion rate limits' using errcode = '22023';
  end if;

  if exists (
      select 1
      from jsonb_array_elements(v_rate_limits) as rate_entry(value)
      where not (rate_entry.value ?& array[
        'kind', 'bucketKeyHmac', 'windowStartedAt', 'windowEndsAt', 'limit'
      ])
        or exists (
          select 1
          from jsonb_object_keys(rate_entry.value) as rate_key(key)
          where rate_key.key <> all(array[
            'kind', 'bucketKeyHmac', 'windowStartedAt', 'windowEndsAt', 'limit'
          ])
        )
    )
    or (select count(*) from jsonb_array_elements(v_rate_limits) as rate_entry(value)
        where rate_entry.value ->> 'kind' = 'network') <> 1
    or (select count(*) from jsonb_array_elements(v_rate_limits) as rate_entry(value)
        where rate_entry.value ->> 'kind' = 'identity') <> 1
    or exists (
      select 1
      from jsonb_array_elements(v_rate_limits) as rate_entry(value)
      where rate_entry.value ->> 'kind' not in ('network', 'identity')
    )
  then
    raise exception 'invalid ingestion rate limits' using errcode = '22023';
  end if;

  select rate_entry.value into v_network_rate
  from jsonb_array_elements(v_rate_limits) as rate_entry(value)
  where rate_entry.value ->> 'kind' = 'network';

  select rate_entry.value into v_identity_rate
  from jsonb_array_elements(v_rate_limits) as rate_entry(value)
  where rate_entry.value ->> 'kind' = 'identity';

  begin
    v_network_bucket_key_hmac := v_network_rate ->> 'bucketKeyHmac';
    v_identity_bucket_key_hmac := v_identity_rate ->> 'bucketKeyHmac';
    v_network_window_started_at := (v_network_rate ->> 'windowStartedAt')::timestamptz;
    v_network_window_ends_at := (v_network_rate ->> 'windowEndsAt')::timestamptz;
    v_identity_window_started_at := (v_identity_rate ->> 'windowStartedAt')::timestamptz;
    v_identity_window_ends_at := (v_identity_rate ->> 'windowEndsAt')::timestamptz;
    v_network_rate_limit := (v_network_rate ->> 'limit')::integer;
    v_identity_rate_limit := (v_identity_rate ->> 'limit')::integer;
  exception
    when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'invalid ingestion rate limits' using errcode = '22023';
  end;

  if v_network_bucket_key_hmac is null
    or v_identity_bucket_key_hmac is null
    or v_network_window_started_at is null
    or v_network_window_ends_at is null
    or v_identity_window_started_at is null
    or v_identity_window_ends_at is null
    or v_network_rate_limit is null
    or v_identity_rate_limit is null
    or v_network_bucket_key_hmac !~ '^[a-f0-9]{64}$'
    or v_identity_bucket_key_hmac !~ '^[a-f0-9]{64}$'
    or v_network_bucket_key_hmac = v_identity_bucket_key_hmac
    or v_network_rate_limit < 1 or v_network_rate_limit > 100
    or v_identity_rate_limit < 1 or v_identity_rate_limit > 100
    or v_network_window_started_at > statement_timestamp() + interval '5 minutes'
    or v_network_window_started_at < statement_timestamp() - interval '24 hours'
    or v_identity_window_started_at > statement_timestamp() + interval '5 minutes'
    or v_identity_window_started_at < statement_timestamp() - interval '24 hours'
    or extract(minute from v_network_window_started_at) <> 0
    or extract(second from v_network_window_started_at) <> 0
    or extract(minute from v_identity_window_started_at) <> 0
    or extract(second from v_identity_window_started_at) <> 0
    or v_network_window_ends_at <> v_network_window_started_at + interval '1 hour'
    or v_identity_window_ends_at <> v_identity_window_started_at + interval '1 hour'
    or v_network_window_ends_at <= statement_timestamp()
    or v_identity_window_ends_at <= statement_timestamp()
  then
    raise exception 'invalid ingestion rate limits' using errcode = '22023';
  end if;

  if jsonb_typeof(v_payload) <> 'object'
    or octet_length(v_payload::text) > 32768
    or (select count(*) from jsonb_object_keys(v_payload)) > 16
    or not (v_payload ?& array['firstName', 'lastName', 'service', 'message'])
    or exists (
      select 1 from jsonb_object_keys(v_payload) as payload_key(key)
      where payload_key.key <> all(array[
        'firstName', 'lastName', 'email', 'phone', 'service', 'message', 'urgency'
      ])
    )
    or jsonb_typeof(v_consent) <> 'object'
    or not (v_consent ?& array['policyVersion', 'purpose', 'languageDigest', 'source', 'capturedAt'])
    or exists (
      select 1 from jsonb_object_keys(v_consent) as consent_key(key)
      where consent_key.key <> all(array[
        'policyVersion', 'purpose', 'languageDigest', 'source', 'capturedAt'
      ])
    )
  then
    raise exception 'invalid ingestion payload' using errcode = '22023';
  end if;

  v_first_name := btrim(v_payload ->> 'firstName');
  v_last_name := btrim(v_payload ->> 'lastName');
  v_display_name := v_first_name || ' ' || v_last_name;
  v_email := nullif(lower(btrim(v_payload ->> 'email')), '');
  v_phone := nullif(btrim(v_payload ->> 'phone'), '');
  v_service := btrim(v_payload ->> 'service');
  v_message := btrim(v_payload ->> 'message');
  v_urgency := coalesce(nullif(v_payload ->> 'urgency', ''), 'normal');
  v_policy_version := v_consent ->> 'policyVersion';
  v_purpose := v_consent ->> 'purpose';
  v_language_digest := v_consent ->> 'languageDigest';

  if char_length(v_first_name) not between 1 and 100
    or char_length(v_last_name) not between 1 and 100
    or char_length(v_display_name) > 200
    or (v_email is null and v_phone is null)
    or (v_email is not null and (char_length(v_email) > 320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    or (v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$')
    or char_length(v_service) not between 1 and 160
    or char_length(v_message) > 2000
    or v_urgency not in ('low', 'normal', 'high', 'emergency')
    or v_policy_version !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
    or v_purpose !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
    or v_language_digest !~ '^[a-f0-9]{64}$'
    or (v_consent ->> 'source') <> 'public_form'
  then
    raise exception 'invalid ingestion payload' using errcode = '22023';
  end if;

  select module.configuration
  into v_configuration
  from public.builder_module_configurations as module
  where module.site_id = v_site_id
    and module.module_id = 'core.website'
    and module.setup_status = 'configured';

  if not found
    or jsonb_typeof(v_configuration #> array['forms', v_form_id, 'services']) <> 'array'
    or not exists (
      select 1
      from jsonb_array_elements_text(v_configuration #> array['forms', v_form_id, 'services']) as allowed_service(value)
      where allowed_service.value = v_service
    )
  then
    raise exception 'unknown ingestion form or service' using errcode = '22023';
  end if;

  select receipt.*
  into v_existing_receipt
  from builder_private.builder_ingestion_receipts as receipt
  where receipt.site_id = v_site_id
    and receipt.idempotency_key = v_idempotency_key::text
  for update;

  if found then
    if v_existing_receipt.request_fingerprint <> v_request_fingerprint then
      raise exception 'ingestion idempotency conflict' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'version', 1, 'accepted', true, 'receiptId', v_existing_receipt.id, 'result', 'replayed'
    );
  end if;

  insert into builder_private.builder_ingestion_receipts (
    site_id, id, idempotency_key, request_fingerprint, safe_result_code,
    entitlement_decision, expires_at
  ) values (
    v_site_id, v_receipt_id, v_idempotency_key::text, v_request_fingerprint,
    'enhancement_unavailable', 'base_only', statement_timestamp() + interval '24 hours'
  )
  on conflict (site_id, idempotency_key) do nothing
  returning * into v_existing_receipt;

  if not found then
    select receipt.*
    into v_existing_receipt
    from builder_private.builder_ingestion_receipts as receipt
    where receipt.site_id = v_site_id
      and receipt.idempotency_key = v_idempotency_key::text
    for update;
    if v_existing_receipt.request_fingerprint <> v_request_fingerprint then
      raise exception 'ingestion idempotency conflict' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'version', 1, 'accepted', true, 'receiptId', v_existing_receipt.id, 'result', 'replayed'
    );
  end if;

  foreach v_claim_kind in array array['network', 'identity']::text[] loop
    if v_claim_kind = 'network' then
      v_claim_bucket_key_hmac := v_network_bucket_key_hmac;
      v_claim_window_started_at := v_network_window_started_at;
      v_claim_window_ends_at := v_network_window_ends_at;
      v_claim_rate_limit := v_network_rate_limit;
    else
      v_claim_bucket_key_hmac := v_identity_bucket_key_hmac;
      v_claim_window_started_at := v_identity_window_started_at;
      v_claim_window_ends_at := v_identity_window_ends_at;
      v_claim_rate_limit := v_identity_rate_limit;
    end if;

    v_rate_count := null;
    insert into builder_private.builder_rate_limit_buckets (
      site_id, bucket_key_hmac, window_started_at, window_ends_at, request_count, updated_at
    ) values (
      v_site_id, v_claim_bucket_key_hmac, v_claim_window_started_at,
      v_claim_window_ends_at, 1, statement_timestamp()
    )
    on conflict (site_id, bucket_key_hmac, window_started_at) do update
    set request_count = builder_private.builder_rate_limit_buckets.request_count + 1,
        updated_at = statement_timestamp()
    where builder_private.builder_rate_limit_buckets.request_count < v_claim_rate_limit
      and builder_private.builder_rate_limit_buckets.window_ends_at = excluded.window_ends_at
    returning request_count into v_rate_count;

    if v_rate_count is null or v_rate_count > v_claim_rate_limit then
      raise exception 'ingestion rate limit exceeded' using errcode = '22023';
    end if;
  end loop;

  insert into public.builder_form_submissions (
    site_id, id, form_id, idempotency_key, payload, source, zip_code, locale, received_at
  ) values (
    v_site_id, v_submission_id, v_form_id, v_idempotency_key::text, v_payload,
    'public_form', v_zip_code, v_locale, v_submitted_at
  );

  insert into public.builder_form_submission_consents (
    site_id, id, submission_id, policy_version, purpose, language_digest, source, captured_at
  ) values (
    v_site_id, v_base_consent_id, v_submission_id, v_policy_version, v_purpose,
    v_language_digest, 'public_form', v_captured_at
  );

  insert into public.builder_form_submission_events (
    site_id, submission_id, event_kind, metadata
  ) values (
    v_site_id, v_submission_id, 'reviewed', jsonb_build_object(
      'version', 1, 'safeCode', 'accepted'
    )
  );

  if builder_private.dependent_action_allowed(
    v_site_id, 'growth.customers', 'growth.leads', 'write'
  ) then
    select identity.contact_id into v_email_contact_id
    from public.builder_contact_identities as identity
    where identity.site_id = v_site_id
      and identity.kind = 'email'
      and identity.normalized_value = v_email;

    select identity.contact_id into v_phone_contact_id
    from public.builder_contact_identities as identity
    where identity.site_id = v_site_id
      and identity.kind = 'phone'
      and identity.normalized_value = v_phone;

    if v_email_contact_id is not null and v_phone_contact_id is not null
      and v_email_contact_id <> v_phone_contact_id
    then
      v_result_code := 'identity_conflict';
      v_safe_code := 'identity_conflict';
      v_entitlement_decision := 'review';
    else
      v_contact_id := coalesce(v_email_contact_id, v_phone_contact_id);

      if v_contact_id is null then
        select contact.id into v_review_contact_id
        from public.builder_contacts as contact
        where contact.site_id = v_site_id
          and lower(contact.display_name) = lower(v_display_name)
          and contact.service_zip_code = v_zip_code
          and contact.lifecycle_state = 'active'
        order by contact.id
        limit 1;
      end if;

      if v_review_contact_id is not null then
        v_result_code := 'review_required';
        v_safe_code := 'review_suggested';
        v_entitlement_decision := 'review';
      else
        begin
          if v_contact_id is null then
            v_contact_id := gen_random_uuid();
            insert into public.builder_contacts (
              site_id, id, display_name, preferred_contact_method, service_zip_code
            ) values (
              v_site_id, v_contact_id, v_display_name,
              case when v_email is not null then 'email' else 'phone' end,
              v_zip_code
            );
          end if;

          if v_email is not null and v_email_contact_id is null then
            insert into public.builder_contact_identities (
              site_id, contact_id, kind, normalized_value, verification_state, source
            ) values (
              v_site_id, v_contact_id, 'email', v_email, 'unverified', 'public_form'
            );
          end if;
          if v_phone is not null and v_phone_contact_id is null then
            insert into public.builder_contact_identities (
              site_id, contact_id, kind, normalized_value, verification_state, source
            ) values (
              v_site_id, v_contact_id, 'phone', v_phone, 'unverified', 'public_form'
            );
          end if;

          v_lead_id := gen_random_uuid();
          insert into public.builder_leads (
            site_id, id, contact_id, source, form_id, service, urgency, status, summary
          ) values (
            v_site_id, v_lead_id, v_contact_id, 'public_form', v_form_id,
            v_service, v_urgency, 'new', v_message
          );

          v_channel := case when v_email is not null then 'email' else 'phone' end;
          insert into public.builder_consents (
            site_id, contact_id, base_consent_id, purpose, channel, state, captured_at
          ) values (
            v_site_id, v_contact_id, v_base_consent_id, v_purpose, v_channel, 'granted', v_captured_at
          );

          insert into public.builder_lead_events (
            site_id, lead_id, event_kind, metadata
          ) values (
            v_site_id, v_lead_id, 'created', jsonb_build_object(
              'version', 1, 'source', 'public_form', 'submissionId', v_submission_id
            )
          );

          insert into public.builder_outbox (
            site_id, topic, payload, idempotency_key, schema_version,
            aggregate_type, aggregate_id, correlation_id
          ) values (
            v_site_id, 'growth.lead.created', jsonb_build_object(
              'version', 1, 'submissionId', v_submission_id,
              'contactId', v_contact_id, 'leadId', v_lead_id
            ),
            'growth.ingestion:' || v_idempotency_key::text, 1,
            'lead', v_lead_id, v_receipt_id
          );

          insert into public.builder_in_app_notifications (
            site_id, recipient_id, event_type, resource_type, resource_id, preview_text
          )
          select
            member.site_id, member.user_id, 'growth.lead.created', 'lead', v_lead_id,
            'New website inquiry'
          from public.builder_site_members as member
          where member.site_id = v_site_id
            and member.role in ('owner', 'editor');

          v_result_code := 'enhanced';
          v_safe_code := 'enhanced';
          v_entitlement_decision := 'enhanced';
        exception
          when sqlstate 'P2B01' then
            v_contact_id := null;
            v_lead_id := null;
            v_result_code := 'review_required';
            v_safe_code := 'review_suggested';
            v_entitlement_decision := 'review';
          when unique_violation then
            get stacked diagnostics v_constraint_name = constraint_name;
            if v_constraint_name <> 'builder_contact_identities_site_id_kind_normalized_value_key' then
              raise;
            end if;
            v_contact_id := null;
            v_lead_id := null;
            v_result_code := 'review_required';
            v_safe_code := 'review_suggested';
            v_entitlement_decision := 'review';
        end;
      end if;
    end if;
  end if;

  insert into public.builder_form_submission_results (
    site_id, id, submission_id, version, result_code, contact_id, lead_id, safe_metadata
  ) values (
    v_site_id, v_result_id, v_submission_id, 1, v_result_code, v_contact_id, v_lead_id,
    jsonb_build_object('safeCode', v_safe_code)
  );

  if v_entitlement_decision = 'review' then
    insert into public.builder_form_submission_events (
      site_id, submission_id, event_kind, metadata
    ) values (
      v_site_id, v_submission_id, 'reviewed', jsonb_build_object('safeCode', v_safe_code)
    );
  elsif v_entitlement_decision = 'base_only' then
    insert into public.builder_health_checks (
      site_id, check_kind, status, safe_code, observed_at
    ) values (
      v_site_id, 'ingestion.enhancement', 'degraded', 'ENHANCEMENT_UNAVAILABLE', statement_timestamp()
    );
  end if;

  update builder_private.builder_ingestion_receipts
  set safe_result_code = v_safe_code,
      entitlement_decision = v_entitlement_decision,
      submission_id = v_submission_id
  where site_id = v_site_id
    and id = v_receipt_id;

  return jsonb_build_object(
    'version', 1, 'accepted', true, 'receiptId', v_receipt_id, 'result', 'accepted'
  );
end;
$$;

revoke all on function public.builder_ingest_form_submission_v1(jsonb) from public;
revoke all on function public.builder_ingest_form_submission_v1(jsonb) from anon;
revoke all on function public.builder_ingest_form_submission_v1(jsonb) from authenticated;
grant execute on function public.builder_ingest_form_submission_v1(jsonb) to service_role;

grant execute on function builder_private.dependent_action_allowed(uuid, text, text, text)
  to service_role;
grant execute on function builder_private.module_action_allowed(uuid, text, text)
  to service_role;

create function builder_private.claim_operational_command_v1(
  p_request jsonb,
  p_command_type text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private, extensions
as $$
declare
  v_site_id uuid := (p_request ->> 'siteId')::uuid;
  v_command_id uuid := (p_request ->> 'commandId')::uuid;
  v_idempotency_key text := p_request ->> 'idempotencyKey';
  v_payload_hash text := encode(extensions.digest(convert_to(p_request::text, 'UTF8'), 'sha256'), 'hex');
  v_receipt public.builder_command_receipts%rowtype;
begin
  select receipt.*
  into v_receipt
  from public.builder_command_receipts as receipt
  where receipt.site_id = v_site_id
    and (receipt.command_id = v_command_id or receipt.idempotency_key = v_idempotency_key)
  order by receipt.command_id
  limit 1
  for update;

  if found then
    if v_receipt.command_id <> v_command_id
      or v_receipt.idempotency_key <> v_idempotency_key
      or v_receipt.command_type <> p_command_type
      or v_receipt.command_version <> 1
      or v_receipt.payload_hash <> v_payload_hash
    then
      raise exception 'operational command receipt conflict' using errcode = '22023';
    end if;

    if v_receipt.status = 'succeeded' then
      return jsonb_build_object('status', 'replay', 'result', v_receipt.sanitized_result);
    end if;

    raise exception 'operational command already in progress' using errcode = '40001';
  end if;

  insert into public.builder_command_receipts (
    site_id, command_id, idempotency_key, command_type, command_version, payload_hash
  ) values (
    v_site_id, v_command_id, v_idempotency_key, p_command_type, 1, v_payload_hash
  );

  return jsonb_build_object('status', 'acquired');
end;
$$;

create function builder_private.complete_operational_command_v1(
  p_request jsonb,
  p_command_type text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
begin
  update public.builder_command_receipts
  set status = 'succeeded',
      sanitized_result = p_result,
      lease_token = null,
      lease_expires_at = null,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where site_id = (p_request ->> 'siteId')::uuid
    and command_id = (p_request ->> 'commandId')::uuid
    and idempotency_key = p_request ->> 'idempotencyKey'
    and command_type = p_command_type
    and status = 'received';

  if not found then
    raise exception 'operational command receipt completion failed' using errcode = '40001';
  end if;
  return p_result;
end;
$$;

revoke all on function builder_private.claim_operational_command_v1(jsonb, text) from public;
revoke all on function builder_private.claim_operational_command_v1(jsonb, text) from anon;
revoke all on function builder_private.claim_operational_command_v1(jsonb, text) from authenticated;
grant execute on function builder_private.claim_operational_command_v1(jsonb, text) to service_role;
revoke all on function builder_private.complete_operational_command_v1(jsonb, text, jsonb) from public;
revoke all on function builder_private.complete_operational_command_v1(jsonb, text, jsonb) from anon;
revoke all on function builder_private.complete_operational_command_v1(jsonb, text, jsonb) from authenticated;
grant execute on function builder_private.complete_operational_command_v1(jsonb, text, jsonb) to service_role;

grant execute on function builder_private.member_has_capability(uuid, uuid, text, text) to service_role;
grant execute on function builder_private.member_can_access_growth_record(uuid, uuid, text, text, uuid) to service_role;

create function public.builder_create_manual_lead_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_assignee_id uuid;
  v_source text;
  v_first_name text;
  v_last_name text;
  v_display_name text;
  v_email text;
  v_phone text;
  v_zip_code text;
  v_service text;
  v_urgency text;
  v_notes text;
  v_email_contact_id uuid;
  v_phone_contact_id uuid;
  v_contact_id uuid;
  v_lead_id uuid := gen_random_uuid();
  v_audit_id uuid := gen_random_uuid();
  v_claim jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or (p_request ->> 'version') is distinct from '1'
    or coalesce(p_request ->> 'commandId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'siteId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'actorId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'idempotencyKey', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'
  then
    raise exception 'invalid manual lead payload' using errcode = '22023';
  end if;

  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_assignee_id := coalesce(nullif(p_request ->> 'assigneeId', '')::uuid, v_actor_id);
  v_source := p_request ->> 'source';
  v_first_name := btrim(coalesce(p_request ->> 'firstName', ''));
  v_last_name := btrim(coalesce(p_request ->> 'lastName', ''));
  v_display_name := v_first_name || ' ' || v_last_name;
  v_email := nullif(lower(btrim(p_request ->> 'email')), '');
  v_phone := nullif(btrim(p_request ->> 'phone'), '');
  v_zip_code := nullif(btrim(p_request ->> 'zipCode'), '');
  v_service := nullif(btrim(p_request ->> 'service'), '');
  v_notes := nullif(btrim(p_request ->> 'notes'), '');
  v_urgency := case p_request ->> 'urgency'
    when 'standard' then 'normal'
    when 'urgent' then 'high'
    when 'emergency' then 'emergency'
    else null
  end;

  if v_source not in ('phone', 'walk_in', 'staff_entry')
    or char_length(v_first_name) not between 1 and 100
    or char_length(v_last_name) not between 1 and 100
    or (v_email is null and v_phone is null)
    or (v_email is not null and (char_length(v_email) > 320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    or (v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$')
    or (v_zip_code is not null and v_zip_code !~ '^[0-9]{5}(-[0-9]{4})?$')
    or v_service is null or char_length(v_service) > 160
    or v_urgency is null
    or (v_notes is not null and char_length(v_notes) > 2000)
  then
    raise exception 'invalid manual lead payload' using errcode = '22023';
  end if;

  if not builder_private.dependent_action_allowed(v_site_id, 'growth.customers', 'growth.leads', 'write')
    or not builder_private.member_has_capability(v_site_id, v_actor_id, 'leads.create', 'site')
  then
    raise exception 'manual lead creation not authorized' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.builder_site_members
    where site_id = v_site_id and user_id = v_assignee_id
  ) then
    raise exception 'invalid manual lead assignee' using errcode = '22023';
  end if;
  if v_assignee_id <> v_actor_id
    and not builder_private.member_has_capability(v_site_id, v_actor_id, 'leads.assign', 'site')
  then
    raise exception 'manual lead creation not authorized' using errcode = '42501';
  end if;

  v_claim := builder_private.claim_operational_command_v1(p_request, 'growth.manual-lead.create.v1');
  if v_claim ->> 'status' = 'replay' then
    return (v_claim -> 'result') || jsonb_build_object('status', 'replayed');
  end if;

  if v_email is not null then
    select identity.contact_id into v_email_contact_id
    from public.builder_contact_identities as identity
    join public.builder_contacts as contact
      on contact.site_id = identity.site_id and contact.id = identity.contact_id
    where identity.site_id = v_site_id
      and identity.kind = 'email'
      and identity.normalized_value = v_email
      and contact.lifecycle_state = 'active';
  end if;
  if v_phone is not null then
    select identity.contact_id into v_phone_contact_id
    from public.builder_contact_identities as identity
    join public.builder_contacts as contact
      on contact.site_id = identity.site_id and contact.id = identity.contact_id
    where identity.site_id = v_site_id
      and identity.kind = 'phone'
      and identity.normalized_value = v_phone
      and contact.lifecycle_state = 'active';
  end if;

  if v_email_contact_id is not null and v_phone_contact_id is not null
    and v_email_contact_id <> v_phone_contact_id
  then
    v_result := jsonb_build_object('version', 1, 'status', 'identity_conflict');
    return builder_private.complete_operational_command_v1(p_request, 'growth.manual-lead.create.v1', v_result);
  end if;

  v_contact_id := coalesce(v_email_contact_id, v_phone_contact_id);
  if v_contact_id is null and exists (
    select 1 from public.builder_contacts
    where site_id = v_site_id
      and lifecycle_state = 'active'
      and lower(display_name) = lower(v_display_name)
      and service_zip_code is not distinct from v_zip_code
  ) then
    v_result := jsonb_build_object('version', 1, 'status', 'review_required');
    return builder_private.complete_operational_command_v1(p_request, 'growth.manual-lead.create.v1', v_result);
  end if;

  if v_contact_id is null then
    v_contact_id := gen_random_uuid();
    insert into public.builder_contacts (
      site_id, id, display_name, preferred_contact_method, service_zip_code
    ) values (
      v_site_id, v_contact_id, v_display_name,
      case when v_email is not null then 'email' else 'phone' end,
      v_zip_code
    );
  end if;

  if v_email is not null and v_email_contact_id is null then
    insert into public.builder_contact_identities (
      site_id, contact_id, kind, normalized_value, source
    ) values (v_site_id, v_contact_id, 'email', v_email, v_source);
  end if;
  if v_phone is not null and v_phone_contact_id is null then
    insert into public.builder_contact_identities (
      site_id, contact_id, kind, normalized_value, source
    ) values (v_site_id, v_contact_id, 'phone', v_phone, v_source);
  end if;

  insert into public.builder_audit_events (
    site_id, id, action, actor_id, summary, after_value, correlation_id
  ) values (
    v_site_id, v_audit_id, 'growth.manual_lead.created', v_actor_id,
    'Created a manual lead',
    jsonb_build_object('leadId', v_lead_id, 'contactId', v_contact_id, 'assigneeId', v_assignee_id),
    p_request ->> 'commandId'
  );

  insert into public.builder_leads (
    site_id, id, contact_id, source, service, urgency, status, summary, primary_assignee_id
  ) values (
    v_site_id, v_lead_id, v_contact_id, v_source, v_service, v_urgency, 'new', v_notes, v_assignee_id
  );

  insert into public.builder_record_assignments (
    site_id, member_id, resource_type, resource_id, assigned_by, audit_event_id
  ) values (v_site_id, v_assignee_id, 'lead', v_lead_id, v_actor_id, v_audit_id);

  insert into public.builder_record_access_edges (
    site_id, child_resource_type, child_resource_id, parent_resource_type, parent_resource_id,
    created_by, audit_event_id
  ) values (v_site_id, 'customer', v_contact_id, 'lead', v_lead_id, v_actor_id, v_audit_id);

  insert into public.builder_lead_events (site_id, lead_id, event_kind, actor_id, metadata)
  values (
    v_site_id, v_lead_id, 'created', v_actor_id,
    jsonb_build_object('version', 1, 'source', v_source, 'contactId', v_contact_id)
  );

  insert into public.builder_outbox (
    site_id, topic, payload, idempotency_key, schema_version,
    aggregate_type, aggregate_id, correlation_id
  ) values (
    v_site_id, 'growth.lead.created',
    jsonb_build_object('version', 1, 'leadId', v_lead_id, 'contactId', v_contact_id),
    'growth.manual-lead:' || (p_request ->> 'commandId'), 1,
    'lead', v_lead_id, (p_request ->> 'commandId')::uuid
  );

  insert into public.builder_in_app_notifications (
    site_id, recipient_id, event_type, resource_type, resource_id, preview_text
  ) values (v_site_id, v_assignee_id, 'lead.assigned', 'lead', v_lead_id, 'New assigned lead');

  v_result := jsonb_build_object(
    'version', 1, 'status', 'created', 'contactId', v_contact_id, 'leadId', v_lead_id
  );
  return builder_private.complete_operational_command_v1(p_request, 'growth.manual-lead.create.v1', v_result);
end;
$$;

revoke all on function public.builder_create_manual_lead_v1(jsonb) from public;
revoke all on function public.builder_create_manual_lead_v1(jsonb) from anon;
revoke all on function public.builder_create_manual_lead_v1(jsonb) from authenticated;
grant execute on function public.builder_create_manual_lead_v1(jsonb) to service_role;

create function public.builder_apply_lead_command_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_lead_id uuid;
  v_action text;
  v_expected_version integer;
  v_target_status text;
  v_priority text;
  v_body text;
  v_assignee_id uuid;
  v_audit_id uuid := gen_random_uuid();
  v_lead public.builder_leads%rowtype;
  v_current_assignment public.builder_record_assignments%rowtype;
  v_target_assignment public.builder_record_assignments%rowtype;
  v_claim jsonb;
  v_result jsonb;
  v_transition_allowed boolean;
begin
  if jsonb_typeof(p_request) <> 'object'
    or (p_request ->> 'version') is distinct from '1'
    or coalesce(p_request ->> 'commandId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'siteId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'actorId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'leadId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'idempotencyKey', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'
    or coalesce(p_request ->> 'expectedVersion', '') !~ '^[1-9][0-9]*$'
  then
    raise exception 'invalid lead command payload' using errcode = '22023';
  end if;

  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_lead_id := (p_request ->> 'leadId')::uuid;
  v_action := p_request ->> 'action';
  v_expected_version := (p_request ->> 'expectedVersion')::integer;
  v_target_status := p_request ->> 'status';
  v_priority := p_request ->> 'priority';
  v_body := nullif(btrim(p_request ->> 'body'), '');

  if v_action not in ('status', 'priority', 'note', 'assignment')
    or (v_action = 'status' and (
      coalesce(v_target_status, '') not in ('new', 'contacted', 'qualified', 'won', 'lost', 'spam')
      or p_request ? 'priority' or p_request ? 'body' or p_request ? 'assigneeId'
    ))
    or (v_action = 'priority' and (
      coalesce(v_priority, '') not in ('low', 'normal', 'high', 'urgent')
      or p_request ? 'status' or p_request ? 'body' or p_request ? 'assigneeId'
    ))
    or (v_action = 'note' and (
      v_body is null or char_length(v_body) > 2000
      or p_request ? 'status' or p_request ? 'priority' or p_request ? 'assigneeId'
    ))
    or (v_action = 'assignment' and (
      coalesce(p_request ->> 'assigneeId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or p_request ? 'status' or p_request ? 'priority' or p_request ? 'body'
    ))
  then
    raise exception 'invalid lead command payload' using errcode = '22023';
  end if;
  if v_action = 'assignment' then
    v_assignee_id := (p_request ->> 'assigneeId')::uuid;
  end if;

  if not builder_private.dependent_action_allowed(v_site_id, 'growth.customers', 'growth.leads', 'write') then
    raise exception 'lead command not authorized' using errcode = '42501';
  end if;
  if v_action = 'assignment' then
    if not builder_private.member_has_capability(v_site_id, v_actor_id, 'leads.assign', 'site')
      or not exists (
        select 1 from public.builder_site_members as member
        where member.site_id = v_site_id and member.user_id = v_assignee_id
      )
    then
      raise exception 'lead command not authorized' using errcode = '42501';
    end if;
  elsif not builder_private.member_can_access_growth_record(
    v_site_id, v_actor_id, 'leads.update', 'lead', v_lead_id
  ) then
    raise exception 'lead command not authorized' using errcode = '42501';
  end if;

  v_claim := builder_private.claim_operational_command_v1(p_request, 'growth.lead.command.v1');
  if v_claim ->> 'status' = 'replay' then
    return (v_claim -> 'result') || jsonb_build_object('status', 'replayed');
  end if;

  select lead.* into v_lead
  from public.builder_leads as lead
  where lead.site_id = v_site_id and lead.id = v_lead_id
  for update;
  if not found then
    raise exception 'lead command not authorized' using errcode = '42501';
  end if;

  if v_lead.version <> v_expected_version then
    v_result := jsonb_build_object(
      'version', 1, 'status', 'conflict',
      'expectedVersion', v_expected_version, 'actualVersion', v_lead.version
    );
    return builder_private.complete_operational_command_v1(p_request, 'growth.lead.command.v1', v_result);
  end if;

  if v_action = 'assignment' then
    if v_lead.primary_assignee_id = v_assignee_id then
      v_result := jsonb_build_object(
        'version', 1, 'status', 'conflict',
        'expectedVersion', v_expected_version, 'actualVersion', v_lead.version
      );
      return builder_private.complete_operational_command_v1(p_request, 'growth.lead.command.v1', v_result);
    end if;

    insert into public.builder_audit_events (
      site_id, id, action, actor_id, summary, before_value, after_value, correlation_id
    ) values (
      v_site_id, v_audit_id, 'growth.lead.assigned', v_actor_id,
      'Changed the primary lead assignment',
      jsonb_build_object('leadId', v_lead_id, 'assigneeId', v_lead.primary_assignee_id),
      jsonb_build_object('leadId', v_lead_id, 'assigneeId', v_assignee_id),
      p_request ->> 'commandId'
    );

    if v_lead.primary_assignee_id is not null then
      select assignment.* into v_current_assignment
      from public.builder_record_assignments as assignment
      where assignment.site_id = v_site_id
        and assignment.member_id = v_lead.primary_assignee_id
        and assignment.resource_type = 'lead'
        and assignment.resource_id = v_lead_id
      for update;

      if found and v_current_assignment.state = 'active' then
        update public.builder_record_assignments
        set state = 'ended',
            ended_at = clock_timestamp(),
            assigned_by = v_actor_id,
            audit_event_id = v_audit_id,
            version = version + 1,
            updated_at = clock_timestamp()
        where site_id = v_site_id
          and member_id = v_lead.primary_assignee_id
          and resource_type = 'lead'
          and resource_id = v_lead_id
          and state = 'active'
          and version = v_current_assignment.version;
        if not found then
          raise exception 'assignment version conflict' using errcode = '40001';
        end if;
      end if;
    end if;

    select assignment.* into v_target_assignment
    from public.builder_record_assignments as assignment
    where assignment.site_id = v_site_id
      and assignment.member_id = v_assignee_id
      and assignment.resource_type = 'lead'
      and assignment.resource_id = v_lead_id
    for update;

    if found then
      update public.builder_record_assignments
      set state = 'active',
          ended_at = null,
          assigned_by = v_actor_id,
          audit_event_id = v_audit_id,
          version = version + 1,
          updated_at = clock_timestamp()
      where site_id = v_site_id
        and member_id = v_assignee_id
        and resource_type = 'lead'
        and resource_id = v_lead_id
        and version = v_target_assignment.version;
      if not found then
        raise exception 'assignment version conflict' using errcode = '40001';
      end if;
    else
      insert into public.builder_record_assignments (
        site_id, member_id, resource_type, resource_id, assigned_by, audit_event_id,
        state, version
      ) values (
        v_site_id, v_assignee_id, 'lead', v_lead_id, v_actor_id, v_audit_id,
        'active', 1
      );
    end if;

    update public.builder_leads
    set primary_assignee_id = v_assignee_id,
        version = version + 1,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_lead_id and version = v_lead.version;
    if not found then
      raise exception 'lead version conflict' using errcode = '40001';
    end if;

    insert into public.builder_lead_events (site_id, lead_id, event_kind, actor_id, metadata)
    values (
      v_site_id, v_lead_id, 'assignment', v_actor_id,
      jsonb_build_object(
        'version', v_lead.version + 1,
        'fromAssigneeId', v_lead.primary_assignee_id,
        'assigneeId', v_assignee_id,
        'commandId', p_request ->> 'commandId'
      )
    );

    insert into public.builder_outbox (
      site_id, topic, payload, idempotency_key, schema_version,
      aggregate_type, aggregate_id, correlation_id
    ) values (
      v_site_id, 'growth.lead.assigned',
      jsonb_build_object('version', 1, 'leadId', v_lead_id, 'assigneeId', v_assignee_id),
      'growth.lead-assignment:' || (p_request ->> 'commandId'), 1,
      'lead', v_lead_id, (p_request ->> 'commandId')::uuid
    );

    insert into public.builder_in_app_notifications (
      site_id, recipient_id, event_type, resource_type, resource_id, preview_text
    ) values (v_site_id, v_assignee_id, 'lead.assigned', 'lead', v_lead_id, 'New assigned lead');
  elsif v_action = 'status' then
    v_transition_allowed := case
      when v_target_status = v_lead.status then false
      when v_lead.status = 'new' then v_target_status in ('contacted', 'qualified', 'lost', 'spam')
      when v_lead.status = 'contacted' then v_target_status in ('new', 'qualified', 'lost', 'spam')
      when v_lead.status = 'qualified' then v_target_status in ('contacted', 'won', 'lost', 'spam')
      when v_lead.status = 'spam' then v_target_status = 'new'
      else false
    end;
    if not v_transition_allowed then
      raise exception 'invalid lead status transition' using errcode = '22023';
    end if;

    update public.builder_leads
    set status = v_target_status,
        version = version + 1,
        won_at = case when v_target_status = 'won' then clock_timestamp() else null end,
        lost_at = case when v_target_status = 'lost' then clock_timestamp() else null end,
        updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_lead_id;

    insert into public.builder_lead_events (site_id, lead_id, event_kind, actor_id, metadata)
    values (
      v_site_id, v_lead_id, 'status', v_actor_id,
      jsonb_build_object('version', v_lead.version + 1, 'from', v_lead.status, 'to', v_target_status)
    );
  elsif v_action = 'priority' then
    update public.builder_leads
    set version = version + 1, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_lead_id;

    insert into public.builder_lead_events (site_id, lead_id, event_kind, actor_id, metadata)
    values (
      v_site_id, v_lead_id, 'correction', v_actor_id,
      jsonb_build_object('version', v_lead.version + 1, 'field', 'priority', 'value', v_priority)
    );
  else
    update public.builder_leads
    set version = version + 1, updated_at = clock_timestamp()
    where site_id = v_site_id and id = v_lead_id;

    insert into public.builder_lead_events (site_id, lead_id, event_kind, actor_id, metadata)
    values (
      v_site_id, v_lead_id, 'note', v_actor_id,
      jsonb_build_object('version', v_lead.version + 1, 'body', v_body)
    );
  end if;

  v_result := jsonb_build_object(
    'version', v_lead.version + 1, 'status', 'applied', 'leadId', v_lead_id
  );
  return builder_private.complete_operational_command_v1(p_request, 'growth.lead.command.v1', v_result);
end;
$$;

revoke all on function public.builder_apply_lead_command_v1(jsonb) from public;
revoke all on function public.builder_apply_lead_command_v1(jsonb) from anon;
revoke all on function public.builder_apply_lead_command_v1(jsonb) from authenticated;
grant execute on function public.builder_apply_lead_command_v1(jsonb) to service_role;

create function public.builder_review_form_submission_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_submission_id uuid;
  v_action text;
  v_reason_code text;
  v_expected_version integer;
  v_actual_version integer;
  v_classification text;
  v_role text;
  v_claim jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or (p_request ->> 'version') is distinct from '1'
    or coalesce(p_request ->> 'commandId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'siteId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'actorId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'submissionId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'expectedVersion', '') !~ '^[0-9]+$'
  then
    raise exception 'invalid form submission review payload' using errcode = '22023';
  end if;

  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_submission_id := (p_request ->> 'submissionId')::uuid;
  v_action := p_request ->> 'action';
  v_reason_code := p_request ->> 'reasonCode';
  v_expected_version := (p_request ->> 'expectedVersion')::integer;

  if v_action not in ('spam', 'restore')
    or (v_action = 'spam' and coalesce(v_reason_code, '') !~ '^[a-z][a-z0-9._-]{0,63}$')
    or (v_action = 'restore' and p_request ? 'reasonCode')
  then
    raise exception 'invalid form submission review payload' using errcode = '22023';
  end if;

  select member.role into v_role
  from public.builder_site_members as member
  where member.site_id = v_site_id and member.user_id = v_actor_id;
  if v_role not in ('owner', 'editor')
    or not builder_private.dependent_action_allowed(v_site_id, 'growth.customers', 'growth.leads', 'write')
  then
    raise exception 'form submission review not authorized' using errcode = '42501';
  end if;

  v_claim := builder_private.claim_operational_command_v1(p_request, 'growth.form-submission.review.v1');
  if v_claim ->> 'status' = 'replay' then
    return (v_claim -> 'result') || jsonb_build_object('status', 'replayed');
  end if;

  perform 1 from public.builder_form_submissions
  where site_id = v_site_id and id = v_submission_id
  for update;
  if not found then
    raise exception 'form submission review not authorized' using errcode = '42501';
  end if;

  select count(*)::integer,
         coalesce((array_agg(event.event_kind order by event.created_at desc, event.id desc))[1], 'restored')
  into v_actual_version, v_classification
  from public.builder_form_submission_events as event
  where event.site_id = v_site_id
    and event.submission_id = v_submission_id
    and event.event_kind in ('spam', 'restored');
  v_classification := case when v_classification = 'spam' then 'spam' else 'active' end;

  if v_actual_version <> v_expected_version then
    v_result := jsonb_build_object('version', 1, 'status', 'conflict');
    return builder_private.complete_operational_command_v1(p_request, 'growth.form-submission.review.v1', v_result);
  end if;
  if (v_action = 'spam' and v_classification = 'spam')
    or (v_action = 'restore' and v_classification <> 'spam')
  then
    v_result := jsonb_build_object('version', 1, 'status', 'conflict');
    return builder_private.complete_operational_command_v1(p_request, 'growth.form-submission.review.v1', v_result);
  end if;

  insert into public.builder_form_submission_events (
    site_id, submission_id, event_kind, actor_id, metadata
  ) values (
    v_site_id, v_submission_id,
    case when v_action = 'spam' then 'spam' else 'restored' end,
    v_actor_id,
    jsonb_strip_nulls(jsonb_build_object(
      'version', v_actual_version + 1,
      'reasonCode', case when v_action = 'spam' then v_reason_code else null end
    ))
  );

  v_result := jsonb_build_object(
    'version', v_actual_version + 1,
    'status', 'applied',
    'classification', case when v_action = 'spam' then 'spam' else 'active' end,
    'submissionId', v_submission_id
  );
  return builder_private.complete_operational_command_v1(p_request, 'growth.form-submission.review.v1', v_result);
end;
$$;

revoke all on function public.builder_review_form_submission_v1(jsonb) from public;
revoke all on function public.builder_review_form_submission_v1(jsonb) from anon;
revoke all on function public.builder_review_form_submission_v1(jsonb) from authenticated;
grant execute on function public.builder_review_form_submission_v1(jsonb) to service_role;

create function public.builder_import_form_submission_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_submission_id uuid;
  v_expected_version integer;
  v_aal2_verified_at timestamptz;
  v_role text;
  v_submission public.builder_form_submissions%rowtype;
  v_prior_result public.builder_form_submission_results%rowtype;
  v_claim jsonb;
  v_result jsonb;
  v_first_name text;
  v_last_name text;
  v_display_name text;
  v_email text;
  v_phone text;
  v_service text;
  v_summary text;
  v_email_contact_id uuid;
  v_phone_contact_id uuid;
  v_contact_id uuid;
  v_lead_id uuid := gen_random_uuid();
  v_result_id uuid := gen_random_uuid();
  v_audit_id uuid := gen_random_uuid();
  v_consent record;
begin
  if jsonb_typeof(p_request) <> 'object'
    or (p_request ->> 'version') is distinct from '1'
    or coalesce(p_request ->> 'commandId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'siteId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'actorId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'submissionId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'expectedLatestResultVersion', '') !~ '^[1-9][0-9]*$'
    or not (p_request ? 'aal2VerifiedAt')
  then
    raise exception 'invalid form submission import payload' using errcode = '22023';
  end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_submission_id := (p_request ->> 'submissionId')::uuid;
    v_expected_version := (p_request ->> 'expectedLatestResultVersion')::integer;
    v_aal2_verified_at := (p_request ->> 'aal2VerifiedAt')::timestamptz;
  exception when others then
    raise exception 'invalid form submission import payload' using errcode = '22023';
  end;

  select member.role into v_role
  from public.builder_site_members as member
  where member.site_id = v_site_id and member.user_id = v_actor_id;
  if v_role is distinct from 'owner'
    or not builder_private.dependent_action_allowed(v_site_id, 'growth.customers', 'growth.leads', 'write')
  then
    raise exception 'form submission import not authorized' using errcode = '42501';
  end if;
  if v_aal2_verified_at < statement_timestamp() - interval '5 minutes'
    or v_aal2_verified_at > statement_timestamp() + interval '1 minute'
  then
    raise exception 'recent AAL2 required' using errcode = '42501';
  end if;

  v_claim := builder_private.claim_operational_command_v1(p_request, 'growth.form-submission.import.v1');
  if v_claim ->> 'status' = 'replay' then
    return (v_claim -> 'result') || jsonb_build_object('status', 'replayed');
  end if;

  select submission.* into v_submission
  from public.builder_form_submissions as submission
  where submission.site_id = v_site_id and submission.id = v_submission_id
  for update;
  if not found then
    raise exception 'form submission import not authorized' using errcode = '42501';
  end if;

  select result.* into v_prior_result
  from public.builder_form_submission_results as result
  where result.site_id = v_site_id and result.submission_id = v_submission_id
  order by result.version desc
  limit 1
  for update;
  if not found
    or v_prior_result.version <> v_expected_version
    or v_prior_result.result_code not in ('base_only', 'review_required')
    or coalesce((
      select event.event_kind
      from public.builder_form_submission_events as event
      where event.site_id = v_site_id
        and event.submission_id = v_submission_id
        and event.event_kind in ('spam', 'restored')
      order by event.created_at desc, event.id desc
      limit 1
    ), 'restored') = 'spam'
  then
    v_result := jsonb_build_object('version', 1, 'status', 'conflict');
    return builder_private.complete_operational_command_v1(p_request, 'growth.form-submission.import.v1', v_result);
  end if;
  if not exists (
    select 1 from public.builder_form_submission_events as event
    where event.site_id = v_site_id
      and event.submission_id = v_submission_id
      and event.event_kind = 'reviewed'
      and event.metadata ->> 'decision' = 'approve_import'
  ) then
    raise exception 'reviewed import approval required' using errcode = '42501';
  end if;

  v_first_name := btrim(coalesce(v_submission.payload ->> 'firstName', ''));
  v_last_name := btrim(coalesce(v_submission.payload ->> 'lastName', ''));
  v_display_name := v_first_name || ' ' || v_last_name;
  v_email := nullif(lower(btrim(v_submission.payload ->> 'email')), '');
  v_phone := nullif(btrim(v_submission.payload ->> 'phone'), '');
  v_service := nullif(btrim(v_submission.payload ->> 'service'), '');
  v_summary := nullif(btrim(v_submission.payload ->> 'message'), '');
  if char_length(v_first_name) not between 1 and 100
    or char_length(v_last_name) not between 1 and 100
    or (v_email is null and v_phone is null)
    or (v_email is not null and (char_length(v_email) > 320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    or (v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$')
    or (v_service is not null and char_length(v_service) > 160)
    or (v_summary is not null and char_length(v_summary) > 2000)
  then
    raise exception 'invalid reviewed submission data' using errcode = '22023';
  end if;

  if v_email is not null then
    select identity.contact_id into v_email_contact_id
    from public.builder_contact_identities as identity
    join public.builder_contacts as contact
      on contact.site_id = identity.site_id and contact.id = identity.contact_id
    where identity.site_id = v_site_id
      and identity.kind = 'email'
      and identity.normalized_value = v_email
      and contact.lifecycle_state = 'active';
  end if;
  if v_phone is not null then
    select identity.contact_id into v_phone_contact_id
    from public.builder_contact_identities as identity
    join public.builder_contacts as contact
      on contact.site_id = identity.site_id and contact.id = identity.contact_id
    where identity.site_id = v_site_id
      and identity.kind = 'phone'
      and identity.normalized_value = v_phone
      and contact.lifecycle_state = 'active';
  end if;

  if v_email_contact_id is not null and v_phone_contact_id is not null
    and v_email_contact_id <> v_phone_contact_id
  then
    insert into public.builder_form_submission_results (
      site_id, id, submission_id, version, prior_result_id, result_code, safe_metadata
    ) values (
      v_site_id, v_result_id, v_submission_id, v_prior_result.version + 1,
      v_prior_result.id, 'identity_conflict', jsonb_build_object('safeCode', 'identity_conflict')
    );
    v_result := jsonb_build_object('version', 1, 'status', 'identity_conflict', 'resultVersion', v_prior_result.version + 1);
    return builder_private.complete_operational_command_v1(p_request, 'growth.form-submission.import.v1', v_result);
  end if;

  v_contact_id := coalesce(v_email_contact_id, v_phone_contact_id);
  if v_contact_id is null then
    v_contact_id := gen_random_uuid();
    insert into public.builder_contacts (
      site_id, id, display_name, preferred_contact_method, service_zip_code
    ) values (
      v_site_id, v_contact_id, v_display_name,
      case when v_email is not null then 'email' else 'phone' end,
      v_submission.zip_code
    );
  end if;
  if v_email is not null and v_email_contact_id is null then
    insert into public.builder_contact_identities (
      site_id, contact_id, kind, normalized_value, source
    ) values (v_site_id, v_contact_id, 'email', v_email, 'import');
  end if;
  if v_phone is not null and v_phone_contact_id is null then
    insert into public.builder_contact_identities (
      site_id, contact_id, kind, normalized_value, source
    ) values (v_site_id, v_contact_id, 'phone', v_phone, 'import');
  end if;

  insert into public.builder_audit_events (
    site_id, id, action, actor_id, summary, after_value, correlation_id
  ) values (
    v_site_id, v_audit_id, 'growth.form_submission.imported', v_actor_id,
    'Imported a reviewed form submission',
    jsonb_build_object('submissionId', v_submission_id, 'leadId', v_lead_id, 'contactId', v_contact_id),
    p_request ->> 'commandId'
  );

  insert into public.builder_leads (
    site_id, id, contact_id, source, form_id, service, urgency, status, summary, primary_assignee_id
  ) values (
    v_site_id, v_lead_id, v_contact_id, 'import', v_submission.form_id,
    v_service, 'normal', 'new', v_summary, v_actor_id
  );
  insert into public.builder_record_assignments (
    site_id, member_id, resource_type, resource_id, assigned_by, audit_event_id
  ) values (v_site_id, v_actor_id, 'lead', v_lead_id, v_actor_id, v_audit_id);
  insert into public.builder_record_access_edges (
    site_id, child_resource_type, child_resource_id, parent_resource_type, parent_resource_id,
    created_by, audit_event_id
  ) values (v_site_id, 'customer', v_contact_id, 'lead', v_lead_id, v_actor_id, v_audit_id);

  for v_consent in
    select consent.* from public.builder_form_submission_consents as consent
    where consent.site_id = v_site_id and consent.submission_id = v_submission_id
  loop
    insert into public.builder_consents (
      site_id, contact_id, base_consent_id, purpose, channel, state, captured_at
    ) values (
      v_site_id, v_contact_id, v_consent.id, v_consent.purpose,
      case when v_email is not null then 'email' else 'phone' end,
      'granted', v_consent.captured_at
    );
  end loop;

  insert into public.builder_lead_events (site_id, lead_id, event_kind, actor_id, metadata)
  values (
    v_site_id, v_lead_id, 'created', v_actor_id,
    jsonb_build_object('version', 1, 'source', 'import', 'submissionId', v_submission_id)
  );
  insert into public.builder_outbox (
    site_id, topic, payload, idempotency_key, schema_version,
    aggregate_type, aggregate_id, correlation_id
  ) values (
    v_site_id, 'growth.lead.created',
    jsonb_build_object('version', 1, 'submissionId', v_submission_id, 'leadId', v_lead_id, 'contactId', v_contact_id),
    'growth.reviewed-import:' || (p_request ->> 'commandId'), 1,
    'lead', v_lead_id, (p_request ->> 'commandId')::uuid
  );
  insert into public.builder_in_app_notifications (
    site_id, recipient_id, event_type, resource_type, resource_id, preview_text
  ) values (v_site_id, v_actor_id, 'lead.assigned', 'lead', v_lead_id, 'Imported reviewed lead');

  insert into public.builder_form_submission_results (
    site_id, id, submission_id, version, prior_result_id, result_code, contact_id, lead_id, safe_metadata
  ) values (
    v_site_id, v_result_id, v_submission_id, v_prior_result.version + 1,
    v_prior_result.id, 'enhanced', v_contact_id, v_lead_id,
    jsonb_build_object('safeCode', 'enhanced', 'reviewedImport', true)
  );

  v_result := jsonb_build_object(
    'version', 1, 'status', 'imported', 'resultVersion', v_prior_result.version + 1,
    'contactId', v_contact_id, 'leadId', v_lead_id
  );
  return builder_private.complete_operational_command_v1(p_request, 'growth.form-submission.import.v1', v_result);
end;
$$;

revoke all on function public.builder_import_form_submission_v1(jsonb) from public;
revoke all on function public.builder_import_form_submission_v1(jsonb) from anon;
revoke all on function public.builder_import_form_submission_v1(jsonb) from authenticated;
grant execute on function public.builder_import_form_submission_v1(jsonb) to service_role;

create function public.builder_create_lead_task_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_assignee_id uuid;
  v_lead_id uuid;
  v_expected_version integer;
  v_actual_version integer;
  v_title text;
  v_priority text;
  v_due_at timestamptz;
  v_task_id uuid := gen_random_uuid();
  v_audit_id uuid := gen_random_uuid();
  v_claim jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or (p_request ->> 'version') is distinct from '1'
    or coalesce(p_request ->> 'commandId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'siteId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'actorId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'leadId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'expectedVersion', '') !~ '^[1-9][0-9]*$'
  then
    raise exception 'invalid lead task payload' using errcode = '22023';
  end if;
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_assignee_id := coalesce(nullif(p_request ->> 'assigneeId', '')::uuid, v_actor_id);
    v_lead_id := (p_request ->> 'leadId')::uuid;
    v_expected_version := (p_request ->> 'expectedVersion')::integer;
    v_due_at := nullif(p_request ->> 'dueAt', '')::timestamptz;
  exception when others then
    raise exception 'invalid lead task payload' using errcode = '22023';
  end;
  v_title := btrim(coalesce(p_request ->> 'title', ''));
  v_priority := coalesce(p_request ->> 'priority', 'normal');
  if char_length(v_title) not between 1 and 240
    or v_priority not in ('low', 'normal', 'high', 'urgent')
    or coalesce(p_request ->> 'idempotencyKey', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'
  then
    raise exception 'invalid lead task payload' using errcode = '22023';
  end if;

  if not builder_private.dependent_action_allowed(v_site_id, 'growth.customers', 'growth.leads', 'write')
    or not builder_private.member_can_access_growth_record(v_site_id, v_actor_id, 'leads.update', 'lead', v_lead_id)
    or not builder_private.member_has_capability(v_site_id, v_actor_id, 'tasks.manage', null)
  then
    raise exception 'lead task creation not authorized' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.builder_site_members where site_id = v_site_id and user_id = v_assignee_id
  ) then
    raise exception 'invalid lead task assignee' using errcode = '22023';
  end if;
  if v_assignee_id <> v_actor_id
    and not builder_private.member_has_capability(v_site_id, v_actor_id, 'tasks.manage', 'site')
  then
    raise exception 'lead task creation not authorized' using errcode = '42501';
  end if;

  v_claim := builder_private.claim_operational_command_v1(p_request, 'growth.lead-task.create.v1');
  if v_claim ->> 'status' = 'replay' then
    return (v_claim -> 'result') || jsonb_build_object('status', 'replayed');
  end if;

  select lead.version into v_actual_version
  from public.builder_leads as lead
  where lead.site_id = v_site_id and lead.id = v_lead_id
  for update;
  if not found then
    raise exception 'lead task creation not authorized' using errcode = '42501';
  end if;
  if v_actual_version <> v_expected_version then
    v_result := jsonb_build_object(
      'version', 1, 'status', 'conflict',
      'expectedVersion', v_expected_version, 'actualVersion', v_actual_version
    );
    return builder_private.complete_operational_command_v1(p_request, 'growth.lead-task.create.v1', v_result);
  end if;
  insert into public.builder_audit_events (
    site_id, id, action, actor_id, summary, after_value, correlation_id
  ) values (
    v_site_id, v_audit_id, 'growth.lead_task.created', v_actor_id, 'Created a lead task',
    jsonb_build_object('taskId', v_task_id, 'leadId', v_lead_id, 'assigneeId', v_assignee_id),
    p_request ->> 'commandId'
  );
  insert into public.builder_tasks (
    site_id, id, title, priority, assignee_id, due_at, created_by
  ) values (v_site_id, v_task_id, v_title, v_priority, v_assignee_id, v_due_at, v_actor_id);
  insert into public.builder_record_access_edges (
    site_id, child_resource_type, child_resource_id, parent_resource_type, parent_resource_id,
    created_by, audit_event_id
  ) values (v_site_id, 'task', v_task_id, 'lead', v_lead_id, v_actor_id, v_audit_id);
  insert into public.builder_record_assignments (
    site_id, member_id, resource_type, resource_id, assigned_by, audit_event_id
  ) values (v_site_id, v_assignee_id, 'task', v_task_id, v_actor_id, v_audit_id);
  insert into public.builder_lead_events (site_id, lead_id, event_kind, actor_id, metadata)
  values (
    v_site_id, v_lead_id, 'task', v_actor_id,
    jsonb_build_object('taskId', v_task_id, 'title', v_title, 'assigneeId', v_assignee_id)
  );

  v_result := jsonb_build_object('version', 1, 'status', 'created', 'taskId', v_task_id, 'leadId', v_lead_id);
  return builder_private.complete_operational_command_v1(p_request, 'growth.lead-task.create.v1', v_result);
end;
$$;

revoke all on function public.builder_create_lead_task_v1(jsonb) from public;
revoke all on function public.builder_create_lead_task_v1(jsonb) from anon;
revoke all on function public.builder_create_lead_task_v1(jsonb) from authenticated;
grant execute on function public.builder_create_lead_task_v1(jsonb) to service_role;

create function public.builder_record_lead_service_event_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_lead_id uuid;
  v_contact_id uuid;
  v_expected_version integer;
  v_actual_version integer;
  v_event_kind text;
  v_purpose text;
  v_scheduled_at timestamptz;
  v_occurred_at timestamptz;
  v_external_reference text;
  v_metadata jsonb;
  v_service_event_id uuid := gen_random_uuid();
  v_claim jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or (p_request ->> 'version') is distinct from '1'
    or coalesce(p_request ->> 'commandId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'siteId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'actorId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'leadId', '') !~ '^[0-9a-f-]{36}$'
    or coalesce(p_request ->> 'expectedVersion', '') !~ '^[1-9][0-9]*$'
  then
    raise exception 'invalid lead service event payload' using errcode = '22023';
  end if;
  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_lead_id := (p_request ->> 'leadId')::uuid;
    v_expected_version := (p_request ->> 'expectedVersion')::integer;
    v_scheduled_at := nullif(p_request ->> 'scheduledAt', '')::timestamptz;
    v_occurred_at := nullif(p_request ->> 'occurredAt', '')::timestamptz;
  exception when others then
    raise exception 'invalid lead service event payload' using errcode = '22023';
  end;
  v_event_kind := p_request ->> 'eventKind';
  v_purpose := nullif(p_request ->> 'purpose', '');
  v_external_reference := nullif(btrim(p_request ->> 'externalReference'), '');
  v_metadata := coalesce(p_request -> 'metadata', '{}'::jsonb);
  if v_event_kind not in (
      'estimate.sent', 'estimate.accepted', 'estimate.declined',
      'appointment.scheduled', 'appointment.rescheduled', 'appointment.cancelled',
      'appointment.completed'
    )
    or (v_purpose is not null and v_purpose not in ('estimate', 'service'))
    or (v_event_kind = 'appointment.scheduled' and v_purpose is null)
    or v_occurred_at is null
    or (v_external_reference is not null and char_length(v_external_reference) > 255)
    or jsonb_typeof(v_metadata) <> 'object'
    or octet_length(v_metadata::text) > 8192
    or coalesce(p_request ->> 'idempotencyKey', '') !~ '^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$'
  then
    raise exception 'invalid lead service event payload' using errcode = '22023';
  end if;

  if not builder_private.dependent_action_allowed(v_site_id, 'growth.customers', 'growth.leads', 'write')
    or not builder_private.member_can_access_growth_record(v_site_id, v_actor_id, 'leads.update', 'lead', v_lead_id)
  then
    raise exception 'lead service event not authorized' using errcode = '42501';
  end if;

  v_claim := builder_private.claim_operational_command_v1(p_request, 'growth.lead-service-event.record.v1');
  if v_claim ->> 'status' = 'replay' then
    return (v_claim -> 'result') || jsonb_build_object('status', 'replayed');
  end if;

  select lead.contact_id, lead.version into v_contact_id, v_actual_version
  from public.builder_leads as lead
  where lead.site_id = v_site_id and lead.id = v_lead_id
  for update;
  if not found then
    raise exception 'lead service event not authorized' using errcode = '42501';
  end if;
  if v_actual_version <> v_expected_version then
    v_result := jsonb_build_object(
      'version', 1, 'status', 'conflict',
      'expectedVersion', v_expected_version, 'actualVersion', v_actual_version
    );
    return builder_private.complete_operational_command_v1(p_request, 'growth.lead-service-event.record.v1', v_result);
  end if;

  insert into public.builder_service_events (
    site_id, id, contact_id, lead_id, event_kind, purpose,
    scheduled_at, occurred_at, source, actor_id, external_reference, metadata
  ) values (
    v_site_id, v_service_event_id, v_contact_id, v_lead_id, v_event_kind, v_purpose,
    v_scheduled_at, v_occurred_at, 'staff', v_actor_id, v_external_reference, v_metadata
  );
  insert into public.builder_lead_events (site_id, lead_id, event_kind, actor_id, metadata)
  values (
    v_site_id, v_lead_id, 'service_event', v_actor_id,
    jsonb_build_object('serviceEventId', v_service_event_id, 'eventKind', v_event_kind)
  );

  v_result := jsonb_build_object(
    'version', 1, 'status', 'recorded', 'serviceEventId', v_service_event_id, 'leadId', v_lead_id
  );
  return builder_private.complete_operational_command_v1(p_request, 'growth.lead-service-event.record.v1', v_result);
end;
$$;

revoke all on function public.builder_record_lead_service_event_v1(jsonb) from public;
revoke all on function public.builder_record_lead_service_event_v1(jsonb) from anon;
revoke all on function public.builder_record_lead_service_event_v1(jsonb) from authenticated;
grant execute on function public.builder_record_lead_service_event_v1(jsonb) to service_role;

alter table public.builder_member_invitations
  add column version integer not null default 1 check (version > 0);

alter table public.builder_contact_merge_suggestions
  drop constraint builder_contact_merge_suggestions_review_state_check;
alter table public.builder_contact_merge_suggestions
  add constraint builder_contact_merge_suggestions_review_state_check
  check (review_state in ('pending','accepted','merged','dismissed'));

create function public.builder_update_customer_profile_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_customer_id uuid;
  v_expected_version integer;
  v_patch jsonb;
  v_customer public.builder_contacts%rowtype;
  v_display_name text;
  v_preferred text;
  v_zip text;
  v_audit_id uuid := gen_random_uuid();
  v_claim jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or not (p_request ?& array['version','commandId','idempotencyKey','siteId','actorId','customerId','expectedVersion','patch'])
    or exists (select 1 from jsonb_object_keys(p_request) key where key <> all(array['version','commandId','idempotencyKey','siteId','actorId','customerId','expectedVersion','patch']))
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'commandId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'idempotencyKey','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'siteId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'actorId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'customerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'expectedVersion','') !~ '^[1-9][0-9]*$'
  then raise exception 'invalid customer profile payload' using errcode='22023'; end if;

  v_patch := p_request -> 'patch';
  if jsonb_typeof(v_patch) <> 'object'
    or (select count(*) from jsonb_object_keys(v_patch)) not between 1 and 3
    or exists (select 1 from jsonb_object_keys(v_patch) key where key not in ('displayName','preferredContactMethod','serviceAreaZip'))
    or (v_patch ? 'displayName' and (jsonb_typeof(v_patch -> 'displayName') <> 'string' or char_length(btrim(v_patch ->> 'displayName')) not between 1 and 200))
    or (v_patch ? 'preferredContactMethod' and (jsonb_typeof(v_patch -> 'preferredContactMethod') <> 'string' or v_patch ->> 'preferredContactMethod' not in ('email','phone','none')))
    or (v_patch ? 'serviceAreaZip' and jsonb_typeof(v_patch -> 'serviceAreaZip') not in ('string','null'))
    or (v_patch ? 'serviceAreaZip' and jsonb_typeof(v_patch -> 'serviceAreaZip')='string' and v_patch ->> 'serviceAreaZip' !~ '^[0-9]{5}(-[0-9]{4})?$')
  then raise exception 'invalid customer profile payload' using errcode='22023'; end if;

  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_customer_id := (p_request ->> 'customerId')::uuid;
  v_expected_version := (p_request ->> 'expectedVersion')::integer;

  if not builder_private.module_action_allowed(v_site_id,'growth.customers','write')
    or not builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'customers.update','customer',v_customer_id)
  then raise exception 'customer profile update not authorized' using errcode='42501'; end if;

  v_claim := builder_private.claim_operational_command_v1(p_request,'growth.customer-profile.update.v1');
  if v_claim ->> 'status'='replay' then return (v_claim -> 'result') || jsonb_build_object('status','replayed'); end if;

  select * into v_customer from public.builder_contacts
  where site_id=v_site_id and id=v_customer_id and lifecycle_state in ('active','inactive') for update;
  if not found then raise exception 'customer profile update not authorized' using errcode='42501'; end if;
  if v_customer.version <> v_expected_version then
    v_result := jsonb_build_object('version',1,'status','conflict','expectedVersion',v_expected_version,'actualVersion',v_customer.version);
    return builder_private.complete_operational_command_v1(p_request,'growth.customer-profile.update.v1',v_result);
  end if;

  v_display_name := case when v_patch ? 'displayName' then btrim(v_patch ->> 'displayName') else v_customer.display_name end;
  v_preferred := case when v_patch ? 'preferredContactMethod' then v_patch ->> 'preferredContactMethod' else v_customer.preferred_contact_method end;
  v_zip := case when v_patch ? 'serviceAreaZip' then nullif(v_patch ->> 'serviceAreaZip','') else v_customer.service_zip_code end;

  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,before_value,after_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.customer.profile_updated',v_actor_id,'Updated a customer profile',
    jsonb_build_object('customerId',v_customer_id,'version',v_customer.version),
    jsonb_build_object('customerId',v_customer_id,'version',v_customer.version+1),p_request ->> 'commandId');
  update public.builder_contacts set display_name=v_display_name,preferred_contact_method=v_preferred,
    service_zip_code=v_zip,version=version+1,updated_at=clock_timestamp()
  where site_id=v_site_id and id=v_customer_id;
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.customer.updated',jsonb_build_object('version',1,'customerId',v_customer_id,'customerVersion',v_customer.version+1),
    'growth.customer-profile:'||(p_request->>'commandId'),1,'customer',v_customer_id,(p_request->>'commandId')::uuid);
  v_result := jsonb_build_object('version',1,'status','applied','customerId',v_customer_id,'resultVersion',v_customer.version+1);
  return builder_private.complete_operational_command_v1(p_request,'growth.customer-profile.update.v1',v_result);
end;
$$;

revoke all on function public.builder_update_customer_profile_v1(jsonb) from public;
revoke all on function public.builder_update_customer_profile_v1(jsonb) from anon;
revoke all on function public.builder_update_customer_profile_v1(jsonb) from authenticated;
grant execute on function public.builder_update_customer_profile_v1(jsonb) to service_role;

create function public.builder_review_customer_merge_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_suggestion_id uuid;
  v_expected_version integer;
  v_decision text;
  v_review_state text;
  v_suggestion public.builder_contact_merge_suggestions%rowtype;
  v_audit_id uuid := gen_random_uuid();
  v_claim jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(p_request)<>'object'
    or not (p_request ?& array['version','commandId','idempotencyKey','siteId','actorId','suggestionId','expectedVersion','decision'])
    or exists(select 1 from jsonb_object_keys(p_request) key where key<>all(array['version','commandId','idempotencyKey','siteId','actorId','suggestionId','expectedVersion','decision']))
    or p_request->>'version'<>'1'
    or coalesce(p_request->>'commandId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'idempotencyKey','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'siteId','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'actorId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'suggestionId','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'expectedVersion','')!~'^[1-9][0-9]*$'
    or p_request->>'decision' not in ('accept','reject')
  then raise exception 'invalid customer merge review payload' using errcode='22023'; end if;
  begin
    v_site_id:=(p_request->>'siteId')::uuid; v_actor_id:=(p_request->>'actorId')::uuid;
    v_suggestion_id:=(p_request->>'suggestionId')::uuid; v_expected_version:=(p_request->>'expectedVersion')::integer;
  exception when others then raise exception 'invalid customer merge review payload' using errcode='22023'; end;
  v_decision:=p_request->>'decision';
  v_review_state:=case v_decision when 'accept' then 'accepted' else 'dismissed' end;
  if not builder_private.module_action_allowed(v_site_id,'growth.customers','write')
    or not builder_private.member_has_capability(v_site_id,v_actor_id,'customers.update','site')
  then raise exception 'customer merge review not authorized' using errcode='42501'; end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.customer-merge.review.v1');
  if v_claim->>'status'='replay' then return (v_claim->'result')||jsonb_build_object('status','replayed'); end if;
  select * into v_suggestion from public.builder_contact_merge_suggestions
  where site_id=v_site_id and id=v_suggestion_id for update;
  if not found or not exists(select 1 from public.builder_contacts where site_id=v_site_id and id=v_suggestion.left_contact_id)
    or not exists(select 1 from public.builder_contacts where site_id=v_site_id and id=v_suggestion.right_contact_id)
  then raise exception 'customer merge review not authorized' using errcode='42501'; end if;
  if v_suggestion.version<>v_expected_version then
    v_result:=jsonb_build_object('version',1,'status','conflict','expectedVersion',v_expected_version,'actualVersion',v_suggestion.version);
    return builder_private.complete_operational_command_v1(p_request,'growth.customer-merge.review.v1',v_result);
  end if;
  if v_suggestion.review_state<>'pending' then raise exception 'customer merge review invalid state' using errcode='22023'; end if;
  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,before_value,after_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.customer_merge.reviewed',v_actor_id,'Reviewed a customer merge suggestion',
    jsonb_build_object('suggestionId',v_suggestion_id,'state','pending','version',v_suggestion.version),
    jsonb_build_object('suggestionId',v_suggestion_id,'state',v_review_state,'version',v_suggestion.version+1),p_request->>'commandId');
  update public.builder_contact_merge_suggestions set review_state=v_review_state,reviewed_by=v_actor_id,
    reviewed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where site_id=v_site_id and id=v_suggestion_id;
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.customer-merge.reviewed',jsonb_build_object('version',1,'suggestionId',v_suggestion_id,'decision',v_decision,'reviewState',v_review_state),
    'growth.customer-merge:'||(p_request->>'commandId'),1,'customer_merge_suggestion',v_suggestion_id,(p_request->>'commandId')::uuid);
  v_result:=jsonb_build_object('version',1,'status','applied','suggestionId',v_suggestion_id,'resultVersion',v_suggestion.version+1,'decision',v_decision,'reviewState',v_review_state);
  return builder_private.complete_operational_command_v1(p_request,'growth.customer-merge.review.v1',v_result);
end;
$$;

revoke all on function public.builder_review_customer_merge_v1(jsonb) from public;
revoke all on function public.builder_review_customer_merge_v1(jsonb) from anon;
revoke all on function public.builder_review_customer_merge_v1(jsonb) from authenticated;
grant execute on function public.builder_review_customer_merge_v1(jsonb) to service_role;

create function public.builder_request_customer_export_v1(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  v_site_id uuid; v_actor_id uuid; v_aal2 timestamptz; v_filters jsonb;
  v_export_id uuid:=gen_random_uuid(); v_audit_id uuid:=gen_random_uuid(); v_claim jsonb; v_result jsonb;
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','commandId','idempotencyKey','siteId','actorId','aal2VerifiedAt','filters'])
    or exists(select 1 from jsonb_object_keys(p_request) key where key<>all(array['version','commandId','idempotencyKey','siteId','actorId','aal2VerifiedAt','filters']))
    or p_request->>'version'<>'1'
    or coalesce(p_request->>'commandId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'idempotencyKey','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'siteId','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'actorId','')!~'^[0-9a-f-]{36}$'
  then raise exception 'invalid customer export payload' using errcode='22023'; end if;
  begin v_site_id:=(p_request->>'siteId')::uuid; v_actor_id:=(p_request->>'actorId')::uuid; v_aal2:=(p_request->>'aal2VerifiedAt')::timestamptz;
  exception when others then raise exception 'invalid customer export payload' using errcode='22023'; end;
  v_filters:=p_request->'filters';
  if jsonb_typeof(v_filters)<>'object' or octet_length(v_filters::text)>8192
    or (select count(*) from jsonb_object_keys(v_filters))>5
    or exists(select 1 from jsonb_object_keys(v_filters) key where key not in ('customerIds','lifecycleStates','zipCodes','tagKeys','query'))
    or exists(select 1 from jsonb_each(v_filters) pair where pair.key<>'query' and jsonb_typeof(pair.value)<>'array')
    or (v_filters?'query' and (jsonb_typeof(v_filters->'query')<>'string' or char_length(v_filters->>'query') not between 1 and 200))
    or exists(select 1 from jsonb_each(v_filters) pair where jsonb_typeof(pair.value)='array' and jsonb_array_length(pair.value)>100)
    or exists(select 1 from jsonb_each(v_filters) pair cross join lateral jsonb_array_elements(pair.value) item
      where jsonb_typeof(pair.value)='array' and (jsonb_typeof(item)<>'string' or char_length(item#>>'{}') not between 1 and 128))
    or exists(select 1 from jsonb_array_elements_text(coalesce(v_filters->'customerIds','[]')) item where item!~'^[0-9a-f-]{36}$')
    or exists(select 1 from jsonb_array_elements_text(coalesce(v_filters->'lifecycleStates','[]')) item where item not in ('active','inactive','merged','deleted'))
    or exists(select 1 from jsonb_array_elements_text(coalesce(v_filters->'zipCodes','[]')) item where item!~'^[0-9]{5}(-[0-9]{4})?$')
    or exists(select 1 from jsonb_array_elements_text(coalesce(v_filters->'tagKeys','[]')) item where item!~'^[a-z][a-z0-9_-]{0,63}$')
  then raise exception 'invalid customer export filters' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(v_filters->'customerIds','[]')) item
    where not exists(select 1 from public.builder_contacts c where c.site_id=v_site_id and c.id=item::uuid))
  then raise exception 'invalid customer export filters' using errcode='22023'; end if;
  if v_aal2<statement_timestamp()-interval '5 minutes' or v_aal2>statement_timestamp()+interval '1 minute'
  then raise exception 'recent AAL2 required' using errcode='42501'; end if;
  if not builder_private.module_action_allowed(v_site_id,'growth.customers','export')
    or not builder_private.member_has_capability(v_site_id,v_actor_id,'customers.export','site')
  then raise exception 'customer export not authorized' using errcode='42501'; end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.customer-export.request.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed'); end if;
  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,after_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.customer_export.requested',v_actor_id,'Requested a customer export',jsonb_build_object('exportId',v_export_id),p_request->>'commandId');
  insert into public.builder_data_exports(site_id,id,requester_id,domain,frozen_scope,state,schema_version)
  values(v_site_id,v_export_id,v_actor_id,'customers',v_filters,'requested',1);
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.customer-export.requested',jsonb_build_object('version',1,'exportId',v_export_id),
    'growth.customer-export:'||(p_request->>'commandId'),1,'data_export',v_export_id,(p_request->>'commandId')::uuid);
  v_result:=jsonb_build_object('version',1,'status','requested','exportId',v_export_id);
  return builder_private.complete_operational_command_v1(p_request,'growth.customer-export.request.v1',v_result);
end; $$;
revoke all on function public.builder_request_customer_export_v1(jsonb) from public;
revoke all on function public.builder_request_customer_export_v1(jsonb) from anon;
revoke all on function public.builder_request_customer_export_v1(jsonb) from authenticated;
grant execute on function public.builder_request_customer_export_v1(jsonb) to service_role;

create function public.builder_request_customer_deletion_v1(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  v_site_id uuid; v_actor_id uuid; v_customer_id uuid; v_aal2 timestamptz;
  v_request_id uuid:=gen_random_uuid(); v_audit_id uuid:=gen_random_uuid(); v_claim jsonb; v_result jsonb; v_role text;
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','commandId','idempotencyKey','siteId','actorId','customerId','reason','aal2VerifiedAt'])
    or exists(select 1 from jsonb_object_keys(p_request) key where key<>all(array['version','commandId','idempotencyKey','siteId','actorId','customerId','reason','aal2VerifiedAt']))
    or p_request->>'version'<>'1' or coalesce(p_request->>'commandId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'idempotencyKey','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'siteId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'actorId','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'customerId','')!~'^[0-9a-f-]{36}$'
    or char_length(btrim(coalesce(p_request->>'reason',''))) not between 1 and 500
  then raise exception 'invalid customer deletion payload' using errcode='22023'; end if;
  begin v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_customer_id:=(p_request->>'customerId')::uuid;v_aal2:=(p_request->>'aal2VerifiedAt')::timestamptz;
  exception when others then raise exception 'invalid customer deletion payload' using errcode='22023'; end;
  if v_aal2<statement_timestamp()-interval '5 minutes' or v_aal2>statement_timestamp()+interval '1 minute'
  then raise exception 'recent AAL2 required' using errcode='42501'; end if;
  select role into v_role from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id;
  if v_role is distinct from 'owner' or not builder_private.member_has_capability(v_site_id,v_actor_id,'customers.deleteRequest','site')
    or not builder_private.module_action_allowed(v_site_id,'growth.customers','write')
  then raise exception 'customer deletion request not authorized' using errcode='42501'; end if;
  if not exists(select 1 from public.builder_contacts where site_id=v_site_id and id=v_customer_id)
  then raise exception 'customer deletion request not authorized' using errcode='42501'; end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.customer-deletion.request.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed'); end if;
  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,after_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.customer_deletion.requested',v_actor_id,'Requested customer deletion',jsonb_build_object('requestId',v_request_id,'customerId',v_customer_id),p_request->>'commandId');
  insert into public.builder_deletion_requests(site_id,id,requester_id,contact_id,scope,state)
  values(v_site_id,v_request_id,v_actor_id,v_customer_id,'contact','requested');
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.customer-deletion.requested',jsonb_build_object('version',1,'requestId',v_request_id,'customerId',v_customer_id),
    'growth.customer-deletion:'||(p_request->>'commandId'),1,'deletion_request',v_request_id,(p_request->>'commandId')::uuid);
  v_result:=jsonb_build_object('version',1,'status','requested','requestId',v_request_id,'customerId',v_customer_id);
  return builder_private.complete_operational_command_v1(p_request,'growth.customer-deletion.request.v1',v_result);
end; $$;
revoke all on function public.builder_request_customer_deletion_v1(jsonb) from public;
revoke all on function public.builder_request_customer_deletion_v1(jsonb) from anon;
revoke all on function public.builder_request_customer_deletion_v1(jsonb) from authenticated;
grant execute on function public.builder_request_customer_deletion_v1(jsonb) to service_role;

create function public.builder_mark_notification_read_v1(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  v_site_id uuid;v_actor_id uuid;v_recipient_id uuid;v_notification_id uuid;v_read_at timestamptz;
  v_notification public.builder_in_app_notifications%rowtype;v_audit_id uuid:=gen_random_uuid();v_claim jsonb;v_result jsonb;
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','commandId','idempotencyKey','siteId','actorId','recipientId','notificationId','readAt'])
    or exists(select 1 from jsonb_object_keys(p_request) key where key<>all(array['version','commandId','idempotencyKey','siteId','actorId','recipientId','notificationId','readAt']))
    or p_request->>'version'<>'1' or coalesce(p_request->>'commandId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'idempotencyKey','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'siteId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'actorId','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'recipientId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'notificationId','')!~'^[0-9a-f-]{36}$'
  then raise exception 'invalid notification read payload' using errcode='22023'; end if;
  begin v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_recipient_id:=(p_request->>'recipientId')::uuid;v_notification_id:=(p_request->>'notificationId')::uuid;v_read_at:=(p_request->>'readAt')::timestamptz;
  exception when others then raise exception 'invalid notification read payload' using errcode='22023'; end;
  if v_actor_id<>v_recipient_id or v_read_at<statement_timestamp()-interval '24 hours' or v_read_at>statement_timestamp()+interval '1 minute'
    or not exists(select 1 from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id)
    or not builder_private.module_action_allowed(v_site_id,'growth.dashboard','read')
  then raise exception 'notification read not authorized' using errcode='42501'; end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.notification.mark-read.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed'); end if;
  select * into v_notification from public.builder_in_app_notifications where site_id=v_site_id and id=v_notification_id and recipient_id=v_recipient_id for update;
  if not found then raise exception 'notification read not authorized' using errcode='42501'; end if;
  if v_notification.read_at is not null then
    v_result:=jsonb_build_object('version',1,'status','already_read','notificationId',v_notification_id);
    return builder_private.complete_operational_command_v1(p_request,'growth.notification.mark-read.v1',v_result);
  end if;
  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,after_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.notification.read',v_actor_id,'Marked an in-app notification read',jsonb_build_object('notificationId',v_notification_id),p_request->>'commandId');
  update public.builder_in_app_notifications set read_at=v_read_at where site_id=v_site_id and id=v_notification_id;
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.notification.read',jsonb_build_object('version',1,'notificationId',v_notification_id),
    'growth.notification-read:'||(p_request->>'commandId'),1,'notification',v_notification_id,(p_request->>'commandId')::uuid);
  v_result:=jsonb_build_object('version',1,'status','read','notificationId',v_notification_id);
  return builder_private.complete_operational_command_v1(p_request,'growth.notification.mark-read.v1',v_result);
end; $$;
revoke all on function public.builder_mark_notification_read_v1(jsonb) from public;
revoke all on function public.builder_mark_notification_read_v1(jsonb) from anon;
revoke all on function public.builder_mark_notification_read_v1(jsonb) from authenticated;
grant execute on function public.builder_mark_notification_read_v1(jsonb) to service_role;

create function builder_private.apply_invitation_template_v1(
  p_site_id uuid,p_member_id uuid,p_template_id text,p_granted_by uuid,p_audit_event_id uuid
)
returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare v_count integer;
begin
  if p_template_id not in ('growth_manager_v1','growth_staff_v1','growth_read_only_v1') then
    raise exception 'invalid invitation permission template' using errcode='22023';
  end if;
  insert into public.builder_member_capabilities(
    site_id,member_id,capability,scope,template_id,template_version,granted_by,audit_event_id
  )
  select p_site_id,p_member_id,template.capability,template.scope,p_template_id,1,p_granted_by,p_audit_event_id
  from (
    select capability,'site'::text scope from unnest(array[
      'dashboard.read','leads.read','leads.create','leads.update','leads.assign','leads.export',
      'customers.read','customers.update','customers.export','tasks.read','tasks.manage',
      'messages.read','messages.draft','messages.send','templates.manage','reviews.manage',
      'automations.read','automations.manage','automations.approve','projects.read','projects.manage',
      'siteHealth.read','emergencyPause.manage'
    ]) capability where p_template_id='growth_manager_v1'
    union all
    select capability,'site' from unnest(array['dashboard.read','leads.create']) capability
      where p_template_id='growth_staff_v1'
    union all
    select capability,'assigned' from unnest(array[
      'leads.read','leads.update','customers.read','customers.update','tasks.read','tasks.manage',
      'messages.read','messages.draft','messages.send','projects.read'
    ]) capability where p_template_id='growth_staff_v1'
    union all
    select capability,'site' from unnest(array[
      'dashboard.read','leads.read','customers.read','tasks.read','messages.read',
      'automations.read','projects.read','siteHealth.read'
    ]) capability where p_template_id='growth_read_only_v1'
  ) template;
  get diagnostics v_count=row_count;
  if (p_template_id='growth_manager_v1' and v_count<>23)
    or (p_template_id='growth_staff_v1' and v_count<>12)
    or (p_template_id='growth_read_only_v1' and v_count<>8)
  then raise exception 'invitation permission template drift' using errcode='23514'; end if;
  return v_count;
end; $$;
revoke all on function builder_private.apply_invitation_template_v1(uuid,uuid,text,uuid,uuid) from public;
revoke all on function builder_private.apply_invitation_template_v1(uuid,uuid,text,uuid,uuid) from anon;
revoke all on function builder_private.apply_invitation_template_v1(uuid,uuid,text,uuid,uuid) from authenticated;
grant execute on function builder_private.apply_invitation_template_v1(uuid,uuid,text,uuid,uuid) to service_role;

create function public.builder_create_member_invitation_v1(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  v_site_id uuid;v_actor_id uuid;v_digest text;v_token_hash text;v_template_id text;
  v_expires_at timestamptz;v_aal2 timestamptz;v_role text;v_invitation_id uuid:=gen_random_uuid();v_audit_id uuid:=gen_random_uuid();v_claim jsonb;v_result jsonb;
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','commandId','idempotencyKey','siteId','actorId','canonicalEmailDigest','tokenHash','templateId','templateVersion','expiresAt','aal2VerifiedAt'])
    or exists(select 1 from jsonb_object_keys(p_request) key where key<>all(array['version','commandId','idempotencyKey','siteId','actorId','canonicalEmailDigest','tokenHash','templateId','templateVersion','expiresAt','aal2VerifiedAt']))
    or p_request->>'version'<>'1' or coalesce(p_request->>'commandId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'idempotencyKey','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'siteId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'actorId','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'canonicalEmailDigest','')!~'^[a-f0-9]{64}$'
    or coalesce(p_request->>'tokenHash','')!~'^[a-f0-9]{64}$'
    or p_request->>'templateId' not in ('growth_manager_v1','growth_staff_v1','growth_read_only_v1')
    or p_request->>'templateVersion'<>'1'
  then raise exception 'invalid member invitation payload' using errcode='22023'; end if;
  begin v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;
    v_expires_at:=(p_request->>'expiresAt')::timestamptz;v_aal2:=(p_request->>'aal2VerifiedAt')::timestamptz;
  exception when others then raise exception 'invalid member invitation payload' using errcode='22023'; end;
  v_digest:=p_request->>'canonicalEmailDigest';v_token_hash:=p_request->>'tokenHash';v_template_id:=p_request->>'templateId';
  if v_expires_at<statement_timestamp()+interval '5 minutes' or v_expires_at>statement_timestamp()+interval '30 days'
  then raise exception 'invalid member invitation payload' using errcode='22023'; end if;
  if v_aal2<statement_timestamp()-interval '5 minutes' or v_aal2>statement_timestamp()+interval '1 minute'
  then raise exception 'recent AAL2 required' using errcode='42501'; end if;
  select role into v_role from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id;
  if v_role is distinct from 'owner' or not builder_private.member_has_capability(v_site_id,v_actor_id,'members.manage','site')
    or not builder_private.module_action_allowed(v_site_id,'growth.dashboard','write')
  then raise exception 'member invitation not authorized' using errcode='42501'; end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.member-invitation.create.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed'); end if;
  if exists(select 1 from public.builder_member_invitations where site_id=v_site_id and canonical_email_digest=v_digest and state='pending' and expires_at>statement_timestamp())
  then raise exception 'active member invitation already exists' using errcode='22023'; end if;
  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,after_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.member_invitation.created',v_actor_id,'Created a member invitation',
    jsonb_build_object('invitationId',v_invitation_id,'templateId',v_template_id,'templateVersion',1),p_request->>'commandId');
  insert into public.builder_member_invitations(site_id,id,canonical_email_digest,token_hash,template_id,template_version,invited_by,state,expires_at,version)
  values(v_site_id,v_invitation_id,v_digest,v_token_hash,v_template_id,1,v_actor_id,'pending',v_expires_at,1);
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.member-invitation.created',jsonb_build_object('version',1,'invitationId',v_invitation_id,'templateId',v_template_id,'templateVersion',1),
    'growth.member-invitation-create:'||(p_request->>'commandId'),1,'member_invitation',v_invitation_id,(p_request->>'commandId')::uuid);
  v_result:=jsonb_build_object('version',1,'status','created','invitationId',v_invitation_id,'resultVersion',1,'templateId',v_template_id,'templateVersion',1);
  return builder_private.complete_operational_command_v1(p_request,'growth.member-invitation.create.v1',v_result);
end; $$;
revoke all on function public.builder_create_member_invitation_v1(jsonb) from public;
revoke all on function public.builder_create_member_invitation_v1(jsonb) from anon;
revoke all on function public.builder_create_member_invitation_v1(jsonb) from authenticated;
grant execute on function public.builder_create_member_invitation_v1(jsonb) to service_role;

create function public.builder_revoke_member_invitation_v1(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  v_site_id uuid;v_actor_id uuid;v_invitation_id uuid;v_expected_version integer;v_aal2 timestamptz;v_role text;
  v_invitation public.builder_member_invitations%rowtype;v_audit_id uuid:=gen_random_uuid();v_claim jsonb;v_result jsonb;
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','commandId','idempotencyKey','siteId','actorId','invitationId','expectedVersion','reason','aal2VerifiedAt'])
    or exists(select 1 from jsonb_object_keys(p_request) key where key<>all(array['version','commandId','idempotencyKey','siteId','actorId','invitationId','expectedVersion','reason','aal2VerifiedAt']))
    or p_request->>'version'<>'1' or coalesce(p_request->>'commandId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'idempotencyKey','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'siteId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'actorId','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'invitationId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'expectedVersion','')!~'^[1-9][0-9]*$' or char_length(btrim(coalesce(p_request->>'reason',''))) not between 1 and 500
  then raise exception 'invalid member invitation revoke payload' using errcode='22023'; end if;
  begin v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_invitation_id:=(p_request->>'invitationId')::uuid;
    v_expected_version:=(p_request->>'expectedVersion')::integer;v_aal2:=(p_request->>'aal2VerifiedAt')::timestamptz;
  exception when others then raise exception 'invalid member invitation revoke payload' using errcode='22023'; end;
  if v_aal2<statement_timestamp()-interval '5 minutes' or v_aal2>statement_timestamp()+interval '1 minute'
  then raise exception 'recent AAL2 required' using errcode='42501'; end if;
  select role into v_role from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id;
  if v_role is distinct from 'owner' or not builder_private.member_has_capability(v_site_id,v_actor_id,'members.manage','site')
    or not builder_private.module_action_allowed(v_site_id,'growth.dashboard','write')
  then raise exception 'member invitation not authorized' using errcode='42501'; end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.member-invitation.revoke.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed'); end if;
  select * into v_invitation from public.builder_member_invitations where site_id=v_site_id and id=v_invitation_id for update;
  if not found then raise exception 'member invitation not authorized' using errcode='42501'; end if;
  if v_invitation.version<>v_expected_version then
    v_result:=jsonb_build_object('version',1,'status','conflict','expectedVersion',v_expected_version,'actualVersion',v_invitation.version);
    return builder_private.complete_operational_command_v1(p_request,'growth.member-invitation.revoke.v1',v_result);
  end if;
  if v_invitation.state<>'pending' then raise exception 'member invitation revoke invalid state' using errcode='22023'; end if;
  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,before_value,after_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.member_invitation.revoked',v_actor_id,'Revoked a member invitation',
    jsonb_build_object('invitationId',v_invitation_id,'state','pending','version',v_invitation.version),
    jsonb_build_object('invitationId',v_invitation_id,'state','revoked','version',v_invitation.version+1),p_request->>'commandId');
  update public.builder_member_invitations set state='revoked',revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
  where site_id=v_site_id and id=v_invitation_id;
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.member-invitation.revoked',jsonb_build_object('version',1,'invitationId',v_invitation_id,'invitationVersion',v_invitation.version+1),
    'growth.member-invitation-revoke:'||(p_request->>'commandId'),1,'member_invitation',v_invitation_id,(p_request->>'commandId')::uuid);
  v_result:=jsonb_build_object('version',1,'status','revoked','invitationId',v_invitation_id,'resultVersion',v_invitation.version+1);
  return builder_private.complete_operational_command_v1(p_request,'growth.member-invitation.revoke.v1',v_result);
end; $$;
revoke all on function public.builder_revoke_member_invitation_v1(jsonb) from public;
revoke all on function public.builder_revoke_member_invitation_v1(jsonb) from anon;
revoke all on function public.builder_revoke_member_invitation_v1(jsonb) from authenticated;
grant execute on function public.builder_revoke_member_invitation_v1(jsonb) to service_role;

create function public.builder_accept_member_invitation_v1(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  v_site_id uuid;v_user_id uuid;v_digest text;v_token_hash text;v_member_role text;
  v_invitation public.builder_member_invitations%rowtype;v_audit_id uuid:=gen_random_uuid();v_claim jsonb;v_result jsonb;v_grant_count integer;
begin
  if jsonb_typeof(p_request)<>'object'
    or not(p_request?&array['version','commandId','idempotencyKey','siteId','authenticatedUserId','canonicalEmailDigest','tokenHash'])
    or exists(select 1 from jsonb_object_keys(p_request) key where key<>all(array['version','commandId','idempotencyKey','siteId','authenticatedUserId','canonicalEmailDigest','tokenHash']))
    or p_request->>'version'<>'1' or coalesce(p_request->>'commandId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'idempotencyKey','')!~'^[0-9a-f-]{36}$' or coalesce(p_request->>'siteId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'authenticatedUserId','')!~'^[0-9a-f-]{36}$'
    or coalesce(p_request->>'canonicalEmailDigest','')!~'^[a-f0-9]{64}$' or coalesce(p_request->>'tokenHash','')!~'^[a-f0-9]{64}$'
  then raise exception 'invalid member invitation acceptance payload' using errcode='22023'; end if;
  begin v_site_id:=(p_request->>'siteId')::uuid;v_user_id:=(p_request->>'authenticatedUserId')::uuid;
  exception when others then raise exception 'invalid member invitation acceptance payload' using errcode='22023'; end;
  v_digest:=p_request->>'canonicalEmailDigest';v_token_hash:=p_request->>'tokenHash';
  -- Receipt claim intentionally precedes membership checks: the accepting user is
  -- not a member yet, and an accepted replay must remain deterministic.
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.member-invitation.accept.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed','replayed',true); end if;

  select * into v_invitation from public.builder_member_invitations
  where site_id=v_site_id and token_hash=v_token_hash for update;
  if not found or v_invitation.canonical_email_digest<>v_digest or v_invitation.state<>'pending'
    or v_invitation.expires_at<=statement_timestamp() or v_invitation.template_version<>1
    or v_invitation.template_id not in ('growth_manager_v1','growth_staff_v1','growth_read_only_v1')
    or not exists(select 1 from public.builder_site_members where site_id=v_site_id and user_id=v_invitation.invited_by)
    or exists(select 1 from public.builder_site_members where site_id=v_site_id and user_id=v_user_id)
    or not builder_private.module_action_allowed(v_site_id,'growth.dashboard','write')
  then raise exception 'member invitation acceptance denied' using errcode='42501'; end if;

  v_member_role:=case v_invitation.template_id
    when 'growth_manager_v1' then 'editor'
    when 'growth_staff_v1' then 'contributor'
    when 'growth_read_only_v1' then 'viewer'
  end;
  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,after_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.member_invitation.accepted',v_user_id,'Accepted a member invitation',
    jsonb_build_object('invitationId',v_invitation.id,'memberId',v_user_id,'templateId',v_invitation.template_id,'templateVersion',1),p_request->>'commandId');
  insert into public.builder_site_members(site_id,user_id,role) values(v_site_id,v_user_id,v_member_role);
  v_grant_count:=builder_private.apply_invitation_template_v1(v_site_id,v_user_id,v_invitation.template_id,v_invitation.invited_by,v_audit_id);
  update public.builder_member_invitations set state='accepted',accepted_by=v_user_id,accepted_at=clock_timestamp(),
    version=version+1,updated_at=clock_timestamp() where site_id=v_site_id and id=v_invitation.id and state='pending';
  if not found then raise exception 'member invitation acceptance denied' using errcode='42501'; end if;
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.member-invitation.accepted',jsonb_build_object('version',1,'invitationId',v_invitation.id,'memberId',v_user_id,
    'memberRole',v_member_role,'templateId',v_invitation.template_id,'templateVersion',1,'grantCount',v_grant_count),
    'growth.member-invitation-accept:'||(p_request->>'commandId'),1,'member_invitation',v_invitation.id,(p_request->>'commandId')::uuid);
  v_result:=jsonb_build_object('version',1,'status','accepted','memberId',v_user_id,'invitationId',v_invitation.id,'resultVersion',v_invitation.version+1,'replayed',false);
  return builder_private.complete_operational_command_v1(p_request,'growth.member-invitation.accept.v1',v_result);
end; $$;
revoke all on function public.builder_accept_member_invitation_v1(jsonb) from public;
revoke all on function public.builder_accept_member_invitation_v1(jsonb) from anon;
revoke all on function public.builder_accept_member_invitation_v1(jsonb) from authenticated;
grant execute on function public.builder_accept_member_invitation_v1(jsonb) to service_role;
