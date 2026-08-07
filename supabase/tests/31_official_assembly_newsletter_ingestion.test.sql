begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.builder_sites (id, site_key, display_name)
values ('31000000-0000-4000-8000-000000000001', 'newsletter-ingestion-test', 'Newsletter Ingestion Test');

insert into builder_private.builder_verified_entitlement_snapshots (
  id, site_id, installation_id, sequence, issued_at, expires_at,
  outage_window_ends_at, has_prior_valid_snapshot, digest, contract_version
) values (
  '31100000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  '31200000-0000-4000-8000-000000000001',
  1, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 day',
  clock_timestamp() + interval '2 days', true, repeat('1', 64), 1
);
insert into builder_private.builder_verified_entitlement_snapshot_modules (
  snapshot_id, site_id, sequence, module_id, module_version, state, setup_complete
) values
  ('31100000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 1, 'growth.customers', '1.0.1', 'active', true),
  ('31100000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 1, 'growth.leads', '1.0.1', 'active', true),
  ('31100000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 1, 'growth.dashboard', '2.0.1', 'active', true);

insert into public.builder_forms (
  site_id, id, form_key, template_id, template_version
) values (
  '31000000-0000-4000-8000-000000000001',
  '31300000-0000-4000-8000-000000000001',
  'newsletter-signup',
  'local-business.newsletter-signup',
  '1.0.0'
);
insert into public.builder_form_revisions (
  site_id, form_id, id, revision_number, template_id, template_version,
  contract_digest, schema_version, configuration
) values (
  '31000000-0000-4000-8000-000000000001',
  '31300000-0000-4000-8000-000000000001',
  '31400000-0000-4000-8000-000000000001',
  1,
  'local-business.newsletter-signup',
  '1.0.0',
  '285bb0c54a09990f82614061e17a0ce4e50c00b178d65bb4e7a1d033e74e04af',
  1,
  $json${
    "templateId":"local-business.newsletter-signup","templateVersion":"1.0.0","displayName":"Newsletter Signup",
    "fields":[
      {"key":"email","label":"Email","helpText":"","placeholder":"you@example.com","visible":true,"required":true},
      {"key":"firstName","label":"First name","helpText":"","placeholder":"First name","visible":true,"required":false},
      {"key":"marketingConsent","label":"I agree to receive District Newsletter emails from the Office of Assemblywoman Carmen Morales. I understand that submitting this form is a confirmation request, that I am not subscribed until I confirm by email, and that I can unsubscribe at any time.","helpText":"","placeholder":"","visible":true,"required":true}
    ],
    "qualification":{"enabled":false,"allowedZipCodes":[]},
    "completion":{"mode":"inline_success","successCopy":"Check your inbox to continue. Your request is pending, and you are not subscribed unless you complete the confirmation step."},
    "consentPolicyVersion":"marketing-v1"
  }$json$::jsonb
);
update public.builder_forms
set published_revision_id = '31400000-0000-4000-8000-000000000001'
where site_id = '31000000-0000-4000-8000-000000000001'
  and id = '31300000-0000-4000-8000-000000000001';

create function pg_temp.newsletter_request(
  p_idempotency_key uuid,
  p_receipt_id uuid,
  p_email text,
  p_address_fingerprint text default repeat('9', 64)
)
returns jsonb
language sql
volatile
as $$
  with form_row as (
    select * from public.builder_forms
    where site_id = '31000000-0000-4000-8000-000000000001'
      and form_key = 'newsletter-signup'
  ), payload as (
    select jsonb_build_object('email', p_email, 'firstName', 'Reader') as value
  ), rate_clock as materialized (
    select clock_timestamp() as observed_at
  )
  select jsonb_build_object(
    'version', 1,
    'confirmationKeyId', '2026-08',
    'addressFingerprint', p_address_fingerprint,
    'ingestion', jsonb_build_object(
      'version', 2,
      'siteId', form_row.site_id,
      'formId', form_row.id,
      'formKey', form_row.form_key,
      'formRevisionId', form_row.published_revision_id,
      'templateId', form_row.template_id,
      'templateVersion', form_row.template_version,
      'sourcePage', '/newsletter',
      'idempotencyKey', p_idempotency_key,
      'requestFingerprint', encode(extensions.digest(convert_to(p_idempotency_key::text, 'UTF8'), 'sha256'), 'hex'),
      'submittedAt', rate_clock.observed_at,
      'locale', 'en-US',
      'qualificationResult', 'not_configured',
      'payload', payload.value,
      'payloadByteLength', octet_length(payload.value::text),
      'fieldCount', 2,
      'consentEvidence', jsonb_build_object(
        'policyVersion', 'marketing-v1',
        'purpose', 'marketing_email',
        'languageDigest', repeat('a', 64),
        'source', 'public_form',
        'capturedAt', rate_clock.observed_at
      ),
      'securityReceiptId', p_receipt_id,
      'rateLimits', jsonb_build_array(
        jsonb_build_object(
          'kind', 'network',
          'bucketKeyHmac', encode(extensions.digest(convert_to(p_receipt_id::text || ':network', 'UTF8'), 'sha256'), 'hex'),
          'windowStartedAt', date_trunc('hour', rate_clock.observed_at),
          'windowEndsAt', date_trunc('hour', rate_clock.observed_at) + interval '1 hour',
          'limit', 20
        ),
        jsonb_build_object(
          'kind', 'identity',
          'bucketKeyHmac', encode(extensions.digest(convert_to(p_receipt_id::text || ':identity', 'UTF8'), 'sha256'), 'hex'),
          'windowStartedAt', date_trunc('minute', rate_clock.observed_at),
          'windowEndsAt', date_trunc('minute', rate_clock.observed_at) + interval '15 minutes',
          'limit', 20
        )
      )
    )
  )
  from form_row cross join payload cross join rate_clock;
$$;

create temporary table newsletter_results (
  test_case text primary key,
  result jsonb not null
) on commit drop;
grant select, insert on newsletter_results to service_role;

set local role service_role;
insert into newsletter_results values (
  'initial',
  public.builder_ingest_official_assembly_newsletter_v1(pg_temp.newsletter_request(
    '31500000-0000-4000-8000-000000000001',
    '31600000-0000-4000-8000-000000000001',
    'reader@example.test'
  ))
);
insert into newsletter_results values (
  'replay',
  public.builder_ingest_official_assembly_newsletter_v1(pg_temp.newsletter_request(
    '31500000-0000-4000-8000-000000000001',
    '31600000-0000-4000-8000-000000000001',
    'reader@example.test'
  ))
);
reset role;

select is((select result->>'version' from newsletter_results where test_case = 'initial'), '2', 'newsletter intake preserves the version-2 acceptance contract');
select is((select result->>'accepted' from newsletter_results where test_case = 'initial'), 'true', 'newsletter intake remains externally generic');
select is((select result->>'receiptId' from newsletter_results where test_case = 'initial'), '31600000-0000-4000-8000-000000000001', 'newsletter intake preserves the managed-form receipt identifier');
select is((select result->>'result' from newsletter_results where test_case = 'initial'), 'accepted', 'the first newsletter intake uses the package acceptance result');
select is((select result->>'result' from newsletter_results where test_case = 'replay'), 'replayed', 'receipt replay uses the package replay result');
select is((select result->>'deliveryOrdinal' from newsletter_results where test_case = 'initial'), '1', 'the first accepted request creates delivery ordinal one');
select is((select result->>'subscriptionId' from newsletter_results where test_case = 'initial'), (select result->>'subscriptionId' from newsletter_results where test_case = 'replay'), 'receipt replay returns the same subscription');
select is((select count(*) from public.builder_newsletter_subscriptions where site_id = '31000000-0000-4000-8000-000000000001'), 1::bigint, 'receipt replay creates one subscription');
select is((select count(*) from public.builder_newsletter_confirmation_generations where site_id = '31000000-0000-4000-8000-000000000001'), 1::bigint, 'receipt replay creates one confirmation generation');
select is((select count(*) from public.builder_newsletter_jobs where site_id = '31000000-0000-4000-8000-000000000001' and kind = 'newsletter.confirmation.send'), 1::bigint, 'receipt replay creates one confirmation job');
select is((select count(*) from builder_private.builder_newsletter_delivery_ledger where site_id = '31000000-0000-4000-8000-000000000001'), 1::bigint, 'receipt replay consumes one logical-delivery allowance');

set local "builder.newsletter_test_failure" = 'after_strict_ingestion';
set local role service_role;
select throws_ok(
  $$ select public.builder_ingest_official_assembly_newsletter_v1(pg_temp.newsletter_request(
    '31500000-0000-4000-8000-000000000002',
    '31600000-0000-4000-8000-000000000002',
    'rollback@example.test',
    repeat('8', 64)
  )) $$,
  'P2N99',
  'newsletter injected rollback',
  'an injected failure rolls back the strict intake and newsletter records together'
);
reset role;
reset "builder.newsletter_test_failure";

select is((select count(*) from public.builder_form_submissions where idempotency_key = '31500000-0000-4000-8000-000000000002'), 0::bigint, 'injected failure leaves no strict submission');
select is((select count(*) from builder_private.builder_ingestion_receipts where idempotency_key = '31500000-0000-4000-8000-000000000002'), 0::bigint, 'injected failure leaves no strict receipt');
select is((select count(*) from public.builder_newsletter_subscriptions where site_id = '31000000-0000-4000-8000-000000000001'), 1::bigint, 'injected failure leaves no newsletter subscription');

set local role service_role;
select throws_ok(
  $$ select public.builder_ingest_official_assembly_newsletter_v1(pg_temp.newsletter_request(
    '31500000-0000-4000-8000-000000000001',
    '31600000-0000-4000-8000-000000000001',
    'reader@example.test',
    repeat('7', 64)
  )) $$,
  'P2N01',
  'newsletter receipt is incompatible',
  'a replay cannot change the site-scoped address fingerprint'
);
reset role;

update builder_private.builder_newsletter_delivery_ledger
set created_at = clock_timestamp() - interval '16 minutes'
where site_id = '31000000-0000-4000-8000-000000000001';

set local role service_role;
insert into newsletter_results values (
  'resend',
  public.builder_ingest_official_assembly_newsletter_v1(pg_temp.newsletter_request(
    '31500000-0000-4000-8000-000000000003',
    '31600000-0000-4000-8000-000000000003',
    'reader@example.test'
  ))
);
reset role;

select is((select result->>'confirmationGeneration' from newsletter_results where test_case = 'resend'), '1', 'a cooled-down resend reuses the unexpired generation');
select is((select result->>'deliveryOrdinal' from newsletter_results where test_case = 'resend'), '2', 'a cooled-down resend creates the next logical delivery ordinal');
select is((select count(*) from public.builder_newsletter_jobs where site_id = '31000000-0000-4000-8000-000000000001' and kind = 'newsletter.confirmation.send'), 2::bigint, 'the next logical delivery has its own durable job');

set local role service_role;
insert into newsletter_results values (
  'session',
  public.builder_exchange_newsletter_confirmation_session_v1(jsonb_build_object(
    'version', 1,
    'siteId', '31000000-0000-4000-8000-000000000001',
    'subscriptionId', (select (result->>'subscriptionId')::uuid from newsletter_results where test_case = 'initial'),
    'generation', 1,
    'nonce', (select nonce from public.builder_newsletter_confirmation_generations where site_id = '31000000-0000-4000-8000-000000000001' and generation = 1),
    'keyId', '2026-08',
    'sessionDigest', repeat('b', 64),
    'sessionExpiresAt', clock_timestamp() + interval '10 minutes'
  ))
);
insert into newsletter_results values (
  'confirm',
  public.builder_confirm_newsletter_subscription_v1(jsonb_build_object(
    'version', 1,
    'siteId', '31000000-0000-4000-8000-000000000001',
    'sessionDigest', repeat('b', 64)
  ))
);
insert into newsletter_results values (
  'confirm_replay',
  public.builder_confirm_newsletter_subscription_v1(jsonb_build_object(
    'version', 1,
    'siteId', '31000000-0000-4000-8000-000000000001',
    'sessionDigest', repeat('b', 64)
  ))
);
reset role;

select is((select result->>'status' from newsletter_results where test_case = 'session'), 'ready', 'a valid token exchange creates a read-only confirmation session');
select is((select result->>'status' from newsletter_results where test_case = 'confirm'), 'confirmed_pending_provider', 'explicit confirmation advances to provider activation pending');
select is((select result->>'status' from newsletter_results where test_case = 'confirm_replay'), 'already_confirmed', 'confirmation replay is harmless');
select is((select count(*) from public.builder_newsletter_jobs where site_id = '31000000-0000-4000-8000-000000000001' and kind = 'newsletter.contact.sync'), 1::bigint, 'confirmation enqueues one provider synchronization job');
select ok((select consumed_at is not null from public.builder_newsletter_confirmation_generations where site_id = '31000000-0000-4000-8000-000000000001' and generation = 1), 'the confirmed generation is consumed once');

select * from finish();
rollback;
