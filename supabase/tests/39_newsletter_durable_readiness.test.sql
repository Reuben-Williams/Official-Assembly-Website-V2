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

select has_function('public', 'builder_schedule_newsletter_reconciliation_v1', array['jsonb'], 'generic reconciliation scheduler exists');
select has_function('public', 'builder_request_newsletter_reconciliation_v1', array['jsonb'], 'force-fresh reconciliation request exists');
select has_function('public', 'builder_checkpoint_newsletter_reconciliation_v1', array['jsonb'], 'fenced checkpoint/yield exists');
select has_function('public', 'builder_finalize_newsletter_reconciliation_v1', array['jsonb'], 'atomic readiness finalizer exists');
select has_function('public', 'builder_abandon_newsletter_reconciliations_v1', array['jsonb'], 'age-bounded abandonment exists');
select has_function('public', 'builder_purge_newsletter_reconciliation_members_v1', array['jsonb'], 'bounded evidence purge exists');
select has_function('public', 'builder_recover_newsletter_reconciliation_v1', array['jsonb'], 'audited owner recovery exists');
select has_function('public', 'builder_record_newsletter_provider_activation_v1', array['jsonb'], 'provider activation evidence RPC exists');
select has_function('public', 'builder_record_newsletter_inventory_attestation_v1', array['jsonb'], 'inventory attestation RPC exists');

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

insert into public.builder_sites (id, site_key, display_name)
values ('39000000-0000-4000-8000-000000000001', 'newsletter-durable-test', 'Newsletter Durable Test');

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

select * from finish();
rollback;
