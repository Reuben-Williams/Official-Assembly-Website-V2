create function builder_private.phase2c_validate_request(
  p_request jsonb,
  p_allowed_keys text[],
  p_required_keys text[],
  p_error text
)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& p_required_keys)
    or exists (select 1 from jsonb_object_keys(p_request) key where not key = any(p_allowed_keys))
    or octet_length(p_request::text) > 65536
    or coalesce(p_request ->> 'siteId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'actorId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception '%', p_error using errcode = '22023';
  end if;
end;
$$;

create function builder_private.phase2c_growth_access_state(
  p_site_id uuid,
  p_actor_id uuid,
  p_module_id text,
  p_dependency_module_id text,
  p_capability text,
  p_required_scope text default null
)
returns text
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_snapshot record;
  v_module_state text;
begin
  if not exists (
    select 1 from public.builder_site_members
    where site_id = p_site_id and user_id = p_actor_id
  ) or not builder_private.member_has_capability(p_site_id, p_actor_id, p_capability, p_required_scope)
  then return 'restricted'; end if;

  if (p_dependency_module_id is null and not builder_private.module_action_allowed(p_site_id, p_module_id, 'read'))
    or (p_dependency_module_id is not null and not builder_private.dependent_action_allowed(p_site_id, p_dependency_module_id, p_module_id, 'read'))
  then return 'restricted'; end if;

  select id, expires_at into v_snapshot
  from builder_private.builder_verified_entitlement_snapshots
  where site_id = p_site_id order by sequence desc limit 1;
  if v_snapshot.expires_at < statement_timestamp() then return 'stale'; end if;

  select state into v_module_state
  from builder_private.builder_verified_entitlement_snapshot_modules
  where snapshot_id = v_snapshot.id and module_id = p_module_id;
  if v_module_state in ('grace_period', 'suspended', 'offboarding', 'termination_failed')
  then return 'read_only'; end if;
  return 'allowed';
end;
$$;

revoke all on function builder_private.phase2c_validate_request(jsonb, text[], text[], text) from public, anon, authenticated;
revoke all on function builder_private.phase2c_growth_access_state(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function builder_private.phase2c_validate_request(jsonb, text[], text[], text) to service_role;
grant execute on function builder_private.phase2c_growth_access_state(uuid, uuid, text, text, text, text) to service_role;

create function public.builder_list_leads_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_limit integer;
  v_search text;
  v_filter jsonb;
  v_sort text;
  v_direction text;
  v_cursor jsonb;
  v_state text;
  v_items jsonb;
  v_next_cursor jsonb;
begin
  perform builder_private.phase2c_validate_request(
    p_request,
    array['version','siteId','actorId','search','filter','sort','direction','limit','cursor'],
    array['version','siteId','actorId','limit'],
    'invalid lead list payload'
  );
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_limit := case when jsonb_typeof(p_request -> 'limit') = 'number' then (p_request ->> 'limit')::integer else null end;
  v_search := nullif(btrim(coalesce(p_request ->> 'search','')), '');
  v_filter := coalesce(p_request -> 'filter', '{}'::jsonb);
  v_sort := coalesce(p_request ->> 'sort', 'created_at');
  v_direction := coalesce(p_request ->> 'direction', 'desc');
  v_cursor := p_request -> 'cursor';

  if v_limit not between 1 and 100
    or (v_search is not null and char_length(v_search) > 200)
    or jsonb_typeof(v_filter) <> 'object'
    or exists (select 1 from jsonb_object_keys(v_filter) key where key not in ('statuses','services','assigneeIds','sources','priorities','createdFrom','createdTo','unassigned'))
    or v_sort not in ('created_at','updated_at','priority','status')
    or v_direction not in ('asc','desc')
    or exists (
      select 1 from jsonb_each(v_filter) entry
      where entry.key in ('statuses','services','assigneeIds','sources','priorities')
        and (jsonb_typeof(entry.value) <> 'array' or jsonb_array_length(entry.value) > 100)
    )
    or (v_cursor is not null and (
      jsonb_typeof(v_cursor) <> 'object'
      or v_cursor -> 'version' is distinct from '1'::jsonb
      or not (v_cursor ?& array['version','sortValue','id'])
      or exists (select 1 from jsonb_object_keys(v_cursor) key where key not in ('version','sortValue','id'))
      or coalesce(v_cursor ->> 'sortValue','') = ''
      or coalesce(v_cursor ->> 'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ))
  then raise exception 'invalid lead list payload' using errcode = '22023'; end if;

  v_state := builder_private.phase2c_growth_access_state(v_site_id, v_actor_id, 'growth.leads', 'growth.customers', 'leads.read');
  if v_state = 'restricted' then
    return jsonb_build_object('version',1,'status','restricted','items','[]'::jsonb,'nextCursor',null);
  end if;

  with candidates as (
    select lead.id, lead.contact_id, contact.display_name, lead.source, lead.form_id, lead.service,
      lead.urgency, lead.status, lead.summary, lead.primary_assignee_id, lead.version,
      lead.created_at, lead.updated_at,
      coalesce(priority.value, 'normal') as priority,
      case v_sort
        when 'created_at' then to_char(lead.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        when 'updated_at' then to_char(lead.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        when 'status' then lead.status
        else lpad(case coalesce(priority.value,'normal') when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end::text,2,'0')
      end sort_value
    from public.builder_leads lead
    join public.builder_contacts contact on contact.site_id=lead.site_id and contact.id=lead.contact_id
    left join lateral (
      select event.metadata ->> 'value' value
      from public.builder_lead_events event
      where event.site_id=lead.site_id and event.lead_id=lead.id
        and event.event_kind='correction' and event.metadata ->> 'field'='priority'
        and event.metadata ->> 'value' in ('low','normal','high','urgent')
      order by event.created_at desc, event.id desc limit 1
    ) priority on true
    where lead.site_id=v_site_id
      and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'leads.read','lead',lead.id)
      and (v_search is null or contact.display_name ilike '%'||v_search||'%' or coalesce(lead.summary,'') ilike '%'||v_search||'%' or coalesce(lead.service,'') ilike '%'||v_search||'%')
      and (not (v_filter ? 'statuses') or lead.status in (select jsonb_array_elements_text(v_filter -> 'statuses')))
      and (not (v_filter ? 'services') or lead.service in (select jsonb_array_elements_text(v_filter -> 'services')))
      and (not (v_filter ? 'assigneeIds') or lead.primary_assignee_id::text in (select jsonb_array_elements_text(v_filter -> 'assigneeIds')))
      and (not coalesce((v_filter ->> 'unassigned')::boolean,false) or lead.primary_assignee_id is null)
      and (not (v_filter ? 'sources') or lead.source in (select case value when 'website_form' then 'public_form' else value end from jsonb_array_elements_text(v_filter -> 'sources') value))
      and (not (v_filter ? 'priorities') or coalesce(priority.value,'normal') in (select jsonb_array_elements_text(v_filter -> 'priorities')))
      and (not (v_filter ? 'createdFrom') or lead.created_at >= (v_filter ->> 'createdFrom')::timestamptz)
      and (not (v_filter ? 'createdTo') or lead.created_at < (v_filter ->> 'createdTo')::timestamptz)
  ), cursor_page as (
    select * from candidates
    where v_cursor is null
      or (v_direction='asc' and (sort_value,id) > (v_cursor ->> 'sortValue',(v_cursor ->> 'id')::uuid))
      or (v_direction='desc' and (sort_value,id) < (v_cursor ->> 'sortValue',(v_cursor ->> 'id')::uuid))
    order by
      case when v_direction='asc' then sort_value end asc,
      case when v_direction='asc' then id end asc,
      case when v_direction='desc' then sort_value end desc,
      case when v_direction='desc' then id end desc
    limit v_limit + 1
  ), numbered as (
    select *, row_number() over (order by
      case when v_direction='asc' then sort_value end asc,
      case when v_direction='asc' then id end asc,
      case when v_direction='desc' then sort_value end desc,
      case when v_direction='desc' then id end desc) rn,
      count(*) over () page_count
    from cursor_page
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'contactId',contact_id,'displayName',display_name,
      'source',case source when 'public_form' then 'website_form' else source end,
      'formId',form_id,'service',service,
      'urgency',case urgency when 'emergency' then 'emergency' when 'high' then 'urgent' else 'standard' end,
      'status',status,'summary',summary,'primaryAssigneeId',primary_assignee_id,
      'priority',priority,'version',version,'createdAt',created_at,'updatedAt',updated_at
    ) order by rn) filter (where rn <= v_limit),'[]'::jsonb),
    (jsonb_agg(jsonb_build_object('version',1,'sortValue',sort_value,'id',id)) filter (where rn=v_limit and page_count > v_limit))->0
  into v_items, v_next_cursor from numbered;

  return jsonb_build_object('version',1,'status',v_state,'items',v_items,'nextCursor',v_next_cursor);
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'invalid lead list payload' using errcode='22023';
end;
$$;

create function public.builder_get_lead_detail_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_lead_id uuid;
  v_state text;
  v_result jsonb;
begin
  perform builder_private.phase2c_validate_request(p_request,
    array['version','siteId','actorId','leadId'],array['version','siteId','actorId','leadId'],
    'invalid lead detail payload');
  if coalesce(p_request ->> 'leadId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then raise exception 'invalid lead detail payload' using errcode='22023'; end if;
  v_site_id := (p_request ->> 'siteId')::uuid;
  v_actor_id := (p_request ->> 'actorId')::uuid;
  v_lead_id := (p_request ->> 'leadId')::uuid;
  v_state := builder_private.phase2c_growth_access_state(v_site_id,v_actor_id,'growth.leads','growth.customers','leads.read');
  if v_state='restricted' or not builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'leads.read','lead',v_lead_id)
  then return '{"version":1,"status":"not_found"}'::jsonb; end if;

  select jsonb_build_object(
    'version',1,'status',v_state,
    'lead',jsonb_build_object('id',lead.id,'contactId',lead.contact_id,
      'source',case lead.source when 'public_form' then 'website_form' else lead.source end,
      'formId',lead.form_id,'service',lead.service,
      'urgency',case lead.urgency when 'emergency' then 'emergency' when 'high' then 'urgent' else 'standard' end,
      'status',lead.status,'summary',lead.summary,'primaryAssigneeId',lead.primary_assignee_id,
      'priority',coalesce(priority.value,'normal'),'version',lead.version,'createdAt',lead.created_at,'updatedAt',lead.updated_at),
    'customer',jsonb_build_object('id',contact.id,'displayName',contact.display_name,'lifecycleState',contact.lifecycle_state,
      'preferredContactMethod',contact.preferred_contact_method,'serviceZipCode',contact.service_zip_code,'version',contact.version),
    'identities',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'value',i.normalized_value,'verificationState',i.verification_state,
      'source',case i.source when 'public_form' then 'website_form' else i.source end,'createdAt',i.created_at) order by i.kind,i.id),'[]'::jsonb)
      from public.builder_contact_identities i where i.site_id=lead.site_id and i.contact_id=lead.contact_id),
    'tags',(select coalesce(jsonb_agg(jsonb_build_object('id',tag.id,'key',tag.key,'label',tag.label,'colorToken',tag.color_token) order by tag.label,tag.id),'[]'::jsonb)
      from public.builder_contact_tags tag join public.builder_lead_tag_links link on link.site_id=tag.site_id and link.tag_id=tag.id
      where link.site_id=lead.site_id and link.lead_id=lead.id),
    'tasks',(select coalesce(jsonb_agg(jsonb_build_object('id',task.id,'title',task.title,'priority',task.priority,'state',task.state,'assigneeId',task.assignee_id,
      'dueAt',task.due_at,'completedAt',task.completed_at,'version',task.version,'createdAt',task.created_at,'updatedAt',task.updated_at) order by task.created_at,task.id),'[]'::jsonb)
      from public.builder_tasks task join public.builder_record_access_edges edge on edge.site_id=task.site_id and edge.child_resource_type='task' and edge.child_resource_id=task.id
      where edge.parent_resource_type='lead' and edge.parent_resource_id=lead.id
        and builder_private.member_has_capability(v_site_id,v_actor_id,'tasks.read')
        and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'tasks.read','task',task.id)),
    'serviceEvents',(select coalesce(jsonb_agg(jsonb_build_object('id',se.id,'eventKind',se.event_kind,'purpose',se.purpose,'scheduledAt',se.scheduled_at,
      'occurredAt',se.occurred_at,'source',case se.source when 'public_form' then 'website_form' else se.source end,'actorId',se.actor_id,'createdAt',se.created_at)
      order by se.created_at,se.id),'[]'::jsonb) from public.builder_service_events se where se.site_id=lead.site_id and se.lead_id=lead.id),
    'timeline',(select coalesce(jsonb_agg(jsonb_build_object('id',event.id,'kind',event.event_kind,'actorId',event.actor_id,'metadata',event.metadata,'createdAt',event.created_at)
      order by event.created_at,event.id),'[]'::jsonb) from public.builder_lead_events event where event.site_id=lead.site_id and event.lead_id=lead.id),
    'submission',(select jsonb_build_object('id',s.id,'formId',s.form_id,'source',case s.source when 'public_form' then 'website_form' else s.source end,
      'zipCode',s.zip_code,'locale',s.locale,'receivedAt',s.received_at,'payload',s.payload,'resultCode',r.result_code)
      from public.builder_form_submission_results r join public.builder_form_submissions s on s.site_id=r.site_id and s.id=r.submission_id
      where r.site_id=lead.site_id and r.lead_id=lead.id order by r.version desc limit 1),
    'duplicateWarning',(select jsonb_build_object('id',m.id,'confidenceBand',m.confidence_band,'reviewState',m.review_state,'version',m.version)
      from public.builder_contact_merge_suggestions m where m.site_id=lead.site_id and (m.left_contact_id=lead.contact_id or m.right_contact_id=lead.contact_id)
        and m.review_state='pending' and builder_private.member_has_capability(v_site_id,v_actor_id,'customers.update','site') order by m.created_at desc limit 1)
  ) into v_result
  from public.builder_leads lead
  join public.builder_contacts contact on contact.site_id=lead.site_id and contact.id=lead.contact_id
  left join lateral (select event.metadata ->> 'value' value from public.builder_lead_events event where event.site_id=lead.site_id and event.lead_id=lead.id
    and event.event_kind='correction' and event.metadata ->> 'field'='priority' and event.metadata ->> 'value' in ('low','normal','high','urgent')
    order by event.created_at desc,event.id desc limit 1) priority on true
  where lead.site_id=v_site_id and lead.id=v_lead_id;
  return coalesce(v_result,'{"version":1,"status":"not_found"}'::jsonb);
end;
$$;

create function public.builder_list_customers_v1(p_request jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid; v_actor_id uuid; v_limit integer; v_search text; v_segment jsonb;
  v_sort text; v_direction text; v_cursor jsonb; v_state text; v_items jsonb; v_next_cursor jsonb;
begin
  perform builder_private.phase2c_validate_request(p_request,
    array['version','siteId','actorId','search','segment','sort','direction','limit','cursor'],
    array['version','siteId','actorId','limit'],'invalid customer list payload');
  v_site_id := (p_request ->> 'siteId')::uuid; v_actor_id := (p_request ->> 'actorId')::uuid;
  v_limit := case when jsonb_typeof(p_request -> 'limit')='number' then (p_request ->> 'limit')::integer else null end;
  v_search := nullif(btrim(coalesce(p_request ->> 'search','')),'');
  v_segment := p_request -> 'segment'; v_sort := coalesce(p_request ->> 'sort','display_name');
  v_direction := coalesce(p_request ->> 'direction','asc'); v_cursor := p_request -> 'cursor';
  if v_limit not between 1 and 100 or (v_search is not null and char_length(v_search)>200)
    or v_sort not in ('display_name','updated_at','latest_activity') or v_direction not in ('asc','desc')
    or (v_segment is not null and (
      jsonb_typeof(v_segment)<>'object' or v_segment -> 'version' is distinct from '1'::jsonb
      or not (v_segment ?& array['version','conjunction','clauses'])
      or exists(select 1 from jsonb_object_keys(v_segment) key where key not in ('version','conjunction','clauses'))
      or v_segment ->> 'conjunction' not in ('all','any') or jsonb_typeof(v_segment -> 'clauses')<>'array'
      or jsonb_array_length(v_segment -> 'clauses')>20
      or exists(select 1 from jsonb_array_elements(v_segment -> 'clauses') clause where jsonb_typeof(clause)<>'object'
        or not (clause ?& array['field','operator'])
        or exists(select 1 from jsonb_object_keys(clause) key where key not in ('field','operator','value'))
        or clause ->> 'field' not in ('lifecycle_state','preferred_contact_method','tag_id','service_area_zip','created_at','updated_at')
        or clause ->> 'operator' not in ('equals','not_equals','in','contains','before','after','is_empty')
        or (clause ->> 'operator'<>'is_empty' and not clause ? 'value'))
    ))
    or (v_cursor is not null and (jsonb_typeof(v_cursor)<>'object' or v_cursor -> 'version' is distinct from '1'::jsonb
      or not (v_cursor ?& array['version','sortValue','id'])
      or exists(select 1 from jsonb_object_keys(v_cursor) key where key not in ('version','sortValue','id'))
      or coalesce(v_cursor ->> 'sortValue','')='' or coalesce(v_cursor ->> 'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
  then raise exception 'invalid customer list payload' using errcode='22023'; end if;
  if v_segment is not null and exists(select 1 from jsonb_array_elements(v_segment -> 'clauses') clause
    where clause ->> 'field'='tag_id' and clause ->> 'operator'<>'is_empty'
      and coalesce(clause ->> 'value','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  then raise exception 'invalid customer list payload' using errcode='22023'; end if;
  v_state := builder_private.phase2c_growth_access_state(v_site_id,v_actor_id,'growth.customers',null,'customers.read');
  if v_state='restricted' then return jsonb_build_object('version',1,'status','restricted','items','[]'::jsonb,'nextCursor',null); end if;

  with candidates as (
    select contact.*,
      greatest(contact.updated_at,coalesce(activity.latest_at,contact.updated_at)) latest_activity,
      case v_sort when 'display_name' then lower(contact.display_name)
        when 'updated_at' then to_char(contact.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        else to_char(greatest(contact.updated_at,coalesce(activity.latest_at,contact.updated_at)) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end sort_value
    from public.builder_contacts contact
    left join lateral (
      select max(at) latest_at from (
        select max(lead.updated_at) at from public.builder_leads lead where lead.site_id=contact.site_id and lead.contact_id=contact.id
        union all select max(event.created_at) from public.builder_service_events event where event.site_id=contact.site_id and event.contact_id=contact.id
      ) activity_rows
    ) activity on true
    where contact.site_id=v_site_id
      and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'customers.read','customer',contact.id)
      and (v_search is null or contact.display_name ilike '%'||v_search||'%'
        or exists(select 1 from public.builder_contact_identities identity where identity.site_id=contact.site_id and identity.contact_id=contact.id and identity.normalized_value ilike '%'||v_search||'%'))
      and (v_segment is null or jsonb_array_length(v_segment -> 'clauses')=0 or
        (v_segment ->> 'conjunction'='all' and not exists(
          select 1 from jsonb_array_elements(v_segment -> 'clauses') clause where not case clause ->> 'field'
            when 'lifecycle_state' then case clause ->> 'operator' when 'equals' then contact.lifecycle_state=clause->>'value' when 'not_equals' then contact.lifecycle_state<>clause->>'value' when 'in' then contact.lifecycle_state in (select jsonb_array_elements_text(clause->'value')) when 'is_empty' then false else false end
            when 'preferred_contact_method' then case clause ->> 'operator' when 'equals' then contact.preferred_contact_method=clause->>'value' when 'not_equals' then contact.preferred_contact_method is distinct from clause->>'value' when 'is_empty' then contact.preferred_contact_method is null else false end
            when 'service_area_zip' then case clause ->> 'operator' when 'equals' then contact.service_zip_code=clause->>'value' when 'not_equals' then contact.service_zip_code is distinct from clause->>'value' when 'contains' then coalesce(contact.service_zip_code,'') ilike '%'||(clause->>'value')||'%' when 'is_empty' then contact.service_zip_code is null else false end
            when 'tag_id' then case clause ->> 'operator' when 'equals' then exists(select 1 from public.builder_contact_tag_links link where link.site_id=contact.site_id and link.contact_id=contact.id and link.tag_id=(clause->>'value')::uuid) when 'not_equals' then not exists(select 1 from public.builder_contact_tag_links link where link.site_id=contact.site_id and link.contact_id=contact.id and link.tag_id=(clause->>'value')::uuid) when 'is_empty' then not exists(select 1 from public.builder_contact_tag_links link where link.site_id=contact.site_id and link.contact_id=contact.id) else false end
            when 'created_at' then case clause ->> 'operator' when 'before' then contact.created_at<(clause->>'value')::timestamptz when 'after' then contact.created_at>(clause->>'value')::timestamptz else false end
            when 'updated_at' then case clause ->> 'operator' when 'before' then contact.updated_at<(clause->>'value')::timestamptz when 'after' then contact.updated_at>(clause->>'value')::timestamptz else false end
            else false end))
        or (v_segment ->> 'conjunction'='any' and exists(
          select 1 from jsonb_array_elements(v_segment -> 'clauses') clause where case clause ->> 'field'
            when 'lifecycle_state' then clause->>'operator'='equals' and contact.lifecycle_state=clause->>'value'
            when 'preferred_contact_method' then clause->>'operator'='equals' and contact.preferred_contact_method=clause->>'value'
            when 'service_area_zip' then clause->>'operator'='equals' and contact.service_zip_code=clause->>'value'
            when 'tag_id' then clause->>'operator'='equals' and exists(select 1 from public.builder_contact_tag_links link where link.site_id=contact.site_id and link.contact_id=contact.id and link.tag_id=(clause->>'value')::uuid)
            when 'created_at' then clause->>'operator'='before' and contact.created_at<(clause->>'value')::timestamptz
            when 'updated_at' then clause->>'operator'='before' and contact.updated_at<(clause->>'value')::timestamptz
            else false end)))
  ), cursor_page as (
    select * from candidates where v_cursor is null
      or (v_direction='asc' and (sort_value,id)>(v_cursor->>'sortValue',(v_cursor->>'id')::uuid))
      or (v_direction='desc' and (sort_value,id)<(v_cursor->>'sortValue',(v_cursor->>'id')::uuid))
    order by case when v_direction='asc' then sort_value end asc,case when v_direction='asc' then id end asc,
      case when v_direction='desc' then sort_value end desc,case when v_direction='desc' then id end desc limit v_limit+1
  ), numbered as (
    select *,row_number() over(order by case when v_direction='asc' then sort_value end asc,case when v_direction='asc' then id end asc,
      case when v_direction='desc' then sort_value end desc,case when v_direction='desc' then id end desc) rn,count(*) over() page_count from cursor_page
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'displayName',display_name,'lifecycleState',lifecycle_state,
      'preferredContactMethod',preferred_contact_method,'serviceZipCode',service_zip_code,'latestActivityAt',latest_activity,
      'version',version,'createdAt',created_at,'updatedAt',updated_at) order by rn) filter(where rn<=v_limit),'[]'::jsonb),
    (jsonb_agg(jsonb_build_object('version',1,'sortValue',sort_value,'id',id)) filter(where rn=v_limit and page_count>v_limit))->0
  into v_items,v_next_cursor from numbered;
  return jsonb_build_object('version',1,'status',v_state,'items',v_items,'nextCursor',v_next_cursor);
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'invalid customer list payload' using errcode='22023';
end;
$$;

create function public.builder_get_customer_detail_v1(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare v_site_id uuid; v_actor_id uuid; v_customer_id uuid; v_state text; v_result jsonb; v_owner boolean;
begin
  perform builder_private.phase2c_validate_request(p_request,array['version','siteId','actorId','customerId'],array['version','siteId','actorId','customerId'],'invalid customer detail payload');
  if coalesce(p_request->>'customerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then raise exception 'invalid customer detail payload' using errcode='22023'; end if;
  v_site_id:=(p_request->>'siteId')::uuid; v_actor_id:=(p_request->>'actorId')::uuid; v_customer_id:=(p_request->>'customerId')::uuid;
  v_state:=builder_private.phase2c_growth_access_state(v_site_id,v_actor_id,'growth.customers',null,'customers.read');
  select role='owner' into v_owner from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id;
  if v_state='restricted' or not builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'customers.read','customer',v_customer_id)
  then return '{"version":1,"status":"not_found"}'::jsonb; end if;
  select jsonb_build_object('version',1,'status',v_state,
    'customer',jsonb_build_object('id',c.id,'displayName',c.display_name,'lifecycleState',c.lifecycle_state,'preferredContactMethod',c.preferred_contact_method,
      'serviceZipCode',c.service_zip_code,'version',c.version,'createdAt',c.created_at,'updatedAt',c.updated_at),
    'identities',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'value',i.normalized_value,'verificationState',i.verification_state,
      'source',case i.source when 'public_form' then 'website_form' else i.source end,'createdAt',i.created_at) order by i.kind,i.id),'[]'::jsonb) from public.builder_contact_identities i where i.site_id=c.site_id and i.contact_id=c.id),
    'preferences',(select coalesce(jsonb_agg(jsonb_build_object('key',p.preference_key,'value',p.preference_value,'version',p.version,'updatedAt',p.updated_at) order by p.preference_key),'[]'::jsonb) from public.builder_contact_preferences p where p.site_id=c.site_id and p.contact_id=c.id),
    'suppressions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'channel',s.channel,'reason',s.reason,'active',s.active,'createdAt',s.created_at,'endedAt',s.ended_at) order by s.created_at,s.id),'[]'::jsonb) from public.builder_suppressions s where s.site_id=c.site_id and s.contact_id=c.id),
    'tags',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'key',t.key,'label',t.label,'colorToken',t.color_token) order by t.label,t.id),'[]'::jsonb) from public.builder_contact_tags t join public.builder_contact_tag_links l on l.site_id=t.site_id and l.tag_id=t.id where l.site_id=c.site_id and l.contact_id=c.id),
    'leads',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'source',case l.source when 'public_form' then 'website_form' else l.source end,'service',l.service,
      'urgency',case l.urgency when 'emergency' then 'emergency' when 'high' then 'urgent' else 'standard' end,'status',l.status,'version',l.version,'createdAt',l.created_at,'updatedAt',l.updated_at) order by l.created_at,l.id),'[]'::jsonb)
      from public.builder_leads l where l.site_id=c.site_id and l.contact_id=c.id
        and builder_private.dependent_action_allowed(v_site_id,'growth.customers','growth.leads','read')
        and builder_private.member_has_capability(v_site_id,v_actor_id,'leads.read')
        and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'leads.read','lead',l.id)),
    'serviceEvents',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'leadId',e.lead_id,'eventKind',e.event_kind,'purpose',e.purpose,'scheduledAt',e.scheduled_at,'occurredAt',e.occurred_at,'createdAt',e.created_at) order by e.created_at,e.id),'[]'::jsonb) from public.builder_service_events e where e.site_id=c.site_id and e.contact_id=c.id),
    'mergeSuggestions',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'leftCustomerId',m.left_contact_id,'rightCustomerId',m.right_contact_id,'evidenceCategories',m.evidence_categories,'confidenceBand',m.confidence_band,'reviewState',m.review_state,'version',m.version,'createdAt',m.created_at,'updatedAt',m.updated_at) order by m.created_at,m.id),'[]'::jsonb)
      from public.builder_contact_merge_suggestions m where m.site_id=c.site_id and (m.left_contact_id=c.id or m.right_contact_id=c.id) and builder_private.member_has_capability(v_site_id,v_actor_id,'customers.update','site')),
    'exports',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'domain',e.domain,'state',e.state,'schemaVersion',e.schema_version,'expiresAt',e.object_expires_at,'createdAt',e.created_at,'updatedAt',e.updated_at) order by e.created_at,e.id),'[]'::jsonb)
      from public.builder_data_exports e where e.site_id=c.site_id and e.domain='customers' and (e.requester_id=v_actor_id or v_owner) and builder_private.member_has_capability(v_site_id,v_actor_id,'customers.export')),
    'deletionRequests',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'scope',d.scope,'state',d.state,'legalHold',d.legal_hold,'version',d.version,'createdAt',d.created_at,'updatedAt',d.updated_at) order by d.created_at,d.id),'[]'::jsonb)
      from public.builder_deletion_requests d where d.site_id=c.site_id and d.contact_id=c.id and v_owner)
  ) into v_result from public.builder_contacts c where c.site_id=v_site_id and c.id=v_customer_id;
  return coalesce(v_result,'{"version":1,"status":"not_found"}'::jsonb);
end;
$$;

create function public.builder_get_dashboard_facts_v1(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare v_site_id uuid; v_actor_id uuid; v_state text; v_role text; v_leads boolean; v_customers boolean; v_tasks boolean;
begin
  perform builder_private.phase2c_validate_request(p_request,array['version','siteId','actorId'],array['version','siteId','actorId'],'invalid dashboard facts payload');
  v_site_id:=(p_request->>'siteId')::uuid; v_actor_id:=(p_request->>'actorId')::uuid;
  v_state:=builder_private.phase2c_growth_access_state(v_site_id,v_actor_id,'growth.dashboard',null,'dashboard.read');
  if v_state='restricted' then return jsonb_build_object('version',1,'status','restricted','facts','{}'::jsonb); end if;
  select role into v_role from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id;
  v_leads:=builder_private.dependent_action_allowed(v_site_id,'growth.customers','growth.leads','read') and builder_private.member_has_capability(v_site_id,v_actor_id,'leads.read');
  v_customers:=builder_private.module_action_allowed(v_site_id,'growth.customers','read') and builder_private.member_has_capability(v_site_id,v_actor_id,'customers.read');
  v_tasks:=v_leads and builder_private.member_has_capability(v_site_id,v_actor_id,'tasks.read');
  return jsonb_build_object('version',1,'status',v_state,'facts',jsonb_build_object(
    'leads',case when v_leads then jsonb_build_object('status','allowed',
      'newCount',(select count(*) from public.builder_leads l where l.site_id=v_site_id and l.status='new' and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'leads.read','lead',l.id)),
      'agingCount',(select count(*) from public.builder_leads l where l.site_id=v_site_id and l.status in ('new','contacted','qualified') and l.created_at<statement_timestamp()-interval '2 days' and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'leads.read','lead',l.id)),
      'unassignedCount',(select count(*) from public.builder_leads l where l.site_id=v_site_id and l.primary_assignee_id is null and l.status not in ('won','lost','spam') and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'leads.read','lead',l.id))) else '{"status":"restricted"}'::jsonb end,
    'customers',case when v_customers then jsonb_build_object('status','allowed','activeCount',(select count(*) from public.builder_contacts c where c.site_id=v_site_id and c.lifecycle_state='active' and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'customers.read','customer',c.id)),
      'recentActivityCount',(select count(distinct e.contact_id) from public.builder_service_events e where e.site_id=v_site_id and e.created_at>=statement_timestamp()-interval '7 days' and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'customers.read','customer',e.contact_id))) else '{"status":"restricted"}'::jsonb end,
    'tasks',case when v_tasks then jsonb_build_object('status','allowed','dueTodayCount',(select count(*) from public.builder_tasks t where t.site_id=v_site_id and t.state in ('open','in_progress') and t.due_at::date=statement_timestamp()::date and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'tasks.read','task',t.id)),
      'overdueCount',(select count(*) from public.builder_tasks t where t.site_id=v_site_id and t.state in ('open','in_progress') and t.due_at<statement_timestamp() and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'tasks.read','task',t.id))) else '{"status":"restricted"}'::jsonb end,
    'notifications',jsonb_build_object('status','allowed','unreadCount',(select count(*) from public.builder_in_app_notifications n where n.site_id=v_site_id and n.recipient_id=v_actor_id and n.read_at is null)),
    'baseSubmissions',case when v_role in ('owner','editor') then jsonb_build_object('status','allowed','recentCount',(select count(*) from public.builder_form_submissions s where s.site_id=v_site_id and s.received_at>=statement_timestamp()-interval '7 days'),
      'spamReviewCount',(select count(*) from public.builder_form_submission_results r where r.site_id=v_site_id and r.result_code in ('spam','review_required') and not exists(select 1 from public.builder_form_submission_results newer where newer.site_id=r.site_id and newer.submission_id=r.submission_id and newer.version>r.version))) else '{"status":"restricted"}'::jsonb end,
    'health',case when builder_private.member_has_capability(v_site_id,v_actor_id,'siteHealth.read') then jsonb_build_object('status','allowed','items',(select coalesce(jsonb_agg(jsonb_build_object('checkKind',h.check_kind,'status',h.status,'observedVersion',h.observed_version,'queueAgeSeconds',h.queue_age_seconds,'snapshotAgeSeconds',h.snapshot_age_seconds,'safeCode',h.safe_code,'observedAt',h.observed_at) order by h.observed_at desc,h.id),'[]'::jsonb) from public.builder_health_checks h where h.site_id=v_site_id)) else '{"status":"restricted"}'::jsonb end
  ));
end;
$$;

create function public.builder_list_form_submissions_v1(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare v_site_id uuid; v_actor_id uuid; v_limit integer; v_search text; v_codes jsonb; v_cursor jsonb; v_role text; v_items jsonb; v_next jsonb;
begin
  perform builder_private.phase2c_validate_request(p_request,array['version','siteId','actorId','search','resultCodes','limit','cursor'],array['version','siteId','actorId','limit'],'invalid submission list payload');
  v_site_id:=(p_request->>'siteId')::uuid; v_actor_id:=(p_request->>'actorId')::uuid;
  v_limit:=case when jsonb_typeof(p_request->'limit')='number' then (p_request->>'limit')::integer else null end;
  v_search:=nullif(btrim(coalesce(p_request->>'search','')),''); v_codes:=p_request->'resultCodes'; v_cursor:=p_request->'cursor';
  if v_limit not between 1 and 100 or (v_search is not null and char_length(v_search)>200)
    or (v_codes is not null and (jsonb_typeof(v_codes)<>'array' or jsonb_array_length(v_codes)>20 or exists(select 1 from jsonb_array_elements_text(v_codes) code where code not in ('base_only','enhanced','review_required','identity_conflict','spam'))))
    or (v_cursor is not null and (jsonb_typeof(v_cursor)<>'object' or v_cursor->'version' is distinct from '1'::jsonb or not (v_cursor ?& array['version','receivedAt','id'])
      or exists(select 1 from jsonb_object_keys(v_cursor) key where key not in ('version','receivedAt','id'))
      or coalesce(v_cursor->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
  then raise exception 'invalid submission list payload' using errcode='22023'; end if;
  select role into v_role from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id;
  if v_role not in ('owner','editor') then return jsonb_build_object('version',1,'status','restricted','items','[]'::jsonb,'nextCursor',null); end if;
  with candidates as (
    select s.*,r.id result_id,r.version result_version,r.result_code,r.contact_id,r.lead_id,r.safe_metadata,r.created_at result_created_at
    from public.builder_form_submissions s left join lateral (select result.* from public.builder_form_submission_results result where result.site_id=s.site_id and result.submission_id=s.id order by result.version desc limit 1) r on true
    where s.site_id=v_site_id and (v_search is null or s.form_id ilike '%'||v_search||'%' or coalesce(s.zip_code,'') ilike '%'||v_search||'%')
      and (v_codes is null or r.result_code in(select jsonb_array_elements_text(v_codes)))
      and (v_cursor is null or (s.received_at,s.id)<((v_cursor->>'receivedAt')::timestamptz,(v_cursor->>'id')::uuid))
    order by s.received_at desc,s.id desc limit v_limit+1
  ), numbered as (select *,row_number() over(order by received_at desc,id desc) rn,count(*) over() page_count from candidates)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'formId',form_id,'source',case source when 'public_form' then 'website_form' else source end,'zipCode',zip_code,'locale',locale,'receivedAt',received_at,
    'currentResult',case when result_id is null then null else jsonb_build_object('id',result_id,'version',result_version,'resultCode',result_code,'contactId',contact_id,'leadId',lead_id,'safeMetadata',safe_metadata,'createdAt',result_created_at) end) order by rn) filter(where rn<=v_limit),'[]'::jsonb),
    (jsonb_agg(jsonb_build_object('version',1,'receivedAt',received_at,'id',id)) filter(where rn=v_limit and page_count>v_limit))->0 into v_items,v_next from numbered;
  return jsonb_build_object('version',1,'status','allowed','items',v_items,'nextCursor',v_next);
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'invalid submission list payload' using errcode='22023';
end;
$$;

create function public.builder_get_form_submission_detail_v1(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare v_site_id uuid; v_actor_id uuid; v_id uuid; v_role text; v_result jsonb;
begin
  perform builder_private.phase2c_validate_request(p_request,array['version','siteId','actorId','submissionId'],array['version','siteId','actorId','submissionId'],'invalid submission detail payload');
  if coalesce(p_request->>'submissionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'invalid submission detail payload' using errcode='22023'; end if;
  v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_id:=(p_request->>'submissionId')::uuid;
  select role into v_role from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id;
  if v_role not in ('owner','editor') then return '{"version":1,"status":"not_found"}'::jsonb; end if;
  select jsonb_build_object('version',1,'status','allowed','submission',jsonb_build_object('id',s.id,'formId',s.form_id,'payload',s.payload,'source',case s.source when 'public_form' then 'website_form' else s.source end,'zipCode',s.zip_code,'locale',s.locale,'receivedAt',s.received_at,'createdAt',s.created_at),
    'consents',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'policyVersion',c.policy_version,'purpose',c.purpose,'languageDigest',c.language_digest,'source',case c.source when 'public_form' then 'website_form' else c.source end,'capturedAt',c.captured_at) order by c.captured_at,c.id),'[]'::jsonb) from public.builder_form_submission_consents c where c.site_id=s.site_id and c.submission_id=s.id),
    'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'eventKind',e.event_kind,'actorId',e.actor_id,'metadata',e.metadata,'createdAt',e.created_at) order by e.created_at,e.id),'[]'::jsonb) from public.builder_form_submission_events e where e.site_id=s.site_id and e.submission_id=s.id),
    'results',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'priorResultId',r.prior_result_id,'resultCode',r.result_code,'contactId',r.contact_id,'leadId',r.lead_id,'safeMetadata',r.safe_metadata,'createdAt',r.created_at) order by r.version),'[]'::jsonb) from public.builder_form_submission_results r where r.site_id=s.site_id and r.submission_id=s.id)
  ) into v_result from public.builder_form_submissions s where s.site_id=v_site_id and s.id=v_id;
  return coalesce(v_result,'{"version":1,"status":"not_found"}'::jsonb);
end;
$$;

create function public.builder_list_in_app_notifications_v1(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare v_site_id uuid;v_actor_id uuid;v_limit integer;v_unread boolean;v_cursor jsonb;v_items jsonb;v_next jsonb;
begin
  perform builder_private.phase2c_validate_request(p_request,array['version','siteId','actorId','unreadOnly','limit','cursor'],array['version','siteId','actorId','limit'],'invalid notification list payload');
  v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_limit:=case when jsonb_typeof(p_request->'limit')='number' then (p_request->>'limit')::integer else null end;
  v_unread:=coalesce((p_request->>'unreadOnly')::boolean,false);v_cursor:=p_request->'cursor';
  if v_limit not between 1 and 100 or (p_request ? 'unreadOnly' and jsonb_typeof(p_request->'unreadOnly')<>'boolean')
    or (v_cursor is not null and (jsonb_typeof(v_cursor)<>'object' or v_cursor->'version' is distinct from '1'::jsonb or not(v_cursor ?& array['version','createdAt','id'])
      or exists(select 1 from jsonb_object_keys(v_cursor) key where key not in ('version','createdAt','id')) or coalesce(v_cursor->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
  then raise exception 'invalid notification list payload' using errcode='22023';end if;
  if not exists(select 1 from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id) then return jsonb_build_object('version',1,'status','restricted','items','[]'::jsonb,'nextCursor',null,'unreadCount',0);end if;
  with candidates as (
    select n.* from public.builder_in_app_notifications n where n.site_id=v_site_id and n.recipient_id=v_actor_id and (not v_unread or n.read_at is null)
      and (n.resource_type is null or case n.resource_type when 'lead' then builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'leads.read','lead',n.resource_id)
        when 'customer' then builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'customers.read','customer',n.resource_id)
        when 'task' then builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'tasks.read','task',n.resource_id) else false end)
      and (v_cursor is null or (n.created_at,n.id)<((v_cursor->>'createdAt')::timestamptz,(v_cursor->>'id')::uuid)) order by n.created_at desc,n.id desc limit v_limit+1
  ),numbered as(select *,row_number() over(order by created_at desc,id desc) rn,count(*) over() page_count from candidates)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'eventType',event_type,'resourceType',resource_type,'resourceId',resource_id,'previewText',preview_text,'readAt',read_at,'createdAt',created_at) order by rn) filter(where rn<=v_limit),'[]'::jsonb),
    (jsonb_agg(jsonb_build_object('version',1,'createdAt',created_at,'id',id)) filter(where rn=v_limit and page_count>v_limit))->0 into v_items,v_next from numbered;
  return jsonb_build_object('version',1,'status','allowed','items',v_items,'nextCursor',v_next,'unreadCount',(select count(*) from public.builder_in_app_notifications n where n.site_id=v_site_id and n.recipient_id=v_actor_id and n.read_at is null));
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'invalid notification list payload' using errcode='22023';
end;
$$;

create function public.builder_list_assignment_members_v1(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare v_site_id uuid;v_actor_id uuid;v_purpose text;v_allowed boolean;v_cap text;v_items jsonb;
begin
  perform builder_private.phase2c_validate_request(p_request,array['version','siteId','actorId','purpose'],array['version','siteId','actorId','purpose'],'invalid assignment member list payload');
  v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_purpose:=p_request->>'purpose';
  if v_purpose not in ('lead_assignment','task_assignment','customer_assignment') then raise exception 'invalid assignment member list payload' using errcode='22023';end if;
  v_cap:=case v_purpose when 'lead_assignment' then 'leads.read' when 'task_assignment' then 'tasks.read' else 'customers.read' end;
  v_allowed:=case v_purpose
    when 'lead_assignment' then builder_private.dependent_action_allowed(v_site_id,'growth.customers','growth.leads','write') and builder_private.member_has_capability(v_site_id,v_actor_id,'leads.assign','site')
    when 'task_assignment' then builder_private.dependent_action_allowed(v_site_id,'growth.customers','growth.leads','write') and builder_private.member_has_capability(v_site_id,v_actor_id,'tasks.manage','site')
    else builder_private.module_action_allowed(v_site_id,'growth.customers','write') and builder_private.member_has_capability(v_site_id,v_actor_id,'customers.update','site') end;
  if not v_allowed then return jsonb_build_object('version',1,'status','restricted','items','[]'::jsonb);end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'role',m.role,
    'displayLabel',initcap(m.role)||' '||left(m.user_id::text,8)) order by m.role,m.user_id),'[]'::jsonb)
  into v_items from public.builder_site_members m
  where m.site_id=v_site_id and builder_private.member_has_capability(v_site_id,m.user_id,v_cap);
  return jsonb_build_object('version',1,'status','allowed','items',v_items);
end;
$$;

create function public.builder_list_member_invitations_v1(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare v_site_id uuid;v_actor_id uuid;v_limit integer;v_cursor jsonb;v_owner boolean;v_items jsonb;v_next jsonb;
begin
  perform builder_private.phase2c_validate_request(p_request,array['version','siteId','actorId','limit','cursor'],array['version','siteId','actorId','limit'],'invalid invitation list payload');
  v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_limit:=case when jsonb_typeof(p_request->'limit')='number' then (p_request->>'limit')::integer else null end;v_cursor:=p_request->'cursor';
  if v_limit not between 1 and 100 or (v_cursor is not null and (jsonb_typeof(v_cursor)<>'object' or v_cursor->'version' is distinct from '1'::jsonb or not(v_cursor ?& array['version','createdAt','id'])
    or exists(select 1 from jsonb_object_keys(v_cursor) key where key not in ('version','createdAt','id')) or coalesce(v_cursor->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
  then raise exception 'invalid invitation list payload' using errcode='22023';end if;
  select role='owner' into v_owner from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id;
  if not coalesce(v_owner,false) or not builder_private.member_has_capability(v_site_id,v_actor_id,'members.manage','site') then return jsonb_build_object('version',1,'status','restricted','items','[]'::jsonb,'nextCursor',null);end if;
  with candidates as(select i.* from public.builder_member_invitations i where i.site_id=v_site_id and (v_cursor is null or (i.created_at,i.id)<((v_cursor->>'createdAt')::timestamptz,(v_cursor->>'id')::uuid)) order by i.created_at desc,i.id desc limit v_limit+1),
  numbered as(select *,row_number() over(order by created_at desc,id desc) rn,count(*) over() page_count from candidates)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'templateId',template_id,'templateVersion',template_version,'invitedBy',invited_by,'state',state,'expiresAt',expires_at,'acceptedBy',accepted_by,'acceptedAt',accepted_at,'revokedAt',revoked_at,'version',version,'createdAt',created_at,'updatedAt',updated_at) order by rn) filter(where rn<=v_limit),'[]'::jsonb),
    (jsonb_agg(jsonb_build_object('version',1,'createdAt',created_at,'id',id)) filter(where rn=v_limit and page_count>v_limit))->0 into v_items,v_next from numbered;
  return jsonb_build_object('version',1,'status','allowed','items',v_items,'nextCursor',v_next);
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'invalid invitation list payload' using errcode='22023';
end;
$$;

revoke all on function public.builder_list_leads_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_get_lead_detail_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_list_customers_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_get_customer_detail_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_get_dashboard_facts_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_list_form_submissions_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_get_form_submission_detail_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_list_in_app_notifications_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_list_assignment_members_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_list_member_invitations_v1(jsonb) from public,anon,authenticated;
grant execute on function public.builder_list_leads_v1(jsonb) to service_role;
grant execute on function public.builder_get_lead_detail_v1(jsonb) to service_role;
grant execute on function public.builder_list_customers_v1(jsonb) to service_role;
grant execute on function public.builder_get_customer_detail_v1(jsonb) to service_role;
grant execute on function public.builder_get_dashboard_facts_v1(jsonb) to service_role;
grant execute on function public.builder_list_form_submissions_v1(jsonb) to service_role;
grant execute on function public.builder_get_form_submission_detail_v1(jsonb) to service_role;
grant execute on function public.builder_list_in_app_notifications_v1(jsonb) to service_role;
grant execute on function public.builder_list_assignment_members_v1(jsonb) to service_role;
grant execute on function public.builder_list_member_invitations_v1(jsonb) to service_role;

create function public.builder_execute_customer_merge_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_suggestion_id uuid;
  v_source_id uuid;
  v_target_id uuid;
  v_expected_suggestion_version integer;
  v_expected_source_version integer;
  v_expected_target_version integer;
  v_suggestion public.builder_contact_merge_suggestions%rowtype;
  v_source public.builder_contacts%rowtype;
  v_target public.builder_contacts%rowtype;
  v_alias_id uuid := gen_random_uuid();
  v_audit_id uuid := gen_random_uuid();
  v_claim jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(p_request) <> 'object'
    or p_request -> 'version' is distinct from '1'::jsonb
    or not (p_request ?& array[
      'version','commandId','idempotencyKey','siteId','actorId','suggestionId',
      'expectedSuggestionVersion','sourceId','targetId','expectedSourceVersion','expectedTargetVersion'
    ])
    or exists (select 1 from jsonb_object_keys(p_request) key where key <> all(array[
      'version','commandId','idempotencyKey','siteId','actorId','suggestionId',
      'expectedSuggestionVersion','sourceId','targetId','expectedSourceVersion','expectedTargetVersion'
    ]))
    or coalesce(p_request ->> 'commandId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'idempotencyKey','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'siteId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'actorId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'suggestionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'sourceId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'targetId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'expectedSuggestionVersion','') !~ '^[1-9][0-9]*$'
    or coalesce(p_request ->> 'expectedSourceVersion','') !~ '^[1-9][0-9]*$'
    or coalesce(p_request ->> 'expectedTargetVersion','') !~ '^[1-9][0-9]*$'
    or p_request ->> 'sourceId' = p_request ->> 'targetId'
  then raise exception 'invalid customer merge execution payload' using errcode='22023'; end if;

  begin
    v_site_id := (p_request ->> 'siteId')::uuid;
    v_actor_id := (p_request ->> 'actorId')::uuid;
    v_suggestion_id := (p_request ->> 'suggestionId')::uuid;
    v_source_id := (p_request ->> 'sourceId')::uuid;
    v_target_id := (p_request ->> 'targetId')::uuid;
    v_expected_suggestion_version := (p_request ->> 'expectedSuggestionVersion')::integer;
    v_expected_source_version := (p_request ->> 'expectedSourceVersion')::integer;
    v_expected_target_version := (p_request ->> 'expectedTargetVersion')::integer;
  exception when others then
    raise exception 'invalid customer merge execution payload' using errcode='22023';
  end;

  if not exists(select 1 from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id)
    or not builder_private.module_action_allowed(v_site_id,'growth.customers','write')
    or not builder_private.member_has_capability(v_site_id,v_actor_id,'customers.update','site')
  then raise exception 'customer merge execution not authorized' using errcode='42501'; end if;

  v_claim := builder_private.claim_operational_command_v1(p_request,'growth.customer-merge.execute.v1');
  if v_claim ->> 'status' = 'replay' then
    return (v_claim -> 'result') || jsonb_build_object('status','replayed');
  end if;

  select * into v_suggestion from public.builder_contact_merge_suggestions
  where site_id=v_site_id and id=v_suggestion_id for update;
  if not found then raise exception 'customer merge execution not authorized' using errcode='42501'; end if;

  perform 1 from public.builder_contacts
  where site_id=v_site_id and id in (v_source_id,v_target_id)
  order by id for update;
  select * into v_source from public.builder_contacts where site_id=v_site_id and id=v_source_id;
  if not found then raise exception 'customer merge execution not authorized' using errcode='42501'; end if;
  select * into v_target from public.builder_contacts where site_id=v_site_id and id=v_target_id;
  if not found then raise exception 'customer merge execution not authorized' using errcode='42501'; end if;

  if not ((v_suggestion.left_contact_id=v_source_id and v_suggestion.right_contact_id=v_target_id)
    or (v_suggestion.left_contact_id=v_target_id and v_suggestion.right_contact_id=v_source_id))
  then raise exception 'customer merge candidates do not match suggestion' using errcode='22023'; end if;
  if v_suggestion.review_state <> 'accepted'
    or v_source.lifecycle_state in ('merged','deleted')
    or v_target.lifecycle_state in ('merged','deleted')
    or exists(select 1 from public.builder_contact_aliases where site_id=v_site_id and source_contact_id in (v_source_id,v_target_id))
  then raise exception 'customer merge execution invalid state' using errcode='22023'; end if;

  if v_suggestion.version <> v_expected_suggestion_version
    or v_source.version <> v_expected_source_version
    or v_target.version <> v_expected_target_version
  then
    v_result := jsonb_build_object(
      'version',1,'status','conflict',
      'expectedSuggestionVersion',v_expected_suggestion_version,'actualSuggestionVersion',v_suggestion.version,
      'expectedSourceVersion',v_expected_source_version,'actualSourceVersion',v_source.version,
      'expectedTargetVersion',v_expected_target_version,'actualTargetVersion',v_target.version,
      'actualVersion',case
        when v_suggestion.version<>v_expected_suggestion_version then v_suggestion.version
        when v_source.version<>v_expected_source_version then v_source.version
        else v_target.version end
    );
    return builder_private.complete_operational_command_v1(p_request,'growth.customer-merge.execute.v1',v_result);
  end if;

  insert into public.builder_contact_aliases(site_id,id,source_contact_id,canonical_contact_id,reason,created_by,created_at)
  values(v_site_id,v_alias_id,v_source_id,v_target_id,'merge',v_actor_id,clock_timestamp());
  update public.builder_contacts set lifecycle_state='merged',version=version+1,updated_at=clock_timestamp()
  where site_id=v_site_id and id=v_source_id;
  update public.builder_contacts set version=version+1,updated_at=clock_timestamp()
  where site_id=v_site_id and id=v_target_id;
  update public.builder_contact_merge_suggestions
  set review_state='merged',version=version+1,updated_at=clock_timestamp()
  where site_id=v_site_id and id=v_suggestion_id;

  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,before_value,after_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.customer_merge.executed',v_actor_id,'Executed an accepted customer merge',
    jsonb_build_object('suggestionId',v_suggestion_id,'suggestionVersion',v_suggestion.version,
      'sourceId',v_source_id,'sourceVersion',v_source.version,'sourceState',v_source.lifecycle_state,
      'targetId',v_target_id,'targetVersion',v_target.version),
    jsonb_build_object('suggestionId',v_suggestion_id,'suggestionVersion',v_suggestion.version+1,'suggestionState','merged',
      'sourceId',v_source_id,'sourceVersion',v_source.version+1,'sourceState','merged',
      'targetId',v_target_id,'targetVersion',v_target.version+1,'aliasId',v_alias_id),p_request->>'commandId');
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.customer-merge.executed',jsonb_build_object('version',1,'suggestionId',v_suggestion_id,
      'sourceCustomerId',v_source_id,'customerId',v_target_id,'customerVersion',v_target.version+1),
    'growth.customer-merge.execute:'||(p_request->>'commandId'),1,'customer',v_target_id,(p_request->>'commandId')::uuid);

  v_result := jsonb_build_object('version',1,'status','applied','customerId',v_target_id,
    'resultVersion',v_target.version+1,'sourceCustomerId',v_source_id,'suggestionId',v_suggestion_id);
  return builder_private.complete_operational_command_v1(p_request,'growth.customer-merge.execute.v1',v_result);
end;
$$;

revoke all on function public.builder_execute_customer_merge_v1(jsonb) from public,anon,authenticated;
grant execute on function public.builder_execute_customer_merge_v1(jsonb) to service_role;
