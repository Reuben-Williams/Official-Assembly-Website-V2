begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.builder_sites (id, site_key, display_name) values
  ('38000000-0000-4000-8000-000000000001', 'recovery-bootstrap-complete', 'Recovery Bootstrap Complete'),
  ('38000000-0000-4000-8000-000000000002', 'recovery-bootstrap-incomplete', 'Recovery Bootstrap Incomplete');

insert into public.builder_site_routes (site_id, path, label) values
  ('38000000-0000-4000-8000-000000000001', '/', 'Home'),
  ('38000000-0000-4000-8000-000000000001', '/about', 'About'),
  ('38000000-0000-4000-8000-000000000002', '/', 'Home');

insert into public.builder_versions (id, site_id, page_path, status, snapshot, user_id) values
  ('38100000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000001', '/__builder/global', 'published', '{"path":"/__builder/global","regions":{}}', 'bootstrap'),
  ('38100000-0000-4000-8000-000000000002', '38000000-0000-4000-8000-000000000001', '/', 'published', '{"path":"/","regions":{}}', 'bootstrap'),
  ('38100000-0000-4000-8000-000000000003', '38000000-0000-4000-8000-000000000001', '/about', 'published', '{"path":"/about","regions":{}}', 'bootstrap'),
  ('38100000-0000-4000-8000-000000000004', '38000000-0000-4000-8000-000000000002', '/__builder/global', 'published', '{"path":"/__builder/global","regions":{}}', 'bootstrap');

insert into public.builder_published_pages (site_id, path, regions, version_id) values
  ('38000000-0000-4000-8000-000000000001', '/__builder/global', '{}', '38100000-0000-4000-8000-000000000001'),
  ('38000000-0000-4000-8000-000000000001', '/', '{}', '38100000-0000-4000-8000-000000000002'),
  ('38000000-0000-4000-8000-000000000001', '/about', '{}', '38100000-0000-4000-8000-000000000003'),
  ('38000000-0000-4000-8000-000000000002', '/__builder/global', '{}', '38100000-0000-4000-8000-000000000004');

set local role service_role;

select is(
  public.builder_enqueue_initial_content_recovery_generation_v1('recovery-bootstrap-complete'),
  1::bigint,
  'a complete already-published site receives its initial recovery generation'
);
select is(
  (select count(*) from public.builder_site_generations where site_id = '38000000-0000-4000-8000-000000000001'),
  1::bigint,
  'the bootstrap creates exactly one immutable generation'
);
select is(
  (select count(*) from public.builder_content_recovery_jobs where site_id = '38000000-0000-4000-8000-000000000001' and status = 'pending'),
  1::bigint,
  'the initial generation has one due recovery job'
);
select is(
  (select page_versions ->> '/about' from public.builder_site_generations where site_id = '38000000-0000-4000-8000-000000000001'),
  '38100000-0000-4000-8000-000000000003',
  'the generation binds every configured route to its exact published version'
);
select is(
  public.builder_enqueue_initial_content_recovery_generation_v1('recovery-bootstrap-complete'),
  1::bigint,
  'replaying bootstrap returns the existing generation'
);
select is(
  (select count(*) from public.builder_content_recovery_jobs where site_id = '38000000-0000-4000-8000-000000000001'),
  1::bigint,
  'replaying bootstrap never duplicates work'
);
select throws_ok(
  $$ select public.builder_enqueue_initial_content_recovery_generation_v1('recovery-bootstrap-incomplete') $$,
  '23514',
  'INCOMPLETE_INITIAL_RECOVERY_GENERATION',
  'an incomplete configured route set fails closed'
);

reset role;

select ok(not has_function_privilege('anon', 'public.builder_enqueue_initial_content_recovery_generation_v1(text)', 'EXECUTE'), 'anonymous callers cannot bootstrap recovery');
select ok(not has_function_privilege('authenticated', 'public.builder_enqueue_initial_content_recovery_generation_v1(text)', 'EXECUTE'), 'editor sessions cannot bootstrap recovery');
select ok(has_function_privilege('service_role', 'public.builder_enqueue_initial_content_recovery_generation_v1(text)', 'EXECUTE'), 'only the service role can bootstrap recovery');

select * from finish();
rollback;
