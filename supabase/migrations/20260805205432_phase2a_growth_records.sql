create table public.builder_contacts (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 200),
  lifecycle_state text not null default 'active' check (lifecycle_state in ('active', 'inactive', 'merged', 'deleted')),
  preferred_contact_method text check (preferred_contact_method is null or preferred_contact_method in ('email', 'phone', 'none')),
  service_zip_code text check (service_zip_code is null or service_zip_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id)
);

create table public.builder_contact_identities (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  kind text not null check (kind in ('email', 'phone', 'external')),
  normalized_value text not null check (char_length(normalized_value) between 3 and 320),
  verification_state text not null default 'unverified' check (verification_state in ('unverified', 'verified', 'invalid')),
  source text not null check (source in ('public_form', 'phone', 'walk_in', 'staff_entry', 'import', 'correction')),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, contact_id) references public.builder_contacts(site_id, id) on delete restrict,
  unique (site_id, kind, normalized_value),
  check ((kind = 'phone' and normalized_value ~ '^\+[1-9][0-9]{7,14}$') or kind <> 'phone'),
  check ((kind = 'email' and normalized_value = lower(normalized_value) and normalized_value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or kind <> 'email')
);

create table public.builder_contact_tags (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  label text not null check (char_length(label) between 1 and 100),
  color_token text check (color_token is null or color_token ~ '^[a-z][a-z0-9._-]{0,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, key)
);

create table public.builder_contact_tag_links (
  site_id uuid not null,
  contact_id uuid not null,
  tag_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, contact_id, tag_id),
  foreign key (site_id, contact_id) references public.builder_contacts(site_id, id) on delete cascade,
  foreign key (site_id, tag_id) references public.builder_contact_tags(site_id, id) on delete cascade,
  foreign key (site_id, created_by) references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_contact_preferences (
  site_id uuid not null,
  contact_id uuid not null,
  preference_key text not null check (preference_key ~ '^[a-z][a-z0-9._-]{0,63}$'),
  preference_value jsonb not null check (octet_length(preference_value::text) <= 4096),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, contact_id, preference_key),
  foreign key (site_id, contact_id) references public.builder_contacts(site_id, id) on delete cascade
);

create table public.builder_consents (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  base_consent_id uuid not null,
  purpose text not null check (purpose ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  channel text not null check (channel in ('email', 'sms', 'phone')),
  state text not null check (state in ('granted', 'revoked')),
  captured_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, contact_id) references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, base_consent_id) references public.builder_form_submission_consents(site_id, id) on delete restrict,
  check ((state = 'revoked') = (revoked_at is not null))
);

create table public.builder_suppressions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  channel text not null check (channel in ('email', 'sms', 'phone')),
  reason text not null check (reason in ('unsubscribe', 'bounce', 'complaint', 'manual')),
  destination_digest text check (destination_digest is null or destination_digest ~ '^[a-f0-9]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (site_id, id),
  foreign key (site_id, contact_id) references public.builder_contacts(site_id, id) on delete restrict,
  check (active = (ended_at is null))
);

create table public.builder_contact_merge_suggestions (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  left_contact_id uuid not null,
  right_contact_id uuid not null,
  evidence_categories jsonb not null check (jsonb_typeof(evidence_categories) = 'array' and jsonb_array_length(evidence_categories) between 1 and 8),
  confidence_band text not null check (confidence_band in ('low', 'medium', 'high')),
  review_state text not null default 'pending' check (review_state in ('pending', 'merged', 'dismissed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, left_contact_id) references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, right_contact_id) references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, reviewed_by) references public.builder_site_members(site_id, user_id) on delete restrict,
  check (left_contact_id <> right_contact_id),
  check ((review_state = 'pending') = (reviewed_at is null and reviewed_by is null))
);

create table public.builder_contact_aliases (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  source_contact_id uuid not null,
  canonical_contact_id uuid not null,
  reason text not null check (reason in ('merge', 'correction', 'import')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, source_contact_id),
  foreign key (site_id, source_contact_id) references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, canonical_contact_id) references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, created_by) references public.builder_site_members(site_id, user_id) on delete restrict,
  check (source_contact_id <> canonical_contact_id)
);

create table public.builder_leads (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  source text not null check (source in ('public_form', 'phone', 'walk_in', 'staff_entry', 'import')),
  form_id text,
  service text check (service is null or char_length(service) between 1 and 160),
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'emergency')),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'won', 'lost', 'spam')),
  summary text check (summary is null or char_length(summary) <= 2000),
  primary_assignee_id uuid,
  version integer not null default 1 check (version > 0),
  won_at timestamptz,
  lost_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, contact_id) references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, primary_assignee_id) references public.builder_site_members(site_id, user_id) on delete restrict,
  check ((status = 'won') = (won_at is not null)),
  check ((status = 'lost') = (lost_at is not null))
);

create table public.builder_lead_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  lead_id uuid not null,
  event_kind text not null check (event_kind in ('created', 'status', 'assignment', 'note', 'task', 'service_event', 'correction', 'export', 'merge')),
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 16384),
  correction_of_id uuid,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, lead_id) references public.builder_leads(site_id, id) on delete restrict,
  foreign key (site_id, actor_id) references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, correction_of_id) references public.builder_lead_events(site_id, id) on delete restrict
);

create table public.builder_lead_tag_links (
  site_id uuid not null,
  lead_id uuid not null,
  tag_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (site_id, lead_id, tag_id),
  foreign key (site_id, lead_id) references public.builder_leads(site_id, id) on delete cascade,
  foreign key (site_id, tag_id) references public.builder_contact_tags(site_id, id) on delete cascade,
  foreign key (site_id, created_by) references public.builder_site_members(site_id, user_id) on delete restrict
);

create table public.builder_tasks (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 240),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  state text not null default 'open' check (state in ('open', 'in_progress', 'completed', 'cancelled')),
  assignee_id uuid,
  due_at timestamptz,
  completed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, assignee_id) references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, created_by) references public.builder_site_members(site_id, user_id) on delete restrict,
  check ((state = 'completed') = (completed_at is not null))
);

create table public.builder_service_events (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  contact_id uuid not null,
  lead_id uuid,
  event_kind text not null check (event_kind in (
    'estimate.sent', 'estimate.accepted', 'estimate.declined',
    'appointment.scheduled', 'appointment.rescheduled', 'appointment.cancelled',
    'appointment.completed'
  )),
  purpose text check (purpose is null or purpose in ('estimate', 'service', 'follow_up')),
  scheduled_at timestamptz,
  occurred_at timestamptz,
  source text not null check (source in ('staff', 'public_form', 'import', 'integration', 'correction')),
  actor_id uuid,
  external_reference text check (external_reference is null or char_length(external_reference) <= 255),
  correction_of_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8192),
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, contact_id) references public.builder_contacts(site_id, id) on delete restrict,
  foreign key (site_id, lead_id) references public.builder_leads(site_id, id) on delete restrict,
  foreign key (site_id, actor_id) references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, correction_of_id) references public.builder_service_events(site_id, id) on delete restrict,
  check (event_kind <> 'appointment.scheduled' or purpose is not null)
);

create table public.builder_in_app_notifications (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  recipient_id uuid not null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9._-]{0,127}$'),
  resource_type text check (resource_type is null or resource_type in ('lead', 'customer', 'task')),
  resource_id uuid,
  preview_text text check (preview_text is null or char_length(preview_text) <= 240),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, recipient_id) references public.builder_site_members(site_id, user_id) on delete cascade,
  check ((resource_type is null) = (resource_id is null))
);

create table public.builder_saved_views (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  domain text not null check (domain in ('leads', 'customers', 'base_submissions')),
  name text not null check (char_length(name) between 1 and 100),
  visibility text not null default 'private' check (visibility in ('private', 'site')),
  filter_ast jsonb not null check (jsonb_typeof(filter_ast) = 'object' and octet_length(filter_ast::text) <= 16384),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, owner_id) references public.builder_site_members(site_id, user_id) on delete cascade
);

create table public.builder_data_exports (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  requester_id uuid not null,
  domain text not null check (domain in ('leads', 'customers', 'base_submissions', 'portable_bundle')),
  frozen_scope jsonb not null check (jsonb_typeof(frozen_scope) = 'object' and octet_length(frozen_scope::text) <= 16384),
  state text not null default 'requested' check (state in ('requested', 'running', 'completed', 'failed', 'expired')),
  object_reference text,
  object_expires_at timestamptz,
  schema_version integer not null check (schema_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, requester_id) references public.builder_site_members(site_id, user_id) on delete restrict,
  check ((state = 'completed') = (object_reference is not null and object_expires_at is not null))
);

create table public.builder_deletion_requests (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  requester_id uuid not null,
  contact_id uuid,
  scope text not null check (scope in ('contact', 'site')),
  state text not null default 'requested' check (state in ('requested', 'approved', 'blocked', 'completed', 'rejected')),
  legal_hold boolean not null default false,
  approved_by uuid,
  approved_at timestamptz,
  executed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, requester_id) references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, approved_by) references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, contact_id) references public.builder_contacts(site_id, id) on delete restrict,
  check ((scope = 'contact') = (contact_id is not null)),
  check ((state in ('approved', 'completed')) = (approved_by is not null and approved_at is not null)),
  check ((state = 'completed') = (executed_at is not null))
);

alter table public.builder_form_submission_results
  add constraint builder_form_submission_results_contact_fk
  foreign key (site_id, contact_id) references public.builder_contacts(site_id, id) on delete restrict
  deferrable initially deferred;
alter table public.builder_form_submission_results
  add constraint builder_form_submission_results_lead_fk
  foreign key (site_id, lead_id) references public.builder_leads(site_id, id) on delete restrict
  deferrable initially deferred;

alter table public.builder_record_assignments
  add column state text not null default 'active' check (state in ('active', 'ended')),
  add column version integer not null default 1 check (version > 0),
  add column ended_at timestamptz,
  add constraint builder_record_assignments_state_timing_check check ((state = 'active') = (ended_at is null));

alter table public.builder_outbox
  add column schema_version integer not null default 1 check (schema_version > 0),
  add column aggregate_type text,
  add column aggregate_id uuid,
  add column correlation_id uuid,
  add column causation_id uuid,
  add constraint builder_outbox_aggregate_pair_check check ((aggregate_type is null) = (aggregate_id is null)),
  add constraint builder_outbox_growth_topic_check check (topic not like 'growth.%' or (aggregate_type is not null and correlation_id is not null));

create index builder_contacts_display_idx on public.builder_contacts (site_id, lower(display_name), id);
create index builder_contact_identities_contact_idx on public.builder_contact_identities (site_id, contact_id, kind);
create index builder_contact_tags_key_idx on public.builder_contact_tags (site_id, key);
create index builder_consents_contact_idx on public.builder_consents (site_id, contact_id, purpose, channel, captured_at desc);
create index builder_suppressions_active_idx on public.builder_suppressions (site_id, contact_id, channel) where active;
create index builder_merge_suggestions_review_idx on public.builder_contact_merge_suggestions (site_id, review_state, created_at desc);
create index builder_leads_pipeline_idx on public.builder_leads (site_id, status, primary_assignee_id, service, source, created_at desc) where status <> 'spam';
create index builder_lead_events_timeline_idx on public.builder_lead_events (site_id, lead_id, created_at, id);
create index builder_tasks_assignee_idx on public.builder_tasks (site_id, assignee_id, state, due_at);
create index builder_tasks_due_idx on public.builder_tasks (site_id, state, due_at) where state in ('open', 'in_progress');
create index builder_service_events_lead_idx on public.builder_service_events (site_id, lead_id, created_at desc) where lead_id is not null;
create index builder_service_events_contact_idx on public.builder_service_events (site_id, contact_id, created_at desc);
create index builder_notifications_recipient_idx on public.builder_in_app_notifications (site_id, recipient_id, read_at, created_at desc);
create index builder_saved_views_owner_idx on public.builder_saved_views (site_id, owner_id, domain);
create index builder_data_exports_state_idx on public.builder_data_exports (site_id, state, created_at desc);
create index builder_deletion_requests_state_idx on public.builder_deletion_requests (site_id, state, created_at desc);
create index builder_outbox_growth_aggregate_idx on public.builder_outbox (site_id, aggregate_type, aggregate_id, created_at) where topic like 'growth.%';

create trigger builder_contact_identities_append_only
before update or delete on public.builder_contact_identities
for each row execute function builder_private.reject_append_only_change();
create trigger builder_lead_events_append_only
before update or delete on public.builder_lead_events
for each row execute function builder_private.reject_append_only_change();
create trigger builder_service_events_append_only
before update or delete on public.builder_service_events
for each row execute function builder_private.reject_append_only_change();
create trigger builder_contact_aliases_append_only
before update or delete on public.builder_contact_aliases
for each row execute function builder_private.reject_append_only_change();

alter table public.builder_contacts enable row level security;
alter table public.builder_contact_identities enable row level security;
alter table public.builder_contact_tags enable row level security;
alter table public.builder_contact_tag_links enable row level security;
alter table public.builder_contact_preferences enable row level security;
alter table public.builder_consents enable row level security;
alter table public.builder_suppressions enable row level security;
alter table public.builder_contact_merge_suggestions enable row level security;
alter table public.builder_contact_aliases enable row level security;
alter table public.builder_leads enable row level security;
alter table public.builder_lead_events enable row level security;
alter table public.builder_lead_tag_links enable row level security;
alter table public.builder_tasks enable row level security;
alter table public.builder_service_events enable row level security;
alter table public.builder_in_app_notifications enable row level security;
alter table public.builder_saved_views enable row level security;
alter table public.builder_data_exports enable row level security;
alter table public.builder_deletion_requests enable row level security;

revoke all on public.builder_contacts, public.builder_contact_identities, public.builder_contact_tags,
  public.builder_contact_tag_links, public.builder_contact_preferences, public.builder_consents,
  public.builder_suppressions, public.builder_contact_merge_suggestions, public.builder_contact_aliases,
  public.builder_leads, public.builder_lead_events, public.builder_lead_tag_links,
  public.builder_tasks, public.builder_service_events, public.builder_in_app_notifications,
  public.builder_saved_views, public.builder_data_exports, public.builder_deletion_requests
from anon, authenticated;

grant all on public.builder_contacts, public.builder_contact_identities, public.builder_contact_tags,
  public.builder_contact_tag_links, public.builder_contact_preferences, public.builder_consents,
  public.builder_suppressions, public.builder_contact_merge_suggestions, public.builder_contact_aliases,
  public.builder_leads, public.builder_lead_events, public.builder_lead_tag_links,
  public.builder_tasks, public.builder_service_events, public.builder_in_app_notifications,
  public.builder_saved_views, public.builder_data_exports, public.builder_deletion_requests
to service_role;
