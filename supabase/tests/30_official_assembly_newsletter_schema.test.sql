begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'builder_newsletter_subscriptions', 'newsletter subscriptions exist');
select has_table('public', 'builder_newsletter_confirmation_generations', 'confirmation generations exist');
select has_table('builder_private', 'builder_newsletter_delivery_ledger', 'private delivery ledger exists');
select has_table('builder_private', 'builder_newsletter_confirmation_sessions', 'private confirmation sessions exist');
select has_table('public', 'builder_newsletter_jobs', 'subscription jobs exist');
select has_table('public', 'builder_newsletter_site_jobs', 'site maintenance jobs exist');
select has_table('public', 'builder_newsletter_broadcast_audit_jobs', 'broadcast audit jobs exist');
select has_table('public', 'builder_newsletter_readiness_revisions', 'audience readiness revisions exist');
select has_table('public', 'builder_newsletter_webhook_receipts', 'verified webhook receipts exist');
select has_table('public', 'builder_newsletter_staff_test_windows', 'staff test windows exist');
select has_table('public', 'builder_newsletter_staff_test_observations', 'staff test observations exist');
select has_table('public', 'builder_newsletter_broadcast_validations', 'broadcast validations exist');
select has_table('public', 'builder_newsletter_broadcast_incidents', 'broadcast incidents exist');

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where (namespace.nspname, relation.relname) in (
      ('public', 'builder_newsletter_subscriptions'),
      ('public', 'builder_newsletter_confirmation_generations'),
      ('builder_private', 'builder_newsletter_delivery_ledger'),
      ('builder_private', 'builder_newsletter_confirmation_sessions'),
      ('public', 'builder_newsletter_jobs'),
      ('public', 'builder_newsletter_site_jobs'),
      ('public', 'builder_newsletter_broadcast_audit_jobs'),
      ('public', 'builder_newsletter_readiness_revisions'),
      ('public', 'builder_newsletter_webhook_receipts'),
      ('public', 'builder_newsletter_staff_test_windows'),
      ('public', 'builder_newsletter_staff_test_observations'),
      ('public', 'builder_newsletter_broadcast_validations'),
      ('public', 'builder_newsletter_broadcast_incidents')
    )
      and not relation.relrowsecurity
  ),
  'every newsletter table has row-level security enabled'
);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    cross join (values ('anon'), ('authenticated')) as browser(role_name)
    where (namespace.nspname, relation.relname) in (
      ('public', 'builder_newsletter_subscriptions'),
      ('public', 'builder_newsletter_confirmation_generations'),
      ('builder_private', 'builder_newsletter_delivery_ledger'),
      ('builder_private', 'builder_newsletter_confirmation_sessions'),
      ('public', 'builder_newsletter_jobs'),
      ('public', 'builder_newsletter_site_jobs'),
      ('public', 'builder_newsletter_broadcast_audit_jobs'),
      ('public', 'builder_newsletter_readiness_revisions'),
      ('public', 'builder_newsletter_webhook_receipts'),
      ('public', 'builder_newsletter_staff_test_windows'),
      ('public', 'builder_newsletter_staff_test_observations'),
      ('public', 'builder_newsletter_broadcast_validations'),
      ('public', 'builder_newsletter_broadcast_incidents')
    )
      and has_table_privilege(
        browser.role_name,
        format('%I.%I', namespace.nspname, relation.relname),
        'select,insert,update,delete'
      )
  ),
  'browser roles have no direct newsletter-table privileges'
);

select has_function('public', 'builder_ingest_official_assembly_newsletter_v1', array['jsonb'], 'newsletter ingestion RPC exists');
select has_function('public', 'builder_exchange_newsletter_confirmation_session_v1', array['jsonb'], 'confirmation-session exchange RPC exists');
select has_function('public', 'builder_confirm_newsletter_subscription_v1', array['jsonb'], 'single-use confirmation RPC exists');
select has_function('public', 'builder_claim_newsletter_jobs_v1', array['jsonb'], 'job claim RPC exists');
select has_function('public', 'builder_complete_newsletter_job_v1', array['jsonb'], 'job completion RPC exists');
select has_function('public', 'builder_fail_newsletter_job_v1', array['jsonb'], 'job retry/terminal RPC exists');
select has_function('public', 'builder_reconcile_newsletter_webhook_v1', array['jsonb'], 'verified webhook RPC exists');
select has_function('public', 'builder_open_newsletter_staff_test_window_v1', array['jsonb'], 'staff-test window RPC exists');
select has_function('public', 'builder_record_newsletter_staff_test_observation_v1', array['jsonb'], 'staff-test observation RPC exists');
select has_function('public', 'builder_create_newsletter_broadcast_validation_v1', array['jsonb'], 'broadcast validation RPC exists');
select has_function('public', 'builder_classify_newsletter_broadcast_v1', array['jsonb'], 'broadcast classification RPC exists');
select has_function('public', 'builder_record_newsletter_broadcast_audit_page_v1', array['jsonb'], 'paginated Broadcast audit checkpoint RPC exists');
select has_function('public', 'builder_resolve_newsletter_broadcast_incident_v1', array['jsonb'], 'two-operator recovery RPC exists');
select has_function('public', 'builder_get_newsletter_public_readiness_v1', array['uuid'], 'public readiness projection exists');
select has_function('public', 'builder_get_newsletter_operations_status_v1', array['jsonb'], 'staff operations projection exists');

select ok(
  not exists (
    select 1
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname like 'builder_%newsletter%_v1'
      and (
        has_function_privilege('anon', routine.oid, 'execute')
        or has_function_privilege('authenticated', routine.oid, 'execute')
      )
  ),
  'browser roles cannot execute newsletter RPCs'
);

select ok(
  not exists (
    select 1
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname like 'builder_%newsletter%_v1'
      and coalesce(array_to_string(routine.proconfig, ','), '') <> 'search_path=""'
  ),
  'every newsletter RPC has an empty search path'
);

select * from finish();
rollback;
