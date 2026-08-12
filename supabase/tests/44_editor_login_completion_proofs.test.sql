begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
create temporary table pg_temp.tap_results (line text not null);
grant insert on pg_temp.tap_results to service_role;

insert into pg_temp.tap_results select has_table(
  'public',
  'builder_editor_login_completion_proofs',
  'editor login completion proofs exist'
);
insert into pg_temp.tap_results select is(
  (select relrowsecurity from pg_class where oid = 'public.builder_editor_login_completion_proofs'::regclass),
  true,
  'editor login completion proofs enforce RLS'
);
insert into pg_temp.tap_results select ok(
  not has_table_privilege('anon', 'public.builder_editor_login_completion_proofs', 'SELECT')
  and not has_table_privilege('authenticated', 'public.builder_editor_login_completion_proofs', 'SELECT'),
  'browser roles cannot read editor login completion proofs'
);
insert into pg_temp.tap_results select ok(
  not has_function_privilege('anon', 'public.builder_issue_editor_login_completion_proof_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.builder_issue_editor_login_completion_proof_v1(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.builder_issue_editor_login_completion_proof_v1(jsonb)', 'EXECUTE'),
  'only the service role can issue editor login completion proofs'
);
insert into pg_temp.tap_results select ok(
  not has_function_privilege('anon', 'public.builder_consume_editor_login_completion_proof_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.builder_consume_editor_login_completion_proof_v1(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.builder_consume_editor_login_completion_proof_v1(jsonb)', 'EXECUTE'),
  'only the service role can consume editor login completion proofs'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '44100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'editor-login-proof@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
);
insert into public.builder_sites (id, site_key, display_name)
values (
  '44000000-0000-4000-8000-000000000001',
  'editor-login-proof-test',
  'Editor Login Proof Test'
);
insert into public.builder_site_members (site_id, user_id, role)
values (
  '44000000-0000-4000-8000-000000000001',
  '44100000-0000-4000-8000-000000000001',
  'owner'
);

create temporary table pg_temp.proof_results (
  test_case text primary key,
  response jsonb not null
);
grant select, insert on pg_temp.proof_results to service_role;

set local role service_role;
insert into pg_temp.proof_results values (
  'issue',
  public.builder_issue_editor_login_completion_proof_v1(jsonb_build_object(
    'version', 1,
    'siteKey', 'editor-login-proof-test',
    'userId', '44100000-0000-4000-8000-000000000001',
    'sessionGeneration', 1,
    'proofDigest', repeat('a', 64),
    'expiresAt', clock_timestamp() + interval '4 minutes'
  ))
);
insert into pg_temp.proof_results values (
  'consume',
  public.builder_consume_editor_login_completion_proof_v1(jsonb_build_object(
    'version', 1,
    'siteKey', 'editor-login-proof-test',
    'userId', '44100000-0000-4000-8000-000000000001',
    'sessionGeneration', 1,
    'proofDigest', repeat('a', 64)
  ))
);
insert into pg_temp.proof_results values (
  'replay',
  public.builder_consume_editor_login_completion_proof_v1(jsonb_build_object(
    'version', 1,
    'siteKey', 'editor-login-proof-test',
    'userId', '44100000-0000-4000-8000-000000000001',
    'sessionGeneration', 1,
    'proofDigest', repeat('a', 64)
  ))
);
insert into pg_temp.proof_results values (
  'issue-before-revocation',
  public.builder_issue_editor_login_completion_proof_v1(jsonb_build_object(
    'version', 1,
    'siteKey', 'editor-login-proof-test',
    'userId', '44100000-0000-4000-8000-000000000001',
    'sessionGeneration', 1,
    'proofDigest', repeat('b', 64),
    'expiresAt', clock_timestamp() + interval '4 minutes'
  ))
);
reset role;

update public.builder_site_members
set session_generation = 2
where site_id = '44000000-0000-4000-8000-000000000001'
  and user_id = '44100000-0000-4000-8000-000000000001';

set local role service_role;
insert into pg_temp.proof_results values (
  'revoked',
  public.builder_consume_editor_login_completion_proof_v1(jsonb_build_object(
    'version', 1,
    'siteKey', 'editor-login-proof-test',
    'userId', '44100000-0000-4000-8000-000000000001',
    'sessionGeneration', 1,
    'proofDigest', repeat('b', 64)
  ))
);
insert into pg_temp.proof_results values (
  'unknown',
  public.builder_consume_editor_login_completion_proof_v1(jsonb_build_object(
    'version', 1,
    'siteKey', 'editor-login-proof-test',
    'userId', '44100000-0000-4000-8000-000000000001',
    'sessionGeneration', 2,
    'proofDigest', repeat('c', 64)
  ))
);
reset role;

insert into pg_temp.tap_results select is(
  (select response ->> 'status' from pg_temp.proof_results where test_case = 'issue'),
  'issued',
  'a current member can receive an editor login completion proof'
);
insert into pg_temp.tap_results select is(
  (select response ->> 'status' from pg_temp.proof_results where test_case = 'consume'),
  'consumed',
  'a current proof is consumed once'
);
insert into pg_temp.tap_results select is(
  (select response ->> 'status' from pg_temp.proof_results where test_case = 'replay'),
  'rejected',
  'a consumed proof cannot be replayed'
);
insert into pg_temp.tap_results select ok(
  (select consumed_at is not null
   from public.builder_editor_login_completion_proofs
   where proof_digest = repeat('a', 64)),
  'successful consumption leaves durable audit evidence'
);
insert into pg_temp.tap_results select is(
  (select response ->> 'status' from pg_temp.proof_results where test_case = 'revoked'),
  'rejected',
  'a session-generation change revokes an outstanding proof'
);
insert into pg_temp.tap_results select is(
  (select response ->> 'status' from pg_temp.proof_results where test_case = 'unknown'),
  'rejected',
  'an unknown digest is rejected'
);

select line from pg_temp.tap_results;
select * from finish();
rollback;
