begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function(
  'public', 'builder_record_newsletter_history_reconciliation_v2', array['jsonb'],
  'the eleven-record provider history boundary has a dedicated RPC'
);
select ok(
  not has_function_privilege('anon', 'public.builder_record_newsletter_history_reconciliation_v2(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.builder_record_newsletter_history_reconciliation_v2(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.builder_record_newsletter_history_reconciliation_v2(jsonb)', 'EXECUTE'),
  'only the service role can execute the v2 reconciliation RPC'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '41000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'history-v2-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '41000000-0000-4000-8000-000000000202', 'authenticated', 'authenticated', 'history-v2-editor@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.builder_sites (id, site_key, display_name)
values ('41000000-0000-4000-8000-000000000001', 'newsletter-history-v2-test', 'Newsletter History V2 Test');
insert into public.builder_site_members (site_id, user_id, role) values
  ('41000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000201', 'owner'),
  ('41000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000202', 'editor');

insert into public.builder_newsletter_webhook_receipts (
  site_id, provider_scope_id, svix_id, event_type, provider_created_at,
  provider_message_id, provider_broadcast_id, disposition, safe_digest
)
select
  '41000000-0000-4000-8000-000000000001'::uuid,
  'resend-team-production',
  'svix-v2-' || left(message_id, 8) || '-' || replace(event_type, '.', '-'),
  event_type,
  '2026-08-07T17:00:00Z'::timestamptz,
  message_id,
  null,
  'matched',
  repeat('a', 64)
from unnest(array[
  '811ea57a-349d-40c5-a0e6-880b2c79eff4',
  'a1c81a5d-c005-48b3-8ab0-3894958ac9cf',
  'd7477a6b-e5ff-4dac-a087-2a162567b538',
  'a9f2632a-63f3-403d-9cc3-b727173df3df',
  '1c9faeab-9011-40df-a011-fe7203dd3f29',
  '21b1a46d-625b-4338-bdd7-dbb4bdca953d',
  '8f77edd1-1342-48a7-99a5-4d0ce8eebbff',
  '294b5df4-7128-40a6-ab5b-ea719a74c953'
]) message_id
cross join unnest(array['email.sent', 'email.delivered']) event_type
where not (
  message_id = '294b5df4-7128-40a6-ab5b-ea719a74c953'
  and event_type = 'email.delivered'
);

create temporary table history_v2_requests (request jsonb not null);
insert into history_v2_requests values (jsonb_build_object(
  'version', 2,
  'commandId', '41000000-0000-4000-8000-000000000301',
  'siteId', '41000000-0000-4000-8000-000000000001',
  'operatorId', '41000000-0000-4000-8000-000000000201',
  'policyVersion', 'resend-initial-history-v2',
  'safeEvidenceDigest', repeat('b', 64),
  'entries', jsonb_build_array(
    jsonb_build_object('providerMessageId', '811ea57a-349d-40c5-a0e6-880b2c79eff4', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T17:00:00Z'),
    jsonb_build_object('providerMessageId', 'a1c81a5d-c005-48b3-8ab0-3894958ac9cf', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T17:30:00Z'),
    jsonb_build_object('providerMessageId', 'd7477a6b-e5ff-4dac-a087-2a162567b538', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T18:00:00Z'),
    jsonb_build_object('providerMessageId', 'a9f2632a-63f3-403d-9cc3-b727173df3df', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T18:30:00Z'),
    jsonb_build_object('providerMessageId', '1c9faeab-9011-40df-a011-fe7203dd3f29', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T19:00:00Z'),
    jsonb_build_object('providerMessageId', '21b1a46d-625b-4338-bdd7-dbb4bdca953d', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T19:30:00Z'),
    jsonb_build_object('providerMessageId', '8f77edd1-1342-48a7-99a5-4d0ce8eebbff', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T20:00:00Z'),
    jsonb_build_object('providerMessageId', '294b5df4-7128-40a6-ab5b-ea719a74c953', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T20:30:00Z'),
    jsonb_build_object('providerMessageId', '038fb647-8443-42d1-9c16-98f45d944d34', 'classification', 'unattributed_failed_setup_test', 'providerStatus', 'failed', 'providerCreatedAt', '2026-08-06T14:00:00Z')
  )
));
grant select on history_v2_requests to service_role;

set local role service_role;
select throws_ok(
  format(
    $$ select public.builder_record_newsletter_history_reconciliation_v2(%L::jsonb) $$,
    jsonb_set(
      (select request from history_v2_requests),
      '{commandId}',
      '"41000000-0000-4000-8000-000000000302"'
    )::text
  ),
  '55000',
  'newsletter Auth history evidence is incomplete',
  'the newly identified Auth message requires its exact delivered receipt'
);
reset role;

insert into public.builder_newsletter_webhook_receipts (
  site_id, provider_scope_id, svix_id, event_type, provider_created_at,
  provider_message_id, provider_broadcast_id, disposition, safe_digest
) values (
  '41000000-0000-4000-8000-000000000001',
  'resend-team-production',
  'svix-v2-294b5df4-email-delivered',
  'email.delivered',
  '2026-08-07T20:30:00Z',
  '294b5df4-7128-40a6-ab5b-ea719a74c953',
  null,
  'matched',
  repeat('a', 64)
);

set local role service_role;
select throws_ok(
  format(
    $$ select public.builder_record_newsletter_history_reconciliation_v2(%L::jsonb) $$,
    jsonb_set((select request from history_v2_requests), '{operatorId}', '"41000000-0000-4000-8000-000000000202"')::text
  ),
  '42501',
  'newsletter history reconciliation not authorized',
  'the v2 reconciliation still requires a site owner'
);
select is(
  public.builder_record_newsletter_history_reconciliation_v2(
    (select request from history_v2_requests)
  ) ->> 'status',
  'recorded',
  'an owner can record the exact approved nine-entry batch'
);
select is(
  public.builder_record_newsletter_history_reconciliation_v2(
    (select request from history_v2_requests)
  ) ->> 'replayed',
  'true',
  'the exact v2 command replay is idempotent'
);
select throws_ok(
  format(
    $$ select public.builder_record_newsletter_history_reconciliation_v2(%L::jsonb) $$,
    jsonb_set((select request from history_v2_requests), '{safeEvidenceDigest}', ('"' || repeat('c', 64) || '"')::jsonb)::text
  ),
  '23505',
  'newsletter history reconciliation command conflict',
  'the same v2 command cannot be replayed with different evidence'
);
reset role;

select is(
  (select count(*)::integer from public.builder_newsletter_provider_history_reconciliations
   where site_id = '41000000-0000-4000-8000-000000000001'
     and policy_version = 'resend-initial-history-v2'),
  9,
  'the immutable ledger contains only the approved nine new mappings'
);
select is(
  (select count(*)::integer from public.builder_newsletter_provider_history_reconciliations
   where site_id = '41000000-0000-4000-8000-000000000001'
     and classification = 'unattributed_failed_setup_test'),
  1,
  'the failed setup artifact remains explicitly unattributed in v2'
);

set local role service_role;
select throws_ok(
  $$ update public.builder_newsletter_provider_history_reconciliations
     set provider_status = 'failed'
     where site_id = '41000000-0000-4000-8000-000000000001' $$,
  '42501',
  'permission denied for table builder_newsletter_provider_history_reconciliations',
  'service operations cannot rewrite v2 reconciliation evidence'
);
select throws_ok(
  $$ delete from public.builder_newsletter_provider_history_reconciliations
     where site_id = '41000000-0000-4000-8000-000000000001' $$,
  '42501',
  'permission denied for table builder_newsletter_provider_history_reconciliations',
  'service operations cannot delete v2 reconciliation evidence'
);
reset role;

select * from finish();
rollback;
