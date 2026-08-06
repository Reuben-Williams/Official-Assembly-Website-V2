alter table public.builder_member_capabilities
  drop constraint builder_member_capabilities_capability_check,
  add constraint builder_member_capabilities_capability_check check (capability in (
    'dashboard.read', 'leads.read', 'leads.create', 'leads.update', 'leads.assign', 'leads.export',
    'customers.read', 'customers.update', 'customers.export', 'customers.deleteRequest',
    'tasks.read', 'tasks.manage', 'messages.read', 'messages.draft', 'messages.send',
    'templates.manage', 'reviews.manage', 'automations.read', 'automations.manage',
    'automations.approve', 'projects.read', 'projects.manage', 'integrations.manage',
    'members.manage', 'billing.manage', 'siteHealth.read', 'emergencyPause.manage',
    'bookings.read', 'bookings.create', 'bookings.update', 'bookings.approve',
    'bookings.assign', 'bookings.checkIn', 'bookings.manageServices',
    'bookings.manageAvailability', 'bookings.manageResources',
    'bookings.managePayments', 'bookings.export',
    'campaigns.read', 'campaigns.create', 'campaigns.approve', 'campaigns.send',
    'campaigns.manageTemplates', 'campaigns.manageSegments', 'campaigns.export'
  ));

alter table builder_private.builder_verified_entitlement_snapshot_modules
  drop constraint builder_verified_entitlement_snapshot_modules_module_id_check,
  add constraint builder_verified_entitlement_snapshot_modules_module_id_check check (module_id in (
    'core.website', 'growth.dashboard', 'growth.leads', 'growth.customers', 'growth.messaging',
    'growth.automations', 'growth.reviews', 'growth.projects', 'growth.ai', 'growth.chat',
    'growth.bookings', 'growth.campaigns'
  ));

alter table builder_private.builder_verified_entitlement_incident_overrides
  drop constraint builder_verified_entitlement_incident_overrides_module_id_check,
  add constraint builder_verified_entitlement_incident_overrides_module_id_check check (
    module_id is null or module_id in (
      'core.website', 'growth.dashboard', 'growth.leads', 'growth.customers', 'growth.messaging',
      'growth.automations', 'growth.reviews', 'growth.projects', 'growth.ai', 'growth.chat',
      'growth.bookings', 'growth.campaigns'
    )
  );

create or replace function builder_private.snapshot_module_action_allowed(
  p_snapshot_id uuid,
  p_module_id text,
  p_action text,
  p_now timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_snapshot builder_private.builder_verified_entitlement_snapshots%rowtype;
  v_module builder_private.builder_verified_entitlement_snapshot_modules%rowtype;
  v_override_mode text;
begin
  if p_snapshot_id is null
    or p_module_id not in (
      'growth.customers', 'growth.leads', 'growth.dashboard',
      'growth.bookings', 'growth.messaging', 'growth.campaigns', 'growth.ai'
    )
    or p_action not in ('read', 'write', 'outbound', 'export')
  then
    return false;
  end if;

  select * into v_snapshot
  from builder_private.builder_verified_entitlement_snapshots
  where id = p_snapshot_id;
  if not found or v_snapshot.issued_at > p_now then return false; end if;

  select * into v_module
  from builder_private.builder_verified_entitlement_snapshot_modules
  where snapshot_id = p_snapshot_id and module_id = p_module_id;
  if not found then return false; end if;

  select case
    when count(*) = 0 then null
    when bool_or(mode = 'blocked') then 'blocked'
    else 'read_only'
  end
  into v_override_mode
  from builder_private.builder_verified_entitlement_incident_overrides
  where snapshot_id = p_snapshot_id
    and (module_id is null or module_id = p_module_id)
    and starts_at <= p_now
    and ends_at > p_now;

  if v_override_mode = 'blocked' then return false; end if;
  if v_override_mode = 'read_only' then
    return p_action = 'read'
      and builder_private.entitlement_state_action_allowed(
        v_module.state, v_module.grace_ends_at, 'read', p_now
      );
  end if;
  if p_now <= v_snapshot.expires_at then
    return builder_private.entitlement_state_action_allowed(
      v_module.state, v_module.grace_ends_at, p_action, p_now
    );
  end if;
  if v_snapshot.has_prior_valid_snapshot and p_now <= v_snapshot.outage_window_ends_at then
    return builder_private.entitlement_state_action_allowed(
      v_module.state, v_module.grace_ends_at, p_action, p_now
    );
  end if;
  if v_snapshot.has_prior_valid_snapshot then
    return p_action = 'read'
      and builder_private.entitlement_state_action_allowed(
        v_module.state, v_module.grace_ends_at, 'read', p_now
      );
  end if;
  return false;
end;
$$;

create table public.builder_campaign_templates (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  stable_key text not null check (stable_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 200),
  channel text not null check (channel in ('email', 'sms')),
  current_revision_id uuid,
  state text not null default 'draft' check (state in ('draft', 'approved', 'retired')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, stable_key),
  unique (site_id, id, channel)
);

create table public.builder_campaign_template_revisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  template_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  channel text not null check (channel in ('email', 'sms')),
  blocks jsonb not null check (
    jsonb_typeof(blocks) = 'array' and octet_length(blocks::text) <= 100000
  ),
  required_component_keys text[] not null check (
    required_component_keys @> array[
      'sender_identification', 'preference_center', 'unsubscribe',
      'consent_notice', 'legal_footer'
    ]::text[]
  ),
  state text not null default 'draft' check (state in ('draft', 'approved', 'retired')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, template_id, revision_number),
  unique (site_id, template_id, id),
  foreign key (site_id, template_id, channel)
    references public.builder_campaign_templates(site_id, id, channel) on delete cascade,
  check ((state = 'approved') = (approved_at is not null))
);

alter table public.builder_campaign_templates
  add constraint builder_campaign_templates_current_revision_fk
  foreign key (site_id, id, current_revision_id)
  references public.builder_campaign_template_revisions(site_id, template_id, id)
  on delete restrict;

create table public.builder_campaign_segments (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  stable_key text not null check (stable_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 200),
  current_revision_id uuid,
  state text not null default 'draft' check (state in ('draft', 'active', 'retired')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, stable_key)
);

create table public.builder_campaign_segment_revisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  segment_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  source text not null check (source in ('query', 'explicit_list')),
  data_source text not null check (
    data_source in ('customer_marketing', 'explicit_marketing_list', 'constituent_service')
  ),
  rules jsonb not null default '[]'::jsonb check (
    jsonb_typeof(rules) = 'array' and octet_length(rules::text) <= 50000
  ),
  explicit_contact_ids uuid[] not null default '{}'::uuid[],
  audience_digest text not null check (audience_digest ~ '^[a-f0-9]{64}$'),
  created_by_member_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, segment_id, revision_number),
  unique (site_id, segment_id, id),
  foreign key (site_id, segment_id)
    references public.builder_campaign_segments(site_id, id) on delete cascade,
  foreign key (site_id, created_by_member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check (
    (source = 'explicit_list' and cardinality(explicit_contact_ids) > 0)
    or (source = 'query' and cardinality(explicit_contact_ids) = 0)
  )
);

alter table public.builder_campaign_segments
  add constraint builder_campaign_segments_current_revision_fk
  foreign key (site_id, id, current_revision_id)
  references public.builder_campaign_segment_revisions(site_id, segment_id, id)
  on delete restrict;

create table public.builder_campaigns (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  stable_key text not null check (stable_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 200),
  kind text not null check (kind in (
    'one_time_newsletter', 'scheduled_broadcast', 'welcome_sequence',
    'promotional_post_booking_follow_up', 'review_request',
    'abandoned_booking_reminder', 'waitlist_or_opening_announcement',
    'service_or_event_announcement', 'seasonal_reengagement',
    'membership_package_renewal_or_birthday'
  )),
  channel text not null check (channel in ('email', 'sms')),
  purpose text not null check (
    purpose in ('marketing_email', 'marketing_sms', 'public_office_campaign')
  ),
  state text not null default 'draft' check (state in (
    'draft', 'in_review', 'approved', 'scheduled', 'sending',
    'paused', 'completed', 'cancelled', 'failed'
  )),
  current_revision_id uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, stable_key),
  unique (site_id, id, channel, purpose),
  check (
    (purpose = 'marketing_email' and channel = 'email')
    or (purpose = 'marketing_sms' and channel = 'sms')
    or purpose = 'public_office_campaign'
  )
);

create table public.builder_campaign_revisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  campaign_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  channel text not null check (channel in ('email', 'sms')),
  purpose text not null check (
    purpose in ('marketing_email', 'marketing_sms', 'public_office_campaign')
  ),
  template_revision_id uuid not null,
  segment_revision_id uuid not null,
  brand_revision_id uuid not null,
  sender_config_revision_id uuid not null,
  provider_config_revision_id uuid not null,
  subject text check (subject is null or char_length(subject) between 1 and 500),
  preview_text text check (preview_text is null or char_length(preview_text) <= 500),
  editable_content jsonb not null check (
    jsonb_typeof(editable_content) = 'object'
    and octet_length(editable_content::text) <= 100000
  ),
  link_destinations text[] not null default '{}'::text[],
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  created_by_member_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, campaign_id, revision_number),
  unique (site_id, campaign_id, id),
  foreign key (site_id, campaign_id, channel, purpose)
    references public.builder_campaigns(site_id, id, channel, purpose) on delete cascade,
  foreign key (site_id, template_revision_id)
    references public.builder_campaign_template_revisions(site_id, id) on delete restrict,
  foreign key (site_id, segment_revision_id)
    references public.builder_campaign_segment_revisions(site_id, id) on delete restrict,
  foreign key (site_id, created_by_member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check ((channel = 'email') = (subject is not null)),
  check (
    (purpose = 'marketing_email' and channel = 'email')
    or (purpose = 'marketing_sms' and channel = 'sms')
    or purpose = 'public_office_campaign'
  )
);

alter table public.builder_campaigns
  add constraint builder_campaigns_current_revision_fk
  foreign key (site_id, id, current_revision_id)
  references public.builder_campaign_revisions(site_id, campaign_id, id)
  on delete restrict;

create table public.builder_campaign_approvals (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  campaign_id uuid not null,
  campaign_revision_id uuid not null,
  template_revision_id uuid not null,
  segment_revision_id uuid not null,
  brand_revision_id uuid not null,
  sender_config_revision_id uuid not null,
  provider_config_revision_id uuid not null,
  consent_decision_version text not null check (char_length(consent_decision_version) between 1 and 100),
  suppression_decision_version text not null check (char_length(suppression_decision_version) between 1 and 100),
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  audience_digest text not null check (audience_digest ~ '^[a-f0-9]{64}$'),
  link_destinations text[] not null default '{}'::text[],
  state text not null check (state in ('approved', 'revoked')),
  approved_by_member_id uuid not null,
  approved_at timestamptz not null,
  revoked_at timestamptz,
  reason text not null check (char_length(reason) between 12 and 1000),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, campaign_id, campaign_revision_id),
  foreign key (site_id, campaign_id, campaign_revision_id)
    references public.builder_campaign_revisions(site_id, campaign_id, id) on delete restrict,
  foreign key (site_id, approved_by_member_id)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  check ((state = 'revoked') = (revoked_at is not null))
);

create table public.builder_campaign_schedules (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  campaign_id uuid not null,
  approval_id uuid not null,
  starts_at timestamptz not null,
  next_attempt_at timestamptz not null,
  time_zone text not null check (char_length(time_zone) between 1 and 100),
  state text not null default 'scheduled' check (
    state in ('scheduled', 'sending', 'paused', 'cancelled', 'completed', 'failed')
  ),
  quiet_hours_start time,
  quiet_hours_end time,
  frequency_window interval not null default interval '30 days' check (
    frequency_window between interval '1 hour' and interval '365 days'
  ),
  frequency_max integer not null default 4 check (frequency_max between 1 and 100),
  lease_owner text check (lease_owner is null or char_length(lease_owner) between 1 and 255),
  lease_token uuid,
  lease_expires_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, campaign_id, approval_id),
  foreign key (site_id, campaign_id)
    references public.builder_campaigns(site_id, id) on delete cascade,
  foreign key (site_id, approval_id)
    references public.builder_campaign_approvals(site_id, id) on delete restrict,
  check (
    (lease_token is null and lease_owner is null and lease_expires_at is null)
    or (lease_token is not null and lease_owner is not null and lease_expires_at is not null)
  ),
  check (
    (quiet_hours_start is null and quiet_hours_end is null)
    or (quiet_hours_start is not null and quiet_hours_end is not null)
  )
);

create table public.builder_campaign_materialization_runs (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  schedule_id uuid not null,
  campaign_id uuid not null,
  approval_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  cursor text,
  state text not null default 'pending' check (
    state in ('pending', 'claimed', 'completed', 'failed')
  ),
  evaluated_count integer not null default 0 check (evaluated_count >= 0),
  materialized_count integer not null default 0 check (materialized_count >= 0),
  suppressed_count integer not null default 0 check (suppressed_count >= 0),
  lease_owner text check (lease_owner is null or char_length(lease_owner) between 1 and 255),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, schedule_id)
    references public.builder_campaign_schedules(site_id, id) on delete cascade,
  foreign key (site_id, campaign_id)
    references public.builder_campaigns(site_id, id) on delete cascade,
  foreign key (site_id, approval_id)
    references public.builder_campaign_approvals(site_id, id) on delete restrict
);

create table public.builder_campaign_recipient_decisions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  campaign_id uuid not null,
  schedule_id uuid not null,
  approval_id uuid not null,
  contact_id uuid not null,
  contact_identity_id uuid,
  action text not null check (action in ('allow', 'suppress', 'skip', 'defer')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  consent_decision_version text not null check (char_length(consent_decision_version) between 1 and 100),
  suppression_decision_version text not null check (char_length(suppression_decision_version) between 1 and 100),
  evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence) = 'object'
    and octet_length(evidence::text) <= 16384
    and evidence::text !~* '"[^"]*(destination|email|phone|token|secret|credential|authorization)[^"]*"'
  ),
  evaluated_at timestamptz not null,
  primary key (site_id, id),
  foreign key (site_id, campaign_id)
    references public.builder_campaigns(site_id, id) on delete cascade,
  foreign key (site_id, schedule_id)
    references public.builder_campaign_schedules(site_id, id) on delete cascade,
  foreign key (site_id, approval_id)
    references public.builder_campaign_approvals(site_id, id) on delete restrict,
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, contact_identity_id)
    references public.builder_contact_identities(site_id, id) on delete restrict,
  check ((action = 'allow') = (contact_identity_id is not null))
);

create table public.builder_campaign_recipients (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  campaign_id uuid not null,
  schedule_id uuid not null,
  approval_id uuid not null,
  contact_id uuid not null,
  contact_identity_id uuid,
  decision_id uuid not null,
  send_snapshot_id uuid,
  state text not null check (
    state in ('eligible', 'materialized', 'suppressed', 'skipped', 'delivery_requested', 'completed')
  ),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, campaign_id, schedule_id, contact_id),
  unique (site_id, campaign_id, schedule_id, id),
  foreign key (site_id, campaign_id)
    references public.builder_campaigns(site_id, id) on delete cascade,
  foreign key (site_id, schedule_id)
    references public.builder_campaign_schedules(site_id, id) on delete cascade,
  foreign key (site_id, approval_id)
    references public.builder_campaign_approvals(site_id, id) on delete restrict,
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, contact_identity_id)
    references public.builder_contact_identities(site_id, id) on delete restrict,
  foreign key (site_id, decision_id)
    references public.builder_campaign_recipient_decisions(site_id, id) on delete restrict
);

create table public.builder_campaign_send_snapshots (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  campaign_id uuid not null,
  schedule_id uuid not null,
  recipient_id uuid not null,
  approval_id uuid not null,
  campaign_revision_id uuid not null,
  template_revision_id uuid not null,
  segment_revision_id uuid not null,
  brand_revision_id uuid not null,
  sender_config_revision_id uuid not null,
  provider_config_revision_id uuid not null,
  contact_identity_id uuid not null,
  destination_reference text not null check (
    destination_reference ~ '^contact-identity:[0-9a-f-]{36}$'
  ),
  channel text not null check (channel in ('email', 'sms')),
  purpose text not null check (
    purpose in ('marketing_email', 'marketing_sms', 'public_office_campaign')
  ),
  rendered_subject text check (
    rendered_subject is null or char_length(rendered_subject) between 1 and 500
  ),
  rendered_body text not null check (char_length(rendered_body) between 1 and 50000),
  link_destinations text[] not null default '{}'::text[],
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  audience_digest text not null check (audience_digest ~ '^[a-f0-9]{64}$'),
  consent_decision_version text not null check (char_length(consent_decision_version) between 1 and 100),
  suppression_decision_version text not null check (char_length(suppression_decision_version) between 1 and 100),
  rendered_at timestamptz not null,
  primary key (site_id, id),
  unique (site_id, recipient_id),
  foreign key (site_id, campaign_id)
    references public.builder_campaigns(site_id, id) on delete cascade,
  foreign key (site_id, schedule_id)
    references public.builder_campaign_schedules(site_id, id) on delete cascade,
  foreign key (site_id, campaign_id, schedule_id, recipient_id)
    references public.builder_campaign_recipients(site_id, campaign_id, schedule_id, id) on delete restrict,
  foreign key (site_id, approval_id)
    references public.builder_campaign_approvals(site_id, id) on delete restrict,
  foreign key (site_id, campaign_revision_id)
    references public.builder_campaign_revisions(site_id, id) on delete restrict,
  foreign key (site_id, template_revision_id)
    references public.builder_campaign_template_revisions(site_id, id) on delete restrict,
  foreign key (site_id, segment_revision_id)
    references public.builder_campaign_segment_revisions(site_id, id) on delete restrict,
  foreign key (site_id, contact_identity_id)
    references public.builder_contact_identities(site_id, id) on delete restrict,
  check ((channel = 'email') = (rendered_subject is not null)),
  check (
    (purpose = 'marketing_email' and channel = 'email')
    or (purpose = 'marketing_sms' and channel = 'sms')
    or purpose = 'public_office_campaign'
  )
);

alter table public.builder_campaign_recipients
  add constraint builder_campaign_recipients_send_snapshot_fk
  foreign key (site_id, send_snapshot_id)
  references public.builder_campaign_send_snapshots(site_id, id) on delete restrict;

create table public.builder_campaign_deliveries (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  campaign_id uuid not null,
  recipient_id uuid not null,
  send_snapshot_id uuid not null,
  messaging_delivery_id uuid not null,
  messaging_message_id uuid not null,
  state text not null check (state in (
    'requested', 'authorized', 'held', 'claimed', 'submitted', 'accepted',
    'delivered', 'failed_retryable', 'failed_terminal', 'suppressed',
    'cancelled', 'reconciliation_required'
  )),
  attempt integer not null default 0 check (attempt >= 0),
  version integer not null default 1 check (version > 0),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  unique (site_id, recipient_id),
  unique (site_id, messaging_delivery_id),
  foreign key (site_id, campaign_id)
    references public.builder_campaigns(site_id, id) on delete cascade,
  foreign key (site_id, recipient_id)
    references public.builder_campaign_recipients(site_id, id) on delete restrict,
  foreign key (site_id, send_snapshot_id)
    references public.builder_campaign_send_snapshots(site_id, id) on delete restrict,
  foreign key (site_id, messaging_delivery_id)
    references public.builder_message_deliveries(site_id, id) on delete restrict,
  foreign key (site_id, messaging_message_id)
    references public.builder_messages(site_id, id) on delete restrict
);

create table public.builder_campaign_delivery_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  campaign_delivery_id uuid not null,
  messaging_delivery_id uuid not null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
  from_state text,
  to_state text not null,
  reason_code text check (reason_code is null or reason_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  correlation_id uuid not null,
  occurred_at timestamptz not null,
  primary key (site_id, id),
  unique (site_id, campaign_delivery_id, event_type, occurred_at),
  foreign key (site_id, campaign_delivery_id)
    references public.builder_campaign_deliveries(site_id, id) on delete restrict,
  foreign key (site_id, messaging_delivery_id)
    references public.builder_message_deliveries(site_id, id) on delete restrict
);

create table public.builder_campaign_newsletter_imports (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  submission_id uuid not null,
  base_consent_id uuid not null,
  contact_id uuid not null,
  contact_identity_id uuid not null,
  consent_id uuid not null,
  actor_id uuid not null,
  command_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  review_reason text not null check (char_length(review_reason) between 12 and 1000),
  reviewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, submission_id),
  unique (site_id, idempotency_key),
  foreign key (site_id, submission_id)
    references public.builder_form_submissions(site_id, id) on delete restrict,
  foreign key (site_id, base_consent_id)
    references public.builder_form_submission_consents(site_id, id) on delete restrict,
  foreign key (site_id, contact_id)
    references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, contact_identity_id)
    references public.builder_contact_identities(site_id, id) on delete restrict,
  foreign key (site_id, consent_id)
    references public.builder_consents(site_id, id) on delete restrict,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_campaign_ai_drafts (
  site_id uuid not null,
  id uuid not null,
  campaign_id uuid not null,
  actor_id uuid not null,
  prompt_version_id uuid not null,
  model_configuration_version_id uuid not null,
  provider_kind text not null check (provider_kind ~ '^[a-z][a-z0-9._-]{0,127}$'),
  approval_state text not null default 'draft' check (approval_state = 'draft'),
  response_text text not null check (char_length(response_text) between 1 and 8000),
  source_revision_ids uuid[] not null default '{}'::uuid[],
  decision_evidence jsonb not null check (
    jsonb_typeof(decision_evidence) = 'object'
    and octet_length(decision_evidence::text) <= 32768
    and decision_evidence::text !~* '"[^"]*(secret|credential|authorization)[^"]*"'
  ),
  created_at timestamptz not null,
  primary key (site_id, id),
  foreign key (site_id, campaign_id)
    references public.builder_campaigns(site_id, id) on delete cascade,
  foreign key (site_id, actor_id)
    references public.builder_site_members(site_id, user_id) on delete restrict
);

create index builder_campaigns_site_state_updated_idx
  on public.builder_campaigns(site_id, state, updated_at desc, id);
create index builder_campaign_schedules_due_idx
  on public.builder_campaign_schedules(next_attempt_at, site_id, id)
  where state in ('scheduled', 'sending');
create index builder_campaign_recipients_state_idx
  on public.builder_campaign_recipients(site_id, campaign_id, state, id);
create index builder_campaign_recipients_contact_idx
  on public.builder_campaign_recipients(site_id, contact_id, created_at desc);
create index builder_campaign_delivery_events_delivery_idx
  on public.builder_campaign_delivery_events(
    site_id, campaign_delivery_id, occurred_at, id
  );

create trigger builder_campaign_template_revisions_append_only
before update or delete on public.builder_campaign_template_revisions
for each row execute function builder_private.reject_append_only_change();
create trigger builder_campaign_segment_revisions_append_only
before update or delete on public.builder_campaign_segment_revisions
for each row execute function builder_private.reject_append_only_change();
create trigger builder_campaign_revisions_append_only
before update or delete on public.builder_campaign_revisions
for each row execute function builder_private.reject_append_only_change();
create trigger builder_campaign_approvals_append_only
before update or delete on public.builder_campaign_approvals
for each row execute function builder_private.reject_append_only_change();
create trigger builder_campaign_recipient_decisions_append_only
before update or delete on public.builder_campaign_recipient_decisions
for each row execute function builder_private.reject_append_only_change();
create trigger builder_campaign_send_snapshots_append_only
before update or delete on public.builder_campaign_send_snapshots
for each row execute function builder_private.reject_append_only_change();
create trigger builder_campaign_delivery_events_append_only
before update or delete on public.builder_campaign_delivery_events
for each row execute function builder_private.reject_append_only_change();
create trigger builder_campaign_newsletter_imports_append_only
before update or delete on public.builder_campaign_newsletter_imports
for each row execute function builder_private.reject_append_only_change();
create trigger builder_campaign_ai_drafts_append_only
before update or delete on public.builder_campaign_ai_drafts
for each row execute function builder_private.reject_append_only_change();

alter table public.builder_campaign_templates enable row level security;
alter table public.builder_campaign_template_revisions enable row level security;
alter table public.builder_campaign_segments enable row level security;
alter table public.builder_campaign_segment_revisions enable row level security;
alter table public.builder_campaigns enable row level security;
alter table public.builder_campaign_revisions enable row level security;
alter table public.builder_campaign_approvals enable row level security;
alter table public.builder_campaign_schedules enable row level security;
alter table public.builder_campaign_materialization_runs enable row level security;
alter table public.builder_campaign_recipient_decisions enable row level security;
alter table public.builder_campaign_recipients enable row level security;
alter table public.builder_campaign_send_snapshots enable row level security;
alter table public.builder_campaign_deliveries enable row level security;
alter table public.builder_campaign_delivery_events enable row level security;
alter table public.builder_campaign_newsletter_imports enable row level security;
alter table public.builder_campaign_ai_drafts enable row level security;

create policy builder_campaign_templates_read
on public.builder_campaign_templates for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_template_revisions_read
on public.builder_campaign_template_revisions for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_segments_read
on public.builder_campaign_segments for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_segment_revisions_read
on public.builder_campaign_segment_revisions for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaigns_read
on public.builder_campaigns for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_revisions_read
on public.builder_campaign_revisions for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_approvals_read
on public.builder_campaign_approvals for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_schedules_read
on public.builder_campaign_schedules for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_materialization_runs_read
on public.builder_campaign_materialization_runs for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_recipient_decisions_read
on public.builder_campaign_recipient_decisions for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_recipients_read
on public.builder_campaign_recipients for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_send_snapshots_read
on public.builder_campaign_send_snapshots for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_deliveries_read
on public.builder_campaign_deliveries for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_delivery_events_read
on public.builder_campaign_delivery_events for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_newsletter_imports_read
on public.builder_campaign_newsletter_imports for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);
create policy builder_campaign_ai_drafts_read
on public.builder_campaign_ai_drafts for select to authenticated using (
  builder_private.module_action_allowed(site_id, 'growth.campaigns', 'read')
  and builder_private.member_has_capability(
    site_id, (select auth.uid()), 'campaigns.read', 'site'
  )
);

revoke all on table public.builder_campaign_templates from anon, authenticated;
revoke all on table public.builder_campaign_template_revisions from anon, authenticated;
revoke all on table public.builder_campaign_segments from anon, authenticated;
revoke all on table public.builder_campaign_segment_revisions from anon, authenticated;
revoke all on table public.builder_campaigns from anon, authenticated;
revoke all on table public.builder_campaign_revisions from anon, authenticated;
revoke all on table public.builder_campaign_approvals from anon, authenticated;
revoke all on table public.builder_campaign_schedules from anon, authenticated;
revoke all on table public.builder_campaign_materialization_runs from anon, authenticated;
revoke all on table public.builder_campaign_recipient_decisions from anon, authenticated;
revoke all on table public.builder_campaign_recipients from anon, authenticated;
revoke all on table public.builder_campaign_send_snapshots from anon, authenticated;
revoke all on table public.builder_campaign_deliveries from anon, authenticated;
revoke all on table public.builder_campaign_delivery_events from anon, authenticated;
revoke all on table public.builder_campaign_newsletter_imports from anon, authenticated;
revoke all on table public.builder_campaign_ai_drafts from anon, authenticated;

grant select on table public.builder_campaign_templates to authenticated;
grant select on table public.builder_campaign_template_revisions to authenticated;
grant select on table public.builder_campaign_segments to authenticated;
grant select on table public.builder_campaign_segment_revisions to authenticated;
grant select on table public.builder_campaigns to authenticated;
grant select on table public.builder_campaign_revisions to authenticated;
grant select on table public.builder_campaign_approvals to authenticated;
grant select on table public.builder_campaign_schedules to authenticated;
grant select on table public.builder_campaign_materialization_runs to authenticated;
grant select on table public.builder_campaign_recipient_decisions to authenticated;
grant select on table public.builder_campaign_recipients to authenticated;
grant select on table public.builder_campaign_send_snapshots to authenticated;
grant select on table public.builder_campaign_deliveries to authenticated;
grant select on table public.builder_campaign_delivery_events to authenticated;
grant select on table public.builder_campaign_newsletter_imports to authenticated;
grant select on table public.builder_campaign_ai_drafts to authenticated;

grant select on table public.builder_campaign_templates to service_role;
grant select on table public.builder_campaign_template_revisions to service_role;
grant select on table public.builder_campaign_segments to service_role;
grant select on table public.builder_campaign_segment_revisions to service_role;
grant select on table public.builder_campaigns to service_role;
grant select on table public.builder_campaign_revisions to service_role;
grant select on table public.builder_campaign_approvals to service_role;
grant select on table public.builder_campaign_schedules to service_role;
grant select on table public.builder_campaign_materialization_runs to service_role;
grant select on table public.builder_campaign_recipient_decisions to service_role;
grant select on table public.builder_campaign_recipients to service_role;
grant select on table public.builder_campaign_send_snapshots to service_role;
grant select on table public.builder_campaign_deliveries to service_role;
grant select on table public.builder_campaign_delivery_events to service_role;
grant select on table public.builder_campaign_newsletter_imports to service_role;
grant select on table public.builder_campaign_ai_drafts to service_role;

create function builder_private.campaign_member_allowed(
  p_site_id uuid,
  p_actor_id uuid,
  p_capability text,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select
    builder_private.module_action_allowed(p_site_id, 'growth.campaigns', p_action)
    and builder_private.member_has_capability(
      p_site_id, p_actor_id, p_capability, 'site'
    );
$$;

revoke all on function builder_private.campaign_member_allowed(uuid, uuid, text, text)
from public, anon, authenticated, service_role;

create function public.builder_cancel_queued_campaign_work_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid;
  v_campaign_id uuid;
  v_recipient_id uuid;
  v_reason_code text;
  v_now timestamptz;
  v_count integer := 0;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'campaignId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'reasonCode', '') !~ '^[a-z][a-z0-9._-]{0,127}$'
  then
    raise exception 'invalid campaign cancellation request' using errcode = '22023';
  end if;
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_campaign_id := (p_request ->> 'campaignId')::uuid;
  v_reason_code := p_request ->> 'reasonCode';
  v_now := coalesce((p_request ->> 'now')::timestamptz, statement_timestamp());
  if p_request ? 'recipientId' and p_request ->> 'recipientId' is not null then
    v_recipient_id := (p_request ->> 'recipientId')::uuid;
  end if;

  update public.builder_outbox outbox
  set status = case when v_reason_code in ('unsubscribe', 'complaint', 'bounce')
        then 'suppressed' else 'cancelled' end,
      last_error = v_reason_code,
      lease_owner = null,
      lease_expires_at = null,
      lease_token = null,
      updated_at = v_now
  from public.builder_message_deliveries messaging_delivery
  join public.builder_campaign_deliveries campaign_delivery
    on campaign_delivery.site_id = messaging_delivery.site_id
    and campaign_delivery.messaging_delivery_id = messaging_delivery.id
  where outbox.site_id = v_site_id
    and outbox.id = messaging_delivery.outbox_id
    and campaign_delivery.campaign_id = v_campaign_id
    and (v_recipient_id is null or campaign_delivery.recipient_id = v_recipient_id)
    and outbox.status in ('pending', 'claimed');
  get diagnostics v_count = row_count;

  update public.builder_message_deliveries messaging_delivery
  set state = case when v_reason_code in ('unsubscribe', 'complaint', 'bounce')
        then 'suppressed' else 'cancelled' end,
      reason_code = v_reason_code,
      worker_id = null,
      lease_token = null,
      version = messaging_delivery.version + 1,
      updated_at = v_now
  from public.builder_campaign_deliveries campaign_delivery
  where messaging_delivery.site_id = v_site_id
    and campaign_delivery.site_id = messaging_delivery.site_id
    and campaign_delivery.messaging_delivery_id = messaging_delivery.id
    and campaign_delivery.campaign_id = v_campaign_id
    and (v_recipient_id is null or campaign_delivery.recipient_id = v_recipient_id)
    and messaging_delivery.state in (
      'requested', 'authorized', 'held', 'claimed', 'failed_retryable'
    );

  update public.builder_campaign_deliveries
  set state = case when v_reason_code in ('unsubscribe', 'complaint', 'bounce')
        then 'suppressed' else 'cancelled' end,
      version = version + 1,
      updated_at = v_now
  where site_id = v_site_id
    and campaign_id = v_campaign_id
    and (v_recipient_id is null or recipient_id = v_recipient_id)
    and state in ('requested', 'authorized', 'held', 'claimed', 'failed_retryable');

  update public.builder_campaign_recipients
  set state = 'suppressed',
      reason_code = v_reason_code,
      version = version + 1,
      updated_at = v_now
  where site_id = v_site_id
    and campaign_id = v_campaign_id
    and (v_recipient_id is null or id = v_recipient_id)
    and state not in ('completed', 'suppressed', 'skipped');

  return jsonb_build_object('version', 1, 'status', 'cancelled', 'cancelledCount', v_count);
end;
$$;

create function public.builder_apply_campaign_command_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_campaign_id uuid;
  v_schedule_id uuid;
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_action text;
  v_now timestamptz;
  v_expected_version integer;
  v_schedule public.builder_campaign_schedules%rowtype;
  v_target_state text;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'campaignId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'scheduleId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request ->> 'type' <> 'campaign.transition'
    or jsonb_typeof(p_request -> 'actor') <> 'object'
    or char_length(coalesce(p_request ->> 'idempotencyKey', '')) not between 1 and 255
    or coalesce(p_request ->> 'expectedVersion', '') !~ '^[1-9][0-9]*$'
  then
    raise exception 'invalid campaign command envelope' using errcode = '22023';
  end if;

  v_site_id := (p_request ->> 'siteId')::uuid;
  v_campaign_id := (p_request ->> 'campaignId')::uuid;
  v_schedule_id := (p_request ->> 'scheduleId')::uuid;
  v_actor_type := p_request #>> '{actor,type}';
  v_actor_id_text := p_request #>> '{actor,id}';
  v_action := p_request ->> 'action';
  v_expected_version := (p_request ->> 'expectedVersion')::integer;
  v_now := coalesce((p_request ->> 'now')::timestamptz, statement_timestamp());

  if v_actor_type not in ('member', 'system')
    or v_action not in ('complete', 'pause', 'resume', 'cancel')
    or char_length(coalesce(v_actor_id_text, '')) not between 1 and 255
  then
    raise exception 'invalid campaign command' using errcode = '22023';
  end if;

  select * into v_schedule
  from public.builder_campaign_schedules
  where site_id = v_site_id and id = v_schedule_id and campaign_id = v_campaign_id
  for update;
  if not found then
    raise exception 'campaign schedule not found' using errcode = 'P0002';
  end if;

  v_target_state := case v_action
    when 'complete' then 'completed'
    when 'pause' then 'paused'
    when 'resume' then 'scheduled'
    when 'cancel' then 'cancelled'
  end;
  if v_schedule.state = v_target_state then
    return jsonb_build_object('version', 1, 'status', 'replayed');
  end if;

  if v_actor_type = 'system' then
    if v_action <> 'complete'
      or v_schedule.lease_owner <> v_actor_id_text
      or v_schedule.lease_token is distinct from (p_request ->> 'leaseToken')::uuid
      or v_schedule.lease_expires_at < v_now
    then
      raise exception 'campaign worker lease is invalid' using errcode = '42501';
    end if;
  else
    if v_actor_id_text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      raise exception 'campaign actor is invalid' using errcode = '42501';
    end if;
    v_actor_id := v_actor_id_text::uuid;
    if not builder_private.campaign_member_allowed(
      v_site_id, v_actor_id, 'campaigns.send', 'write'
    ) then
      raise exception 'campaign command is not authorized' using errcode = '42501';
    end if;
  end if;

  if v_schedule.version <> v_expected_version then
    raise exception 'campaign schedule version conflict' using errcode = '40001';
  end if;

  update public.builder_campaign_schedules
  set state = v_target_state,
      next_attempt_at = case
        when v_target_state = 'scheduled' then greatest(v_now, starts_at)
        else next_attempt_at
      end,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      version = version + 1,
      updated_at = v_now
  where site_id = v_site_id and id = v_schedule_id;

  update public.builder_campaigns
  set state = case
        when v_target_state = 'scheduled' then 'scheduled'
        else v_target_state
      end,
      version = version + 1,
      updated_at = v_now
  where site_id = v_site_id and id = v_campaign_id;

  if v_target_state = 'cancelled' then
    perform public.builder_cancel_queued_campaign_work_v1(jsonb_build_object(
      'version', 1,
      'siteId', v_site_id,
      'campaignId', v_campaign_id,
      'reasonCode', 'campaign_cancelled',
      'now', v_now
    ));
  end if;

  return jsonb_build_object('version', 1, 'status', 'completed');
end;
$$;

create function public.builder_claim_due_campaign_schedules_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_worker_id text;
  v_now timestamptz;
  v_limit integer;
  v_lease_seconds integer;
  v_candidate record;
  v_schedule public.builder_campaign_schedules%rowtype;
  v_items jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or char_length(coalesce(p_request ->> 'workerId', '')) not between 1 and 255
  then
    raise exception 'invalid campaign schedule claim' using errcode = '22023';
  end if;

  v_site_id := (p_request ->> 'siteId')::uuid;
  v_worker_id := p_request ->> 'workerId';
  v_now := coalesce((p_request ->> 'now')::timestamptz, statement_timestamp());
  v_limit := greatest(1, least(100, coalesce((p_request ->> 'limit')::integer, 10)));
  v_lease_seconds := greatest(1, least(
    300, coalesce((p_request ->> 'leaseSeconds')::integer, 60)
  ));

  if not builder_private.module_action_allowed(
    v_site_id, 'growth.campaigns', 'outbound'
  ) or not builder_private.module_action_allowed(
    v_site_id, 'growth.messaging', 'outbound'
  ) then
    raise exception 'campaign scheduling is not authorized' using errcode = '42501';
  end if;

  for v_candidate in
    select schedule.site_id, schedule.id
    from public.builder_campaign_schedules schedule
    join public.builder_campaign_approvals approval
      on approval.site_id = schedule.site_id and approval.id = schedule.approval_id
    join public.builder_campaigns campaign
      on campaign.site_id = schedule.site_id and campaign.id = schedule.campaign_id
    where schedule.site_id = v_site_id
      and schedule.state in ('scheduled', 'sending')
      and schedule.starts_at <= v_now
      and schedule.next_attempt_at <= v_now
      and (schedule.lease_expires_at is null or schedule.lease_expires_at <= v_now)
      and approval.state = 'approved'
      and campaign.state not in ('paused', 'cancelled', 'completed', 'failed')
    order by schedule.next_attempt_at, schedule.id
    limit v_limit
    for update skip locked
  loop
    update public.builder_campaign_schedules schedule
    set state = 'sending',
        lease_owner = v_worker_id,
        lease_token = gen_random_uuid(),
        lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
        version = version + 1,
        updated_at = v_now
    where schedule.site_id = v_candidate.site_id and schedule.id = v_candidate.id
    returning schedule.* into v_schedule;

    update public.builder_campaigns
    set state = 'sending', version = version + 1, updated_at = v_now
    where site_id = v_schedule.site_id and id = v_schedule.campaign_id
      and state <> 'sending';

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'siteId', v_schedule.site_id,
      'scheduleId', v_schedule.id,
      'campaignId', v_schedule.campaign_id,
      'approvalId', v_schedule.approval_id,
      'workerId', v_schedule.lease_owner,
      'leaseToken', v_schedule.lease_token,
      'leaseExpiresAt', v_schedule.lease_expires_at,
      'scheduleVersion', v_schedule.version
    ));
  end loop;

  return jsonb_build_object('version', 1, 'items', v_items);
end;
$$;

create function public.builder_materialize_campaign_batch_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_schedule_id uuid;
  v_campaign_id uuid;
  v_approval_id uuid;
  v_worker_id text;
  v_lease_token uuid;
  v_now timestamptz;
  v_limit integer;
  v_cursor text;
  v_schedule public.builder_campaign_schedules%rowtype;
  v_campaign public.builder_campaigns%rowtype;
  v_approval public.builder_campaign_approvals%rowtype;
  v_revision public.builder_campaign_revisions%rowtype;
  v_segment public.builder_campaign_segment_revisions%rowtype;
  v_contact record;
  v_identity public.builder_contact_identities%rowtype;
  v_consent public.builder_consents%rowtype;
  v_decision_id uuid;
  v_recipient_id uuid;
  v_snapshot_id uuid;
  v_existing_recipient public.builder_campaign_recipients%rowtype;
  v_action text;
  v_reason_code text;
  v_body text;
  v_items jsonb := '[]'::jsonb;
  v_evaluated integer := 0;
  v_materialized integer := 0;
  v_suppressed integer := 0;
  v_candidate_count integer := 0;
  v_frequency_count integer;
  v_local_time time;
  v_quiet boolean := false;
  v_next_cursor text;
  v_status text;
  v_run_key text;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'scheduleId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'campaignId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'approvalId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'leaseToken', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or char_length(coalesce(p_request ->> 'workerId', '')) not between 1 and 255
  then
    raise exception 'invalid campaign materialization request' using errcode = '22023';
  end if;

  v_site_id := (p_request ->> 'siteId')::uuid;
  v_schedule_id := (p_request ->> 'scheduleId')::uuid;
  v_campaign_id := (p_request ->> 'campaignId')::uuid;
  v_approval_id := (p_request ->> 'approvalId')::uuid;
  v_worker_id := p_request ->> 'workerId';
  v_lease_token := (p_request ->> 'leaseToken')::uuid;
  v_now := coalesce((p_request ->> 'now')::timestamptz, statement_timestamp());
  v_limit := greatest(1, least(100, coalesce((p_request ->> 'limit')::integer, 50)));
  v_cursor := nullif(p_request ->> 'cursor', '');

  select * into v_schedule
  from public.builder_campaign_schedules
  where site_id = v_site_id and id = v_schedule_id
    and campaign_id = v_campaign_id and approval_id = v_approval_id
  for update;
  if not found
    or v_schedule.state <> 'sending'
    or v_schedule.lease_owner <> v_worker_id
    or v_schedule.lease_token <> v_lease_token
    or v_schedule.lease_expires_at < v_now
  then
    raise exception 'campaign materialization lease is invalid' using errcode = '42501';
  end if;

  select * into v_campaign
  from public.builder_campaigns
  where site_id = v_site_id and id = v_campaign_id;
  select * into v_approval
  from public.builder_campaign_approvals
  where site_id = v_site_id and id = v_approval_id and state = 'approved';
  if v_campaign.state <> 'sending' or v_approval.id is null then
    raise exception 'campaign is not approved for sending' using errcode = '42501';
  end if;
  select * into v_revision
  from public.builder_campaign_revisions
  where site_id = v_site_id and id = v_approval.campaign_revision_id;
  select * into v_segment
  from public.builder_campaign_segment_revisions
  where site_id = v_site_id and id = v_approval.segment_revision_id;

  if v_revision.id is null or v_segment.id is null
    or v_revision.content_digest <> v_approval.content_digest
    or v_segment.audience_digest <> v_approval.audience_digest
  then
    raise exception 'campaign approval lineage is invalid' using errcode = '23514';
  end if;

  if v_schedule.quiet_hours_start is not null then
    v_local_time := (v_now at time zone v_schedule.time_zone)::time;
    v_quiet := case
      when v_schedule.quiet_hours_start < v_schedule.quiet_hours_end
        then v_local_time >= v_schedule.quiet_hours_start
          and v_local_time < v_schedule.quiet_hours_end
      else v_local_time >= v_schedule.quiet_hours_start
        or v_local_time < v_schedule.quiet_hours_end
    end;
  end if;
  if v_quiet then
    update public.builder_campaign_schedules
    set next_attempt_at = v_now + interval '1 hour', updated_at = v_now
    where site_id = v_site_id and id = v_schedule_id;
    return jsonb_build_object(
      'version', 1, 'status', 'deferred', 'recipients', '[]'::jsonb,
      'nextCursor', v_cursor, 'deferredUntil', v_now + interval '1 hour',
      'evaluatedCount', 0, 'materializedCount', 0, 'suppressedCount', 0
    );
  end if;

  v_run_key := 'campaign-materialize:' || v_schedule_id::text || ':' ||
    coalesce(v_cursor, 'start');
  insert into public.builder_campaign_materialization_runs (
    site_id, schedule_id, campaign_id, approval_id, idempotency_key,
    cursor, state, lease_owner, lease_token, lease_expires_at
  ) values (
    v_site_id, v_schedule_id, v_campaign_id, v_approval_id, v_run_key,
    v_cursor, 'claimed', v_worker_id, v_lease_token, v_schedule.lease_expires_at
  )
  on conflict (site_id, idempotency_key) do nothing;

  for v_contact in
    select contact.id
    from public.builder_contacts contact
    where contact.site_id = v_site_id
      and contact.lifecycle_state = 'active'
      and contact.id::text > coalesce(v_cursor, '')
      and (
        (v_segment.source = 'explicit_list' and contact.id = any(v_segment.explicit_contact_ids))
        or v_segment.source = 'query'
      )
    order by contact.id::text
    limit v_limit
  loop
    v_candidate_count := v_candidate_count + 1;
    v_evaluated := v_evaluated + 1;
    v_next_cursor := v_contact.id::text;

    select * into v_existing_recipient
    from public.builder_campaign_recipients
    where site_id = v_site_id
      and campaign_id = v_campaign_id
      and schedule_id = v_schedule_id
      and contact_id = v_contact.id;
    if found then
      if v_existing_recipient.send_snapshot_id is not null
        and v_existing_recipient.state in ('materialized', 'delivery_requested', 'completed')
      then
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'recipientId', v_existing_recipient.id,
          'sendSnapshotId', v_existing_recipient.send_snapshot_id
        ));
        v_materialized := v_materialized + 1;
      else
        v_suppressed := v_suppressed + 1;
      end if;
      continue;
    end if;

    select identity.* into v_identity
    from public.builder_contact_identities identity
    where identity.site_id = v_site_id
      and identity.contact_id = v_contact.id
      and identity.kind = case when v_campaign.channel = 'sms' then 'phone' else 'email' end
      and identity.verification_state <> 'invalid'
    order by (identity.verification_state = 'verified') desc, identity.created_at, identity.id
    limit 1;

    select consent.* into v_consent
    from public.builder_consents consent
    where consent.site_id = v_site_id
      and consent.contact_id = v_contact.id
      and consent.channel = v_campaign.channel
      and consent.purpose = case
        when v_campaign.purpose = 'public_office_campaign'
          then 'public_office_campaign'
        else v_campaign.purpose
      end
    order by consent.captured_at desc, consent.created_at desc, consent.id desc
    limit 1;

    v_action := 'allow';
    v_reason_code := 'eligible';
    if v_identity.id is null then
      v_action := 'suppress';
      v_reason_code := 'destination_reference_missing';
    elsif v_campaign.purpose = 'public_office_campaign'
      and (v_segment.data_source = 'constituent_service')
      and (v_consent.id is null or v_consent.state <> 'granted')
    then
      v_action := 'suppress';
      v_reason_code := 'public_office_marketing_consent_required';
    elsif v_consent.id is null or v_consent.state <> 'granted' then
      v_action := 'suppress';
      v_reason_code := 'marketing_consent_required';
    elsif exists (
      select 1 from public.builder_suppressions suppression
      where suppression.site_id = v_site_id
        and suppression.contact_id = v_contact.id
        and suppression.channel = v_campaign.channel
        and suppression.active
    ) then
      v_action := 'suppress';
      v_reason_code := 'active_suppression';
    else
      select count(*) into v_frequency_count
      from public.builder_campaign_deliveries delivery
      join public.builder_campaign_recipients recipient
        on recipient.site_id = delivery.site_id and recipient.id = delivery.recipient_id
      where delivery.site_id = v_site_id
        and recipient.contact_id = v_contact.id
        and delivery.requested_at >= v_now - v_schedule.frequency_window
        and delivery.state not in ('cancelled', 'suppressed');
      if v_frequency_count >= v_schedule.frequency_max then
        v_action := 'suppress';
        v_reason_code := 'frequency_cap_reached';
      end if;
    end if;

    v_decision_id := gen_random_uuid();
    insert into public.builder_campaign_recipient_decisions (
      site_id, id, campaign_id, schedule_id, approval_id, contact_id,
      contact_identity_id, action, reason_code, consent_decision_version,
      suppression_decision_version, evidence, evaluated_at
    ) values (
      v_site_id, v_decision_id, v_campaign_id, v_schedule_id, v_approval_id,
      v_contact.id, case when v_action = 'allow' then v_identity.id else null end,
      v_action, v_reason_code, v_approval.consent_decision_version,
      v_approval.suppression_decision_version,
      jsonb_build_object(
        'policyVersion', 1,
        'consentEvidenceId', case when v_consent.id is null then null else v_consent.id::text end,
        'suppressionCheckedAt', v_now
      ),
      v_now
    );

    v_recipient_id := gen_random_uuid();
    insert into public.builder_campaign_recipients (
      site_id, id, campaign_id, schedule_id, approval_id, contact_id,
      contact_identity_id, decision_id, state, reason_code
    ) values (
      v_site_id, v_recipient_id, v_campaign_id, v_schedule_id, v_approval_id,
      v_contact.id, case when v_action = 'allow' then v_identity.id else null end,
      v_decision_id, case when v_action = 'allow' then 'materialized' else 'suppressed' end,
      v_reason_code
    );

    if v_action = 'allow' then
      v_snapshot_id := gen_random_uuid();
      v_body := coalesce(
        nullif(v_revision.editable_content ->> 'body', ''),
        v_revision.editable_content::text
      );
      insert into public.builder_campaign_send_snapshots (
        site_id, id, campaign_id, schedule_id, recipient_id, approval_id,
        campaign_revision_id, template_revision_id, segment_revision_id,
        brand_revision_id, sender_config_revision_id, provider_config_revision_id,
        contact_identity_id, destination_reference, channel, purpose,
        rendered_subject, rendered_body, link_destinations, content_digest,
        audience_digest, consent_decision_version, suppression_decision_version,
        rendered_at
      ) values (
        v_site_id, v_snapshot_id, v_campaign_id, v_schedule_id, v_recipient_id,
        v_approval_id, v_revision.id, v_approval.template_revision_id,
        v_approval.segment_revision_id, v_approval.brand_revision_id,
        v_approval.sender_config_revision_id, v_approval.provider_config_revision_id,
        v_identity.id, 'contact-identity:' || v_identity.id::text,
        v_campaign.channel, v_campaign.purpose, v_revision.subject, v_body,
        v_approval.link_destinations, v_approval.content_digest,
        v_approval.audience_digest, v_approval.consent_decision_version,
        v_approval.suppression_decision_version, v_now
      );
      update public.builder_campaign_recipients
      set send_snapshot_id = v_snapshot_id, updated_at = v_now
      where site_id = v_site_id and id = v_recipient_id;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'recipientId', v_recipient_id, 'sendSnapshotId', v_snapshot_id
      ));
      v_materialized := v_materialized + 1;
    else
      v_suppressed := v_suppressed + 1;
    end if;
  end loop;

  v_status := case when v_candidate_count < v_limit then 'completed' else 'partial' end;
  update public.builder_campaign_materialization_runs
  set state = case when v_status = 'completed' then 'completed' else 'pending' end,
      cursor = v_next_cursor,
      evaluated_count = v_evaluated,
      materialized_count = v_materialized,
      suppressed_count = v_suppressed,
      lease_owner = case when v_status = 'completed' then null else lease_owner end,
      lease_token = case when v_status = 'completed' then null else lease_token end,
      lease_expires_at = case when v_status = 'completed' then null else lease_expires_at end,
      updated_at = v_now
  where site_id = v_site_id and idempotency_key = v_run_key;

  return jsonb_build_object(
    'version', 1, 'status', v_status, 'recipients', v_items,
    'nextCursor', case when v_status = 'partial' then v_next_cursor else null end,
    'deferredUntil', null,
    'evaluatedCount', v_evaluated,
    'materializedCount', v_materialized,
    'suppressedCount', v_suppressed
  );
end;
$$;

create function public.builder_enqueue_campaign_recipient_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_schedule_id uuid;
  v_campaign_id uuid;
  v_approval_id uuid;
  v_recipient_id uuid;
  v_snapshot_id uuid;
  v_worker_id text;
  v_lease_token uuid;
  v_now timestamptz;
  v_schedule public.builder_campaign_schedules%rowtype;
  v_campaign public.builder_campaigns%rowtype;
  v_recipient public.builder_campaign_recipients%rowtype;
  v_snapshot public.builder_campaign_send_snapshots%rowtype;
  v_sender public.builder_messaging_senders%rowtype;
  v_consent public.builder_consents%rowtype;
  v_existing public.builder_campaign_deliveries%rowtype;
  v_conversation_id uuid := gen_random_uuid();
  v_message_template_id uuid := gen_random_uuid();
  v_message_template_revision_id uuid := gen_random_uuid();
  v_message_id uuid := gen_random_uuid();
  v_outbox_id uuid := gen_random_uuid();
  v_messaging_delivery_id uuid := gen_random_uuid();
  v_campaign_delivery_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_provider_key text;
  v_purpose text;
  v_local_time time;
  v_quiet boolean := false;
  v_frequency_count integer;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'scheduleId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'campaignId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'approvalId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'recipientId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'sendSnapshotId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'leaseToken', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or char_length(coalesce(p_request ->> 'workerId', '')) not between 1 and 255
  then
    raise exception 'invalid campaign enqueue request' using errcode = '22023';
  end if;

  v_site_id := (p_request ->> 'siteId')::uuid;
  v_schedule_id := (p_request ->> 'scheduleId')::uuid;
  v_campaign_id := (p_request ->> 'campaignId')::uuid;
  v_approval_id := (p_request ->> 'approvalId')::uuid;
  v_recipient_id := (p_request ->> 'recipientId')::uuid;
  v_snapshot_id := (p_request ->> 'sendSnapshotId')::uuid;
  v_worker_id := p_request ->> 'workerId';
  v_lease_token := (p_request ->> 'leaseToken')::uuid;
  v_now := coalesce((p_request ->> 'now')::timestamptz, statement_timestamp());

  select * into v_schedule
  from public.builder_campaign_schedules
  where site_id = v_site_id and id = v_schedule_id
    and campaign_id = v_campaign_id and approval_id = v_approval_id;
  if not found
    or v_schedule.state <> 'sending'
    or v_schedule.lease_owner <> v_worker_id
    or v_schedule.lease_token <> v_lease_token
    or v_schedule.lease_expires_at < v_now
  then
    raise exception 'campaign enqueue lease is invalid' using errcode = '42501';
  end if;
  if not builder_private.module_action_allowed(
    v_site_id, 'growth.campaigns', 'outbound'
  ) or not builder_private.module_action_allowed(
    v_site_id, 'growth.messaging', 'outbound'
  ) then
    raise exception 'campaign outbound action is not authorized' using errcode = '42501';
  end if;

  select * into v_recipient
  from public.builder_campaign_recipients
  where site_id = v_site_id and id = v_recipient_id
    and campaign_id = v_campaign_id and schedule_id = v_schedule_id
  for update;
  select * into v_snapshot
  from public.builder_campaign_send_snapshots
  where site_id = v_site_id and id = v_snapshot_id
    and recipient_id = v_recipient_id and approval_id = v_approval_id;
  select * into v_campaign
  from public.builder_campaigns
  where site_id = v_site_id and id = v_campaign_id;
  if v_recipient.id is null or v_snapshot.id is null
    or v_recipient.send_snapshot_id <> v_snapshot.id
    or v_recipient.state not in ('materialized', 'delivery_requested')
    or v_campaign.state <> 'sending'
  then
    raise exception 'campaign recipient is not enqueueable' using errcode = '42501';
  end if;

  select * into v_existing
  from public.builder_campaign_deliveries
  where site_id = v_site_id and recipient_id = v_recipient_id;
  if found then
    return jsonb_build_object(
      'version', 1, 'status', 'replayed', 'recipientId', v_recipient_id,
      'campaignDeliveryId', v_existing.id,
      'messagingDeliveryId', v_existing.messaging_delivery_id,
      'reasonCode', null
    );
  end if;

  select consent.* into v_consent
  from public.builder_consents consent
  where consent.site_id = v_site_id
    and consent.contact_id = v_recipient.contact_id
    and consent.channel = v_snapshot.channel
    and consent.purpose = case
      when v_snapshot.purpose = 'public_office_campaign'
        then 'public_office_campaign'
      else v_snapshot.purpose
    end
  order by consent.captured_at desc, consent.created_at desc, consent.id desc
  limit 1;

  if v_consent.id is null or v_consent.state <> 'granted'
    or exists (
      select 1 from public.builder_suppressions suppression
      where suppression.site_id = v_site_id
        and suppression.contact_id = v_recipient.contact_id
        and suppression.channel = v_snapshot.channel
        and suppression.active
    )
  then
    update public.builder_campaign_recipients
    set state = 'suppressed',
        reason_code = case
          when v_snapshot.purpose = 'public_office_campaign'
            then 'public_office_marketing_consent_required'
          else 'consent_or_suppression_changed'
        end,
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_recipient_id;
    return jsonb_build_object(
      'version', 1, 'status', 'suppressed', 'recipientId', v_recipient_id,
      'campaignDeliveryId', null, 'messagingDeliveryId', null,
      'reasonCode', case
        when v_snapshot.purpose = 'public_office_campaign'
          then 'public_office_marketing_consent_required'
        else 'consent_or_suppression_changed'
      end
    );
  end if;

  if v_schedule.quiet_hours_start is not null then
    v_local_time := (v_now at time zone v_schedule.time_zone)::time;
    v_quiet := case
      when v_schedule.quiet_hours_start < v_schedule.quiet_hours_end
        then v_local_time >= v_schedule.quiet_hours_start
          and v_local_time < v_schedule.quiet_hours_end
      else v_local_time >= v_schedule.quiet_hours_start
        or v_local_time < v_schedule.quiet_hours_end
    end;
  end if;
  if v_quiet then
    update public.builder_campaign_schedules
    set next_attempt_at = v_now + interval '1 hour', updated_at = v_now
    where site_id = v_site_id and id = v_schedule_id;
    return jsonb_build_object(
      'version', 1, 'status', 'deferred', 'recipientId', v_recipient_id,
      'campaignDeliveryId', null, 'messagingDeliveryId', null,
      'reasonCode', 'quiet_hours'
    );
  end if;

  select count(*) into v_frequency_count
  from public.builder_campaign_deliveries delivery
  join public.builder_campaign_recipients prior_recipient
    on prior_recipient.site_id = delivery.site_id
    and prior_recipient.id = delivery.recipient_id
  where delivery.site_id = v_site_id
    and prior_recipient.contact_id = v_recipient.contact_id
    and delivery.requested_at >= v_now - v_schedule.frequency_window
    and delivery.state not in ('cancelled', 'suppressed');
  if v_frequency_count >= v_schedule.frequency_max then
    update public.builder_campaign_recipients
    set state = 'suppressed', reason_code = 'frequency_cap_reached',
        version = version + 1, updated_at = v_now
    where site_id = v_site_id and id = v_recipient_id;
    return jsonb_build_object(
      'version', 1, 'status', 'suppressed', 'recipientId', v_recipient_id,
      'campaignDeliveryId', null, 'messagingDeliveryId', null,
      'reasonCode', 'frequency_cap_reached'
    );
  end if;

  select * into v_sender
  from public.builder_messaging_senders
  where site_id = v_site_id and id = v_snapshot.sender_config_revision_id
    and channel = v_snapshot.channel and state = 'verified';
  if not found then
    raise exception 'campaign sender is not ready' using errcode = '42501';
  end if;
  select connection.provider_key into v_provider_key
  from public.builder_provider_connections connection
  where connection.site_id = v_site_id
    and connection.id = v_sender.connection_id
    and connection.state = 'ready';
  if v_provider_key is null then
    raise exception 'campaign provider is not ready' using errcode = '42501';
  end if;

  v_purpose := v_snapshot.purpose;
  insert into public.builder_message_templates (
    site_id, id, stable_key, channel, purpose, state
  ) values (
    v_site_id, v_message_template_id,
    'campaign-' || replace(v_recipient_id::text, '-', ''),
    v_snapshot.channel, v_purpose, 'published'
  );
  insert into public.builder_message_template_revisions (
    site_id, id, template_id, revision_number, channel, purpose,
    subject, body, state, published_at
  ) values (
    v_site_id, v_message_template_revision_id, v_message_template_id, 1,
    v_snapshot.channel, v_purpose, v_snapshot.rendered_subject,
    v_snapshot.rendered_body, 'published', v_now
  );
  update public.builder_message_templates
  set current_revision_id = v_message_template_revision_id, updated_at = v_now
  where site_id = v_site_id and id = v_message_template_id;

  insert into public.builder_messaging_conversations (
    site_id, id, channel, purpose, state
  ) values (
    v_site_id, v_conversation_id, v_snapshot.channel, v_purpose, 'waiting_on_staff'
  );
  insert into public.builder_messaging_conversation_participants (
    site_id, conversation_id, role, contact_id
  ) values (
    v_site_id, v_conversation_id, 'customer', v_recipient.contact_id
  );
  insert into public.builder_messages (
    site_id, id, conversation_id, direction, channel, purpose,
    author_type, body_format, body, template_revision_id, state
  ) values (
    v_site_id, v_message_id, v_conversation_id, 'outbound',
    v_snapshot.channel, v_purpose, 'system', 'rich_text',
    v_snapshot.rendered_body, v_message_template_revision_id, 'delivery_requested'
  );

  insert into public.builder_outbox (
    site_id, id, topic, payload, idempotency_key, schema_version,
    aggregate_type, aggregate_id, correlation_id, module_id, channel,
    provider_key, purpose, contact_id
  ) values (
    v_site_id, v_outbox_id, 'growth.message.delivery_requested',
    jsonb_build_object('version', 1, 'deliveryId', v_messaging_delivery_id),
    'campaign-delivery:' || v_recipient_id::text, 1, 'message',
    v_message_id, v_correlation_id, 'growth.messaging',
    v_snapshot.channel, v_provider_key, v_purpose, v_recipient.contact_id
  );
  insert into public.builder_message_deliveries (
    site_id, id, message_id, conversation_id, contact_id, sender_id,
    destination_reference, channel, purpose, outbox_id, idempotency_key,
    correlation_id
  ) values (
    v_site_id, v_messaging_delivery_id, v_message_id, v_conversation_id,
    v_recipient.contact_id, v_sender.id, v_snapshot.destination_reference,
    v_snapshot.channel, v_purpose, v_outbox_id,
    'campaign-delivery:' || v_recipient_id::text, v_correlation_id
  );
  insert into public.builder_campaign_deliveries (
    site_id, id, campaign_id, recipient_id, send_snapshot_id,
    messaging_delivery_id, messaging_message_id, state, idempotency_key,
    requested_at, updated_at
  ) values (
    v_site_id, v_campaign_delivery_id, v_campaign_id, v_recipient_id,
    v_snapshot_id, v_messaging_delivery_id, v_message_id, 'requested',
    'campaign-delivery:' || v_recipient_id::text, v_now, v_now
  );
  insert into public.builder_message_events (
    site_id, message_id, conversation_id, event_type, actor_type,
    from_state, to_state, correlation_id, occurred_at
  ) values (
    v_site_id, v_message_id, v_conversation_id, 'message.delivery_requested',
    'system', 'draft', 'delivery_requested', v_correlation_id, v_now
  );
  insert into public.builder_message_delivery_events (
    site_id, delivery_id, message_id, event_type, to_state,
    correlation_id, occurred_at
  ) values (
    v_site_id, v_messaging_delivery_id, v_message_id, 'delivery.requested',
    'requested', v_correlation_id, v_now
  );
  insert into public.builder_campaign_delivery_events (
    site_id, campaign_delivery_id, messaging_delivery_id, event_type,
    to_state, correlation_id, occurred_at
  ) values (
    v_site_id, v_campaign_delivery_id, v_messaging_delivery_id,
    'delivery.requested', 'requested', v_correlation_id, v_now
  );
  update public.builder_campaign_recipients
  set state = 'delivery_requested', reason_code = 'delivery_requested',
      version = version + 1, updated_at = v_now
  where site_id = v_site_id and id = v_recipient_id;

  return jsonb_build_object(
    'version', 1, 'status', 'enqueued', 'recipientId', v_recipient_id,
    'campaignDeliveryId', v_campaign_delivery_id,
    'messagingDeliveryId', v_messaging_delivery_id, 'reasonCode', null
  );
end;
$$;

create function public.builder_reconcile_campaign_delivery_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid;
  v_campaign_delivery_id uuid;
  v_now timestamptz;
  v_delivery public.builder_campaign_deliveries%rowtype;
  v_messaging public.builder_message_deliveries%rowtype;
  v_changed boolean := false;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'campaignDeliveryId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'invalid campaign delivery reconciliation' using errcode = '22023';
  end if;
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_campaign_delivery_id := (p_request ->> 'campaignDeliveryId')::uuid;
  v_now := coalesce((p_request ->> 'now')::timestamptz, statement_timestamp());

  select * into v_delivery
  from public.builder_campaign_deliveries
  where site_id = v_site_id and id = v_campaign_delivery_id
  for update;
  if not found then
    raise exception 'campaign delivery not found' using errcode = 'P0002';
  end if;
  select * into v_messaging
  from public.builder_message_deliveries
  where site_id = v_site_id and id = v_delivery.messaging_delivery_id;
  if not found then
    raise exception 'messaging delivery not found' using errcode = 'P0002';
  end if;

  if v_delivery.state <> v_messaging.state or v_delivery.attempt <> v_messaging.attempt then
    insert into public.builder_campaign_delivery_events (
      site_id, campaign_delivery_id, messaging_delivery_id, event_type,
      from_state, to_state, reason_code, correlation_id, occurred_at
    ) values (
      v_site_id, v_delivery.id, v_messaging.id, 'delivery.reconciled',
      v_delivery.state, v_messaging.state, v_messaging.reason_code,
      v_messaging.correlation_id, v_now
    );
    update public.builder_campaign_deliveries
    set state = v_messaging.state,
        attempt = v_messaging.attempt,
        version = version + 1,
        updated_at = v_now
    where site_id = v_site_id and id = v_delivery.id;
    v_changed := true;

    if v_messaging.state in (
      'delivered', 'failed_terminal', 'suppressed', 'cancelled'
    ) then
      update public.builder_campaign_recipients
      set state = case
            when v_messaging.state = 'delivered' then 'completed'
            when v_messaging.state in ('suppressed', 'cancelled') then 'suppressed'
            else 'completed'
          end,
          reason_code = coalesce(v_messaging.reason_code, v_messaging.state),
          version = version + 1,
          updated_at = v_now
      where site_id = v_site_id and id = v_delivery.recipient_id;
    end if;
  end if;

  return jsonb_build_object(
    'version', 1,
    'status', case when v_changed then 'reconciled' else 'replayed' end,
    'campaignDeliveryId', v_delivery.id,
    'messagingDeliveryId', v_messaging.id,
    'deliveryState', v_messaging.state
  );
end;
$$;

create function public.builder_import_newsletter_consent_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_submission_id uuid;
  v_contact_id uuid;
  v_command_id uuid;
  v_idempotency_key text;
  v_review_reason text;
  v_reviewed_at timestamptz;
  v_submission public.builder_form_submissions%rowtype;
  v_base_consent public.builder_form_submission_consents%rowtype;
  v_identity public.builder_contact_identities%rowtype;
  v_import public.builder_campaign_newsletter_imports%rowtype;
  v_consent_id uuid := gen_random_uuid();
  v_import_id uuid := gen_random_uuid();
  v_email text;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'actorId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'submissionId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'contactId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'commandId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or char_length(coalesce(p_request ->> 'idempotencyKey', '')) not between 1 and 255
    or char_length(btrim(coalesce(p_request ->> 'reviewReason', ''))) not between 12 and 1000
  then
    raise exception 'invalid reviewed Newsletter Signup import' using errcode = '22023';
  end if;

  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_submission_id := (p_request ->> 'submissionId')::uuid;
  v_contact_id := (p_request ->> 'contactId')::uuid;
  v_command_id := (p_request ->> 'commandId')::uuid;
  v_idempotency_key := p_request ->> 'idempotencyKey';
  v_review_reason := btrim(p_request ->> 'reviewReason');
  v_reviewed_at := (p_request ->> 'reviewedAt')::timestamptz;

  select * into v_import
  from public.builder_campaign_newsletter_imports
  where site_id = v_site_id and idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object(
      'version', 1, 'status', 'replayed',
      'importId', v_import.id, 'consentId', v_import.consent_id
    );
  end if;
  if not builder_private.campaign_member_allowed(
    v_site_id, v_actor_id, 'campaigns.create', 'write'
  ) then
    raise exception 'Newsletter Signup import is not authorized' using errcode = '42501';
  end if;

  select * into v_submission
  from public.builder_form_submissions
  where site_id = v_site_id and id = v_submission_id
  for update;
  if not found or v_submission.template_id <> 'local-business.newsletter-signup' then
    raise exception 'submission is not a Newsletter Signup' using errcode = '22023';
  end if;
  v_email := lower(btrim(v_submission.payload ->> 'email'));
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Newsletter Signup email is invalid' using errcode = '22023';
  end if;

  select * into v_base_consent
  from public.builder_form_submission_consents
  where site_id = v_site_id and submission_id = v_submission_id
  order by captured_at desc, id desc
  limit 1;
  if not found or exists (
    select 1
    from public.builder_form_submission_consent_events event
    where event.site_id = v_site_id
      and event.submission_id = v_submission_id
      and event.base_consent_id = v_base_consent.id
      and event.event_kind = 'withdrawn'
      and event.occurred_at <= v_reviewed_at
  ) then
    raise exception 'Newsletter Signup consent is unavailable or withdrawn'
      using errcode = '42501';
  end if;

  select * into v_identity
  from public.builder_contact_identities
  where site_id = v_site_id
    and contact_id = v_contact_id
    and kind = 'email'
    and normalized_value = v_email
    and verification_state <> 'invalid'
  order by (verification_state = 'verified') desc, created_at, id
  limit 1;
  if not found then
    raise exception 'Newsletter Signup identity requires exact reviewed match'
      using errcode = '42501';
  end if;

  insert into public.builder_consents (
    site_id, id, contact_id, base_consent_id, purpose, channel,
    state, captured_at
  ) values (
    v_site_id, v_consent_id, v_contact_id, v_base_consent.id,
    'marketing_email', 'email', 'granted', v_base_consent.captured_at
  );
  insert into public.builder_campaign_newsletter_imports (
    site_id, id, submission_id, base_consent_id, contact_id,
    contact_identity_id, consent_id, actor_id, command_id,
    idempotency_key, review_reason, reviewed_at
  ) values (
    v_site_id, v_import_id, v_submission_id, v_base_consent.id,
    v_contact_id, v_identity.id, v_consent_id, v_actor_id, v_command_id,
    v_idempotency_key, v_review_reason, v_reviewed_at
  );

  return jsonb_build_object(
    'version', 1, 'status', 'imported',
    'importId', v_import_id, 'consentId', v_consent_id
  );
end;
$$;

create function public.builder_record_campaign_ai_draft_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_campaign_id uuid;
  v_draft_id uuid;
  v_actor_id uuid;
  v_prompt_version_id uuid;
  v_model_configuration_version_id uuid;
  v_provider_result jsonb;
  v_response_text text;
  v_source_revision_ids uuid[];
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'campaignId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'draftId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'actorId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'promptVersionId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'modelConfigurationVersionId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'providerKind', '') !~ '^[a-z][a-z0-9._-]{0,127}$'
    or jsonb_typeof(p_request -> 'providerResult') <> 'object'
  then
    raise exception 'invalid campaign AI draft evidence' using errcode = '22023';
  end if;

  v_site_id := (p_request ->> 'siteId')::uuid;
  v_campaign_id := (p_request ->> 'campaignId')::uuid;
  v_draft_id := (p_request ->> 'draftId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_prompt_version_id := (p_request ->> 'promptVersionId')::uuid;
  v_model_configuration_version_id :=
    (p_request ->> 'modelConfigurationVersionId')::uuid;
  v_provider_result := p_request -> 'providerResult';

  if exists (
    select 1 from public.builder_campaign_ai_drafts
    where site_id = v_site_id and id = v_draft_id
  ) then
    return jsonb_build_object(
      'version', 1, 'status', 'replayed', 'draftId', v_draft_id
    );
  end if;
  if not builder_private.campaign_member_allowed(
    v_site_id, v_actor_id, 'campaigns.create', 'write'
  ) or not builder_private.module_action_allowed(v_site_id, 'growth.ai', 'write') then
    raise exception 'campaign AI draft is not authorized' using errcode = '42501';
  end if;
  if v_provider_result ->> 'outcome' <> 'completed'
    or jsonb_typeof(v_provider_result #> '{proposal,toolRequests}') <> 'array'
    or jsonb_array_length(v_provider_result #> '{proposal,toolRequests}') <> 0
    or char_length(coalesce(v_provider_result #>> '{proposal,responseText}', '')) not between 1 and 8000
  then
    raise exception 'AI campaign proposal must remain draft-only without tools'
      using errcode = '42501';
  end if;
  v_response_text := v_provider_result #>> '{proposal,responseText}';
  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into v_source_revision_ids
  from jsonb_array_elements_text(
    coalesce(v_provider_result #> '{proposal,sourceRevisionIds}', '[]'::jsonb)
  );

  insert into public.builder_campaign_ai_drafts (
    site_id, id, campaign_id, actor_id, prompt_version_id,
    model_configuration_version_id, provider_kind, approval_state,
    response_text, source_revision_ids, decision_evidence, created_at
  ) values (
    v_site_id, v_draft_id, v_campaign_id, v_actor_id, v_prompt_version_id,
    v_model_configuration_version_id, p_request ->> 'providerKind', 'draft',
    v_response_text, v_source_revision_ids, v_provider_result,
    (p_request ->> 'createdAt')::timestamptz
  );
  return jsonb_build_object(
    'version', 1, 'status', 'recorded', 'draftId', v_draft_id
  );
end;
$$;

create function public.builder_list_campaigns_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_limit integer;
  v_items jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'actorId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'invalid campaign list request' using errcode = '22023';
  end if;
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_limit := greatest(1, least(100, coalesce((p_request ->> 'limit')::integer, 50)));
  if not builder_private.campaign_member_allowed(
    v_site_id, v_actor_id, 'campaigns.read', 'read'
  ) then
    raise exception 'campaign list is not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'updatedAt' desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'campaignId', campaign.id,
      'stableKey', campaign.stable_key,
      'name', campaign.name,
      'kind', campaign.kind,
      'channel', campaign.channel,
      'purpose', campaign.purpose,
      'state', campaign.state,
      'version', campaign.version,
      'updatedAt', campaign.updated_at
    ) as item
    from public.builder_campaigns campaign
    where campaign.site_id = v_site_id
      and (
        nullif(p_request ->> 'cursor', '') is null
        or campaign.id::text > p_request ->> 'cursor'
      )
    order by campaign.id
    limit v_limit
  ) rows;
  return jsonb_build_object('version', 1, 'items', v_items);
end;
$$;

create function public.builder_get_campaign_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_campaign_id uuid;
  v_result jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'actorId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'campaignId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'invalid campaign detail request' using errcode = '22023';
  end if;
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_campaign_id := (p_request ->> 'campaignId')::uuid;
  if not builder_private.campaign_member_allowed(
    v_site_id, v_actor_id, 'campaigns.read', 'read'
  ) then
    raise exception 'campaign detail is not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'version', 1,
    'campaign', jsonb_build_object(
      'campaignId', campaign.id,
      'stableKey', campaign.stable_key,
      'name', campaign.name,
      'kind', campaign.kind,
      'channel', campaign.channel,
      'purpose', campaign.purpose,
      'state', campaign.state,
      'currentRevisionId', campaign.current_revision_id,
      'version', campaign.version,
      'createdAt', campaign.created_at,
      'updatedAt', campaign.updated_at
    ),
    'schedule', case when schedule.id is null then null else jsonb_build_object(
      'scheduleId', schedule.id,
      'approvalId', schedule.approval_id,
      'startsAt', schedule.starts_at,
      'timeZone', schedule.time_zone,
      'state', schedule.state,
      'version', schedule.version
    ) end
  )
  into v_result
  from public.builder_campaigns campaign
  left join lateral (
    select item.*
    from public.builder_campaign_schedules item
    where item.site_id = campaign.site_id and item.campaign_id = campaign.id
    order by item.created_at desc, item.id desc
    limit 1
  ) schedule on true
  where campaign.site_id = v_site_id and campaign.id = v_campaign_id;
  if v_result is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create function public.builder_get_campaign_metrics_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_campaign_id uuid;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request ->> 'version' <> '1'
    or coalesce(p_request ->> 'siteId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'actorId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'campaignId', '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'invalid campaign metrics request' using errcode = '22023';
  end if;
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_campaign_id := (p_request ->> 'campaignId')::uuid;
  if not builder_private.campaign_member_allowed(
    v_site_id, v_actor_id, 'campaigns.read', 'read'
  ) then
    raise exception 'campaign metrics are not authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'version', 1,
    'campaignId', v_campaign_id,
    'recipients', (
      select count(*) from public.builder_campaign_recipients
      where site_id = v_site_id and campaign_id = v_campaign_id
    ),
    'suppressed', (
      select count(*) from public.builder_campaign_recipients
      where site_id = v_site_id and campaign_id = v_campaign_id
        and state = 'suppressed'
    ),
    'requested', (
      select count(*) from public.builder_campaign_deliveries
      where site_id = v_site_id and campaign_id = v_campaign_id
    ),
    'delivered', (
      select count(*) from public.builder_campaign_deliveries
      where site_id = v_site_id and campaign_id = v_campaign_id
        and state = 'delivered'
    ),
    'failed', (
      select count(*) from public.builder_campaign_deliveries
      where site_id = v_site_id and campaign_id = v_campaign_id
        and state in ('failed_terminal', 'reconciliation_required')
    )
  );
end;
$$;

revoke all on function public.builder_apply_campaign_command_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_claim_due_campaign_schedules_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_materialize_campaign_batch_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_enqueue_campaign_recipient_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_reconcile_campaign_delivery_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_cancel_queued_campaign_work_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_import_newsletter_consent_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_record_campaign_ai_draft_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_list_campaigns_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_get_campaign_v1(jsonb)
from public, anon, authenticated;
revoke all on function public.builder_get_campaign_metrics_v1(jsonb)
from public, anon, authenticated;

grant execute on function public.builder_apply_campaign_command_v1(jsonb) to service_role;
grant execute on function public.builder_claim_due_campaign_schedules_v1(jsonb) to service_role;
grant execute on function public.builder_materialize_campaign_batch_v1(jsonb) to service_role;
grant execute on function public.builder_enqueue_campaign_recipient_v1(jsonb) to service_role;
grant execute on function public.builder_reconcile_campaign_delivery_v1(jsonb) to service_role;
grant execute on function public.builder_cancel_queued_campaign_work_v1(jsonb) to service_role;
grant execute on function public.builder_import_newsletter_consent_v1(jsonb) to service_role;
grant execute on function public.builder_record_campaign_ai_draft_v1(jsonb) to service_role;
grant execute on function public.builder_list_campaigns_v1(jsonb) to service_role;
grant execute on function public.builder_get_campaign_v1(jsonb) to service_role;
grant execute on function public.builder_get_campaign_metrics_v1(jsonb) to service_role;
