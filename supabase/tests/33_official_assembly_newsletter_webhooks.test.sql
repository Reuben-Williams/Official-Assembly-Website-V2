begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.builder_sites (id, site_key, display_name)
values ('33000000-0000-4000-8000-000000000001', 'newsletter-webhook-test', 'Newsletter Webhook Test');

select hasnt_column('public', 'builder_newsletter_webhook_receipts', 'raw_body', 'raw webhook bodies are not retained');
select hasnt_column('public', 'builder_newsletter_webhook_receipts', 'payload', 'provider webhook payloads are not retained');

create temporary table webhook_results (
  test_case text primary key,
  result jsonb not null
) on commit drop;
grant select, insert on webhook_results to service_role;

set local role service_role;
insert into webhook_results values (
  'incident',
  public.builder_reconcile_newsletter_webhook_v1(jsonb_build_object(
    'version', 1,
    'siteId', '33000000-0000-4000-8000-000000000001',
    'providerScopeId', 'resend-team-production',
    'svixId', 'msg_webhook_incident_1',
    'eventType', 'email.delivered',
    'providerCreatedAt', clock_timestamp(),
    'providerMessageId', 'provider-message-1',
    'providerBroadcastId', 'broadcast-unauthorized-1',
    'disposition', 'incident',
    'incidentReason', 'unvalidated',
    'providerStatus', 'sent',
    'sentAt', clock_timestamp(),
    'digest', repeat('a', 64)
  ))
);
insert into webhook_results values (
  'replay',
  public.builder_reconcile_newsletter_webhook_v1(jsonb_build_object(
    'version', 1,
    'siteId', '33000000-0000-4000-8000-000000000001',
    'providerScopeId', 'resend-team-production',
    'svixId', 'msg_webhook_incident_1',
    'eventType', 'email.delivered',
    'providerCreatedAt', clock_timestamp(),
    'providerMessageId', 'provider-message-1',
    'providerBroadcastId', 'broadcast-unauthorized-1',
    'disposition', 'incident',
    'incidentReason', 'unvalidated',
    'providerStatus', 'sent',
    'sentAt', clock_timestamp(),
    'digest', repeat('a', 64)
  ))
);
insert into webhook_results values (
  'second_recipient',
  public.builder_reconcile_newsletter_webhook_v1(jsonb_build_object(
    'version', 1,
    'siteId', '33000000-0000-4000-8000-000000000001',
    'providerScopeId', 'resend-team-production',
    'svixId', 'msg_webhook_incident_2',
    'eventType', 'email.delivered',
    'providerCreatedAt', clock_timestamp(),
    'providerMessageId', 'provider-message-2',
    'providerBroadcastId', 'broadcast-unauthorized-1',
    'disposition', 'incident',
    'incidentReason', 'unvalidated',
    'providerStatus', 'sent',
    'sentAt', clock_timestamp(),
    'digest', repeat('a', 64)
  ))
);
reset role;

select is((select result->>'disposition' from webhook_results where test_case = 'incident'), 'incident', 'an unauthorized Broadcast is classified before recipient mapping');
select is((select result->>'replayed' from webhook_results where test_case = 'replay'), 'true', 'the same verified svix identifier replays its recorded disposition');
select is((select count(*) from public.builder_newsletter_webhook_receipts where site_id = '33000000-0000-4000-8000-000000000001'), 2::bigint, 'webhook deduplication retains one receipt per svix identifier');
select is((select count(*) from public.builder_newsletter_broadcast_incidents where site_id = '33000000-0000-4000-8000-000000000001'), 1::bigint, 'recipient events converge on one Broadcast incident');
select is((select occurrence_count from public.builder_newsletter_broadcast_incidents where site_id = '33000000-0000-4000-8000-000000000001'), 2, 'a different verified event increments the existing incident');
select is((select first_evidence_id from public.builder_newsletter_broadcast_incidents where site_id = '33000000-0000-4000-8000-000000000001'), 'msg_webhook_incident_1', 'incident upsert preserves first-seen evidence');
select is((select last_evidence_id from public.builder_newsletter_broadcast_incidents where site_id = '33000000-0000-4000-8000-000000000001'), 'msg_webhook_incident_2', 'incident upsert records bounded last-seen evidence');

set local "builder.newsletter_test_failure" = 'after_webhook_receipt';
set local role service_role;
select throws_ok(
  $$ select public.builder_reconcile_newsletter_webhook_v1(jsonb_build_object(
    'version', 1,
    'siteId', '33000000-0000-4000-8000-000000000001',
    'providerScopeId', 'resend-team-production',
    'svixId', 'msg_webhook_rollback',
    'eventType', 'email.delivered',
    'providerCreatedAt', clock_timestamp(),
    'providerMessageId', 'provider-message-rollback',
    'providerBroadcastId', 'broadcast-rollback',
    'disposition', 'incident',
    'incidentReason', 'unvalidated',
    'providerStatus', 'sent',
    'sentAt', clock_timestamp(),
    'digest', repeat('b', 64)
  )) $$,
  'P2N99',
  'newsletter injected rollback',
  'a failure after receipt insertion rolls the receipt and incident back together'
);
reset role;
reset "builder.newsletter_test_failure";

select is((select count(*) from public.builder_newsletter_webhook_receipts where svix_id = 'msg_webhook_rollback'), 0::bigint, 'failed webhook processing leaves no permanent deduplication receipt');
select is((select count(*) from public.builder_newsletter_broadcast_incidents where provider_broadcast_id = 'broadcast-rollback'), 0::bigint, 'failed webhook processing leaves no partial incident');

select * from finish();
rollback;
