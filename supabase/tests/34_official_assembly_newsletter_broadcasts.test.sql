begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.builder_sites (id, site_key, display_name)
values ('34000000-0000-4000-8000-000000000001', 'newsletter-broadcast-test', 'Newsletter Broadcast Test');

create temporary table broadcast_results (
  test_case text primary key,
  result jsonb not null
) on commit drop;
grant select, insert on broadcast_results to service_role;

insert into public.builder_newsletter_readiness_revisions (
  site_id, id, revision, provider_scope_id, audience_count,
  eligibility_digest, reconciled_at, expires_at, state
) values (
  '34000000-0000-4000-8000-000000000001',
  '34100000-0000-4000-8000-000000000001',
  1,
  'resend-team-production',
  125,
  repeat('c', 64),
  clock_timestamp(),
  clock_timestamp() + interval '30 minutes',
  'ready'
);

set local role service_role;
insert into broadcast_results values (
  'window',
  public.builder_open_newsletter_staff_test_window_v1(jsonb_build_object(
    'version', 1,
    'commandId', '34200000-0000-4000-8000-000000000001',
    'siteId', '34000000-0000-4000-8000-000000000001',
    'operatorId', '34300000-0000-4000-8000-000000000001',
    'providerBroadcastId', 'broadcast-draft-1',
    'digest', repeat('d', 64),
    'allowlistRevision', 'staff-allowlist-v1',
    'recipientFingerprint', repeat('e', 64)
  ))
);
insert into broadcast_results values (
  'provisional',
  public.builder_record_newsletter_staff_test_observation_v1(jsonb_build_object(
    'version', 1,
    'siteId', '34000000-0000-4000-8000-000000000001',
    'windowId', (select (result->>'windowId')::uuid from broadcast_results where test_case = 'window'),
    'providerMessageId', 'staff-test-message-1',
    'providerBroadcastId', 'broadcast-draft-1',
    'digest', repeat('d', 64),
    'recipientFingerprint', repeat('e', 64),
    'providerStatus', 'draft'
  ))
);
reset role;

select is((select result->>'state' from broadcast_results where test_case = 'provisional'), 'provisional_test', 'an allowlisted draft event remains provisional');
select is((select count(*) from public.builder_newsletter_broadcast_validations), 0::bigint, 'a staff test never creates or consumes a production validation');

update public.builder_newsletter_staff_test_observations
set recheck_at = clock_timestamp() - interval '1 second'
where provider_message_id = 'staff-test-message-1';

set local role service_role;
insert into broadcast_results values (
  'confirmed_test',
  public.builder_record_newsletter_staff_test_observation_v1(jsonb_build_object(
    'version', 1,
    'action', 'confirm',
    'siteId', '34000000-0000-4000-8000-000000000001',
    'observationId', (select (result->>'observationId')::uuid from broadcast_results where test_case = 'provisional'),
    'providerMessageId', 'staff-test-message-1',
    'providerBroadcastId', 'broadcast-draft-1',
    'digest', repeat('d', 64),
    'providerStatus', 'draft'
  ))
);
insert into broadcast_results values (
  'validation',
  public.builder_create_newsletter_broadcast_validation_v1(jsonb_build_object(
    'version', 1,
    'commandId', '34400000-0000-4000-8000-000000000001',
    'siteId', '34000000-0000-4000-8000-000000000001',
    'operatorId', '34300000-0000-4000-8000-000000000001',
    'providerBroadcastId', 'broadcast-draft-1',
    'confirmedTestObservationId', (select (result->>'observationId')::uuid from broadcast_results where test_case = 'provisional'),
    'digest', repeat('d', 64),
    'segmentId', 'segment-production',
    'topicId', 'topic-district-newsletter',
    'sender', 'Office of Assemblywoman Carmen Morales <newsletter@updates.assemblywomanmorales.com>',
    'replyToState', 'none',
    'readinessRevisionId', '34100000-0000-4000-8000-000000000001',
    'audienceCount', 125
  ))
);
reset role;

select is((select result->>'state' from broadcast_results where test_case = 'confirmed_test'), 'confirmed_test', 'a fifteen-minute recheck confirms only an unscheduled draft');
select is((select result->>'state' from broadcast_results where test_case = 'validation'), 'valid', 'the exact tested draft receives a short-lived validation');
select ok(
  (
    select valid_until = validated_at + interval '10 minutes'
    from public.builder_newsletter_broadcast_validations
    where id = (select (result->>'validationId')::uuid from broadcast_results where test_case = 'validation')
  ),
  'production validation has a fixed ten-minute window'
);

set local role service_role;
insert into broadcast_results values (
  'matching_send',
  public.builder_reconcile_newsletter_webhook_v1(jsonb_build_object(
    'version', 1,
    'siteId', '34000000-0000-4000-8000-000000000001',
    'providerScopeId', 'resend-team-production',
    'svixId', 'msg_matching_send',
    'eventType', 'email.sent',
    'providerCreatedAt', clock_timestamp(),
    'providerMessageId', 'provider-message-matching-send',
    'providerBroadcastId', 'broadcast-draft-1',
    'validationId', (select (result->>'validationId')::uuid from broadcast_results where test_case = 'validation'),
    'digest', repeat('d', 64),
    'disposition', 'matched',
    'classificationRequested', true,
    'providerStatus', 'sent',
    'sentAt', (select validated_at from public.builder_newsletter_broadcast_validations where id = (select (result->>'validationId')::uuid from broadcast_results where test_case = 'validation')),
    'evidenceSource', 'audit',
    'evidenceId', 'audit-matching-send'
  ))
);
reset role;

select is((select result->>'disposition' from broadcast_results where test_case = 'matching_send'), 'matched', 'sent_at equal to validated_at is atomically matched with its verified webhook receipt');
select is((select state from public.builder_newsletter_broadcast_validations where provider_broadcast_id = 'broadcast-draft-1'), 'consumed_matching', 'a matching send consumes its validation exactly once');
select is((select count(*) from public.builder_newsletter_webhook_receipts where svix_id = 'msg_matching_send'), 1::bigint, 'matching classification and receipt commit together');

set local role service_role;
insert into broadcast_results values (
  'boundary_incident',
  public.builder_classify_newsletter_broadcast_v1(jsonb_build_object(
    'version', 1,
    'siteId', '34000000-0000-4000-8000-000000000001',
    'providerScopeId', 'resend-team-production',
    'providerBroadcastId', 'broadcast-expired-boundary',
    'digest', repeat('f', 64),
    'providerStatus', 'sent',
    'sentAt', clock_timestamp(),
    'evidenceSource', 'audit',
    'evidenceId', 'audit-expired-boundary'
  ))
);
reset role;

select is((select result->>'disposition' from broadcast_results where test_case = 'boundary_incident'), 'incident', 'a send without an exact current validation incidents');
select is((select reason from public.builder_newsletter_broadcast_incidents where provider_broadcast_id = 'broadcast-expired-boundary'), 'unvalidated', 'the incident records a bounded policy reason');

set local role service_role;
select throws_ok(
  $$ select public.builder_resolve_newsletter_broadcast_incident_v1(jsonb_build_object(
    'version', 1,
    'siteId', '34000000-0000-4000-8000-000000000001',
    'incidentId', (select id from public.builder_newsletter_broadcast_incidents where provider_broadcast_id = 'broadcast-expired-boundary'),
    'primaryOperatorId', '34300000-0000-4000-8000-000000000001',
    'secondaryOperatorId', '34300000-0000-4000-8000-000000000001',
    'featureDisabled', true,
    'schedulesCleared', true,
    'providerAccessRestricted', true,
    'keysRotated', true,
    'fullAuditCompleted', true,
    'readinessRevisionId', '34100000-0000-4000-8000-000000000001',
    'resolutionReason', 'contained-and-reviewed'
  )) $$,
  '42501',
  'two distinct operators are required',
  'one operator cannot close a critical Broadcast incident alone'
);
insert into broadcast_results values (
  'resolved',
  public.builder_resolve_newsletter_broadcast_incident_v1(jsonb_build_object(
    'version', 1,
    'siteId', '34000000-0000-4000-8000-000000000001',
    'incidentId', (select id from public.builder_newsletter_broadcast_incidents where provider_broadcast_id = 'broadcast-expired-boundary'),
    'primaryOperatorId', '34300000-0000-4000-8000-000000000001',
    'secondaryOperatorId', '34300000-0000-4000-8000-000000000002',
    'featureDisabled', true,
    'schedulesCleared', true,
    'providerAccessRestricted', true,
    'keysRotated', true,
    'fullAuditCompleted', true,
    'readinessRevisionId', '34100000-0000-4000-8000-000000000001',
    'resolutionReason', 'contained-and-reviewed'
  ))
);
reset role;

select is((select result->>'state' from broadcast_results where test_case = 'resolved'), 'resolved', 'distinct operators can close a fully contained incident');

insert into public.builder_newsletter_broadcast_audit_jobs (
  site_id, id, provider_scope_id, kind, activation_cutoff, state,
  lease_owner, lease_fencing_token, lease_expires_at, sweep_started_at
) values (
  '34000000-0000-4000-8000-000000000001',
  '34500000-0000-4000-8000-000000000001',
  'resend-team-production',
  'newsletter.broadcast.audit',
  clock_timestamp(),
  'leased',
  '34600000-0000-4000-8000-000000000001',
  1,
  clock_timestamp() + interval '1 minute',
  clock_timestamp()
);

set local role service_role;
insert into broadcast_results values (
  'audit_page_1',
  public.builder_record_newsletter_broadcast_audit_page_v1(jsonb_build_object(
    'version', 1,
    'siteId', '34000000-0000-4000-8000-000000000001',
    'jobId', '34500000-0000-4000-8000-000000000001',
    'workerId', '34600000-0000-4000-8000-000000000001',
    'fencingToken', 1,
    'hasMore', true,
    'afterCursor', 'cursor-page-2',
    'pageCount', 1
  ))
);
insert into broadcast_results values (
  'audit_page_2',
  public.builder_record_newsletter_broadcast_audit_page_v1(jsonb_build_object(
    'version', 1,
    'siteId', '34000000-0000-4000-8000-000000000001',
    'jobId', '34500000-0000-4000-8000-000000000001',
    'workerId', '34600000-0000-4000-8000-000000000001',
    'fencingToken', 1,
    'hasMore', false,
    'pageCount', 2
  ))
);
reset role;

select is((select result->>'complete' from broadcast_results where test_case = 'audit_page_1'), 'false', 'an in-progress page records a resumable cursor');
select is((select result->>'complete' from broadcast_results where test_case = 'audit_page_2'), 'true', 'has_more false completes the full sweep');
select ok((select after_cursor is null and last_full_sweep_completed_at is not null and baseline_completed_at is not null from public.builder_newsletter_broadcast_audit_jobs where id = '34500000-0000-4000-8000-000000000001'), 'a complete sweep clears its cursor and records baseline/full completion');

select * from finish();
rollback;
