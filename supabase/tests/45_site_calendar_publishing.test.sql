begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'builder_calendar_events', 'calendar event entities exist');
select has_table('public', 'builder_calendar_event_revisions', 'immutable calendar revisions exist');
select has_table('public', 'builder_calendar_command_receipts', 'calendar idempotency receipts exist');
select has_column('public', 'builder_history_events_v1', 'calendar_event_id', 'history identifies a calendar event');
select has_column('public', 'builder_history_events_v1', 'calendar_parent_revision_id', 'history can identify the prior calendar revision');
select has_column('public', 'builder_history_events_v1', 'calendar_result_revision_id', 'history can identify the resulting calendar revision');

select is((select relrowsecurity from pg_class where oid = 'public.builder_calendar_events'::regclass), true, 'calendar entities enforce RLS');
select is((select relrowsecurity from pg_class where oid = 'public.builder_calendar_event_revisions'::regclass), true, 'calendar revisions enforce RLS');
select is((select relrowsecurity from pg_class where oid = 'public.builder_calendar_command_receipts'::regclass), true, 'calendar receipts enforce RLS');

select is(has_table_privilege('anon', 'public.builder_calendar_events', 'select'), false, 'anonymous callers cannot read calendar management records');
select is(has_table_privilege('authenticated', 'public.builder_calendar_events', 'insert'), false, 'browser callers cannot create calendar entities directly');
select is(has_table_privilege('authenticated', 'public.builder_calendar_events', 'update'), false, 'browser callers cannot mutate calendar entities directly');
select is(has_table_privilege('authenticated', 'public.builder_calendar_event_revisions', 'insert'), false, 'browser callers cannot forge calendar revisions');
select is(has_table_privilege('authenticated', 'public.builder_calendar_command_receipts', 'insert'), false, 'browser callers cannot forge calendar receipts');
select is(has_function_privilege('authenticated', 'public.builder_calendar_command_v1(uuid,uuid,text,uuid,bigint,text,jsonb)', 'execute'), false, 'browser callers cannot execute calendar commands directly');
select is(has_function_privilege('anon', 'public.builder_calendar_public_v1(text,timestamp with time zone,integer)', 'execute'), false, 'anonymous callers cannot invoke the server calendar projection');
select is(has_function_privilege('authenticated', 'public.builder_calendar_list_v1(uuid)', 'execute'), false, 'browser callers cannot invoke the server management projection');
select is(has_function_privilege('service_role', 'public.builder_calendar_command_v1(uuid,uuid,text,uuid,bigint,text,jsonb)', 'execute'), true, 'the server role can execute calendar commands');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '27100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'calendar-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '27100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'calendar-editor@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '27100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'calendar-contributor@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '27100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'calendar-viewer@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '27100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'calendar-other-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.builder_sites (id, site_key, display_name) values
  ('27000000-0000-4000-8000-000000000001', 'calendar-first', 'Calendar First'),
  ('27000000-0000-4000-8000-000000000002', 'calendar-second', 'Calendar Second');
insert into public.builder_site_members (site_id, user_id, role) values
  ('27000000-0000-4000-8000-000000000001', '27100000-0000-4000-8000-000000000001', 'owner'),
  ('27000000-0000-4000-8000-000000000001', '27100000-0000-4000-8000-000000000002', 'editor'),
  ('27000000-0000-4000-8000-000000000001', '27100000-0000-4000-8000-000000000003', 'contributor'),
  ('27000000-0000-4000-8000-000000000001', '27100000-0000-4000-8000-000000000004', 'viewer'),
  ('27000000-0000-4000-8000-000000000002', '27100000-0000-4000-8000-000000000005', 'owner');

create function pg_temp.calendar_draft(
  p_title text,
  p_start timestamptz,
  p_end timestamptz default null,
  p_url text default null
)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'titleEn', p_title,
    'titleEs', 'Evento de ' || p_title,
    'descriptionEn', 'Public event information for District 34 residents.',
    'descriptionEs', 'Información pública del evento para residentes del Distrito 34.',
    'startAt', p_start,
    'endAt', p_end,
    'displayTimeZone', 'America/New_York',
    'locationName', 'Belleville Town Hall',
    'locationAddress', '152 Washington Avenue, Belleville, NJ',
    'actionUrl', p_url,
    'actionLabelEn', case when p_url is null then '' else 'Event information' end,
    'actionLabelEs', case when p_url is null then '' else 'Información del evento' end,
    'mediaAssetId', null,
    'publicApproved', true,
    'hostedByOffice', true
  );
$$;

set local role service_role;

create temporary table pg_temp.created as
select public.builder_calendar_command_v1(
  '27000000-0000-4000-8000-000000000001',
  '27100000-0000-4000-8000-000000000003',
  'create_draft', null, 0, 'calendar:create:community-day',
  pg_temp.calendar_draft('Community Day', '2026-10-04T14:00:00Z')
) as response;

select is((select (response #>> '{event,entity,commandVersion}')::integer from pg_temp.created), 1, 'a contributor creates the first immutable draft revision');
select is((select count(*) from public.builder_calendar_event_revisions where site_id = '27000000-0000-4000-8000-000000000001'), 1::bigint, 'create draft inserts one revision');
select is((select count(*) from public.builder_history_events_v1 where site_id = '27000000-0000-4000-8000-000000000001' and source = 'calendar' and category = 'events'), 1::bigint, 'create draft appends normalized calendar history');
select is((select count(*) from public.builder_calendar_command_receipts where site_id = '27000000-0000-4000-8000-000000000001'), 1::bigint, 'create draft records one durable command receipt');

select lives_ok(
  $$ select public.builder_calendar_command_v1(
    '27000000-0000-4000-8000-000000000001',
    '27100000-0000-4000-8000-000000000003',
    'create_draft', null, 0, 'calendar:create:community-day',
    pg_temp.calendar_draft('Community Day', '2026-10-04T14:00:00Z')
  ) $$,
  'the same calendar command replays its original response'
);
select is((select count(*) from public.builder_calendar_events where site_id = '27000000-0000-4000-8000-000000000001'), 1::bigint, 'idempotent replay creates no duplicate event');

select throws_ok(
  $$ select public.builder_calendar_command_v1(
    '27000000-0000-4000-8000-000000000001',
    '27100000-0000-4000-8000-000000000004',
    'create_draft', null, 0, 'calendar:viewer:create',
    pg_temp.calendar_draft('Viewer Event', '2026-10-04T15:00:00Z')
  ) $$,
  '42501', 'CALENDAR_ROLE_DENIED',
  'a viewer cannot create a calendar draft'
);
select throws_ok(
  $$ select public.builder_calendar_command_v1(
    '27000000-0000-4000-8000-000000000001',
    '27100000-0000-4000-8000-000000000005',
    'create_draft', null, 0, 'calendar:cross-site:create',
    pg_temp.calendar_draft('Wrong Site Event', '2026-10-04T15:00:00Z')
  ) $$,
  '42501', 'CALENDAR_ROLE_DENIED',
  'an owner from another site cannot cross the calendar boundary'
);
select throws_ok(
  $$ select public.builder_calendar_command_v1(
    '27000000-0000-4000-8000-000000000001',
    '27100000-0000-4000-8000-000000000003',
    'publish', (select (response #>> '{event,entity,id}')::uuid from pg_temp.created), 1,
    'calendar:contributor:publish', null
  ) $$,
  '42501', 'CALENDAR_ROLE_DENIED',
  'a contributor cannot publish an event'
);

create temporary table pg_temp.saved as
select public.builder_calendar_command_v1(
  '27000000-0000-4000-8000-000000000001',
  '27100000-0000-4000-8000-000000000003',
  'save_draft', (select (response #>> '{event,entity,id}')::uuid from pg_temp.created), 1,
  'calendar:save:community-day',
  pg_temp.calendar_draft('Community Day and Resource Fair', '2026-10-04T14:00:00Z')
) as response;

select is((select (response #>> '{event,entity,commandVersion}')::integer from pg_temp.saved), 2, 'saving a draft advances the monotonic command version');
select is((select count(*) from public.builder_calendar_event_revisions where site_id = '27000000-0000-4000-8000-000000000001'), 2::bigint, 'saving appends rather than overwrites a revision');
select throws_ok(
  $$ select public.builder_calendar_command_v1(
    '27000000-0000-4000-8000-000000000001',
    '27100000-0000-4000-8000-000000000003',
    'save_draft', (select (response #>> '{event,entity,id}')::uuid from pg_temp.created), 1,
    'calendar:save:stale', pg_temp.calendar_draft('Stale Edit', '2026-10-04T14:00:00Z')
  ) $$,
  '40001', 'STALE_CALENDAR_VERSION',
  'a stale calendar write fails closed'
);
select is((select count(*) from public.builder_calendar_event_revisions where site_id = '27000000-0000-4000-8000-000000000001'), 2::bigint, 'a stale write rolls back its revision');

create temporary table pg_temp.published as
select public.builder_calendar_command_v1(
  '27000000-0000-4000-8000-000000000001',
  '27100000-0000-4000-8000-000000000002',
  'publish', (select (response #>> '{event,entity,id}')::uuid from pg_temp.saved), 2,
  'calendar:publish:community-day', null
) as response;

select is((select (response #>> '{event,entity,commandVersion}')::integer from pg_temp.published), 3, 'an editor publishes the current approved revision');
select is(
  (public.builder_calendar_public_v1('calendar-first', '2026-10-04T15:00:00Z', 10) #>> '{0,titleEn}'),
  'Community Day and Resource Fair',
  'the public projection returns only the published revision'
);
select is(
  jsonb_array_length(public.builder_calendar_public_v1('calendar-first', '2026-10-05T04:00:00Z', 10)),
  0,
  'an event without an end expires at the end of its America New York event day'
);

select throws_ok(
  $$ select public.builder_calendar_command_v1(
    '27000000-0000-4000-8000-000000000001',
    '27100000-0000-4000-8000-000000000003',
    'create_draft', null, 0, 'calendar:create:unsafe-url',
    pg_temp.calendar_draft('Unsafe Link', '2026-10-04T14:00:00Z', null, 'https://example.com/register')
  ) $$,
  '22023', 'CALENDAR_VALIDATION',
  'calendar drafts reject URLs outside the reviewed allowlist'
);
select is((select count(*) from public.builder_calendar_events where site_id = '27000000-0000-4000-8000-000000000001'), 1::bigint, 'invalid URL validation rolls back event creation');

create temporary table pg_temp.unpublished as
select public.builder_calendar_command_v1(
  '27000000-0000-4000-8000-000000000001',
  '27100000-0000-4000-8000-000000000001',
  'unpublish', (select (response #>> '{event,entity,id}')::uuid from pg_temp.published), 3,
  'calendar:unpublish:community-day', null
) as response;
select is(jsonb_array_length(public.builder_calendar_public_v1('calendar-first', '2026-10-04T15:00:00Z', 10)), 0, 'unpublishing removes the event from the public projection');

create temporary table pg_temp.republished as
select public.builder_calendar_command_v1(
  '27000000-0000-4000-8000-000000000001',
  '27100000-0000-4000-8000-000000000001',
  'publish', (select (response #>> '{event,entity,id}')::uuid from pg_temp.unpublished), 4,
  'calendar:republish:community-day', null
) as response;
create temporary table pg_temp.archived as
select public.builder_calendar_command_v1(
  '27000000-0000-4000-8000-000000000001',
  '27100000-0000-4000-8000-000000000001',
  'archive', (select (response #>> '{event,entity,id}')::uuid from pg_temp.republished), 5,
  'calendar:archive:community-day', null
) as response;
select is((select response #>> '{event,entity,lifecycleState}' from pg_temp.archived), 'archived', 'archive preserves the event while changing its lifecycle');
select is(jsonb_array_length(public.builder_calendar_public_v1('calendar-first', '2026-10-04T15:00:00Z', 10)), 0, 'archiving removes the event from public results');
select throws_ok(
  $$ select public.builder_calendar_command_v1(
    '27000000-0000-4000-8000-000000000001',
    '27100000-0000-4000-8000-000000000003',
    'save_draft', (select (response #>> '{event,entity,id}')::uuid from pg_temp.archived), 6,
    'calendar:save:archived', pg_temp.calendar_draft('Archived Edit', '2026-10-04T14:00:00Z')
  ) $$,
  '22023', 'CALENDAR_VALIDATION',
  'an archived event cannot be edited until restored'
);

create temporary table pg_temp.restored as
select public.builder_calendar_command_v1(
  '27000000-0000-4000-8000-000000000001',
  '27100000-0000-4000-8000-000000000002',
  'restore_to_draft', (select (response #>> '{event,entity,id}')::uuid from pg_temp.archived), 6,
  'calendar:restore:community-day', null
) as response;
select is((select response #>> '{event,entity,lifecycleState}' from pg_temp.restored), 'active', 'an editor restores an archived event to a draft');
select is((select response #>> '{event,entity,publishedRevisionId}' from pg_temp.restored), null, 'restore never republishes an archived event');
select is((select count(*) from public.builder_history_events_v1 where site_id = '27000000-0000-4000-8000-000000000001' and source = 'calendar'), 7::bigint, 'each successful command appends exactly one normalized History event');
select is((public.builder_calendar_list_v1('27000000-0000-4000-8000-000000000001') #>> '{events,0,entity,id}'), (select response #>> '{event,entity,id}' from pg_temp.restored), 'the management projection returns the site event');
select is(jsonb_array_length(public.builder_calendar_list_v1('27000000-0000-4000-8000-000000000002') -> 'events'), 0, 'management projection remains site scoped');

reset role;
select throws_ok(
  $$ update public.builder_calendar_event_revisions
     set title_en = 'Overwritten'
     where site_id = '27000000-0000-4000-8000-000000000001' $$,
  '55000', 'immutable builder record cannot be updated or deleted',
  'calendar revisions are immutable even for the database owner'
);
select throws_ok(
  $$ delete from public.builder_calendar_events
     where site_id = '27000000-0000-4000-8000-000000000001' $$,
  '55000', 'immutable builder record cannot be updated or deleted',
  'calendar entities have no hard-delete path'
);

select * from finish();
rollback;
