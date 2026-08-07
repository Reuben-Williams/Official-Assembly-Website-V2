begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'builder_newsletter_reconciliation_runs', 'durable reconciliation runs exist');
select has_table('public', 'builder_newsletter_reconciliation_members', 'bounded reconciliation member evidence exists');
select has_table('public', 'builder_newsletter_reconciliation_requests', 'command-bound reconciliation requests exist');
select has_table('public', 'builder_newsletter_reconciliation_circuits', 'site reconciliation circuits exist');
select has_table('public', 'builder_newsletter_eligibility_epochs', 'site eligibility epochs exist');
select has_table('public', 'builder_newsletter_provider_activation_revisions', 'provider activation evidence exists');
select has_table('public', 'builder_newsletter_provider_inventory_attestations', 'non-api inventory attestations exist');

select has_column('public', 'builder_newsletter_site_jobs', 'invocation_count', 'site jobs separate invocation count');
select has_column('public', 'builder_newsletter_site_jobs', 'consecutive_failure_count', 'site jobs separate consecutive failures');
select has_column('public', 'builder_newsletter_site_jobs', 'last_checkpoint_at', 'site jobs retain checkpoint age');
select has_column('public', 'builder_newsletter_provider_activation_revisions', 'command_id', 'provider activation is command-idempotent');
select has_column('public', 'builder_newsletter_provider_inventory_attestations', 'command_id', 'inventory attestation is command-idempotent');
select has_column('public', 'builder_newsletter_reconciliation_circuits', 'recovery_command_id', 'circuit recovery is command-idempotent');

select has_function('public', 'builder_schedule_newsletter_reconciliation_v1', array['jsonb'], 'generic reconciliation scheduler exists');
select has_function('public', 'builder_request_newsletter_reconciliation_v1', array['jsonb'], 'force-fresh reconciliation request exists');
select has_function('public', 'builder_checkpoint_newsletter_reconciliation_v1', array['jsonb'], 'fenced checkpoint/yield exists');
select has_function('public', 'builder_finalize_newsletter_reconciliation_v1', array['jsonb'], 'atomic readiness finalizer exists');
select has_function('public', 'builder_abandon_newsletter_reconciliations_v1', array['jsonb'], 'age-bounded abandonment exists');
select has_function('public', 'builder_purge_newsletter_reconciliation_members_v1', array['jsonb'], 'bounded evidence purge exists');
select has_function('public', 'builder_recover_newsletter_reconciliation_v1', array['jsonb'], 'audited owner recovery exists');
select has_function('public', 'builder_record_newsletter_provider_activation_v1', array['jsonb'], 'provider activation evidence RPC exists');
select has_function('public', 'builder_record_newsletter_inventory_attestation_v1', array['jsonb'], 'inventory attestation RPC exists');

select has_trigger(
  'public', 'builder_newsletter_subscriptions',
  'builder_newsletter_subscription_readiness_invalidation',
  'subscription transitions invalidate readiness'
);
select has_trigger(
  'public', 'builder_consents',
  'builder_newsletter_consent_readiness_invalidation',
  'marketing consent transitions invalidate readiness'
);
select has_trigger(
  'public', 'builder_suppressions',
  'builder_newsletter_suppression_readiness_invalidation',
  'email suppression transitions invalidate readiness'
);
select has_trigger(
  'public', 'builder_contact_identities',
  'builder_newsletter_identity_readiness_invalidation',
  'newsletter email identity transitions invalidate readiness'
);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'builder_newsletter_reconciliation_runs',
        'builder_newsletter_reconciliation_members',
        'builder_newsletter_reconciliation_requests',
        'builder_newsletter_reconciliation_circuits',
        'builder_newsletter_eligibility_epochs',
        'builder_newsletter_provider_activation_revisions',
        'builder_newsletter_provider_inventory_attestations'
      )
      and not relation.relrowsecurity
  ),
  'every durable newsletter table has RLS enabled'
);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    cross join (values ('anon'), ('authenticated')) as browser(role_name)
    where namespace.nspname = 'public'
      and relation.relname in (
        'builder_newsletter_reconciliation_runs',
        'builder_newsletter_reconciliation_members',
        'builder_newsletter_reconciliation_requests',
        'builder_newsletter_reconciliation_circuits',
        'builder_newsletter_eligibility_epochs',
        'builder_newsletter_provider_activation_revisions',
        'builder_newsletter_provider_inventory_attestations'
      )
      and has_table_privilege(
        browser.role_name,
        format('%I.%I', namespace.nspname, relation.relname),
        'select,insert,update,delete'
      )
  ),
  'browser roles have no durable newsletter table privileges'
);

select ok(
  not exists (
    select 1
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname in (
        'builder_schedule_newsletter_reconciliation_v1',
        'builder_request_newsletter_reconciliation_v1',
        'builder_checkpoint_newsletter_reconciliation_v1',
        'builder_finalize_newsletter_reconciliation_v1',
        'builder_abandon_newsletter_reconciliations_v1',
        'builder_purge_newsletter_reconciliation_members_v1',
        'builder_recover_newsletter_reconciliation_v1',
        'builder_record_newsletter_provider_activation_v1',
        'builder_record_newsletter_inventory_attestation_v1'
      )
      and (
        has_function_privilege('anon', routine.oid, 'execute')
        or has_function_privilege('authenticated', routine.oid, 'execute')
        or coalesce(array_to_string(routine.proconfig, ','), '') <> 'search_path=""'
      )
  ),
  'durable newsletter RPCs are browser-denied and use an empty search path'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '39000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'durable-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '39000000-0000-4000-8000-000000000202', 'authenticated', 'authenticated', 'durable-editor@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.builder_sites (id, site_key, display_name)
values ('39000000-0000-4000-8000-000000000001', 'newsletter-durable-test', 'Newsletter Durable Test');
insert into public.builder_site_members (site_id, user_id, role) values
  ('39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000201', 'owner'),
  ('39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000202', 'editor');

set local role service_role;

select is(
  public.builder_schedule_newsletter_reconciliation_v1(jsonb_build_object(
    'version', 1,
    'siteId', '39000000-0000-4000-8000-000000000001'
  )) ->> 'status',
  'blocked',
  'reconciliation remains blocked before durable provider activation'
);

reset role;
insert into public.builder_newsletter_provider_activation_revisions (
  site_id, command_id, revision, provider_scope_id, resource_identity_digest,
  provider_contact_count, local_eligible_count, historical_send_count, recorded_by
) values (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000211',
  1, 'resend-team-production', repeat('a', 64), 0, 0, 0,
  '39000000-0000-4000-8000-000000000201'
);
set local role service_role;

select is(
  public.builder_schedule_newsletter_reconciliation_v1(jsonb_build_object(
    'version', 1,
    'siteId', '39000000-0000-4000-8000-000000000001'
  )) ->> 'status',
  'queued',
  'missing readiness queues a reconciliation job'
);

select is(
  public.builder_schedule_newsletter_reconciliation_v1(jsonb_build_object(
    'version', 1,
    'siteId', '39000000-0000-4000-8000-000000000001'
  )) ->> 'status',
  'already_queued',
  'repeated scheduling reuses the active job'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.builder_newsletter_site_jobs
    where site_id = '39000000-0000-4000-8000-000000000001'
      and kind = 'newsletter.segment.reconcile'
      and state in ('queued', 'leased', 'retryable_failed')
  ),
  1,
  'the database enforces one active reconciliation job per site'
);

create temporary table durable_results (
  test_case text primary key,
  result jsonb not null
) on commit drop;
grant select, insert, update on durable_results to service_role;

set local role service_role;
insert into durable_results values (
  'first_claim',
  public.builder_claim_newsletter_jobs_v1(jsonb_build_object(
    'version', 1,
    'siteId', '39000000-0000-4000-8000-000000000001',
    'workerId', '39000000-0000-4000-8000-000000000101',
    'limit', 1,
    'leaseSeconds', 60,
    'emailEnabled', true
  ))
);
reset role;

select is(
  jsonb_array_length((select result -> 'jobs' from durable_results where test_case = 'first_claim')),
  1,
  'the queued reconciliation is claimed once'
);
select is(
  (
    select invocation_count
    from public.builder_newsletter_site_jobs
    where site_id = '39000000-0000-4000-8000-000000000001'
      and kind = 'newsletter.segment.reconcile'
  ),
  1,
  'a claim increments invocation count without consuming failure budget'
);
select is(
  (
    select consecutive_failure_count
    from public.builder_newsletter_site_jobs
    where site_id = '39000000-0000-4000-8000-000000000001'
      and kind = 'newsletter.segment.reconcile'
  ),
  0,
  'a healthy claim leaves consecutive failures at zero'
);
select is(
  (
    select count(*)::integer
    from public.builder_newsletter_reconciliation_runs
    where site_id = '39000000-0000-4000-8000-000000000001' and state = 'running'
  ),
  1,
  'claim creates one durable reconciliation run'
);
select ok(
  nullif(
    (select result #>> '{jobs,0,runId}' from durable_results where test_case = 'first_claim'),
    ''
  ) is not null,
  'claimed reconciliation includes its run identifier'
);
select is(
  (select (result #>> '{jobs,0,expectedEligibilityEpoch}')::bigint from durable_results where test_case = 'first_claim'),
  0::bigint,
  'claimed reconciliation includes the start eligibility epoch'
);

set local role service_role;
insert into durable_results values (
  'first_yield',
  public.builder_checkpoint_newsletter_reconciliation_v1(jsonb_build_object(
    'version', 1,
    'siteId', '39000000-0000-4000-8000-000000000001',
    'jobId', (select result #>> '{jobs,0,id}' from durable_results where test_case = 'first_claim'),
    'runId', (select result #>> '{jobs,0,runId}' from durable_results where test_case = 'first_claim'),
    'workerId', '39000000-0000-4000-8000-000000000101',
    'fencingToken', (select (result #>> '{jobs,0,fencingToken}')::bigint from durable_results where test_case = 'first_claim'),
    'expectedEligibilityEpoch', 0,
    'phase', 'provider_segment',
    'providerAfterCursor', 'page-1',
    'providerPages', 1,
    'providerComplete', false,
    'moreWork', true
  ))
);
insert into durable_results values (
  'second_claim',
  public.builder_claim_newsletter_jobs_v1(jsonb_build_object(
    'version', 1,
    'siteId', '39000000-0000-4000-8000-000000000001',
    'workerId', '39000000-0000-4000-8000-000000000102',
    'limit', 1,
    'leaseSeconds', 60,
    'emailEnabled', true
  ))
);
reset role;

select is((select result ->> 'status' from durable_results where test_case = 'first_yield'), 'queued', 'a healthy page yields the same job');
select is(
  (select invocation_count from public.builder_newsletter_site_jobs where site_id = '39000000-0000-4000-8000-000000000001' and kind = 'newsletter.segment.reconcile'),
  2,
  'the yielded job can be claimed for another healthy invocation'
);
select is(
  (select consecutive_failure_count from public.builder_newsletter_site_jobs where site_id = '39000000-0000-4000-8000-000000000001' and kind = 'newsletter.segment.reconcile'),
  0,
  'healthy yield and re-claim do not consume failure budget'
);
select is(
  (select result #>> '{jobs,0,runId}' from durable_results where test_case = 'second_claim'),
  (select result #>> '{jobs,0,runId}' from durable_results where test_case = 'first_claim'),
  'healthy pagination preserves the durable run'
);
select is(
  (select result #>> '{jobs,0,providerAfterCursor}' from durable_results where test_case = 'second_claim'),
  'page-1',
  'the next invocation resumes from the committed cursor'
);

set local role service_role;
insert into durable_results values (
  'retry_failure',
  public.builder_fail_newsletter_job_v1(jsonb_build_object(
    'version', 1,
    'siteId', '39000000-0000-4000-8000-000000000001',
    'subject', 'site',
    'jobId', (select result #>> '{jobs,0,id}' from durable_results where test_case = 'second_claim'),
    'workerId', '39000000-0000-4000-8000-000000000102',
    'fencingToken', (select (result #>> '{jobs,0,fencingToken}')::bigint from durable_results where test_case = 'second_claim'),
    'terminal', false,
    'retryAt', clock_timestamp(),
    'failureCode', 'provider_unavailable'
  ))
);
reset role;

select is(
  (select consecutive_failure_count from public.builder_newsletter_site_jobs where site_id = '39000000-0000-4000-8000-000000000001' and kind = 'newsletter.segment.reconcile'),
  1,
  'an actual retryable handler failure consumes one consecutive failure'
);

set local role service_role;
insert into durable_results values (
  'provider_reclaim',
  public.builder_claim_newsletter_jobs_v1(jsonb_build_object(
    'version', 1,
    'siteId', '39000000-0000-4000-8000-000000000001',
    'workerId', '39000000-0000-4000-8000-000000000103',
    'limit', 1,
    'leaseSeconds', 60,
    'emailEnabled', true
  ))
);
insert into durable_results values (
  'provider_complete_yield',
  public.builder_checkpoint_newsletter_reconciliation_v1(jsonb_build_object(
    'version', 1,
    'siteId', '39000000-0000-4000-8000-000000000001',
    'jobId', (select result #>> '{jobs,0,id}' from durable_results where test_case = 'provider_reclaim'),
    'runId', (select result #>> '{jobs,0,runId}' from durable_results where test_case = 'provider_reclaim'),
    'workerId', '39000000-0000-4000-8000-000000000103',
    'fencingToken', (select (result #>> '{jobs,0,fencingToken}')::bigint from durable_results where test_case = 'provider_reclaim'),
    'expectedEligibilityEpoch', 0,
    'phase', 'local_eligible',
    'providerPages', 1,
    'providerComplete', true,
    'moreWork', true,
    'members', jsonb_build_array(jsonb_build_object(
      'providerContactId', 'provider-only-1',
      'seenProvider', true,
      'seenLocal', false,
      'eligible', false,
      'disposition', 'removed',
      'actionState', 'completed'
    ))
  ))
);
reset role;

select is(
  (
    select count(*)::integer
    from public.builder_newsletter_reconciliation_members
    where site_id = '39000000-0000-4000-8000-000000000001'
  ),
  1,
  'the fenced checkpoint stores non-PII member evidence'
);

set local role service_role;
insert into durable_results values (
  'local_claim',
  public.builder_claim_newsletter_jobs_v1(jsonb_build_object(
    'version', 1,
    'siteId', '39000000-0000-4000-8000-000000000001',
    'workerId', '39000000-0000-4000-8000-000000000104',
    'limit', 1,
    'leaseSeconds', 60,
    'emailEnabled', true
  ))
);
insert into durable_results values (
  'local_complete_checkpoint',
  public.builder_checkpoint_newsletter_reconciliation_v1(jsonb_build_object(
    'version', 1,
    'siteId', '39000000-0000-4000-8000-000000000001',
    'jobId', (select result #>> '{jobs,0,id}' from durable_results where test_case = 'local_claim'),
    'runId', (select result #>> '{jobs,0,runId}' from durable_results where test_case = 'local_claim'),
    'workerId', '39000000-0000-4000-8000-000000000104',
    'fencingToken', (select (result #>> '{jobs,0,fencingToken}')::bigint from durable_results where test_case = 'local_claim'),
    'expectedEligibilityEpoch', 0,
    'phase', 'finalize',
    'localPages', 1,
    'localComplete', true,
    'moreWork', false,
    'members', '[]'::jsonb
  ))
);
reset role;

set local role service_role;
select lives_ok(
  format(
    $$ select public.builder_finalize_newsletter_reconciliation_v1(%L::jsonb) $$,
    jsonb_build_object(
      'version', 1,
      'siteId', '39000000-0000-4000-8000-000000000001',
      'jobId', (select result #>> '{jobs,0,id}' from durable_results where test_case = 'local_claim'),
      'runId', (select result #>> '{jobs,0,runId}' from durable_results where test_case = 'local_claim'),
      'workerId', '39000000-0000-4000-8000-000000000104',
      'fencingToken', (select (result #>> '{jobs,0,fencingToken}')::bigint from durable_results where test_case = 'local_claim'),
      'expectedEligibilityEpoch', 0
    )::text
  ),
  'the database computes and finalizes authentic zero-audience readiness'
);
reset role;

select is(
  (
    select audience_count
    from public.builder_newsletter_readiness_revisions
    where site_id = '39000000-0000-4000-8000-000000000001'
    order by revision desc limit 1
  ),
  0,
  'the finalizer derives the zero audience count from evidence and local state'
);
select is(
  (
    select count(*)::integer
    from public.builder_newsletter_reconciliation_members
    where site_id = '39000000-0000-4000-8000-000000000001'
  ),
  0,
  'successful finalization compacts per-member evidence'
);

select lives_ok(
  $$ select builder_private.invalidate_newsletter_readiness_v1(
    '39000000-0000-4000-8000-000000000001'::uuid,
    'test_transition'
  ) $$,
  'an observed eligibility transition atomically invalidates readiness'
);
select is(
  (
    select epoch
    from public.builder_newsletter_eligibility_epochs
    where site_id = '39000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'eligibility invalidation advances the site epoch'
);
select is(
  (
    select state
    from public.builder_newsletter_readiness_revisions
    where site_id = '39000000-0000-4000-8000-000000000001'
    order by revision desc limit 1
  ),
  'stale',
  'eligibility invalidation makes the newest readiness revision stale'
);

set local role service_role;
select throws_ok(
  format(
    $$ select public.builder_record_newsletter_inventory_attestation_v1(%L::jsonb) $$,
    jsonb_build_object(
      'version', 1,
      'commandId', '39000000-0000-4000-8000-000000000221',
      'siteId', '39000000-0000-4000-8000-000000000001',
      'operatorId', '39000000-0000-4000-8000-000000000202',
      'policyVersion', 'resend-district-newsletter-v1',
      'categories', jsonb_build_array('billing_ownership', 'oauth_application_view', 'team_membership'),
      'safeEvidenceDigest', repeat('b', 64)
    )::text
  ),
  '42501',
  'newsletter inventory attestation not authorized',
  'newsletter inventory attestation requires a site owner'
);
select is(
  public.builder_record_newsletter_inventory_attestation_v1(jsonb_build_object(
    'version', 1,
    'commandId', '39000000-0000-4000-8000-000000000222',
    'siteId', '39000000-0000-4000-8000-000000000001',
    'operatorId', '39000000-0000-4000-8000-000000000201',
    'policyVersion', 'resend-district-newsletter-v1',
    'categories', jsonb_build_array('billing_ownership', 'oauth_application_view', 'team_membership'),
    'safeEvidenceDigest', repeat('b', 64)
  )) ->> 'status',
  'recorded',
  'a site owner can record the bounded non-api inventory attestation'
);
select is(
  public.builder_record_newsletter_inventory_attestation_v1(jsonb_build_object(
    'version', 1,
    'commandId', '39000000-0000-4000-8000-000000000222',
    'siteId', '39000000-0000-4000-8000-000000000001',
    'operatorId', '39000000-0000-4000-8000-000000000201',
    'policyVersion', 'resend-district-newsletter-v1',
    'categories', jsonb_build_array('billing_ownership', 'oauth_application_view', 'team_membership'),
    'safeEvidenceDigest', repeat('b', 64)
  )) ->> 'status',
  'recorded',
  'replaying the same attestation command is idempotent'
);
select throws_ok(
  format(
    $$ select public.builder_record_newsletter_inventory_attestation_v1(%L::jsonb) $$,
    jsonb_build_object(
      'version', 1,
      'commandId', '39000000-0000-4000-8000-000000000223',
      'siteId', '39000000-0000-4000-8000-000000000001',
      'operatorId', '39000000-0000-4000-8000-000000000201',
      'policyVersion', 'resend-district-newsletter-v1',
      'categories', jsonb_build_array(
        'auth_smtp_post_revocation_login', 'billing_ownership',
        'oauth_application_view', 'team_membership'
      ),
      'safeEvidenceDigest', repeat('c', 64)
    )::text
  ),
  '22023',
  'invalid newsletter inventory attestation',
  'manual inventory attestation cannot manufacture Auth SMTP proof'
);
reset role;
select is(
  (
    select count(*)::integer
    from public.builder_newsletter_provider_inventory_attestations
    where site_id = '39000000-0000-4000-8000-000000000001'
  ),
  1,
  'attestation command replay creates one immutable row'
);

insert into public.builder_sites (id, site_key, display_name)
values ('39000000-0000-4000-8000-000000000002', 'newsletter-activation-test', 'Newsletter Activation Test');
insert into public.builder_site_members (site_id, user_id, role) values
  ('39000000-0000-4000-8000-000000000002', '39000000-0000-4000-8000-000000000201', 'owner'),
  ('39000000-0000-4000-8000-000000000002', '39000000-0000-4000-8000-000000000202', 'editor');

set local role service_role;
select lives_ok(
  format(
    $$ select public.builder_record_newsletter_inventory_attestation_v1(%L::jsonb) $$,
    jsonb_build_object(
      'version', 1,
      'commandId', '39000000-0000-4000-8000-000000000224',
      'siteId', '39000000-0000-4000-8000-000000000002',
      'operatorId', '39000000-0000-4000-8000-000000000201',
      'policyVersion', 'resend-district-newsletter-v1',
      'categories', jsonb_build_array('billing_ownership', 'oauth_application_view', 'team_membership'),
      'safeEvidenceDigest', repeat('d', 64)
    )::text
  ),
  'activation test inventory attestation is recorded'
);
select throws_ok(
  format(
    $$ select public.builder_record_newsletter_provider_activation_v1(%L::jsonb) $$,
    jsonb_build_object(
      'version', 1,
      'commandId', '39000000-0000-4000-8000-000000000225',
      'siteId', '39000000-0000-4000-8000-000000000002',
      'operatorId', '39000000-0000-4000-8000-000000000202',
      'resourceIdentityDigest', repeat('e', 64),
      'providerContactCount', 0,
      'localEligibleCount', 0,
      'historicalSendCount', 0
    )::text
  ),
  '42501',
  'newsletter provider activation not authorized',
  'provider activation requires a site owner'
);
select is(
  public.builder_record_newsletter_provider_activation_v1(jsonb_build_object(
    'version', 1,
    'commandId', '39000000-0000-4000-8000-000000000226',
    'siteId', '39000000-0000-4000-8000-000000000002',
    'operatorId', '39000000-0000-4000-8000-000000000201',
    'resourceIdentityDigest', repeat('e', 64),
    'providerContactCount', 0,
    'localEligibleCount', 0,
    'historicalSendCount', 0
  )) ->> 'status',
  'active',
  'owner records zero-boundary provider activation'
);
select is(
  public.builder_record_newsletter_provider_activation_v1(jsonb_build_object(
    'version', 1,
    'commandId', '39000000-0000-4000-8000-000000000226',
    'siteId', '39000000-0000-4000-8000-000000000002',
    'operatorId', '39000000-0000-4000-8000-000000000201',
    'resourceIdentityDigest', repeat('e', 64),
    'providerContactCount', 0,
    'localEligibleCount', 0,
    'historicalSendCount', 0
  )) ->> 'replayed',
  'true',
  'provider activation command replay is idempotent'
);
reset role;
select is(
  (
    select count(*)::integer
    from public.builder_newsletter_provider_activation_revisions
    where site_id = '39000000-0000-4000-8000-000000000002'
  ),
  1,
  'provider activation command replay creates one immutable row'
);

insert into public.builder_newsletter_reconciliation_circuits (
  site_id, provider_scope_id, state, safe_failure_code, opened_at
) values (
  '39000000-0000-4000-8000-000000000002',
  'resend-team-production', 'open', 'retry_budget_exhausted', clock_timestamp()
);
set local role service_role;
select throws_ok(
  format(
    $$ select public.builder_recover_newsletter_reconciliation_v1(%L::jsonb) $$,
    jsonb_build_object(
      'version', 1,
      'commandId', '39000000-0000-4000-8000-000000000227',
      'siteId', '39000000-0000-4000-8000-000000000002',
      'operatorId', '39000000-0000-4000-8000-000000000202',
      'reason', 'Operator reviewed the provider incident.'
    )::text
  ),
  '42501',
  'newsletter recovery not authorized',
  'reconciliation recovery requires a site owner'
);
select is(
  public.builder_recover_newsletter_reconciliation_v1(jsonb_build_object(
    'version', 1,
    'commandId', '39000000-0000-4000-8000-000000000228',
    'siteId', '39000000-0000-4000-8000-000000000002',
    'operatorId', '39000000-0000-4000-8000-000000000201',
    'reason', 'Operator reviewed the provider incident.'
  )) ->> 'status',
  'queued',
  'owner recovery closes the circuit and queues reconciliation'
);
select is(
  public.builder_recover_newsletter_reconciliation_v1(jsonb_build_object(
    'version', 1,
    'commandId', '39000000-0000-4000-8000-000000000228',
    'siteId', '39000000-0000-4000-8000-000000000002',
    'operatorId', '39000000-0000-4000-8000-000000000201',
    'reason', 'Operator reviewed the provider incident.'
  )) ->> 'replayed',
  'true',
  'reconciliation recovery command replay is idempotent'
);
reset role;
select is(
  (
    select count(*)::integer
    from public.builder_newsletter_site_jobs
    where site_id = '39000000-0000-4000-8000-000000000002'
      and kind = 'newsletter.segment.reconcile'
  ),
  1,
  'recovery command replay queues one durable job'
);

select * from finish();
rollback;
