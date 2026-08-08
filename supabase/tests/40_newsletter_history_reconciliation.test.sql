begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table(
  'public', 'builder_newsletter_provider_history_reconciliations',
  'immutable provider history reconciliation evidence exists'
);
select has_function(
  'public', 'builder_record_newsletter_history_reconciliation_v1', array['jsonb'],
  'bounded provider history reconciliation RPC exists'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.builder_newsletter_provider_history_reconciliations'::regclass),
  'provider history reconciliation evidence has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.builder_newsletter_provider_history_reconciliations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.builder_newsletter_provider_history_reconciliations', 'SELECT'),
  'browser roles cannot read provider history reconciliation evidence'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'history-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000202', 'authenticated', 'authenticated', 'history-editor@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.builder_sites (id, site_key, display_name)
values ('40000000-0000-4000-8000-000000000001', 'newsletter-history-test', 'Newsletter History Test');
insert into public.builder_site_members (site_id, user_id, role) values
  ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000201', 'owner'),
  ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000202', 'editor');

insert into public.builder_newsletter_webhook_receipts (
  site_id, provider_scope_id, svix_id, event_type, provider_created_at,
  provider_message_id, provider_broadcast_id, disposition, safe_digest
)
select
  '40000000-0000-4000-8000-000000000001'::uuid,
  'resend-team-production',
  'svix-' || left(message_id, 8) || '-' || replace(event_type, '.', '-'),
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
  '8f77edd1-1342-48a7-99a5-4d0ce8eebbff'
]) message_id
cross join unnest(array['email.sent', 'email.delivered']) event_type;

create temporary table history_requests (request jsonb not null);
insert into history_requests values (jsonb_build_object(
  'version', 1,
  'commandId', '40000000-0000-4000-8000-000000000301',
  'siteId', '40000000-0000-4000-8000-000000000001',
  'operatorId', '40000000-0000-4000-8000-000000000201',
  'policyVersion', 'resend-initial-history-v1',
  'safeEvidenceDigest', repeat('b', 64),
  'entries', jsonb_build_array(
    jsonb_build_object('providerMessageId', '811ea57a-349d-40c5-a0e6-880b2c79eff4', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T17:00:00Z'),
    jsonb_build_object('providerMessageId', 'a1c81a5d-c005-48b3-8ab0-3894958ac9cf', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T17:30:00Z'),
    jsonb_build_object('providerMessageId', 'd7477a6b-e5ff-4dac-a087-2a162567b538', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T18:00:00Z'),
    jsonb_build_object('providerMessageId', 'a9f2632a-63f3-403d-9cc3-b727173df3df', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T18:30:00Z'),
    jsonb_build_object('providerMessageId', '1c9faeab-9011-40df-a011-fe7203dd3f29', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T19:00:00Z'),
    jsonb_build_object('providerMessageId', '21b1a46d-625b-4338-bdd7-dbb4bdca953d', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T19:30:00Z'),
    jsonb_build_object('providerMessageId', '8f77edd1-1342-48a7-99a5-4d0ce8eebbff', 'classification', 'auth_smtp_magic_link', 'providerStatus', 'delivered', 'providerCreatedAt', '2026-08-07T20:00:00Z'),
    jsonb_build_object('providerMessageId', '038fb647-8443-42d1-9c16-98f45d944d34', 'classification', 'unattributed_failed_setup_test', 'providerStatus', 'failed', 'providerCreatedAt', '2026-08-06T14:00:00Z')
  )
));
grant select on history_requests to service_role;

set local role service_role;
select throws_ok(
  format(
    $$ select public.builder_record_newsletter_history_reconciliation_v1(%L::jsonb) $$,
    jsonb_set((select request from history_requests), '{operatorId}', '"40000000-0000-4000-8000-000000000202"')::text
  ),
  '42501',
  'newsletter history reconciliation not authorized',
  'history reconciliation requires a site owner'
);
select is(
  public.builder_record_newsletter_history_reconciliation_v1(
    (select request from history_requests)
  ) ->> 'status',
  'recorded',
  'an owner can record the exact approved reconciliation batch'
);
select is(
  public.builder_record_newsletter_history_reconciliation_v1(
    (select request from history_requests)
  ) ->> 'replayed',
  'true',
  'the exact command replay is idempotent'
);
select throws_ok(
  format(
    $$ select public.builder_record_newsletter_history_reconciliation_v1(%L::jsonb) $$,
    jsonb_set((select request from history_requests), '{safeEvidenceDigest}', ('"' || repeat('c', 64) || '"')::jsonb)::text
  ),
  '23505',
  'newsletter history reconciliation command conflict',
  'the same command cannot be replayed with different evidence'
);
reset role;

select is(
  (select count(*)::integer from public.builder_newsletter_provider_history_reconciliations
   where site_id = '40000000-0000-4000-8000-000000000001'),
  8,
  'the immutable ledger contains only the approved eight new mappings'
);
select is(
  (select count(*)::integer from public.builder_newsletter_provider_history_reconciliations
   where site_id = '40000000-0000-4000-8000-000000000001'
     and classification = 'unattributed_failed_setup_test'),
  1,
  'the failed setup artifact remains explicitly unattributed'
);

set local role service_role;
select throws_ok(
  $$ update public.builder_newsletter_provider_history_reconciliations
     set provider_status = 'failed'
     where site_id = '40000000-0000-4000-8000-000000000001' $$,
  '42501',
  'permission denied for table builder_newsletter_provider_history_reconciliations',
  'service operations cannot rewrite reconciliation evidence'
);
select throws_ok(
  $$ delete from public.builder_newsletter_provider_history_reconciliations
     where site_id = '40000000-0000-4000-8000-000000000001' $$,
  '42501',
  'permission denied for table builder_newsletter_provider_history_reconciliations',
  'service operations cannot delete reconciliation evidence'
);
reset role;

select * from finish();
rollback;
