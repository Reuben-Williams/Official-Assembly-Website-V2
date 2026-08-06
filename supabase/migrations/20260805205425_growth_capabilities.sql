create table public.builder_member_capabilities (
  site_id uuid not null,
  member_id uuid not null,
  capability text not null,
  scope text not null,
  template_id text,
  template_version integer,
  granted_by uuid not null,
  audit_event_id uuid not null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, member_id, capability),
  foreign key (site_id, member_id)
    references public.builder_site_members(site_id, user_id) on delete cascade,
  foreign key (site_id, granted_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, audit_event_id)
    references public.builder_audit_events(site_id, id) on delete restrict,
  constraint builder_member_capabilities_capability_check check (capability in (
    'dashboard.read', 'leads.read', 'leads.create', 'leads.update', 'leads.assign', 'leads.export',
    'customers.read', 'customers.update', 'customers.export', 'customers.deleteRequest',
    'tasks.read', 'tasks.manage', 'messages.read', 'messages.draft', 'messages.send',
    'templates.manage', 'reviews.manage', 'automations.read', 'automations.manage',
    'automations.approve', 'projects.read', 'projects.manage', 'integrations.manage',
    'members.manage', 'billing.manage', 'siteHealth.read', 'emergencyPause.manage'
  )),
  constraint builder_member_capabilities_scope_check check (
    scope = 'site'
    or (
      scope = 'assigned'
      and capability in (
        'leads.read', 'leads.update', 'customers.read', 'customers.update',
        'tasks.read', 'tasks.manage', 'messages.read', 'messages.draft',
        'messages.send', 'projects.read', 'projects.manage'
      )
    )
  ),
  constraint builder_member_capabilities_template_check check (
    (template_id is null and template_version is null)
    or (
      template_id ~ '^growth_[a-z0-9_]+$'
      and template_version > 0
    )
  )
);

create table public.builder_record_assignments (
  site_id uuid not null,
  member_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  assigned_by uuid not null,
  audit_event_id uuid not null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, member_id, resource_type, resource_id),
  foreign key (site_id, member_id)
    references public.builder_site_members(site_id, user_id) on delete cascade,
  foreign key (site_id, assigned_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, audit_event_id)
    references public.builder_audit_events(site_id, id) on delete restrict,
  constraint builder_record_assignments_resource_type_check check (
    resource_type in ('lead', 'customer', 'task', 'conversation', 'project')
  )
);

create table public.builder_record_access_edges (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  child_resource_type text not null,
  child_resource_id uuid not null,
  parent_resource_type text not null,
  parent_resource_id uuid not null,
  created_by uuid not null,
  audit_event_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (
    site_id,
    child_resource_type,
    child_resource_id,
    parent_resource_type,
    parent_resource_id
  ),
  foreign key (site_id, created_by)
    references public.builder_site_members(site_id, user_id) on delete restrict,
  foreign key (site_id, audit_event_id)
    references public.builder_audit_events(site_id, id) on delete restrict,
  constraint builder_record_access_edges_registry_check check (
    (child_resource_type = 'customer' and parent_resource_type = 'lead')
    or (
      child_resource_type = 'task'
      and parent_resource_type in ('lead', 'customer', 'project', 'task')
    )
    or (
      child_resource_type = 'conversation'
      and parent_resource_type in ('lead', 'customer', 'project', 'task')
    )
  ),
  constraint builder_record_access_edges_no_self_reference_check check (
    child_resource_type <> parent_resource_type
    or child_resource_id <> parent_resource_id
  )
);

create index builder_member_capabilities_member_idx
  on public.builder_member_capabilities (site_id, member_id, scope);
create index builder_record_assignments_resource_idx
  on public.builder_record_assignments (site_id, resource_type, resource_id, member_id);
create index builder_record_access_edges_parent_idx
  on public.builder_record_access_edges (site_id, parent_resource_type, parent_resource_id);

create function builder_private.has_site_capability(p_site_id uuid, p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_role text;
begin
  if p_site_id is null
    or p_capability is null
    or p_capability not in (
      'dashboard.read', 'leads.read', 'leads.create', 'leads.update', 'leads.assign', 'leads.export',
      'customers.read', 'customers.update', 'customers.export', 'customers.deleteRequest',
      'tasks.read', 'tasks.manage', 'messages.read', 'messages.draft', 'messages.send',
      'templates.manage', 'reviews.manage', 'automations.read', 'automations.manage',
      'automations.approve', 'projects.read', 'projects.manage', 'integrations.manage',
      'members.manage', 'billing.manage', 'siteHealth.read', 'emergencyPause.manage'
    )
  then
    return false;
  end if;

  select member.role
  into v_role
  from public.builder_site_members member
  where member.site_id = p_site_id
    and member.user_id = auth.uid();

  if v_role = 'owner' then
    return true;
  end if;

  if v_role is null then
    return false;
  end if;

  return exists (
    select 1
    from public.builder_member_capabilities grant_row
    where grant_row.site_id = p_site_id
      and grant_row.member_id = auth.uid()
      and grant_row.capability = p_capability
  );
end;
$$;

create function builder_private.can_access_growth_record_node(
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
  if p_site_id is null
    or p_member_id is null
    or p_resource_id is null
    or p_resource_type not in ('lead', 'customer', 'task', 'conversation', 'project')
    or p_depth > 8
  then
    return false;
  end if;

  v_node_key := p_resource_type || ':' || p_resource_id::text;
  if v_node_key = any (p_path) then
    return false;
  end if;

  if exists (
    select 1
    from public.builder_record_assignments assignment
    where assignment.site_id = p_site_id
      and assignment.member_id = p_member_id
      and assignment.resource_type = p_resource_type
      and assignment.resource_id = p_resource_id
  ) then
    return true;
  end if;

  for v_edge in
    select edge.parent_resource_type, edge.parent_resource_id
    from public.builder_record_access_edges edge
    where edge.site_id = p_site_id
      and edge.child_resource_type = p_resource_type
      and edge.child_resource_id = p_resource_id
  loop
    v_has_parent := true;

    if not (
      (p_resource_type = 'customer' and v_edge.parent_resource_type = 'lead')
      or (
        p_resource_type = 'task'
        and v_edge.parent_resource_type in ('lead', 'customer', 'project', 'task')
      )
      or (
        p_resource_type = 'conversation'
        and v_edge.parent_resource_type in ('lead', 'customer', 'project', 'task')
      )
    ) then
      return false;
    end if;

    if not builder_private.can_access_growth_record_node(
      p_site_id,
      p_member_id,
      v_edge.parent_resource_type,
      v_edge.parent_resource_id,
      p_depth + 1,
      array_append(p_path, v_node_key)
    ) then
      return false;
    end if;
  end loop;

  return v_has_parent;
end;
$$;

create function builder_private.can_access_growth_record(
  p_site_id uuid,
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
  v_has_site_scope boolean;
  v_has_assigned_scope boolean;
begin
  if p_site_id is null
    or p_capability is null
    or p_resource_type is null
    or p_resource_id is null
  then
    return false;
  end if;

  select member.role
  into v_role
  from public.builder_site_members member
  where member.site_id = p_site_id
    and member.user_id = auth.uid();

  if v_role is null then
    return false;
  end if;

  if v_role = 'owner' then
    return builder_private.has_site_capability(p_site_id, p_capability);
  end if;

  select
    coalesce(bool_or(grant_row.scope = 'site'), false),
    coalesce(bool_or(grant_row.scope = 'assigned'), false)
  into v_has_site_scope, v_has_assigned_scope
  from public.builder_member_capabilities grant_row
  where grant_row.site_id = p_site_id
    and grant_row.member_id = auth.uid()
    and grant_row.capability = p_capability;

  if v_has_site_scope then
    return true;
  end if;

  if not v_has_assigned_scope
    or not (
      (p_capability in ('leads.read', 'leads.update') and p_resource_type = 'lead')
      or (p_capability in ('customers.read', 'customers.update') and p_resource_type = 'customer')
      or (p_capability in ('tasks.read', 'tasks.manage') and p_resource_type = 'task')
      or (p_capability in ('messages.read', 'messages.draft', 'messages.send') and p_resource_type = 'conversation')
      or (p_capability in ('projects.read', 'projects.manage') and p_resource_type = 'project')
    )
  then
    return false;
  end if;

  return builder_private.can_access_growth_record_node(
    p_site_id,
    auth.uid(),
    p_resource_type,
    p_resource_id,
    0,
    array[]::text[]
  );
end;
$$;

revoke all on function builder_private.has_site_capability(uuid, text)
  from public, anon, authenticated;
revoke all on function builder_private.can_access_growth_record_node(uuid, uuid, text, uuid, integer, text[])
  from public, anon, authenticated;
revoke all on function builder_private.can_access_growth_record(uuid, text, text, uuid)
  from public, anon, authenticated;

alter table public.builder_member_capabilities enable row level security;
alter table public.builder_record_assignments enable row level security;
alter table public.builder_record_access_edges enable row level security;

create policy builder_member_capabilities_member_read
on public.builder_member_capabilities
for select to authenticated
using (
  member_id = auth.uid()
  or builder_private.has_site_role(site_id, array['owner'])
);

create policy builder_member_capabilities_owner_write
on public.builder_member_capabilities
for all to authenticated
using (builder_private.has_site_role(site_id, array['owner']))
with check (builder_private.has_site_role(site_id, array['owner']));

create policy builder_record_assignments_member_read
on public.builder_record_assignments
for select to authenticated
using (
  member_id = auth.uid()
  or builder_private.has_site_role(site_id, array['owner'])
);

create policy builder_record_assignments_owner_write
on public.builder_record_assignments
for all to authenticated
using (builder_private.has_site_role(site_id, array['owner']))
with check (builder_private.has_site_role(site_id, array['owner']));

create policy builder_record_access_edges_owner_read
on public.builder_record_access_edges
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner']));

create policy builder_record_access_edges_owner_write
on public.builder_record_access_edges
for all to authenticated
using (builder_private.has_site_role(site_id, array['owner']))
with check (builder_private.has_site_role(site_id, array['owner']));

revoke all on public.builder_member_capabilities from anon, authenticated;
revoke all on public.builder_record_assignments from anon, authenticated;
revoke all on public.builder_record_access_edges from anon, authenticated;

grant select, insert, update, delete on public.builder_member_capabilities to authenticated;
grant select, insert, update, delete on public.builder_record_assignments to authenticated;
grant select, insert, update, delete on public.builder_record_access_edges to authenticated;

grant all on public.builder_member_capabilities to service_role;
grant all on public.builder_record_assignments to service_role;
grant all on public.builder_record_access_edges to service_role;
