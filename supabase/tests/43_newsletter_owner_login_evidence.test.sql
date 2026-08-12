begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
create temporary table pg_temp.tap_results (line text not null);
grant insert on pg_temp.tap_results to service_role;

insert into pg_temp.tap_results select has_table('public', 'builder_newsletter_auth_login_occurrences', 'owner login occurrences exist');
insert into pg_temp.tap_results select has_table('public', 'builder_newsletter_auth_login_evidence', 'owner login evidence exists');
insert into pg_temp.tap_results select has_table('public', 'builder_newsletter_auth_login_recovery_commands', 'owner login recovery commands exist');
insert into pg_temp.tap_results select has_column('public', 'builder_newsletter_site_jobs', 'auth_login_occurrence_id', 'site jobs bind login occurrences');
insert into pg_temp.tap_results select is((select relrowsecurity from pg_class where oid = 'public.builder_newsletter_auth_login_occurrences'::regclass), true, 'occurrences enforce RLS');
insert into pg_temp.tap_results select is((select relrowsecurity from pg_class where oid = 'public.builder_newsletter_auth_login_evidence'::regclass), true, 'evidence enforces RLS');
insert into pg_temp.tap_results select ok(
  not has_function_privilege('anon', 'public.builder_record_newsletter_auth_login_occurrence_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.builder_record_newsletter_auth_login_occurrence_v1(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.builder_record_newsletter_auth_login_occurrence_v1(jsonb)', 'EXECUTE'),
  'only the service role records login occurrences'
);
insert into pg_temp.tap_results select ok(
  not has_function_privilege('authenticated', 'public.builder_record_newsletter_auth_login_evidence_v1(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.builder_record_newsletter_auth_login_evidence_v1(jsonb)', 'EXECUTE'),
  'only the service role records login evidence'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '43100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner-login-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '43100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner-login-editor@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.builder_sites (id, site_key, display_name)
values ('43000000-0000-4000-8000-000000000001', 'newsletter-owner-login-test', 'Newsletter Owner Login Test');
insert into public.builder_site_members (site_id, user_id, role) values
  ('43000000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000001', 'owner'),
  ('43000000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000002', 'editor');

create temporary table pg_temp.owner_login_request as
select jsonb_build_object(
  'version', 1,
  'siteId', '43000000-0000-4000-8000-000000000001',
  'operatorId', '43100000-0000-4000-8000-000000000001',
  'commandId', '43200000-0000-5000-8000-000000000001',
  'authLastSignInAt', now() - interval '1 minute'
) as request;
grant select on pg_temp.owner_login_request to service_role;

set local role service_role;
insert into pg_temp.tap_results select throws_ok(
  format(
    $$ select public.builder_record_newsletter_auth_login_occurrence_v1(%L::jsonb) $$,
    jsonb_set((select request from pg_temp.owner_login_request), '{operatorId}', '"43100000-0000-4000-8000-000000000002"')::text
  ),
  '42501', 'newsletter owner login occurrence not authorized',
  'an editor cannot record an owner login occurrence'
);

create temporary table pg_temp.owner_login_occurrence as
select public.builder_record_newsletter_auth_login_occurrence_v1(
  (select request from pg_temp.owner_login_request)
) as response;
insert into pg_temp.tap_results select is((select response ->> 'status' from pg_temp.owner_login_occurrence), 'queued', 'an owner login occurrence queues durable work');
insert into pg_temp.tap_results select is(
  public.builder_record_newsletter_auth_login_occurrence_v1(
    (select request from pg_temp.owner_login_request)
  ) ->> 'replayed',
  'true',
  'the exact occurrence command is idempotent'
);

create temporary table pg_temp.owner_login_claim as
select public.builder_claim_newsletter_auth_login_jobs_v1(jsonb_build_object(
  'version', 1,
  'siteId', '43000000-0000-4000-8000-000000000001',
  'workerId', '43300000-0000-4000-8000-000000000001',
  'limit', 1,
  'leaseSeconds', 120
)) as response;
insert into pg_temp.tap_results select is((select response #>> '{jobs,0,kind}' from pg_temp.owner_login_claim), 'newsletter.auth_login.reconcile', 'owner evidence claims while independent of outbound sending');
insert into pg_temp.tap_results select is((select (response #>> '{jobs,0,attemptCount}')::integer from pg_temp.owner_login_claim), 1, 'the bounded claim records one attempt');
reset role;

insert into public.builder_newsletter_webhook_receipts (
  site_id, provider_scope_id, svix_id, event_type, provider_created_at,
  provider_message_id, provider_broadcast_id, disposition, safe_digest
) values
  ('43000000-0000-4000-8000-000000000001', 'resend-team-production', 'owner-login-sent', 'email.sent', now() - interval '70 seconds', 'owner-login-message-1', null, 'matched', repeat('a', 64)),
  ('43000000-0000-4000-8000-000000000001', 'resend-team-production', 'owner-login-delivered', 'email.delivered', now() - interval '65 seconds', 'owner-login-message-1', null, 'matched', repeat('b', 64)),
  ('43000000-0000-4000-8000-000000000001', 'resend-team-production', 'owner-login-opened', 'email.opened', now() - interval '60 seconds', 'owner-login-message-1', null, 'matched', repeat('c', 64));

create temporary table pg_temp.owner_login_evidence_request as
select jsonb_build_object(
  'version', 1,
  'policyVersion', 'resend-owner-login-v1',
  'siteId', '43000000-0000-4000-8000-000000000001',
  'operatorId', '43100000-0000-4000-8000-000000000001',
  'commandId', '43200000-0000-5000-8000-000000000002',
  'occurrenceId', (select response ->> 'occurrenceId' from pg_temp.owner_login_occurrence),
  'providerMessageId', 'owner-login-message-1',
  'providerCreatedAt', now() - interval '70 seconds',
  'authLastSignInAt', (select request ->> 'authLastSignInAt' from pg_temp.owner_login_request),
  'safeEvidenceDigest', repeat('d', 64)
) as request;
grant select on pg_temp.owner_login_evidence_request to service_role;

set local role service_role;
insert into pg_temp.tap_results select is(
  public.builder_record_newsletter_auth_login_evidence_v1(
    (select request from pg_temp.owner_login_evidence_request)
  ) ->> 'status',
  'recorded',
  'exact sent and delivered receipts record immutable owner login evidence'
);
insert into pg_temp.tap_results select is(
  public.builder_record_newsletter_auth_login_evidence_v1(
    (select request from pg_temp.owner_login_evidence_request)
  ) ->> 'replayed',
  'true',
  'the exact evidence command is idempotent'
);
insert into pg_temp.tap_results select throws_ok(
  format(
    $$ select public.builder_complete_newsletter_job_v1(%L::jsonb) $$,
    jsonb_build_object(
      'version', 1,
      'siteId', '43000000-0000-4000-8000-000000000001',
      'subject', 'site',
      'jobId', (select response #>> '{jobs,0,id}' from pg_temp.owner_login_claim),
      'workerId', '43300000-0000-4000-8000-000000000001',
      'fencingToken', (select (response #>> '{jobs,0,fencingToken}')::bigint + 1 from pg_temp.owner_login_claim),
      'resultCode', 'owner_login_evidence_recorded'
    )::text
  ),
  '55000', 'newsletter job lease lost',
  'stale fencing cannot complete owner login work'
);
insert into pg_temp.tap_results select is(
  public.builder_complete_newsletter_job_v1(jsonb_build_object(
    'version', 1,
    'siteId', '43000000-0000-4000-8000-000000000001',
    'subject', 'site',
    'jobId', (select response #>> '{jobs,0,id}' from pg_temp.owner_login_claim),
    'workerId', '43300000-0000-4000-8000-000000000001',
    'fencingToken', (select (response #>> '{jobs,0,fencingToken}')::bigint from pg_temp.owner_login_claim),
    'resultCode', 'owner_login_evidence_recorded'
  )) ->> 'state',
  'completed',
  'the exact lease completes owner login evidence work'
);

insert into pg_temp.tap_results select throws_ok(
  $$ update public.builder_newsletter_auth_login_evidence
     set safe_evidence_digest = repeat('e', 64)
     where site_id = '43000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table builder_newsletter_auth_login_evidence',
  'service operations cannot rewrite owner login evidence'
);
insert into pg_temp.tap_results select throws_ok(
  $$ delete from public.builder_newsletter_auth_login_evidence
     where site_id = '43000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table builder_newsletter_auth_login_evidence',
  'service operations cannot delete owner login evidence'
);
reset role;

insert into pg_temp.tap_results select * from finish();
select line from pg_temp.tap_results;
rollback;
