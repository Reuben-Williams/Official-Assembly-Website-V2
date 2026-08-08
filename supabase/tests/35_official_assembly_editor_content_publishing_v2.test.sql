begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '25100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'content-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '25100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'other-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.builder_sites (id, site_key, display_name) values
  ('25000000-0000-4000-8000-000000000001', 'content-v2-first', 'Content V2 First'),
  ('25000000-0000-4000-8000-000000000002', 'content-v2-second', 'Content V2 Second'),
  ('25000000-0000-4000-8000-000000000003', 'official-assembly-website-v2', 'Official Assembly Website V2');

select is(
  public.builder_register_official_assembly_routes_v1(),
  11,
  'the client attachment registers all configured Official Assembly routes'
);
select is(
  (select count(*)::integer from public.builder_site_routes
   where site_id = '25000000-0000-4000-8000-000000000003'),
  11,
  'the route registry has no missing or extra Official Assembly paths'
);
insert into public.builder_site_members (site_id, user_id, role) values
  ('25000000-0000-4000-8000-000000000001', '25100000-0000-4000-8000-000000000001', 'owner'),
  ('25000000-0000-4000-8000-000000000002', '25100000-0000-4000-8000-000000000002', 'owner');
insert into public.builder_site_routes (site_id, path, label) values
  ('25000000-0000-4000-8000-000000000001', '/', 'Home'),
  ('25000000-0000-4000-8000-000000000001', '/about', 'About'),
  ('25000000-0000-4000-8000-000000000002', '/', 'Home');

insert into public.builder_versions (id, site_id, page_path, status, snapshot, user_id) values
  ('25200000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001', '/__builder/global', 'draft', '{"path":"/__builder/global","regions":{"global.brand":{"type":"text","value":"Draft brand"}}}', '25100000-0000-4000-8000-000000000001'),
  ('25200000-0000-4000-8000-000000000002', '25000000-0000-4000-8000-000000000001', '/__builder/global', 'published', '{"path":"/__builder/global","regions":{"global.brand":{"type":"text","value":"Published brand"}}}', '25100000-0000-4000-8000-000000000001'),
  ('25200000-0000-4000-8000-000000000003', '25000000-0000-4000-8000-000000000001', '/', 'draft', '{"path":"/","regions":{"home.title":{"type":"text","value":"Draft home"}}}', '25100000-0000-4000-8000-000000000001'),
  ('25200000-0000-4000-8000-000000000004', '25000000-0000-4000-8000-000000000001', '/', 'published', '{"path":"/","regions":{"home.title":{"type":"text","value":"Published home"}}}', '25100000-0000-4000-8000-000000000001'),
  ('25200000-0000-4000-8000-000000000005', '25000000-0000-4000-8000-000000000001', '/about', 'draft', '{"path":"/about","regions":{"about.title":{"type":"text","value":"Draft about"}}}', '25100000-0000-4000-8000-000000000001'),
  ('25200000-0000-4000-8000-000000000006', '25000000-0000-4000-8000-000000000001', '/about', 'published', '{"path":"/about","regions":{"about.title":{"type":"text","value":"Published about"}}}', '25100000-0000-4000-8000-000000000001');

insert into public.builder_draft_pages (site_id, path, regions, version_id)
select site_id, page_path, snapshot -> 'regions', id
from public.builder_versions where status = 'draft';
insert into public.builder_published_pages (site_id, path, regions, version_id)
select site_id, page_path, snapshot -> 'regions', id
from public.builder_versions where status = 'published';

create function pg_temp.page_publish_command(
  p_command_id uuid,
  p_key text,
  p_digest text,
  p_expected_draft uuid,
  p_expected_published uuid,
  p_title text
)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'schemaVersion', 2,
    'siteId', 'content-v2-first',
    'commandId', p_command_id,
    'idempotencyKey', p_key,
    'payloadDigest', p_digest,
    'actorId', '25100000-0000-4000-8000-000000000001',
    'operation', 'publish',
    'scopes', jsonb_build_array(jsonb_build_object(
      'scope', jsonb_build_object('kind', 'page', 'path', '/'),
      'expectedDraftVersionId', p_expected_draft,
      'expectedPublishedVersionId', p_expected_published,
      'values', jsonb_build_object('home.title', jsonb_build_object('type', 'text', 'value', p_title))
    ))
  );
$$;

select set_config('request.jwt.claims', '{"sub":"25100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","email":"content-owner@example.test"}', true);
set local role authenticated;

select lives_ok(
  $$ select public.builder_execute_content_command_v2(
    'content-v2-first',
    pg_temp.page_publish_command(
      '25300000-0000-4000-8000-000000000001', 'publish:first', repeat('a', 64),
      '25200000-0000-4000-8000-000000000003', '25200000-0000-4000-8000-000000000004', 'Current home'
    )
  ) $$,
  'a page publish commits one immutable result and complete generation'
);

select lives_ok(
  $$ select public.builder_execute_content_command_v2(
    'content-v2-first',
    pg_temp.page_publish_command(
      '25300000-0000-4000-8000-000000000001', 'publish:first', repeat('a', 64),
      '25200000-0000-4000-8000-000000000003', '25200000-0000-4000-8000-000000000004', 'Current home'
    )
  ) $$,
  'same idempotency key and digest replays the completed response'
);

select throws_ok(
  $$ select public.builder_execute_content_command_v2(
    'content-v2-first',
    pg_temp.page_publish_command(
      '25300000-0000-4000-8000-000000000002', 'publish:first', repeat('b', 64),
      '25200000-0000-4000-8000-000000000003', '25200000-0000-4000-8000-000000000004', 'Conflicting home'
    )
  ) $$,
  '23505', 'IDEMPOTENCY_CONFLICT',
  'same idempotency key with a different digest conflicts'
);

select throws_ok(
  $$ select public.builder_execute_content_command_v2(
    'content-v2-first',
    pg_temp.page_publish_command(
      '25300000-0000-4000-8000-000000000003', 'publish:stale', repeat('c', 64),
      '25200000-0000-4000-8000-000000000003', '25200000-0000-4000-8000-000000000004', 'Stale home'
    )
  ) $$,
  '40001', 'STALE_REVISION',
  'a stale published identifier rejects the whole command'
);
reset role;

select is((select count(*) from public.builder_content_command_receipts where site_id = '25000000-0000-4000-8000-000000000001'), 1::bigint, 'replay and conflicts create no duplicate receipt');
select is((select count(*) from public.builder_versions where command_id = '25300000-0000-4000-8000-000000000001'), 1::bigint, 'replay creates no duplicate version');
select is((select count(*) from public.builder_site_generations where site_id = '25000000-0000-4000-8000-000000000001'), 1::bigint, 'the publish creates one site generation');
select is((select count(*) from public.builder_content_recovery_jobs where site_id = '25000000-0000-4000-8000-000000000001'), 1::bigint, 'the publish appends one recovery job');
select is((select count(*) from public.builder_history_events_v1 where site_id = '25000000-0000-4000-8000-000000000001'), 1::bigint, 'the publish appends one normalized history event');
select is((select page_versions ->> '/about' from public.builder_site_generations where site_id = '25000000-0000-4000-8000-000000000001' and generation_id = 1), '25200000-0000-4000-8000-000000000006', 'the generation binds an unchanged configured page');

select set_config('request.jwt.claims', '{"sub":"25100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","email":"content-owner@example.test"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.builder_execute_content_command_v2(
    'content-v2-first',
    jsonb_build_object(
      'schemaVersion', 2,
      'siteId', 'content-v2-first',
      'commandId', '25300000-0000-4000-8000-000000000004',
      'idempotencyKey', 'publish:composite',
      'payloadDigest', repeat('d', 64),
      'actorId', '25100000-0000-4000-8000-000000000001',
      'operation', 'publish',
      'scopes', jsonb_build_array(
        jsonb_build_object(
          'scope', jsonb_build_object('kind', 'global', 'path', '/__builder/global'),
          'expectedDraftVersionId', '25200000-0000-4000-8000-000000000001',
          'expectedPublishedVersionId', '25200000-0000-4000-8000-000000000002',
          'values', jsonb_build_object('global.brand', jsonb_build_object('type', 'text', 'value', 'Current brand'))
        ),
        jsonb_build_object(
          'scope', jsonb_build_object('kind', 'page', 'path', '/about'),
          'expectedDraftVersionId', '25200000-0000-4000-8000-000000000005',
          'expectedPublishedVersionId', '25200000-0000-4000-8000-000000000006',
          'values', jsonb_build_object('about.title', jsonb_build_object('type', 'text', 'value', 'Current about'))
        )
      )
    )
  ) $$,
  'global and page scopes publish atomically in one command'
);
reset role;

select is((select count(*) from public.builder_versions where command_id = '25300000-0000-4000-8000-000000000004'), 2::bigint, 'composite publish creates both immutable scope versions');
select is((select count(*) from public.builder_history_events_v1 where source_event_id like '25300000-0000-4000-8000-000000000004:%'), 2::bigint, 'composite publish records both scope events');
select is((select global_version_id::text from public.builder_site_generations where site_id = '25000000-0000-4000-8000-000000000001' and generation_id = 2), (select version_id::text from public.builder_published_pages where site_id = '25000000-0000-4000-8000-000000000001' and path = '/__builder/global'), 'generation two binds the atomic global version');

create temporary table pg_temp.before_failed_command as
select
  (select count(*) from public.builder_versions) as versions,
  (select count(*) from public.builder_history_events_v1) as history,
  (select count(*) from public.builder_content_command_receipts) as receipts;

select set_config('request.jwt.claims', '{"sub":"25100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","email":"content-owner@example.test"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.builder_execute_content_command_v2(
    'content-v2-first',
    jsonb_build_object(
      'schemaVersion', 2, 'siteId', 'content-v2-first', 'commandId', '25300000-0000-4000-8000-000000000005',
      'idempotencyKey', 'publish:atomic-failure', 'payloadDigest', repeat('e', 64),
      'actorId', '25100000-0000-4000-8000-000000000001', 'operation', 'publish',
      'scopes', jsonb_build_array(
        jsonb_build_object(
          'scope', jsonb_build_object('kind', 'global', 'path', '/__builder/global'),
          'expectedDraftVersionId', '25200000-0000-4000-8000-000000000001',
          'expectedPublishedVersionId', (select (response #>> '{scopes,0,resultVersionId}')::uuid from public.builder_content_command_receipts where site_id = '25000000-0000-4000-8000-000000000001' and idempotency_key = 'publish:composite'),
          'values', jsonb_build_object('global.brand', jsonb_build_object('type', 'text', 'value', 'Must roll back'))
        ),
        jsonb_build_object(
          'scope', jsonb_build_object('kind', 'page', 'path', '/about'),
          'expectedDraftVersionId', '25200000-0000-4000-8000-000000000005',
          'expectedPublishedVersionId', '25200000-0000-4000-8000-000000000006',
          'values', jsonb_build_object('about.title', jsonb_build_object('type', 'text', 'value', 'Stale'))
        )
      )
    )
  ) $$,
  '40001', 'STALE_REVISION',
  'a later stale scope rolls the earlier scope work back'
);
reset role;

select is((select count(*) from public.builder_versions), (select versions from pg_temp.before_failed_command), 'failed composite command rolls back versions');
select is((select count(*) from public.builder_history_events_v1), (select history from pg_temp.before_failed_command), 'failed composite command rolls back history');
select is((select count(*) from public.builder_content_command_receipts), (select receipts from pg_temp.before_failed_command), 'failed composite command leaves no receipt');

select set_config('request.jwt.claims', '{"sub":"25100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","email":"content-owner@example.test"}', true);
set local role authenticated;
select lives_ok(
  $$ select public.builder_execute_content_command_v2(
    'content-v2-first',
    jsonb_build_object(
      'schemaVersion', 2, 'siteId', 'content-v2-first', 'commandId', '25300000-0000-4000-8000-000000000006',
      'idempotencyKey', 'restore:about', 'payloadDigest', repeat('f', 64),
      'actorId', '25100000-0000-4000-8000-000000000001', 'operation', 'restore',
      'scopes', jsonb_build_array(jsonb_build_object(
        'scope', jsonb_build_object('kind', 'page', 'path', '/about'),
        'expectedDraftVersionId', '25200000-0000-4000-8000-000000000005',
        'expectedPublishedVersionId', (select (response #>> '{scopes,1,resultVersionId}')::uuid from public.builder_content_command_receipts where site_id = '25000000-0000-4000-8000-000000000001' and idempotency_key = 'publish:composite'),
        'sourceVersionId', '25200000-0000-4000-8000-000000000006'
      ))
    )
  ) $$,
  'restore creates a new immutable child instead of rewinding a pointer'
);
reset role;

select isnt((select version_id::text from public.builder_published_pages where site_id = '25000000-0000-4000-8000-000000000001' and path = '/about'), '25200000-0000-4000-8000-000000000006', 'restore result has a fresh version identity');
select is((select source_version_id::text from public.builder_versions where command_id = '25300000-0000-4000-8000-000000000006'), '25200000-0000-4000-8000-000000000006', 'restore retains its immutable source version provenance');

select set_config('request.jwt.claims', '{"sub":"25100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.builder_history_events_v1), 4::bigint, 'site one owner sees only its four normalized website events');
select is((select count(*) from public.builder_history_events_v1 where site_id = '25000000-0000-4000-8000-000000000002'), 0::bigint, 'site one owner cannot read site two history');
reset role;

set local role service_role;
create temporary table pg_temp.claimed_job as
select * from public.builder_claim_content_recovery_job_v1('worker-a', 60) limit 1;
select is((select status from pg_temp.claimed_job), 'claimed', 'recovery worker claims one due generation');
select is(public.builder_complete_content_recovery_job_v1(
  (select site_id from pg_temp.claimed_job), (select generation_id from pg_temp.claimed_job),
  'worker-a', (select fence_token + 1 from pg_temp.claimed_job)
), false, 'a stale recovery fence cannot complete the job');
select is(public.builder_complete_content_recovery_job_v1(
  (select site_id from pg_temp.claimed_job), (select generation_id from pg_temp.claimed_job),
  'worker-a', (select fence_token from pg_temp.claimed_job)
), true, 'the current recovery fence completes the job');
reset role;

select throws_ok(
  $$ insert into public.builder_media_recovery_replicas (
    site_id, media_id, revision_id, status
  ) values (
    '25000000-0000-4000-8000-000000000001',
    '25400000-0000-4000-8000-000000000001',
    '25500000-0000-4000-8000-000000000001',
    'ready'
  ) $$,
  '23514',
  null,
  'an unknown managed media revision cannot be marked recovery ready'
);

select is((select count(*) from public.builder_outbox where site_id = '25000000-0000-4000-8000-000000000001' and lower(topic) ~ '(email|sms|ai)'), 0::bigint, 'content publishing queues no email, SMS, or AI provider work');

select * from finish();
rollback;
