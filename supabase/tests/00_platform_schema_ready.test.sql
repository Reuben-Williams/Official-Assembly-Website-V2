begin;

select plan(6);

select has_table('public', 'builder_sites', 'builder_sites baseline exists');
select has_table('public', 'builder_forms', 'managed forms baseline exists');
select has_table('public', 'builder_form_submissions', 'form submissions baseline exists');
select has_function(
  'public',
  'builder_ingest_form_submission_strict_v3',
  array['jsonb'],
  'strict public form ingestion RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.builder_ingest_form_submission_strict_v3(jsonb)',
    'execute'
  ),
  'service_role can execute strict public form ingestion'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.builder_ingest_form_submission_strict_v3(jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.builder_ingest_form_submission_strict_v3(jsonb)',
    'execute'
  ),
  'browser roles cannot execute strict public form ingestion'
);

select * from finish();
rollback;
