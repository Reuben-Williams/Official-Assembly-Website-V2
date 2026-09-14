begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- Local transaction-only fixtures. No provider calls or production mutations.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '46000000-0000-4000-8000-000000000201',
  'authenticated', 'authenticated', 'epoch-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.builder_sites (id, site_key, display_name)
values ('46000000-0000-4000-8000-000000000001', 'epoch-restart-test', 'Epoch restart test');
insert into public.builder_site_members (site_id, user_id, role)
values ('46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000201', 'owner');
insert into public.builder_newsletter_provider_activation_revisions (
  site_id, command_id, revision, provider_scope_id, resource_identity_digest,
  provider_contact_count, local_eligible_count, historical_send_count, recorded_by
) values (
  '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000301',
  1, 'resend-team-production', repeat('a', 64), 0, 0, 0, '46000000-0000-4000-8000-000000000201'
);

create temporary table epoch_results (name text primary key, value jsonb not null) on commit drop;
grant select, insert, update on epoch_results to service_role;

-- Retain the actual claim/fence/epoch in every request rather than manufacturing leases.
create function pg_temp.claim_epoch_job(p_worker uuid) returns jsonb language plpgsql as $$
declare v_job jsonb;
begin
  v_job := public.builder_claim_newsletter_jobs_v1(jsonb_build_object(
    'version', 1, 'siteId', '46000000-0000-4000-8000-000000000001',
    'workerId', p_worker, 'limit', 1, 'leaseSeconds', 120, 'emailEnabled', true
  )) #> '{jobs,0}';
  return v_job || jsonb_build_object('version', 1,
    'siteId', '46000000-0000-4000-8000-000000000001', 'workerId', p_worker, 'jobId', v_job ->> 'id');
end;
$$;

select ok(not has_function_privilege('anon', 'public.builder_checkpoint_newsletter_reconciliation_v1(jsonb)', 'EXECUTE'),
  'anonymous visitors cannot checkpoint reconciliation');
select ok(not has_function_privilege('authenticated', 'public.builder_reserve_newsletter_segment_removal_v1(jsonb)', 'EXECUTE'),
  'signed-in browser clients cannot reserve provider removals');
select ok(not has_function_privilege('anon', 'builder_private.restart_newsletter_reconciliation_epoch_v1(uuid,uuid,uuid,uuid,bigint,bigint)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'builder_private.restart_newsletter_reconciliation_epoch_v1(uuid,uuid,uuid,uuid,bigint,bigint)', 'EXECUTE'),
  'the private restart helper cannot be called by browser roles');
select ok(has_function_privilege('service_role', 'builder_private.restart_newsletter_reconciliation_epoch_v1(uuid,uuid,uuid,uuid,bigint,bigint)', 'EXECUTE'),
  'the private restart helper is available only within the service boundary');

set local role service_role;
select public.builder_schedule_newsletter_reconciliation_v1(jsonb_build_object(
  'version', 1, 'siteId', '46000000-0000-4000-8000-000000000001'
));
insert into epoch_results values ('provider', pg_temp.claim_epoch_job('46000000-0000-4000-8000-000000000101'));
insert into epoch_results select 'provider_checkpoint', public.builder_checkpoint_newsletter_reconciliation_v1(value || jsonb_build_object(
  'phase', 'local_eligible', 'providerComplete', true, 'providerPages', 1, 'moreWork', true,
  'members', jsonb_build_array(jsonb_build_object('providerContactId', 'removed-before-change',
    'seenProvider', true, 'eligible', false, 'disposition', 'removed', 'actionState', 'completed'))
)) from epoch_results where name = 'provider';
insert into epoch_results values ('local', pg_temp.claim_epoch_job('46000000-0000-4000-8000-000000000102'));
reset role;

select is((select value ->> 'status' from epoch_results where name = 'provider_checkpoint'), 'queued',
  'provider phase checkpoints successfully before eligibility changes');
select is((select value ->> 'runId' from epoch_results where name = 'local'),
  (select value ->> 'runId' from epoch_results where name = 'provider'), 'local phase resumes the same run');
select builder_private.invalidate_newsletter_readiness_v1('46000000-0000-4000-8000-000000000001', 'eligibility_changed_during_walk');

set local role service_role;
select throws_ok(format('select public.builder_checkpoint_newsletter_reconciliation_v1(%L::jsonb)',
  (select value || '{"moreWork":true}'::jsonb from epoch_results where name = 'provider')),
  '55000', 'newsletter job lease lost', 'a previous lease cannot restart an epoch-stale run');
reset role;
select is((select state from public.builder_newsletter_reconciliation_runs
  where id = (select (value ->> 'runId')::uuid from epoch_results where name = 'local')), 'running',
  'rejected stale lease does not supersede the current run');
select is((select count(*)::integer from public.builder_newsletter_reconciliation_members
  where site_id = '46000000-0000-4000-8000-000000000001'), 1,
  'rejected stale lease does not erase current evidence');

update public.builder_newsletter_site_jobs set lease_expires_at = clock_timestamp() - interval '1 second'
where id = (select (value ->> 'jobId')::uuid from epoch_results where name = 'local');
set local role service_role;
select throws_ok(format('select public.builder_checkpoint_newsletter_reconciliation_v1(%L::jsonb)',
  (select value || '{"moreWork":true}'::jsonb from epoch_results where name = 'local')),
  '55000', 'newsletter job lease lost', 'an expired lease cannot restart an epoch-stale run');
reset role;
update public.builder_newsletter_site_jobs set lease_expires_at = clock_timestamp() + interval '120 seconds', consecutive_failure_count = 7
where id = (select (value ->> 'jobId')::uuid from epoch_results where name = 'local');

set local role service_role;
insert into epoch_results select 'restarted', public.builder_checkpoint_newsletter_reconciliation_v1(value || jsonb_build_object(
  'phase', 'finalize', 'localComplete', true, 'localPages', 1, 'moreWork', false,
  'members', jsonb_build_array(jsonb_build_object('providerContactId', 'must-not-be-recorded',
    'seenLocal', true, 'eligible', true, 'disposition', 'eligible', 'actionState', 'none'))
)) from epoch_results where name = 'local';
reset role;
select is((select value ->> 'status' from epoch_results where name = 'restarted'), 'restarted',
  'an owned local checkpoint restarts instead of spending the final failure attempt');
select is((select state from public.builder_newsletter_reconciliation_runs
  where id = (select (value ->> 'runId')::uuid from epoch_results where name = 'local')), 'superseded',
  'the obsolete epoch run is retained as superseded');
select ok((select state = 'queued' and lease_owner is null and lease_expires_at is null and consecutive_failure_count = 0
  from public.builder_newsletter_site_jobs where id = (select (value ->> 'jobId')::uuid from epoch_results where name = 'local')),
  'restart requeues and releases the same job with the failure budget reset');
select is((select count(*)::integer from public.builder_newsletter_reconciliation_members
  where site_id = '46000000-0000-4000-8000-000000000001'), 0,
  'restart discards obsolete evidence and never records the submitted stale members');
select is((select count(*)::integer from public.builder_newsletter_readiness_revisions
  where site_id = '46000000-0000-4000-8000-000000000001' and state = 'ready'), 0,
  'stale reconciliation cannot issue readiness');
select is(public.builder_get_newsletter_public_readiness_v1('46000000-0000-4000-8000-000000000001') ->> 'ready',
  'false', 'the public form stays unavailable while reconciliation must restart');
select is((select count(*)::integer from public.builder_newsletter_reconciliation_circuits
  where site_id = '46000000-0000-4000-8000-000000000001' and state = 'open'), 0,
  'legitimate epoch drift does not open the failure circuit');

set local role service_role;
insert into epoch_results values ('fresh_provider', pg_temp.claim_epoch_job('46000000-0000-4000-8000-000000000103'));
select throws_ok(format('select public.builder_checkpoint_newsletter_reconciliation_v1(%L::jsonb)',
  (select value || '{"moreWork":true}'::jsonb from epoch_results where name = 'local')),
  '55000', 'newsletter job lease lost', 'the superseded lease cannot restart newly claimed work');
reset role;
select isnt((select value ->> 'runId' from epoch_results where name = 'fresh_provider'),
  (select value ->> 'runId' from epoch_results where name = 'local'), 'reclaim creates a fresh run');
select is((select (value ->> 'expectedEligibilityEpoch')::bigint from epoch_results where name = 'fresh_provider'),
  1::bigint, 'the fresh run is bound to the current eligibility epoch');
select ok((select not provider_complete and not local_complete and provider_page_count = 0 and local_page_count = 0
  from public.builder_newsletter_reconciliation_runs where id = (select (value ->> 'runId')::uuid from epoch_results where name = 'fresh_provider')),
  'the fresh run must repeat both complete audience walks');

set local role service_role;
select throws_ok(format('select public.builder_finalize_newsletter_reconciliation_v1(%L::jsonb)',
  (select value from epoch_results where name = 'fresh_provider')),
  '55000', 'newsletter reconciliation is incomplete', 'restart never bypasses completion checks');
select public.builder_checkpoint_newsletter_reconciliation_v1(value || '{"phase":"local_eligible","providerComplete":true,"providerPages":1,"moreWork":true}')
from epoch_results where name = 'fresh_provider';
insert into epoch_results values ('fresh_local', pg_temp.claim_epoch_job('46000000-0000-4000-8000-000000000104'));
select public.builder_checkpoint_newsletter_reconciliation_v1(value || '{"phase":"finalize","localComplete":true,"localPages":1,"moreWork":false}')
from epoch_results where name = 'fresh_local';
insert into epoch_results select 'ready', public.builder_finalize_newsletter_reconciliation_v1(value)
from epoch_results where name = 'fresh_local';
reset role;
select is((select value ->> 'status' from epoch_results where name = 'ready'), 'ready',
  'a complete fresh reconciliation succeeds after the restart');
select is((select count(*)::integer from public.builder_newsletter_readiness_revisions
  where site_id = '46000000-0000-4000-8000-000000000001' and state = 'ready'), 1,
  'only the fully checked fresh run produces readiness');
select is(public.builder_get_newsletter_public_readiness_v1('46000000-0000-4000-8000-000000000001') ->> 'ready',
  'true', 'a complete fresh walk restores genuine public readiness');

-- The same race immediately before an external removal must return without reserving it.
select builder_private.invalidate_newsletter_readiness_v1('46000000-0000-4000-8000-000000000001', 'second_walk_requested');
set local role service_role;
select public.builder_schedule_newsletter_reconciliation_v1(jsonb_build_object(
  'version', 1, 'siteId', '46000000-0000-4000-8000-000000000001'));
insert into epoch_results values ('removal', pg_temp.claim_epoch_job('46000000-0000-4000-8000-000000000105'));
reset role;
select builder_private.invalidate_newsletter_readiness_v1('46000000-0000-4000-8000-000000000001', 'eligibility_changed_before_removal');
set local role service_role;
select throws_ok(format('select public.builder_reserve_newsletter_segment_removal_v1(%L::jsonb)',
  (select value || jsonb_build_object('providerContactId', 'must-not-be-removed',
    'fencingToken', (value ->> 'fencingToken')::bigint - 1) from epoch_results where name = 'removal')),
  '55000', 'newsletter job lease lost', 'an old fencing token cannot trigger removal-time restart');
select throws_ok(format('select public.builder_reserve_newsletter_segment_removal_v1(%L::jsonb)',
  (select value || '{"providerContactId":"must-not-be-removed","workerId":"46000000-0000-4000-8000-000000000106"}'
    from epoch_results where name = 'removal')),
  '55000', 'newsletter job lease lost', 'the wrong worker cannot trigger removal-time restart');
insert into epoch_results select 'removal_restarted', public.builder_reserve_newsletter_segment_removal_v1(
  value || '{"providerContactId":"must-not-be-removed"}') from epoch_results where name = 'removal';
reset role;
select is((select value ->> 'status' from epoch_results where name = 'removal_restarted'), 'restarted',
  'removal reservation returns restart before authorizing an external mutation');
select is((select count(*)::integer from public.builder_newsletter_reconciliation_members
  where site_id = '46000000-0000-4000-8000-000000000001'), 0, 'no removal intent is recorded for the obsolete epoch');
select is((select state from public.builder_newsletter_reconciliation_runs
  where id = (select (value ->> 'runId')::uuid from epoch_results where name = 'removal')), 'superseded',
  'removal-time restart also supersedes the run');
select is((select state from public.builder_newsletter_readiness_revisions
  where site_id = '46000000-0000-4000-8000-000000000001' order by revision desc limit 1), 'stale',
  'removal-time restart leaves public readiness stale until a complete new walk');
select is(public.builder_get_newsletter_public_readiness_v1('46000000-0000-4000-8000-000000000001') ->> 'ready',
  'false', 'old ready revisions are not reused after removal-time epoch drift');
set local role service_role;
insert into epoch_results values ('after_removal', pg_temp.claim_epoch_job('46000000-0000-4000-8000-000000000107'));
reset role;
select is((select (value ->> 'expectedEligibilityEpoch')::bigint from epoch_results where name = 'after_removal'),
  3::bigint, 'removal-time restart reclaims at the newest epoch');

select * from finish();
rollback;
