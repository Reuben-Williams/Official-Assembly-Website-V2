begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.builder_sites (id, site_key, display_name)
values ('32000000-0000-4000-8000-000000000001', 'newsletter-jobs-test', 'Newsletter Jobs Test');
insert into public.builder_form_submissions (
  site_id, id, form_id, idempotency_key, payload, source, received_at
) values (
  '32000000-0000-4000-8000-000000000001',
  '32100000-0000-4000-8000-000000000001',
  'newsletter-signup',
  'newsletter-jobs-fixture',
  '{"email":"jobs@example.test"}',
  'public_form',
  clock_timestamp()
);
insert into public.builder_form_submission_consents (
  site_id, id, submission_id, policy_version, purpose, language_digest, source, captured_at
) values (
  '32000000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32100000-0000-4000-8000-000000000001',
  'marketing-v1',
  'marketing_email',
  repeat('a', 64),
  'public_form',
  clock_timestamp()
);
insert into public.builder_contacts (site_id, id, display_name, preferred_contact_method)
values (
  '32000000-0000-4000-8000-000000000001',
  '32300000-0000-4000-8000-000000000001',
  'Jobs Reader',
  'email'
);
insert into public.builder_consents (
  site_id, id, contact_id, base_consent_id, purpose, channel, state, captured_at
) values (
  '32000000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  '32300000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  'marketing_email',
  'email',
  'granted',
  clock_timestamp()
);
insert into public.builder_newsletter_subscriptions (
  site_id, id, contact_id, current_consent_id, status, current_generation
) values (
  '32000000-0000-4000-8000-000000000001',
  '32500000-0000-4000-8000-000000000001',
  '32300000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  'pending_confirmation',
  1
);
insert into public.builder_newsletter_confirmation_generations (
  site_id, subscription_id, generation, nonce, signing_key_id, issued_at, expires_at
) values (
  '32000000-0000-4000-8000-000000000001',
  '32500000-0000-4000-8000-000000000001',
  1,
  repeat('n', 48),
  '2026-08',
  clock_timestamp(),
  clock_timestamp() + interval '48 hours'
);

select throws_ok(
  $$ insert into public.builder_newsletter_jobs (
       site_id, subscription_id, kind, idempotency_key
     ) values (
       '32000000-0000-4000-8000-000000000001',
       '32500000-0000-4000-8000-000000000001',
       'newsletter.confirmation.send',
       'invalid-confirmation-shape'
     ) $$,
  '23514',
  null,
  'confirmation jobs require generation and delivery ordinal'
);
select throws_ok(
  $$ insert into public.builder_newsletter_site_jobs (
       site_id, provider_scope_id, kind, subscription_id
     ) values (
       '32000000-0000-4000-8000-000000000001',
       'resend-team-production',
       'newsletter.contact.audit',
       '32500000-0000-4000-8000-000000000001'
     ) $$,
  '23514',
  null,
  'site jobs forbid a subscription subject'
);
select throws_ok(
  $$ insert into public.builder_newsletter_broadcast_audit_jobs (
       site_id, provider_scope_id, kind, validation_id
     ) values (
       '32000000-0000-4000-8000-000000000001',
       'resend-team-production',
       'newsletter.broadcast.audit',
       gen_random_uuid()
     ) $$,
  '23514',
  null,
  'broadcast audit jobs cannot depend on a validation'
);

insert into public.builder_newsletter_jobs (
  site_id, id, subscription_id, kind, confirmation_generation,
  delivery_ordinal, idempotency_key
) values (
  '32000000-0000-4000-8000-000000000001',
  '32600000-0000-4000-8000-000000000001',
  '32500000-0000-4000-8000-000000000001',
  'newsletter.confirmation.send',
  1,
  1,
  'newsletter-confirmation/32000000/32500000/1/1'
);
insert into public.builder_newsletter_site_jobs (
  site_id, id, provider_scope_id, kind
) values
  (
    '32000000-0000-4000-8000-000000000001',
    '32700000-0000-4000-8000-000000000001',
    'resend-team-production',
    'newsletter.contact.audit'
  ),
  (
    '32000000-0000-4000-8000-000000000001',
    '32700000-0000-4000-8000-000000000002',
    'resend-team-production',
    'newsletter.segment.reconcile'
  );
insert into public.builder_newsletter_broadcast_audit_jobs (
  site_id, id, provider_scope_id, kind, activation_cutoff
) values (
  '32000000-0000-4000-8000-000000000001',
  '32800000-0000-4000-8000-000000000001',
  'resend-team-production',
  'newsletter.broadcast.audit',
  clock_timestamp()
);

create temporary table job_results (
  test_case text primary key,
  result jsonb not null
) on commit drop;
grant select, insert on job_results to service_role;

set local role service_role;
insert into job_results values (
  'disabled_claim',
  public.builder_claim_newsletter_jobs_v1(jsonb_build_object(
    'version', 1,
    'siteId', '32000000-0000-4000-8000-000000000001',
    'workerId', '32900000-0000-4000-8000-000000000001',
    'limit', 10,
    'leaseSeconds', 60,
    'emailEnabled', false
  ))
);
reset role;

select is(jsonb_array_length((select result->'jobs' from job_results where test_case = 'disabled_claim')), 2, 'disabled mode claims only read-only Contact and Broadcast audits');
select ok(
  not exists (
    select 1
    from jsonb_array_elements((select result->'jobs' from job_results where test_case = 'disabled_claim')) item
    where item->>'kind' not in ('newsletter.contact.audit', 'newsletter.broadcast.audit')
  ),
  'disabled mode excludes confirmation, Contact mutation, and Segment reconciliation'
);

set local role service_role;
select throws_ok(
  $$ select public.builder_complete_newsletter_job_v1(jsonb_build_object(
    'version', 1,
    'siteId', '32000000-0000-4000-8000-000000000001',
    'subject', 'site',
    'jobId', '32700000-0000-4000-8000-000000000001',
    'workerId', '32900000-0000-4000-8000-000000000001',
    'fencingToken', 999,
    'resultCode', 'ok'
  )) $$,
  '55000',
  'newsletter job lease lost',
  'a stale fencing token cannot complete leased work'
);
insert into job_results values (
  'complete_contact_audit',
  public.builder_complete_newsletter_job_v1(jsonb_build_object(
    'version', 1,
    'siteId', '32000000-0000-4000-8000-000000000001',
    'subject', 'site',
    'jobId', '32700000-0000-4000-8000-000000000001',
    'workerId', '32900000-0000-4000-8000-000000000001',
    'fencingToken', 1,
    'resultCode', 'audit_complete'
  ))
);
insert into job_results values (
  'complete_broadcast_audit',
  public.builder_complete_newsletter_job_v1(jsonb_build_object(
    'version', 1,
    'siteId', '32000000-0000-4000-8000-000000000001',
    'subject', 'broadcast',
    'jobId', '32800000-0000-4000-8000-000000000001',
    'workerId', '32900000-0000-4000-8000-000000000001',
    'fencingToken', 1,
    'resultCode', 'audit_complete'
  ))
);
insert into job_results values (
  'enabled_claim',
  public.builder_claim_newsletter_jobs_v1(jsonb_build_object(
    'version', 1,
    'siteId', '32000000-0000-4000-8000-000000000001',
    'workerId', '32900000-0000-4000-8000-000000000002',
    'limit', 10,
    'leaseSeconds', 60,
    'emailEnabled', true
  ))
);
reset role;

select is(jsonb_array_length((select result->'jobs' from job_results where test_case = 'enabled_claim')), 2, 'enabled mode claims confirmation and Segment reconciliation work');
select is((select state from public.builder_newsletter_site_jobs where id = '32700000-0000-4000-8000-000000000001'), 'completed', 'a correctly fenced Contact audit completes');
select is((select state from public.builder_newsletter_broadcast_audit_jobs where id = '32800000-0000-4000-8000-000000000001'), 'completed', 'a correctly fenced Broadcast audit completes');

set local role service_role;
insert into job_results values (
  'retry_confirmation',
  public.builder_fail_newsletter_job_v1(jsonb_build_object(
    'version', 1,
    'siteId', '32000000-0000-4000-8000-000000000001',
    'subject', 'subscription',
    'jobId', '32600000-0000-4000-8000-000000000001',
    'workerId', '32900000-0000-4000-8000-000000000002',
    'fencingToken', 1,
    'terminal', false,
    'retryAt', clock_timestamp() + interval '2 minutes',
    'failureCode', 'provider_unavailable'
  ))
);
reset role;

select is((select state from public.builder_newsletter_jobs where id = '32600000-0000-4000-8000-000000000001'), 'retryable_failed', 'retryable failure returns a leased job to the durable queue');
select is((select safe_failure_code from public.builder_newsletter_jobs where id = '32600000-0000-4000-8000-000000000001'), 'provider_unavailable', 'only a bounded safe failure code is stored');
select ok((select lease_owner is null and lease_expires_at is null from public.builder_newsletter_jobs where id = '32600000-0000-4000-8000-000000000001'), 'retry clears the previous lease');

select * from finish();
rollback;
