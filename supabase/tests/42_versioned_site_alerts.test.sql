begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'builder_alert_collections', 'site alert collections exist');
select has_table('public', 'builder_alert_revisions', 'site alert revisions exist');
select has_table('public', 'builder_alert_command_receipts', 'alert command receipts exist');
select has_table('public', 'builder_alert_recovery_jobs', 'alert recovery jobs exist');

select is((select relrowsecurity from pg_class where oid = 'public.builder_alert_collections'::regclass), true, 'alert collections enforce RLS');
select is((select relrowsecurity from pg_class where oid = 'public.builder_alert_revisions'::regclass), true, 'alert revisions enforce RLS');
select is((select relrowsecurity from pg_class where oid = 'public.builder_alert_command_receipts'::regclass), true, 'alert receipts enforce RLS');
select is((select relrowsecurity from pg_class where oid = 'public.builder_alert_recovery_jobs'::regclass), true, 'alert recovery jobs enforce RLS');

select is(has_table_privilege('anon', 'public.builder_alert_collections', 'select'), false, 'anonymous callers cannot read alert collections');
select is(has_table_privilege('authenticated', 'public.builder_alert_collections', 'select'), false, 'browser callers cannot read alert collections directly');
select is(has_table_privilege('authenticated', 'public.builder_alert_revisions', 'insert'), false, 'browser callers cannot forge alert revisions');
select is(has_table_privilege('authenticated', 'public.builder_alert_command_receipts', 'insert'), false, 'browser callers cannot forge alert receipts');
select is(has_table_privilege('authenticated', 'public.builder_alert_recovery_jobs', 'select'), false, 'browser callers cannot inspect alert recovery jobs');
select is(has_function_privilege('authenticated', 'public.builder_execute_alert_command_v1(text,jsonb)', 'execute'), false, 'browser callers cannot execute alert commands directly');
select is(has_function_privilege('anon', 'public.builder_read_published_alerts_v1(text,timestamptz)', 'execute'), false, 'anonymous callers cannot invoke the server projection RPC');
select is(has_function_privilege('authenticated', 'public.builder_read_alert_collection_v1(text,uuid)', 'execute'), false, 'browser callers cannot invoke the management read RPC');
select is(has_function_privilege('authenticated', 'public.builder_fail_alert_recovery_job_v1(uuid,uuid,text,bigint,text,timestamptz)', 'execute'), false, 'browser callers cannot transition recovery failures');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '26100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'alerts-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '26100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'alerts-editor@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '26100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'alerts-contributor@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '26100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'alerts-viewer@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-8000-000000000000', '26100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'other-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.builder_sites (id, site_key, display_name) values
  ('26000000-0000-4000-8000-000000000001', 'alerts-first', 'Alerts First'),
  ('26000000-0000-4000-8000-000000000002', 'alerts-second', 'Alerts Second');
insert into public.builder_site_members (site_id, user_id, role) values
  ('26000000-0000-4000-8000-000000000001', '26100000-0000-4000-8000-000000000001', 'owner'),
  ('26000000-0000-4000-8000-000000000001', '26100000-0000-4000-8000-000000000002', 'editor'),
  ('26000000-0000-4000-8000-000000000001', '26100000-0000-4000-8000-000000000003', 'contributor'),
  ('26000000-0000-4000-8000-000000000001', '26100000-0000-4000-8000-000000000004', 'viewer'),
  ('26000000-0000-4000-8000-000000000002', '26100000-0000-4000-8000-000000000005', 'owner');

set local role service_role;

create temporary table pg_temp.initial_state as
select public.builder_initialize_alert_collection_v1(
  'alerts-first', '26100000-0000-4000-8000-000000000001'
) as response;

select is((select response ->> 'collectionId' from pg_temp.initial_state), 'alerts', 'initialization creates the canonical site alert collection');
select is((select (response ->> 'lockVersion')::integer from pg_temp.initial_state), 0, 'initial collection starts at lock version zero');
select lives_ok(
  $$ select public.builder_initialize_alert_collection_v1(
    'alerts-first', '26100000-0000-4000-8000-000000000001'
  ) $$,
  'alert collection initialization is idempotent'
);
select throws_ok(
  $$ select public.builder_initialize_alert_collection_v1(
    'alerts-first', '26100000-0000-4000-8000-000000000005'
  ) $$,
  '42501', 'ALERT_COMMAND_DENIED',
  'a member of another site cannot initialize an alert collection'
);
select is(
  (public.builder_read_alert_collection_v1(
    'alerts-first', '26100000-0000-4000-8000-000000000004'
  ) #>> '{items}'),
  '[]',
  'a viewer may read the server-projected alert management collection'
);
select throws_ok(
  $$ select public.builder_read_alert_collection_v1(
    'alerts-first', '26100000-0000-4000-8000-000000000005'
  ) $$,
  '42501', 'ALERT_READ_DENIED',
  'a member of another site cannot cross the management read boundary'
);

create function pg_temp.alert_command(
  p_actor_id uuid,
  p_command_id uuid,
  p_key text,
  p_digest text,
  p_operation text,
  p_expected_lock bigint,
  p_expected_draft uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'siteId', 'alerts-first',
    'collectionId', 'alerts',
    'commandId', p_command_id,
    'idempotencyKey', p_key,
    'payloadDigest', p_digest,
    'actorId', p_actor_id,
    'operation', p_operation,
    'expectedLockVersion', p_expected_lock,
    'expectedDraftRevisionId', p_expected_draft
  ) || p_payload;
$$;

create temporary table pg_temp.create_result as
select public.builder_execute_alert_command_v1(
  'alerts-first',
  pg_temp.alert_command(
    '26100000-0000-4000-8000-000000000003',
    '26300000-0000-4000-8000-000000000001',
    'alerts:create:first', repeat('a', 64), 'create', 0,
    (select (response ->> 'draftRevisionId')::uuid from pg_temp.initial_state),
    jsonb_build_object('item', jsonb_build_object(
      'id', 'office-hours', 'category', 'office',
      'message', 'The district office closes at 4 p.m. today.',
      'link', '/contact', 'lifecycle', 'active', 'enabled', true,
      'startsAt', '2026-08-08T13:00:00.000Z', 'endsAt', '2026-08-08T17:00:00.000Z'
    ))
  )
) as response;

select is((select (response ->> 'lockVersion')::integer from pg_temp.create_result), 1, 'a contributor can append a draft alert revision');
select lives_ok(
  $$ select public.builder_execute_alert_command_v1(
    'alerts-first',
    pg_temp.alert_command(
      '26100000-0000-4000-8000-000000000003',
      '26300000-0000-4000-8000-000000000001',
      'alerts:create:first', repeat('a', 64), 'create', 0,
      (select (response ->> 'draftRevisionId')::uuid from pg_temp.initial_state),
      jsonb_build_object('item', jsonb_build_object(
        'id', 'office-hours', 'category', 'office',
        'message', 'The district office closes at 4 p.m. today.',
        'link', '/contact', 'lifecycle', 'active', 'enabled', true,
        'startsAt', '2026-08-08T13:00:00.000Z', 'endsAt', '2026-08-08T17:00:00.000Z'
      ))
    )
  ) $$,
  'same alert idempotency key and digest replays the original response'
);
select throws_ok(
  $$ select public.builder_execute_alert_command_v1(
    'alerts-first',
    pg_temp.alert_command(
      '26100000-0000-4000-8000-000000000003',
      '26300000-0000-4000-8000-000000000009',
      'alerts:create:first', repeat('b', 64), 'create', 0,
      (select (response ->> 'draftRevisionId')::uuid from pg_temp.initial_state),
      jsonb_build_object('item', jsonb_build_object(
        'id', 'conflict', 'category', 'general', 'message', 'Conflict',
        'lifecycle', 'active', 'enabled', true
      ))
    )
  ) $$,
  '23505', 'IDEMPOTENCY_MISMATCH',
  'same alert idempotency key with a different digest fails closed'
);
select throws_ok(
  $$ select public.builder_execute_alert_command_v1(
    'alerts-first',
    pg_temp.alert_command(
      '26100000-0000-4000-8000-000000000003',
      '26300000-0000-4000-8000-000000000002',
      'alerts:create:stale', repeat('c', 64), 'create', 0,
      (select (response ->> 'draftRevisionId')::uuid from pg_temp.initial_state),
      jsonb_build_object('item', jsonb_build_object(
        'id', 'stale', 'category', 'general', 'message', 'Stale',
        'lifecycle', 'active', 'enabled', true
      ))
    )
  ) $$,
  '40001', 'STALE_REVISION',
  'a stale alert lock and draft revision write nothing'
);
select throws_ok(
  $$ select public.builder_execute_alert_command_v1(
    'alerts-first',
    pg_temp.alert_command(
      '26100000-0000-4000-8000-000000000004',
      '26300000-0000-4000-8000-000000000003',
      'alerts:viewer:denied', repeat('d', 64), 'edit', 1,
      (select (response ->> 'draftRevisionId')::uuid from pg_temp.create_result),
      jsonb_build_object('item', jsonb_build_object(
        'id', 'office-hours', 'category', 'office', 'message', 'Viewer edit',
        'lifecycle', 'active', 'enabled', true
      ))
    )
  ) $$,
  '42501', 'ALERT_COMMAND_DENIED',
  'a viewer cannot mutate alert drafts'
);
select throws_ok(
  $$ select public.builder_execute_alert_command_v1(
    'alerts-first',
    pg_temp.alert_command(
      '26100000-0000-4000-8000-000000000005',
      '26300000-0000-4000-8000-000000000004',
      'alerts:cross-site:denied', repeat('e', 64), 'publish', 1,
      (select (response ->> 'draftRevisionId')::uuid from pg_temp.create_result)
    )
  ) $$,
  '42501', 'ALERT_COMMAND_DENIED',
  'an owner from another site cannot mutate this site'
);

create temporary table pg_temp.publish_result as
select public.builder_execute_alert_command_v1(
  'alerts-first',
  pg_temp.alert_command(
    '26100000-0000-4000-8000-000000000002',
    '26300000-0000-4000-8000-000000000005',
    'alerts:publish:first', repeat('f', 64), 'publish', 1,
    (select (response ->> 'draftRevisionId')::uuid from pg_temp.create_result)
  )
) as response;

select is((select (response ->> 'lockVersion')::integer from pg_temp.publish_result), 2, 'an editor publishes the current immutable draft revision');
select is((select count(*) from public.builder_alert_command_receipts where site_id = '26000000-0000-4000-8000-000000000001'), 2::bigint, 'replays and failures create no duplicate alert receipts');
select is((select count(*) from public.builder_alert_revisions where site_id = '26000000-0000-4000-8000-000000000001'), 2::bigint, 'initialization and draft mutation create two immutable revisions');
select is((select count(*) from public.builder_alert_recovery_jobs where site_id = '26000000-0000-4000-8000-000000000001'), 1::bigint, 'publish transactionally enqueues one alert recovery job');
select is((select count(*) from public.builder_history_events_v1 where site_id = '26000000-0000-4000-8000-000000000001' and source = 'alert'), 2::bigint, 'draft and publish append normalized alert history');
select is((select count(*) from public.builder_audit_log where site_id = '26000000-0000-4000-8000-000000000001' and kind = 'alert'), 2::bigint, 'draft and publish append the existing editor audit boundary');

select is(
  (public.builder_read_published_alerts_v1('alerts-first', '2026-08-08T14:00:00.000Z'::timestamptz) #>> '{activeAlerts,0,id}'),
  'office-hours',
  'server-only public projection returns the active published alert'
);
select is(
  (public.builder_read_published_alerts_v1('alerts-first', '2026-08-08T18:00:00.000Z'::timestamptz) ->> 'nextTransitionAt'),
  null,
  'server-only public projection filters the expired alert and has no future transition'
);

reset role;
select throws_ok(
  $$ update public.builder_alert_revisions
     set items = '[]'::jsonb
     where site_id = '26000000-0000-4000-8000-000000000001' $$,
  '55000', 'immutable builder record cannot be updated or deleted',
  'alert revisions are immutable even for the database owner'
);

set local role service_role;
create temporary table pg_temp.claimed_job as
select public.builder_claim_alert_recovery_job_v1('alerts-worker', 60) as response;
select is((select response ->> 'status' from pg_temp.claimed_job), 'claimed', 'alert recovery worker claims one due published revision');
select is((select response ->> 'siteKey' from pg_temp.claimed_job), 'alerts-first', 'the claimed job binds the public site key');
select is((select response #>> '{revision,items,0,id}' from pg_temp.claimed_job), 'office-hours', 'the claimed job carries the immutable published revision');
select is(
  (public.builder_fail_alert_recovery_job_v1(
    (select (response ->> 'siteId')::uuid from pg_temp.claimed_job),
    (select (response ->> 'revisionId')::uuid from pg_temp.claimed_job),
    'alerts-worker',
    (select (response ->> 'fenceToken')::bigint + 1 from pg_temp.claimed_job),
    'recovery_store_unavailable', now()
  ) ->> 'status'),
  'stale_lease',
  'a stale alert recovery fence cannot schedule a retry'
);
select throws_ok(
  $$ select public.builder_fail_alert_recovery_job_v1(
    (select (response ->> 'siteId')::uuid from pg_temp.claimed_job),
    (select (response ->> 'revisionId')::uuid from pg_temp.claimed_job),
    'alerts-worker',
    (select (response ->> 'fenceToken')::bigint from pg_temp.claimed_job),
    null, now()
  ) $$,
  '22023', 'ALERT_RECOVERY_FAILURE_INVALID',
  'alert recovery failures require a bounded non-null safe code'
);
select is(
  (public.builder_fail_alert_recovery_job_v1(
    (select (response ->> 'siteId')::uuid from pg_temp.claimed_job),
    (select (response ->> 'revisionId')::uuid from pg_temp.claimed_job),
    'alerts-worker',
    (select (response ->> 'fenceToken')::bigint from pg_temp.claimed_job),
    'recovery_store_unavailable', now()
  ) ->> 'status'),
  'retry',
  'the current alert recovery fence records a bounded retry state'
);
create temporary table pg_temp.reclaimed_job as
select public.builder_claim_alert_recovery_job_v1('alerts-worker', 60) as response;
select is((select (response ->> 'attemptCount')::integer from pg_temp.reclaimed_job), 2, 'retry claims remain observable through attempt count');
select throws_ok(
  $$ select public.builder_complete_alert_recovery_job_v1(
    (select (response ->> 'siteId')::uuid from pg_temp.reclaimed_job),
    (select (response ->> 'revisionId')::uuid from pg_temp.reclaimed_job),
    'alerts-worker',
    (select (response ->> 'fenceToken')::bigint + 1 from pg_temp.reclaimed_job),
    'production', 'alerts-first',
    'production/alerts-first/alerts/revisions/wrong.json',
    repeat('1', 64)
  ) $$,
  '22023', 'ALERT_RECOVERY_COMPLETION_INVALID',
  'alert recovery rejects an artifact path outside the exact immutable contract'
);
select is(public.builder_complete_alert_recovery_job_v1(
  (select (response ->> 'siteId')::uuid from pg_temp.reclaimed_job),
  (select (response ->> 'revisionId')::uuid from pg_temp.reclaimed_job),
  'alerts-worker',
  (select (response ->> 'fenceToken')::bigint + 1 from pg_temp.reclaimed_job),
  'production', 'alerts-first',
  'production/alerts-first/alerts/revisions/2-' || repeat('1', 64) || '.json',
  repeat('1', 64)
), false, 'a stale alert recovery fence cannot complete a job');
select is(public.builder_complete_alert_recovery_job_v1(
  (select (response ->> 'siteId')::uuid from pg_temp.reclaimed_job),
  (select (response ->> 'revisionId')::uuid from pg_temp.reclaimed_job),
  'alerts-worker',
  (select (response ->> 'fenceToken')::bigint from pg_temp.reclaimed_job),
  'production', 'alerts-first',
  'production/alerts-first/alerts/revisions/2-' || repeat('1', 64) || '.json',
  repeat('1', 64)
), true, 'the current alert recovery fence records verified artifact evidence');

reset role;

select is((select count(*) from public.builder_outbox where site_id = '26000000-0000-4000-8000-000000000001' and lower(topic) ~ '(email|sms|ai)'), 0::bigint, 'alert publishing queues no email, SMS, or AI provider work');

select * from finish();
rollback;
