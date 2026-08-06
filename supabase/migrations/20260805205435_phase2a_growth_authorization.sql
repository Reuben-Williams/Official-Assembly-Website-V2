create function builder_private.entitlement_state_action_allowed(
  p_state text,
  p_grace_ends_at timestamptz,
  p_action text,
  p_now timestamptz
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_action not in ('read', 'write', 'outbound', 'export') then false
    when p_state in ('trialing', 'active', 'payment_attention') then true
    when p_state = 'grace_period' and p_grace_ends_at > p_now then true
    when p_state = 'grace_period' then p_action in ('read', 'export')
    when p_state = 'setup_required' then p_action = 'export'
    when p_state in ('suspended', 'offboarding', 'termination_failed') then p_action in ('read', 'export')
    else false
  end;
$$;

create function builder_private.snapshot_module_action_allowed(
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
    or p_module_id not in ('growth.customers', 'growth.leads', 'growth.dashboard')
    or p_action not in ('read', 'write', 'outbound', 'export')
  then return false;
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
      and builder_private.entitlement_state_action_allowed(v_module.state, v_module.grace_ends_at, 'read', p_now);
  end if;

  if p_now <= v_snapshot.expires_at then
    return builder_private.entitlement_state_action_allowed(v_module.state, v_module.grace_ends_at, p_action, p_now);
  end if;
  if v_snapshot.has_prior_valid_snapshot and p_now <= v_snapshot.outage_window_ends_at then
    return builder_private.entitlement_state_action_allowed(v_module.state, v_module.grace_ends_at, p_action, p_now);
  end if;
  if v_snapshot.has_prior_valid_snapshot then
    return p_action = 'read'
      and builder_private.entitlement_state_action_allowed(v_module.state, v_module.grace_ends_at, 'read', p_now);
  end if;
  return false;
end;
$$;

create function builder_private.module_action_allowed(p_site_id uuid, p_module_id text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_snapshot_id uuid;
begin
  select id into v_snapshot_id
  from builder_private.builder_verified_entitlement_snapshots
  where site_id = p_site_id
  order by sequence desc
  limit 1;
  return builder_private.snapshot_module_action_allowed(v_snapshot_id, p_module_id, p_action, statement_timestamp());
end;
$$;

create function builder_private.dependent_action_allowed(
  p_site_id uuid,
  p_dependency_module_id text,
  p_module_id text,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_snapshot_id uuid;
  v_now timestamptz := statement_timestamp();
begin
  select id into v_snapshot_id
  from builder_private.builder_verified_entitlement_snapshots
  where site_id = p_site_id
  order by sequence desc
  limit 1;
  if v_snapshot_id is null then return false; end if;
  return builder_private.snapshot_module_action_allowed(v_snapshot_id, p_dependency_module_id, p_action, v_now)
    and builder_private.snapshot_module_action_allowed(v_snapshot_id, p_module_id, p_action, v_now);
end;
$$;

create function builder_private.member_has_capability(
  p_site_id uuid,
  p_member_id uuid,
  p_capability text,
  p_required_scope text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_role text;
begin
  if p_required_scope is not null and p_required_scope not in ('site', 'assigned') then return false; end if;
  select role into v_role from public.builder_site_members
  where site_id = p_site_id and user_id = p_member_id;
  if v_role = 'owner' then return true; end if;
  if v_role is null then return false; end if;
  return exists (
    select 1 from public.builder_member_capabilities
    where site_id = p_site_id and member_id = p_member_id and capability = p_capability
      and (p_required_scope is null or scope = p_required_scope)
  );
end;
$$;

create or replace function builder_private.can_access_growth_record_node(
  p_site_id uuid,
  p_member_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_depth integer,
  p_path text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_edge record;
  v_has_parent boolean := false;
  v_node_key text;
begin
  if p_site_id is null or p_member_id is null or p_resource_id is null
    or p_resource_type not in ('lead', 'customer', 'task', 'conversation', 'project') or p_depth > 8
  then return false; end if;
  v_node_key := p_resource_type || ':' || p_resource_id::text;
  if v_node_key = any(p_path) then return false; end if;

  if exists (
    select 1 from public.builder_record_assignments assignment
    where assignment.site_id = p_site_id and assignment.member_id = p_member_id
      and assignment.resource_type = p_resource_type and assignment.resource_id = p_resource_id
      and assignment.state = 'active'
  ) then return true; end if;

  for v_edge in
    select parent_resource_type, parent_resource_id
    from public.builder_record_access_edges
    where site_id = p_site_id and child_resource_type = p_resource_type and child_resource_id = p_resource_id
  loop
    v_has_parent := true;
    if not (
      (p_resource_type = 'customer' and v_edge.parent_resource_type = 'lead')
      or (p_resource_type in ('task', 'conversation') and v_edge.parent_resource_type in ('lead', 'customer', 'project', 'task'))
    ) then return false; end if;
    if not builder_private.can_access_growth_record_node(
      p_site_id, p_member_id, v_edge.parent_resource_type, v_edge.parent_resource_id,
      p_depth + 1, array_append(p_path, v_node_key)
    ) then return false; end if;
  end loop;
  return v_has_parent;
end;
$$;

create function builder_private.member_can_access_growth_record(
  p_site_id uuid,
  p_member_id uuid,
  p_capability text,
  p_resource_type text,
  p_resource_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_role text;
  v_site_scope boolean;
  v_assigned_scope boolean;
begin
  select role into v_role from public.builder_site_members
  where site_id = p_site_id and user_id = p_member_id;
  if v_role is null then return false; end if;
  if v_role = 'owner' then return true; end if;
  select coalesce(bool_or(scope = 'site'), false), coalesce(bool_or(scope = 'assigned'), false)
  into v_site_scope, v_assigned_scope
  from public.builder_member_capabilities
  where site_id = p_site_id and member_id = p_member_id and capability = p_capability;
  if v_site_scope then return true; end if;
  if not v_assigned_scope or not (
    (p_resource_type = 'lead' and p_capability in ('leads.read', 'leads.update'))
    or (p_resource_type = 'customer' and p_capability in ('customers.read', 'customers.update'))
    or (p_resource_type = 'task' and p_capability in ('tasks.read', 'tasks.manage'))
    or (p_resource_type = 'conversation' and p_capability in ('messages.read', 'messages.draft', 'messages.send'))
    or (p_resource_type = 'project' and p_capability in ('projects.read', 'projects.manage'))
  ) then return false; end if;
  return builder_private.can_access_growth_record_node(p_site_id, p_member_id, p_resource_type, p_resource_id, 0, array[]::text[]);
end;
$$;

create or replace function builder_private.can_access_growth_record(
  p_site_id uuid,
  p_capability text,
  p_resource_type text,
  p_resource_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select builder_private.member_can_access_growth_record(p_site_id, auth.uid(), p_capability, p_resource_type, p_resource_id);
$$;

create function builder_private.record_read_allowed(
  p_site_id uuid,
  p_module_id text,
  p_capability text,
  p_resource_type text,
  p_resource_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select (
    case when p_module_id = 'growth.leads'
      then builder_private.dependent_action_allowed(p_site_id, 'growth.customers', 'growth.leads', 'read')
      else builder_private.module_action_allowed(p_site_id, p_module_id, 'read')
    end
  ) and builder_private.can_access_growth_record(p_site_id, p_capability, p_resource_type, p_resource_id);
$$;

create function builder_private.require_task_parent_before_completion()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.state = 'completed' and old.state <> 'completed' and not exists (
    select 1 from public.builder_record_access_edges
    where site_id = new.site_id and child_resource_type = 'task' and child_resource_id = new.id
  ) then raise exception 'completed task requires an authorization parent' using errcode = '23514'; end if;
  return new;
end;
$$;

create trigger builder_tasks_require_parent_before_completion
before update on public.builder_tasks
for each row execute function builder_private.require_task_parent_before_completion();

drop policy builder_record_assignments_owner_write on public.builder_record_assignments;
drop policy builder_record_assignments_member_read on public.builder_record_assignments;
drop policy builder_record_access_edges_owner_write on public.builder_record_access_edges;
drop policy builder_member_capabilities_member_read on public.builder_member_capabilities;

create policy builder_member_capabilities_member_read
on public.builder_member_capabilities for select to authenticated
using (
  member_id = (select auth.uid())
  or builder_private.has_site_role(site_id, array['owner'])
);

revoke insert, update, delete on public.builder_record_assignments from authenticated;
revoke insert, update, delete on public.builder_record_access_edges from authenticated;

create policy builder_record_assignments_member_read
on public.builder_record_assignments for select to authenticated
using (
  member_id = (select auth.uid())
  or case resource_type
    when 'lead' then builder_private.record_read_allowed(site_id, 'growth.leads', 'leads.read', 'lead', resource_id)
    when 'customer' then builder_private.record_read_allowed(site_id, 'growth.customers', 'customers.read', 'customer', resource_id)
    when 'task' then builder_private.record_read_allowed(site_id, 'growth.leads', 'tasks.read', 'task', resource_id)
    else builder_private.has_site_role(site_id, array['owner'])
  end
);

drop policy builder_editor_outbox on public.builder_outbox;
create policy builder_editor_outbox on public.builder_outbox
for select to authenticated
using (topic not like 'growth.%' and builder_private.has_site_role(site_id, array['owner', 'editor']));

create policy builder_contacts_read on public.builder_contacts for select to authenticated
using (builder_private.record_read_allowed(site_id, 'growth.customers', 'customers.read', 'customer', id));
create policy builder_contact_identities_read on public.builder_contact_identities for select to authenticated
using (builder_private.record_read_allowed(site_id, 'growth.customers', 'customers.read', 'customer', contact_id));
create policy builder_contact_tags_read on public.builder_contact_tags for select to authenticated
using (builder_private.module_action_allowed(site_id, 'growth.customers', 'read') and builder_private.has_site_capability(site_id, 'customers.read'));
create policy builder_contact_tag_links_read on public.builder_contact_tag_links for select to authenticated
using (builder_private.record_read_allowed(site_id, 'growth.customers', 'customers.read', 'customer', contact_id));
create policy builder_contact_preferences_read on public.builder_contact_preferences for select to authenticated
using (builder_private.record_read_allowed(site_id, 'growth.customers', 'customers.read', 'customer', contact_id));
create policy builder_consents_read on public.builder_consents for select to authenticated
using (builder_private.record_read_allowed(site_id, 'growth.customers', 'customers.read', 'customer', contact_id));
create policy builder_suppressions_read on public.builder_suppressions for select to authenticated
using (builder_private.record_read_allowed(site_id, 'growth.customers', 'customers.read', 'customer', contact_id));
create policy builder_contact_merge_suggestions_read on public.builder_contact_merge_suggestions for select to authenticated
using (builder_private.module_action_allowed(site_id, 'growth.customers', 'read') and builder_private.has_site_capability(site_id, 'customers.update'));
create policy builder_contact_aliases_read on public.builder_contact_aliases for select to authenticated
using (builder_private.record_read_allowed(site_id, 'growth.customers', 'customers.read', 'customer', canonical_contact_id));

create policy builder_leads_read on public.builder_leads for select to authenticated
using (builder_private.record_read_allowed(site_id, 'growth.leads', 'leads.read', 'lead', id));
create policy builder_lead_events_read on public.builder_lead_events for select to authenticated
using (builder_private.record_read_allowed(site_id, 'growth.leads', 'leads.read', 'lead', lead_id));
create policy builder_lead_tag_links_read on public.builder_lead_tag_links for select to authenticated
using (builder_private.record_read_allowed(site_id, 'growth.leads', 'leads.read', 'lead', lead_id));
create policy builder_tasks_read on public.builder_tasks for select to authenticated
using (builder_private.record_read_allowed(site_id, 'growth.leads', 'tasks.read', 'task', id));
create policy builder_service_events_read on public.builder_service_events for select to authenticated
using (
  case when lead_id is not null
    then builder_private.record_read_allowed(site_id, 'growth.leads', 'leads.read', 'lead', lead_id)
    else builder_private.record_read_allowed(site_id, 'growth.customers', 'customers.read', 'customer', contact_id)
  end
);
create policy builder_notifications_recipient_read on public.builder_in_app_notifications for select to authenticated
using (recipient_id = (select auth.uid()));
create policy builder_notifications_recipient_update on public.builder_in_app_notifications for update to authenticated
using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy builder_saved_views_read on public.builder_saved_views for select to authenticated
using (
  owner_id = (select auth.uid())
  or (visibility = 'site' and case domain
    when 'leads' then builder_private.dependent_action_allowed(site_id, 'growth.customers', 'growth.leads', 'read') and builder_private.has_site_capability(site_id, 'leads.read')
    when 'customers' then builder_private.module_action_allowed(site_id, 'growth.customers', 'read') and builder_private.has_site_capability(site_id, 'customers.read')
    when 'base_submissions' then builder_private.has_site_role(site_id, array['owner', 'editor'])
    else false end)
);
create policy builder_data_exports_read on public.builder_data_exports for select to authenticated
using (
  (requester_id = (select auth.uid()) or builder_private.has_site_role(site_id, array['owner']))
  and case domain
    when 'leads' then builder_private.dependent_action_allowed(site_id, 'growth.customers', 'growth.leads', 'export') and builder_private.has_site_capability(site_id, 'leads.export')
    when 'customers' then builder_private.module_action_allowed(site_id, 'growth.customers', 'export') and builder_private.has_site_capability(site_id, 'customers.export')
    when 'base_submissions' then builder_private.has_site_role(site_id, array['owner'])
    when 'portable_bundle' then builder_private.has_site_role(site_id, array['owner'])
    else false end
);
create policy builder_deletion_requests_owner_read on public.builder_deletion_requests for select to authenticated
using (builder_private.has_site_role(site_id, array['owner']) and builder_private.module_action_allowed(site_id, 'growth.customers', 'read'));
create policy builder_health_checks_read on public.builder_health_checks for select to authenticated
using (builder_private.has_site_role(site_id, array['owner']) or builder_private.has_site_capability(site_id, 'siteHealth.read'));

grant select on public.builder_contacts, public.builder_contact_identities, public.builder_contact_tags,
  public.builder_contact_tag_links, public.builder_contact_preferences, public.builder_consents,
  public.builder_suppressions, public.builder_contact_merge_suggestions, public.builder_contact_aliases,
  public.builder_leads, public.builder_lead_events, public.builder_lead_tag_links, public.builder_tasks,
  public.builder_service_events, public.builder_in_app_notifications, public.builder_saved_views,
  public.builder_data_exports, public.builder_deletion_requests, public.builder_health_checks
to authenticated;
grant update (read_at) on public.builder_in_app_notifications to authenticated;

create function builder_private.resource_exists(p_site_id uuid, p_resource_type text, p_resource_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return case p_resource_type
    when 'lead' then exists(select 1 from public.builder_leads where site_id = p_site_id and id = p_resource_id)
    when 'customer' then exists(select 1 from public.builder_contacts where site_id = p_site_id and id = p_resource_id)
    when 'task' then exists(select 1 from public.builder_tasks where site_id = p_site_id and id = p_resource_id)
    else false end;
end;
$$;

create function builder_private.set_record_assignment_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_payload ->> 'siteId')::uuid;
  v_actor_id uuid := (p_payload ->> 'actorId')::uuid;
  v_member_id uuid := (p_payload ->> 'memberId')::uuid;
  v_resource_id uuid := (p_payload ->> 'resourceId')::uuid;
  v_audit_event_id uuid := (p_payload ->> 'auditEventId')::uuid;
  v_resource_type text := p_payload ->> 'resourceType';
  v_action text := coalesce(p_payload ->> 'action', 'set');
  v_expected_version integer := coalesce((p_payload ->> 'expectedVersion')::integer, 0);
  v_capability text;
  v_module_allowed boolean;
  v_existing public.builder_record_assignments%rowtype;
  v_new_version integer;
begin
  if v_resource_type not in ('lead', 'customer', 'task') or v_action not in ('set', 'end') or v_expected_version < 0 then
    raise exception 'invalid assignment command' using errcode = '22023';
  end if;
  if not builder_private.resource_exists(v_site_id, v_resource_type, v_resource_id)
    or not exists(select 1 from public.builder_site_members where site_id = v_site_id and user_id = v_member_id)
    or not exists(select 1 from public.builder_site_members where site_id = v_site_id and user_id = v_actor_id)
    or not exists(select 1 from public.builder_audit_events where site_id = v_site_id and id = v_audit_event_id)
  then raise exception 'assignment command references invalid site records' using errcode = '22023'; end if;

  v_capability := case v_resource_type when 'lead' then 'leads.assign' when 'customer' then 'customers.update' else 'tasks.manage' end;
  v_module_allowed := case v_resource_type
    when 'customer' then builder_private.module_action_allowed(v_site_id, 'growth.customers', 'write')
    else builder_private.dependent_action_allowed(v_site_id, 'growth.customers', 'growth.leads', 'write') end;
  if not v_module_allowed or not builder_private.member_has_capability(v_site_id, v_actor_id, v_capability, 'site') then
    raise exception 'assignment command is not authorized' using errcode = '42501';
  end if;

  select * into v_existing from public.builder_record_assignments
  where site_id = v_site_id and member_id = v_member_id and resource_type = v_resource_type and resource_id = v_resource_id
  for update;
  if found then
    if v_existing.version <> v_expected_version then raise exception 'assignment version conflict' using errcode = '40001'; end if;
    v_new_version := v_existing.version + 1;
    update public.builder_record_assignments
    set state = case when v_action = 'end' then 'ended' else 'active' end,
        ended_at = case when v_action = 'end' then clock_timestamp() else null end,
        assigned_by = v_actor_id, audit_event_id = v_audit_event_id,
        version = v_new_version, updated_at = clock_timestamp()
    where site_id = v_site_id and member_id = v_member_id and resource_type = v_resource_type and resource_id = v_resource_id;
  else
    if v_action = 'end' or v_expected_version <> 0 then raise exception 'assignment version conflict' using errcode = '40001'; end if;
    v_new_version := 1;
    insert into public.builder_record_assignments (
      site_id, member_id, resource_type, resource_id, assigned_by, audit_event_id, state, version
    ) values (v_site_id, v_member_id, v_resource_type, v_resource_id, v_actor_id, v_audit_event_id, 'active', 1);
  end if;
  return jsonb_build_object('status', case when v_action = 'end' then 'ended' else 'assigned' end, 'version', v_new_version);
end;
$$;

create function public.builder_set_record_assignment_v1(p_payload jsonb)
returns jsonb language sql security definer set search_path = pg_catalog, public, builder_private
as $$ select builder_private.set_record_assignment_v1(p_payload); $$;

create function builder_private.create_self_assigned_lead_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_payload ->> 'siteId')::uuid;
  v_actor_id uuid := (p_payload ->> 'actorId')::uuid;
  v_lead_id uuid := (p_payload ->> 'leadId')::uuid;
  v_contact_id uuid := (p_payload ->> 'contactId')::uuid;
  v_audit_event_id uuid := (p_payload ->> 'auditEventId')::uuid;
begin
  if not builder_private.dependent_action_allowed(v_site_id, 'growth.customers', 'growth.leads', 'write')
    or not builder_private.member_has_capability(v_site_id, v_actor_id, 'leads.create', 'site')
    or not exists(select 1 from public.builder_contacts where site_id = v_site_id and id = v_contact_id)
    or not builder_private.member_can_access_growth_record(v_site_id, v_actor_id, 'customers.read', 'customer', v_contact_id)
    or not exists(select 1 from public.builder_audit_events where site_id = v_site_id and id = v_audit_event_id)
  then raise exception 'self-assigned lead is not authorized' using errcode = '42501'; end if;
  insert into public.builder_leads (site_id, id, contact_id, source, form_id, service, urgency, status, summary, primary_assignee_id)
  values (v_site_id, v_lead_id, v_contact_id, coalesce(p_payload ->> 'source', 'staff_entry'), p_payload ->> 'formId',
    p_payload ->> 'service', coalesce(p_payload ->> 'urgency', 'normal'), 'new', p_payload ->> 'summary', v_actor_id);
  insert into public.builder_record_assignments (site_id, member_id, resource_type, resource_id, assigned_by, audit_event_id)
  values (v_site_id, v_actor_id, 'lead', v_lead_id, v_actor_id, v_audit_event_id);
  insert into public.builder_lead_events (site_id, lead_id, event_kind, actor_id, metadata)
  values (v_site_id, v_lead_id, 'created', v_actor_id, jsonb_build_object('selfAssigned', true));
  return jsonb_build_object('status', 'created', 'leadId', v_lead_id, 'version', 1);
end;
$$;

create function public.builder_create_self_assigned_lead_v1(p_payload jsonb)
returns jsonb language sql security definer set search_path = pg_catalog, public, builder_private
as $$ select builder_private.create_self_assigned_lead_v1(p_payload); $$;

create function builder_private.create_self_assigned_task_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid := (p_payload ->> 'siteId')::uuid;
  v_actor_id uuid := (p_payload ->> 'actorId')::uuid;
  v_task_id uuid := (p_payload ->> 'taskId')::uuid;
  v_audit_event_id uuid := (p_payload ->> 'auditEventId')::uuid;
  v_parent jsonb;
  v_parent_count integer;
begin
  if not builder_private.dependent_action_allowed(v_site_id, 'growth.customers', 'growth.leads', 'write')
    or not builder_private.member_has_capability(v_site_id, v_actor_id, 'tasks.manage', 'assigned')
    or jsonb_typeof(p_payload -> 'parents') <> 'array'
    or jsonb_array_length(p_payload -> 'parents') = 0
    or jsonb_array_length(p_payload -> 'parents') > 8
    or not exists(select 1 from public.builder_audit_events where site_id = v_site_id and id = v_audit_event_id)
  then raise exception 'self-assigned task is not authorized' using errcode = '42501'; end if;
  v_parent_count := jsonb_array_length(p_payload -> 'parents');
  for v_parent in select value from jsonb_array_elements(p_payload -> 'parents') loop
    if (v_parent ->> 'resourceType') not in ('lead', 'customer', 'task')
      or not builder_private.resource_exists(v_site_id, v_parent ->> 'resourceType', (v_parent ->> 'resourceId')::uuid)
      or not builder_private.member_can_access_growth_record(
        v_site_id, v_actor_id,
        case v_parent ->> 'resourceType' when 'lead' then 'leads.read' when 'customer' then 'customers.read' else 'tasks.read' end,
        v_parent ->> 'resourceType', (v_parent ->> 'resourceId')::uuid
      )
    then raise exception 'self-assigned task parent is inaccessible' using errcode = '42501'; end if;
  end loop;
  insert into public.builder_tasks (site_id, id, title, priority, state, assignee_id, due_at, created_by)
  values (v_site_id, v_task_id, p_payload ->> 'title', coalesce(p_payload ->> 'priority', 'normal'), 'open', v_actor_id,
    case when p_payload ? 'dueAt' then (p_payload ->> 'dueAt')::timestamptz else null end, v_actor_id);
  for v_parent in select value from jsonb_array_elements(p_payload -> 'parents') loop
    insert into public.builder_record_access_edges (
      site_id, child_resource_type, child_resource_id, parent_resource_type, parent_resource_id, created_by, audit_event_id
    ) values (v_site_id, 'task', v_task_id, v_parent ->> 'resourceType', (v_parent ->> 'resourceId')::uuid, v_actor_id, v_audit_event_id);
  end loop;
  insert into public.builder_record_assignments (site_id, member_id, resource_type, resource_id, assigned_by, audit_event_id)
  values (v_site_id, v_actor_id, 'task', v_task_id, v_actor_id, v_audit_event_id);
  return jsonb_build_object('status', 'created', 'taskId', v_task_id, 'version', 1, 'parentCount', v_parent_count);
end;
$$;

create function public.builder_create_self_assigned_task_v1(p_payload jsonb)
returns jsonb language sql security definer set search_path = pg_catalog, public, builder_private
as $$ select builder_private.create_self_assigned_task_v1(p_payload); $$;

revoke all on function builder_private.entitlement_state_action_allowed(text, timestamptz, text, timestamptz) from public, anon, authenticated;
revoke all on function builder_private.snapshot_module_action_allowed(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function builder_private.module_action_allowed(uuid, text, text) from public, anon, authenticated;
revoke all on function builder_private.dependent_action_allowed(uuid, text, text, text) from public, anon, authenticated;
revoke all on function builder_private.member_has_capability(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function builder_private.member_can_access_growth_record(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function builder_private.record_read_allowed(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function builder_private.resource_exists(uuid, text, uuid) from public, anon, authenticated;
revoke all on function builder_private.require_task_parent_before_completion() from public, anon, authenticated;
revoke all on function builder_private.set_record_assignment_v1(jsonb) from public, anon, authenticated;
revoke all on function builder_private.create_self_assigned_lead_v1(jsonb) from public, anon, authenticated;
revoke all on function builder_private.create_self_assigned_task_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_set_record_assignment_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_create_self_assigned_lead_v1(jsonb) from public, anon, authenticated;
revoke all on function public.builder_create_self_assigned_task_v1(jsonb) from public, anon, authenticated;

grant usage on schema builder_private to authenticated, service_role;
grant execute on function builder_private.module_action_allowed(uuid, text, text) to authenticated;
grant execute on function builder_private.dependent_action_allowed(uuid, text, text, text) to authenticated;
grant execute on function builder_private.record_read_allowed(uuid, text, text, text, uuid) to authenticated;
grant execute on function builder_private.has_site_capability(uuid, text) to authenticated;
grant execute on function public.builder_set_record_assignment_v1(jsonb) to service_role;
grant execute on function public.builder_create_self_assigned_lead_v1(jsonb) to service_role;
grant execute on function public.builder_create_self_assigned_task_v1(jsonb) to service_role;
