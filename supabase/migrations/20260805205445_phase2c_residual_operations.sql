create function builder_private.phase2c_residual_validate_common(
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
    or exists(select 1 from jsonb_object_keys(p_request) key where not key=any(p_allowed_keys))
    or octet_length(p_request::text)>131072
    or coalesce(p_request->>'commandId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'idempotencyKey','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'siteId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'actorId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then raise exception '%',p_error using errcode='22023'; end if;
end;
$$;

create function builder_private.phase2c_saved_view_ast_valid(p_domain text,p_ast jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_domain not in ('leads','customers','base_submissions')
    or jsonb_typeof(p_ast)<>'object'
    or p_ast->'version' is distinct from '1'::jsonb
    or not(p_ast ?& array['version','conjunction','clauses'])
    or exists(select 1 from jsonb_object_keys(p_ast) key where key not in ('version','conjunction','clauses'))
    or p_ast->>'conjunction' not in ('all','any')
    or jsonb_typeof(p_ast->'clauses')<>'array'
    or jsonb_array_length(p_ast->'clauses')>20
    or octet_length(p_ast::text)>16384
  then return false; end if;

  if exists(
    select 1 from jsonb_array_elements(p_ast->'clauses') clause
    where jsonb_typeof(clause)<>'object'
      or not(clause ?& array['field','operator'])
      or exists(select 1 from jsonb_object_keys(clause) key where key not in ('field','operator','value'))
      or clause->>'operator' not in ('equals','not_equals','in','contains','before','after','is_empty')
      or (clause->>'operator'<>'is_empty' and not clause?'value')
      or (clause->>'operator'='is_empty' and clause?'value')
      or case p_domain
        when 'leads' then clause->>'field' not in ('status','service','assignee_id','source','priority','created_at','updated_at')
        when 'customers' then clause->>'field' not in ('lifecycle_state','preferred_contact_method','tag_id','service_area_zip','created_at','updated_at')
        else clause->>'field' not in ('result_code','form_id','source','received_at') end
      or (clause?'value' and jsonb_typeof(clause->'value') not in ('string','number','boolean','array'))
      or (jsonb_typeof(clause->'value')='array' and (jsonb_array_length(clause->'value')>100
        or exists(select 1 from jsonb_array_elements(clause->'value') item where jsonb_typeof(item) not in ('string','number','boolean'))))
      or (jsonb_typeof(clause->'value')='string' and char_length(clause->>'value')>240)
  ) then return false; end if;
  return true;
end;
$$;

revoke all on function builder_private.phase2c_residual_validate_common(jsonb,text[],text[],text) from public,anon,authenticated;
revoke all on function builder_private.phase2c_saved_view_ast_valid(text,jsonb) from public,anon,authenticated;
grant execute on function builder_private.phase2c_residual_validate_common(jsonb,text[],text[],text) to service_role;
grant execute on function builder_private.phase2c_saved_view_ast_valid(text,jsonb) to service_role;

create function public.builder_bulk_apply_leads_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_operation text;
  v_status text;
  v_assignee_id uuid;
  v_tag_id uuid;
  v_record jsonb;
  v_lead_id uuid;
  v_expected_version integer;
  v_lead public.builder_leads%rowtype;
  v_audit_id uuid;
  v_results jsonb:='[]'::jsonb;
  v_claim jsonb;
  v_result jsonb;
  v_changed boolean;
  v_allowed boolean;
  v_transition boolean;
begin
  perform builder_private.phase2c_residual_validate_common(p_request,
    array['version','commandId','idempotencyKey','siteId','actorId','operation','records','status','assigneeId','tagId'],
    array['version','commandId','idempotencyKey','siteId','actorId','operation','records'],'invalid bulk lead payload');
  v_site_id:=(p_request->>'siteId')::uuid;
  v_actor_id:=(p_request->>'actorId')::uuid;
  v_operation:=p_request->>'operation';
  if jsonb_typeof(p_request->'records')<>'array' or jsonb_array_length(p_request->'records') not between 1 and 100
    or v_operation not in ('status','assignment','tag_add','tag_remove')
    or exists(select 1 from jsonb_array_elements(p_request->'records') item
      where jsonb_typeof(item)<>'object' or not(item ?& array['id','expectedVersion'])
        or exists(select 1 from jsonb_object_keys(item) key where key not in ('id','expectedVersion'))
        or coalesce(item->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(item->>'expectedVersion','') !~ '^[1-9][0-9]*$')
    or (select count(*) from jsonb_array_elements(p_request->'records'))<>(select count(distinct item->>'id') from jsonb_array_elements(p_request->'records') item)
    or (v_operation='status' and (p_request->>'status' not in ('new','contacted','qualified','won','lost','spam') or p_request?'assigneeId' or p_request?'tagId'))
    or (v_operation='assignment' and (coalesce(p_request->>'assigneeId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or p_request?'status' or p_request?'tagId'))
    or (v_operation in ('tag_add','tag_remove') and (coalesce(p_request->>'tagId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or p_request?'status' or p_request?'assigneeId'))
  then raise exception 'invalid bulk lead payload' using errcode='22023'; end if;
  v_status:=p_request->>'status';
  if v_operation='assignment' then v_assignee_id:=(p_request->>'assigneeId')::uuid; end if;
  if v_operation in ('tag_add','tag_remove') then
    v_tag_id:=(p_request->>'tagId')::uuid;
    if not exists(select 1 from public.builder_contact_tags where site_id=v_site_id and id=v_tag_id)
    then raise exception 'invalid bulk lead tag' using errcode='22023'; end if;
  end if;

  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.leads.bulk.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed'); end if;

  for v_record in select value from jsonb_array_elements(p_request->'records')
  loop
    v_lead_id:=(v_record->>'id')::uuid;
    v_expected_version:=(v_record->>'expectedVersion')::integer;
    v_allowed:=builder_private.dependent_action_allowed(v_site_id,'growth.customers','growth.leads','write')
      and builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'leads.update','lead',v_lead_id)
      and (v_operation<>'assignment' or (builder_private.member_has_capability(v_site_id,v_actor_id,'leads.assign','site')
        and exists(select 1 from public.builder_site_members where site_id=v_site_id and user_id=v_assignee_id)));
    if not v_allowed then
      v_results:=v_results||jsonb_build_array(jsonb_build_object('leadId',v_lead_id,'status','denied','reason','not_authorized'));
      continue;
    end if;
    select * into v_lead from public.builder_leads where site_id=v_site_id and id=v_lead_id for update;
    if not found then
      v_results:=v_results||jsonb_build_array(jsonb_build_object('leadId',v_lead_id,'status','denied','reason','not_found'));
      continue;
    end if;
    if v_lead.version<>v_expected_version then
      v_results:=v_results||jsonb_build_array(jsonb_build_object('leadId',v_lead_id,'status','conflict','expectedVersion',v_expected_version,'actualVersion',v_lead.version));
      continue;
    end if;
    v_changed:=true;
    v_audit_id:=gen_random_uuid();
    if v_operation='status' then
      v_transition:=case when v_status=v_lead.status then false
        when v_lead.status='new' then v_status in ('contacted','qualified','lost','spam')
        when v_lead.status='contacted' then v_status in ('new','qualified','lost','spam')
        when v_lead.status='qualified' then v_status in ('contacted','won','lost','spam')
        when v_lead.status='spam' then v_status='new' else false end;
      if not v_transition then
        v_results:=v_results||jsonb_build_array(jsonb_build_object('leadId',v_lead_id,'status','denied','reason','invalid_transition'));
        continue;
      end if;
      update public.builder_leads set status=v_status,version=version+1,
        won_at=case when v_status='won' then clock_timestamp() else null end,
        lost_at=case when v_status='lost' then clock_timestamp() else null end,updated_at=clock_timestamp()
      where site_id=v_site_id and id=v_lead_id and version=v_lead.version;
      insert into public.builder_lead_events(site_id,lead_id,event_kind,actor_id,metadata)
      values(v_site_id,v_lead_id,'status',v_actor_id,jsonb_build_object('version',v_lead.version+1,'from',v_lead.status,'to',v_status,'commandId',p_request->>'commandId'));
    elsif v_operation='assignment' then
      if v_lead.primary_assignee_id=v_assignee_id then v_changed:=false;
      else
        insert into public.builder_audit_events(site_id,id,action,actor_id,summary,before_value,after_value,correlation_id)
        values(v_site_id,v_audit_id,'growth.lead.bulk_assignment',v_actor_id,'Applied a bulk lead assignment',
          jsonb_build_object('leadId',v_lead_id,'version',v_lead.version,'assigneeId',v_lead.primary_assignee_id),
          jsonb_build_object('leadId',v_lead_id,'version',v_lead.version+1,'assigneeId',v_assignee_id),(p_request->>'commandId'));
        update public.builder_record_assignments set state='ended',ended_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp(),assigned_by=v_actor_id,audit_event_id=v_audit_id
        where site_id=v_site_id and resource_type='lead' and resource_id=v_lead_id and state='active';
        insert into public.builder_record_assignments(site_id,member_id,resource_type,resource_id,assigned_by,audit_event_id,state,version)
        values(v_site_id,v_assignee_id,'lead',v_lead_id,v_actor_id,v_audit_id,'active',1)
        on conflict(site_id,member_id,resource_type,resource_id) do update set state='active',ended_at=null,version=public.builder_record_assignments.version+1,
          assigned_by=excluded.assigned_by,audit_event_id=excluded.audit_event_id,updated_at=clock_timestamp();
        update public.builder_leads set primary_assignee_id=v_assignee_id,version=version+1,updated_at=clock_timestamp()
        where site_id=v_site_id and id=v_lead_id and version=v_lead.version;
        insert into public.builder_lead_events(site_id,lead_id,event_kind,actor_id,metadata)
        values(v_site_id,v_lead_id,'assignment',v_actor_id,jsonb_build_object('version',v_lead.version+1,'fromAssigneeId',v_lead.primary_assignee_id,'assigneeId',v_assignee_id,'commandId',p_request->>'commandId'));
      end if;
    elsif v_operation='tag_add' then
      insert into public.builder_lead_tag_links(site_id,lead_id,tag_id,created_by)
      values(v_site_id,v_lead_id,v_tag_id,v_actor_id) on conflict do nothing;
      v_changed:=found;
      if v_changed then update public.builder_leads set version=version+1,updated_at=clock_timestamp() where site_id=v_site_id and id=v_lead_id and version=v_lead.version; end if;
    else
      delete from public.builder_lead_tag_links where site_id=v_site_id and lead_id=v_lead_id and tag_id=v_tag_id;
      v_changed:=found;
      if v_changed then update public.builder_leads set version=version+1,updated_at=clock_timestamp() where site_id=v_site_id and id=v_lead_id and version=v_lead.version; end if;
    end if;
    if v_changed and v_operation in ('tag_add','tag_remove') then
      insert into public.builder_lead_events(site_id,lead_id,event_kind,actor_id,metadata)
      values(v_site_id,v_lead_id,'correction',v_actor_id,jsonb_build_object('version',v_lead.version+1,'field','tag','operation',v_operation,'tagId',v_tag_id,'commandId',p_request->>'commandId'));
    end if;
    if v_changed and v_operation<>'assignment' then
      insert into public.builder_audit_events(site_id,id,action,actor_id,summary,before_value,after_value,correlation_id)
      values(v_site_id,v_audit_id,'growth.lead.bulk_'||v_operation,v_actor_id,'Applied a bulk lead operation',
        jsonb_build_object('leadId',v_lead_id,'version',v_lead.version),jsonb_build_object('leadId',v_lead_id,'version',v_lead.version+1),(p_request->>'commandId'));
    end if;
    if v_changed then
      insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
      values(v_site_id,'growth.lead.bulk-'||replace(v_operation,'_','-'),jsonb_build_object('version',1,'leadId',v_lead_id,'operation',v_operation),
        'growth.bulk-lead:'||(p_request->>'commandId')||':'||v_lead_id::text,1,'lead',v_lead_id,(p_request->>'commandId')::uuid);
    end if;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('leadId',v_lead_id,'status','applied','changed',v_changed,'resultVersion',v_lead.version+case when v_changed then 1 else 0 end));
  end loop;
  v_result:=jsonb_build_object('version',1,'status','applied','operation',v_operation,'results',v_results);
  return builder_private.complete_operational_command_v1(p_request,'growth.leads.bulk.v1',v_result);
end;
$$;

revoke all on function public.builder_bulk_apply_leads_v1(jsonb) from public,anon,authenticated;
grant execute on function public.builder_bulk_apply_leads_v1(jsonb) to service_role;

create function public.builder_save_view_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;v_actor_id uuid;v_view_id uuid;v_expected integer;v_domain text;v_name text;v_visibility text;v_ast jsonb;
  v_role text;v_allowed boolean;v_share_allowed boolean;v_view public.builder_saved_views%rowtype;
  v_audit_id uuid:=gen_random_uuid();v_claim jsonb;v_result jsonb;
begin
  perform builder_private.phase2c_residual_validate_common(p_request,
    array['version','commandId','idempotencyKey','siteId','actorId','viewId','expectedVersion','domain','name','visibility','filterAst'],
    array['version','commandId','idempotencyKey','siteId','actorId','viewId','expectedVersion','domain','name','visibility','filterAst'],'invalid saved view payload');
  if coalesce(p_request->>'viewId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'expectedVersion','') !~ '^(0|[1-9][0-9]*)$'
    or p_request->>'domain' not in ('leads','customers','base_submissions')
    or p_request->>'visibility' not in ('private','site')
    or char_length(btrim(coalesce(p_request->>'name',''))) not between 1 and 100
    or not builder_private.phase2c_saved_view_ast_valid(p_request->>'domain',p_request->'filterAst')
  then raise exception 'invalid saved view payload' using errcode='22023';end if;
  v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_view_id:=(p_request->>'viewId')::uuid;
  v_expected:=(p_request->>'expectedVersion')::integer;v_domain:=p_request->>'domain';v_name:=btrim(p_request->>'name');
  v_visibility:=p_request->>'visibility';v_ast:=p_request->'filterAst';
  select role into v_role from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id;
  v_allowed:=case v_domain
    when 'leads' then builder_private.dependent_action_allowed(v_site_id,'growth.customers','growth.leads','read') and builder_private.member_has_capability(v_site_id,v_actor_id,'leads.read')
    when 'customers' then builder_private.module_action_allowed(v_site_id,'growth.customers','read') and builder_private.member_has_capability(v_site_id,v_actor_id,'customers.read')
    else v_role in ('owner','editor') end;
  v_share_allowed:=case v_domain
    when 'leads' then builder_private.dependent_action_allowed(v_site_id,'growth.customers','growth.leads','write') and builder_private.member_has_capability(v_site_id,v_actor_id,'leads.update','site')
    when 'customers' then builder_private.module_action_allowed(v_site_id,'growth.customers','write') and builder_private.member_has_capability(v_site_id,v_actor_id,'customers.update','site')
    else v_role='owner' end;
  if not v_allowed or (v_visibility='site' and not v_share_allowed) then raise exception 'saved view not authorized' using errcode='42501';end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.saved-view.save.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed');end if;
  select * into v_view from public.builder_saved_views where site_id=v_site_id and id=v_view_id for update;
  if v_expected=0 then
    if found then
      v_result:=jsonb_build_object('version',1,'status','conflict','expectedVersion',0,'actualVersion',v_view.version);
      return builder_private.complete_operational_command_v1(p_request,'growth.saved-view.save.v1',v_result);
    end if;
    insert into public.builder_saved_views(site_id,id,owner_id,domain,name,visibility,filter_ast,version)
    values(v_site_id,v_view_id,v_actor_id,v_domain,v_name,v_visibility,v_ast,1);
    insert into public.builder_audit_events(site_id,id,action,actor_id,summary,after_value,correlation_id)
    values(v_site_id,v_audit_id,'growth.saved_view.created',v_actor_id,'Created a saved view',jsonb_build_object('viewId',v_view_id,'domain',v_domain,'visibility',v_visibility,'version',1),p_request->>'commandId');
    v_result:=jsonb_build_object('version',1,'status','created','viewId',v_view_id,'resultVersion',1);
  else
    if not found then
      v_result:=jsonb_build_object('version',1,'status','conflict','expectedVersion',v_expected,'actualVersion',0);
      return builder_private.complete_operational_command_v1(p_request,'growth.saved-view.save.v1',v_result);
    end if;
    if v_view.owner_id<>v_actor_id and v_role<>'owner' then raise exception 'saved view not authorized' using errcode='42501';end if;
    if v_view.domain<>v_domain then raise exception 'invalid saved view payload' using errcode='22023';end if;
    if v_view.version<>v_expected then
      v_result:=jsonb_build_object('version',1,'status','conflict','expectedVersion',v_expected,'actualVersion',v_view.version);
      return builder_private.complete_operational_command_v1(p_request,'growth.saved-view.save.v1',v_result);
    end if;
    insert into public.builder_audit_events(site_id,id,action,actor_id,summary,before_value,after_value,correlation_id)
    values(v_site_id,v_audit_id,'growth.saved_view.updated',v_actor_id,'Updated a saved view',jsonb_build_object('viewId',v_view_id,'visibility',v_view.visibility,'version',v_view.version),jsonb_build_object('viewId',v_view_id,'visibility',v_visibility,'version',v_view.version+1),p_request->>'commandId');
    update public.builder_saved_views set name=v_name,visibility=v_visibility,filter_ast=v_ast,version=version+1,updated_at=clock_timestamp()
    where site_id=v_site_id and id=v_view_id and version=v_view.version;
    v_result:=jsonb_build_object('version',1,'status','updated','viewId',v_view_id,'resultVersion',v_view.version+1);
  end if;
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.saved-view.saved',jsonb_build_object('version',1,'viewId',v_view_id,'domain',v_domain,'visibility',v_visibility),
    'growth.saved-view.save:'||(p_request->>'commandId'),1,'saved_view',v_view_id,(p_request->>'commandId')::uuid);
  return builder_private.complete_operational_command_v1(p_request,'growth.saved-view.save.v1',v_result);
end;
$$;

create function public.builder_remove_saved_view_v1(p_request jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_site_id uuid;v_actor_id uuid;v_view_id uuid;v_expected integer;v_role text;v_view public.builder_saved_views%rowtype;
  v_share_allowed boolean;v_audit_id uuid:=gen_random_uuid();v_claim jsonb;v_result jsonb;
begin
  perform builder_private.phase2c_residual_validate_common(p_request,
    array['version','commandId','idempotencyKey','siteId','actorId','viewId','expectedVersion'],
    array['version','commandId','idempotencyKey','siteId','actorId','viewId','expectedVersion'],'invalid saved view removal payload');
  if coalesce(p_request->>'viewId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'expectedVersion','') !~ '^[1-9][0-9]*$'
  then raise exception 'invalid saved view removal payload' using errcode='22023';end if;
  v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_view_id:=(p_request->>'viewId')::uuid;v_expected:=(p_request->>'expectedVersion')::integer;
  select role into v_role from public.builder_site_members where site_id=v_site_id and user_id=v_actor_id;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.saved-view.remove.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed');end if;
  select * into v_view from public.builder_saved_views where site_id=v_site_id and id=v_view_id for update;
  if not found then raise exception 'saved view removal not authorized' using errcode='42501';end if;
  v_share_allowed:=case v_view.domain
    when 'leads' then builder_private.dependent_action_allowed(v_site_id,'growth.customers','growth.leads','write') and builder_private.member_has_capability(v_site_id,v_actor_id,'leads.update','site')
    when 'customers' then builder_private.module_action_allowed(v_site_id,'growth.customers','write') and builder_private.member_has_capability(v_site_id,v_actor_id,'customers.update','site')
    else v_role='owner' end;
  if (v_view.owner_id<>v_actor_id and v_role<>'owner') or (v_view.visibility='site' and not v_share_allowed)
  then raise exception 'saved view removal not authorized' using errcode='42501';end if;
  if v_view.version<>v_expected then
    v_result:=jsonb_build_object('version',1,'status','conflict','expectedVersion',v_expected,'actualVersion',v_view.version);
    return builder_private.complete_operational_command_v1(p_request,'growth.saved-view.remove.v1',v_result);
  end if;
  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,before_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.saved_view.removed',v_actor_id,'Removed a saved view',jsonb_build_object('viewId',v_view_id,'domain',v_view.domain,'visibility',v_view.visibility,'version',v_view.version),p_request->>'commandId');
  delete from public.builder_saved_views where site_id=v_site_id and id=v_view_id and version=v_view.version;
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.saved-view.removed',jsonb_build_object('version',1,'viewId',v_view_id,'domain',v_view.domain),
    'growth.saved-view.remove:'||(p_request->>'commandId'),1,'saved_view',v_view_id,(p_request->>'commandId')::uuid);
  v_result:=jsonb_build_object('version',1,'status','removed','viewId',v_view_id,'resultVersion',v_view.version+1);
  return builder_private.complete_operational_command_v1(p_request,'growth.saved-view.remove.v1',v_result);
end;
$$;

revoke all on function public.builder_save_view_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_remove_saved_view_v1(jsonb) from public,anon,authenticated;
grant execute on function public.builder_save_view_v1(jsonb) to service_role;
grant execute on function public.builder_remove_saved_view_v1(jsonb) to service_role;

create function public.builder_set_customer_preference_v1(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $$
declare
  v_site_id uuid;v_actor_id uuid;v_customer_id uuid;v_key text;v_value jsonb;v_expected integer;
  v_preference public.builder_contact_preferences%rowtype;v_audit_id uuid:=gen_random_uuid();v_claim jsonb;v_result jsonb;
begin
  perform builder_private.phase2c_residual_validate_common(p_request,
    array['version','commandId','idempotencyKey','siteId','actorId','customerId','key','value','expectedVersion'],
    array['version','commandId','idempotencyKey','siteId','actorId','customerId','key','value','expectedVersion'],'invalid customer preference payload');
  if coalesce(p_request->>'customerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'key','') !~ '^[a-z][a-z0-9._-]{0,63}$'
    or coalesce(p_request->>'expectedVersion','') !~ '^(0|[1-9][0-9]*)$'
    or octet_length((p_request->'value')::text)>4096
  then raise exception 'invalid customer preference payload' using errcode='22023';end if;
  v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_customer_id:=(p_request->>'customerId')::uuid;
  v_key:=p_request->>'key';v_value:=p_request->'value';v_expected:=(p_request->>'expectedVersion')::integer;
  if not builder_private.module_action_allowed(v_site_id,'growth.customers','write')
    or not builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'customers.update','customer',v_customer_id)
  then raise exception 'customer preference not authorized' using errcode='42501';end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.customer-preference.set.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed');end if;
  if not exists(select 1 from public.builder_contacts where site_id=v_site_id and id=v_customer_id)
  then raise exception 'customer preference not authorized' using errcode='42501';end if;
  select * into v_preference from public.builder_contact_preferences where site_id=v_site_id and contact_id=v_customer_id and preference_key=v_key for update;
  if v_expected=0 then
    if found then
      v_result:=jsonb_build_object('version',1,'status','conflict','expectedVersion',0,'actualVersion',v_preference.version);
      return builder_private.complete_operational_command_v1(p_request,'growth.customer-preference.set.v1',v_result);
    end if;
    insert into public.builder_contact_preferences(site_id,contact_id,preference_key,preference_value,version)
    values(v_site_id,v_customer_id,v_key,v_value,1);
    insert into public.builder_audit_events(site_id,id,action,actor_id,summary,after_value,correlation_id)
    values(v_site_id,v_audit_id,'growth.customer_preference.created',v_actor_id,'Created a customer preference',jsonb_build_object('customerId',v_customer_id,'key',v_key,'version',1),p_request->>'commandId');
    v_result:=jsonb_build_object('version',1,'status','created','customerId',v_customer_id,'key',v_key,'resultVersion',1);
  else
    if not found then
      v_result:=jsonb_build_object('version',1,'status','conflict','expectedVersion',v_expected,'actualVersion',0);
      return builder_private.complete_operational_command_v1(p_request,'growth.customer-preference.set.v1',v_result);
    end if;
    if v_preference.version<>v_expected then
      v_result:=jsonb_build_object('version',1,'status','conflict','expectedVersion',v_expected,'actualVersion',v_preference.version);
      return builder_private.complete_operational_command_v1(p_request,'growth.customer-preference.set.v1',v_result);
    end if;
    insert into public.builder_audit_events(site_id,id,action,actor_id,summary,before_value,after_value,correlation_id)
    values(v_site_id,v_audit_id,'growth.customer_preference.updated',v_actor_id,'Updated a customer preference',jsonb_build_object('customerId',v_customer_id,'key',v_key,'version',v_preference.version),jsonb_build_object('customerId',v_customer_id,'key',v_key,'version',v_preference.version+1),p_request->>'commandId');
    update public.builder_contact_preferences set preference_value=v_value,version=version+1,updated_at=clock_timestamp()
    where site_id=v_site_id and contact_id=v_customer_id and preference_key=v_key and version=v_preference.version;
    v_result:=jsonb_build_object('version',1,'status','updated','customerId',v_customer_id,'key',v_key,'resultVersion',v_preference.version+1);
  end if;
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.customer-preference.set',jsonb_build_object('version',1,'customerId',v_customer_id,'key',v_key),
    'growth.customer-preference.set:'||(p_request->>'commandId'),1,'customer',v_customer_id,(p_request->>'commandId')::uuid);
  return builder_private.complete_operational_command_v1(p_request,'growth.customer-preference.set.v1',v_result);
end;
$$;

create function public.builder_clear_customer_preference_v1(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $$
declare
  v_site_id uuid;v_actor_id uuid;v_customer_id uuid;v_key text;v_expected integer;
  v_preference public.builder_contact_preferences%rowtype;v_audit_id uuid:=gen_random_uuid();v_claim jsonb;v_result jsonb;
begin
  perform builder_private.phase2c_residual_validate_common(p_request,
    array['version','commandId','idempotencyKey','siteId','actorId','customerId','key','expectedVersion'],
    array['version','commandId','idempotencyKey','siteId','actorId','customerId','key','expectedVersion'],'invalid customer preference clear payload');
  if coalesce(p_request->>'customerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'key','') !~ '^[a-z][a-z0-9._-]{0,63}$' or coalesce(p_request->>'expectedVersion','') !~ '^[1-9][0-9]*$'
  then raise exception 'invalid customer preference clear payload' using errcode='22023';end if;
  v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_customer_id:=(p_request->>'customerId')::uuid;v_key:=p_request->>'key';v_expected:=(p_request->>'expectedVersion')::integer;
  if not builder_private.module_action_allowed(v_site_id,'growth.customers','write')
    or not builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'customers.update','customer',v_customer_id)
  then raise exception 'customer preference not authorized' using errcode='42501';end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.customer-preference.clear.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed');end if;
  select * into v_preference from public.builder_contact_preferences where site_id=v_site_id and contact_id=v_customer_id and preference_key=v_key for update;
  if not found then
    v_result:=jsonb_build_object('version',1,'status','conflict','expectedVersion',v_expected,'actualVersion',0);
    return builder_private.complete_operational_command_v1(p_request,'growth.customer-preference.clear.v1',v_result);
  end if;
  if v_preference.version<>v_expected then
    v_result:=jsonb_build_object('version',1,'status','conflict','expectedVersion',v_expected,'actualVersion',v_preference.version);
    return builder_private.complete_operational_command_v1(p_request,'growth.customer-preference.clear.v1',v_result);
  end if;
  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,before_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.customer_preference.removed',v_actor_id,'Removed a customer preference',jsonb_build_object('customerId',v_customer_id,'key',v_key,'version',v_preference.version),p_request->>'commandId');
  delete from public.builder_contact_preferences where site_id=v_site_id and contact_id=v_customer_id and preference_key=v_key and version=v_preference.version;
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.customer-preference.removed',jsonb_build_object('version',1,'customerId',v_customer_id,'key',v_key),
    'growth.customer-preference.clear:'||(p_request->>'commandId'),1,'customer',v_customer_id,(p_request->>'commandId')::uuid);
  v_result:=jsonb_build_object('version',1,'status','removed','customerId',v_customer_id,'key',v_key,'resultVersion',v_preference.version+1);
  return builder_private.complete_operational_command_v1(p_request,'growth.customer-preference.clear.v1',v_result);
end;
$$;

create function public.builder_set_customer_suppression_v1(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $$
declare
  v_site_id uuid;v_actor_id uuid;v_customer_id uuid;v_suppression_id uuid;v_operation text;v_channel text;v_reason text;
  v_suppression public.builder_suppressions%rowtype;v_changed boolean;v_audit_id uuid:=gen_random_uuid();v_claim jsonb;v_result jsonb;
begin
  perform builder_private.phase2c_residual_validate_common(p_request,
    array['version','commandId','idempotencyKey','siteId','actorId','customerId','suppressionId','operation','channel','reason','expectedState'],
    array['version','commandId','idempotencyKey','siteId','actorId','customerId','suppressionId','operation','channel','reason','expectedState'],'invalid customer suppression payload');
  if coalesce(p_request->>'customerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'suppressionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request->>'operation' not in ('suppress','unsuppress') or p_request->>'channel' not in ('email','sms','phone')
    or p_request->>'reason' not in ('unsubscribe','bounce','complaint','manual')
    or (p_request->>'operation'='suppress' and p_request->>'expectedState'<>'absent')
    or (p_request->>'operation'='unsuppress' and p_request->>'expectedState'<>'active')
  then raise exception 'invalid customer suppression payload' using errcode='22023';end if;
  v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_customer_id:=(p_request->>'customerId')::uuid;
  v_suppression_id:=(p_request->>'suppressionId')::uuid;v_operation:=p_request->>'operation';v_channel:=p_request->>'channel';v_reason:=p_request->>'reason';
  if not builder_private.module_action_allowed(v_site_id,'growth.customers','write')
    or not builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'customers.update','customer',v_customer_id)
  then raise exception 'customer suppression not authorized' using errcode='42501';end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.customer-suppression.set.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed');end if;
  if not exists(select 1 from public.builder_contacts where site_id=v_site_id and id=v_customer_id)
  then raise exception 'customer suppression not authorized' using errcode='42501';end if;
  select * into v_suppression from public.builder_suppressions where site_id=v_site_id and id=v_suppression_id for update;
  if v_operation='suppress' then
    if found then
      if v_suppression.contact_id<>v_customer_id or v_suppression.channel<>v_channel or v_suppression.reason<>v_reason or not v_suppression.active then
        v_result:=jsonb_build_object('version',1,'status','conflict','suppressionId',v_suppression_id,'actualState',case when v_suppression.active then 'active' else 'ended' end);
        return builder_private.complete_operational_command_v1(p_request,'growth.customer-suppression.set.v1',v_result);
      end if;
      v_changed:=false;
    elsif exists(select 1 from public.builder_suppressions where site_id=v_site_id and contact_id=v_customer_id and channel=v_channel and active) then
      v_result:=jsonb_build_object('version',1,'status','conflict','suppressionId',v_suppression_id,'actualState','active');
      return builder_private.complete_operational_command_v1(p_request,'growth.customer-suppression.set.v1',v_result);
    else
      insert into public.builder_suppressions(site_id,id,contact_id,channel,reason,active) values(v_site_id,v_suppression_id,v_customer_id,v_channel,v_reason,true);
      v_changed:=true;
    end if;
  else
    if not found then
      v_result:=jsonb_build_object('version',1,'status','conflict','suppressionId',v_suppression_id,'actualState','absent');
      return builder_private.complete_operational_command_v1(p_request,'growth.customer-suppression.set.v1',v_result);
    end if;
    if v_suppression.contact_id<>v_customer_id or v_suppression.channel<>v_channel or v_suppression.reason<>v_reason then
      raise exception 'invalid customer suppression target' using errcode='22023';end if;
    if v_suppression.active then
      update public.builder_suppressions set active=false,ended_at=clock_timestamp() where site_id=v_site_id and id=v_suppression_id and active;
      v_changed:=true;
    else v_changed:=false;end if;
  end if;
  if v_changed then
    insert into public.builder_audit_events(site_id,id,action,actor_id,summary,after_value,correlation_id)
    values(v_site_id,v_audit_id,'growth.customer_suppression.'||v_operation,v_actor_id,'Changed a customer suppression',jsonb_build_object('customerId',v_customer_id,'suppressionId',v_suppression_id,'channel',v_channel,'active',v_operation='suppress'),p_request->>'commandId');
    insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
    values(v_site_id,'growth.customer-suppression.'||v_operation,jsonb_build_object('version',1,'customerId',v_customer_id,'suppressionId',v_suppression_id,'channel',v_channel,'active',v_operation='suppress'),
      'growth.customer-suppression:'||(p_request->>'commandId'),1,'customer',v_customer_id,(p_request->>'commandId')::uuid);
  end if;
  v_result:=jsonb_build_object('version',1,'status','applied','customerId',v_customer_id,'suppressionId',v_suppression_id,'active',v_operation='suppress','changed',v_changed);
  return builder_private.complete_operational_command_v1(p_request,'growth.customer-suppression.set.v1',v_result);
end;
$$;

create function public.builder_set_record_tag_v1(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $$
declare
  v_site_id uuid;v_actor_id uuid;v_resource_type text;v_resource_id uuid;v_tag_id uuid;v_operation text;v_changed boolean;
  v_audit_id uuid:=gen_random_uuid();v_claim jsonb;v_result jsonb;
begin
  perform builder_private.phase2c_residual_validate_common(p_request,
    array['version','commandId','idempotencyKey','siteId','actorId','resourceType','resourceId','tagId','operation'],
    array['version','commandId','idempotencyKey','siteId','actorId','resourceType','resourceId','tagId','operation'],'invalid record tag payload');
  if p_request->>'resourceType' not in ('lead','customer') or p_request->>'operation' not in ('add','remove')
    or coalesce(p_request->>'resourceId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_request->>'tagId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then raise exception 'invalid record tag payload' using errcode='22023';end if;
  v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_resource_type:=p_request->>'resourceType';
  v_resource_id:=(p_request->>'resourceId')::uuid;v_tag_id:=(p_request->>'tagId')::uuid;v_operation:=p_request->>'operation';
  if not exists(select 1 from public.builder_contact_tags where site_id=v_site_id and id=v_tag_id)
  then raise exception 'invalid record tag target' using errcode='22023';end if;
  if (v_resource_type='lead' and (not builder_private.dependent_action_allowed(v_site_id,'growth.customers','growth.leads','write')
      or not builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'leads.update','lead',v_resource_id)))
    or (v_resource_type='customer' and (not builder_private.module_action_allowed(v_site_id,'growth.customers','write')
      or not builder_private.member_can_access_growth_record(v_site_id,v_actor_id,'customers.update','customer',v_resource_id)))
  then raise exception 'record tag not authorized' using errcode='42501';end if;
  if (v_resource_type='lead' and not exists(select 1 from public.builder_leads where site_id=v_site_id and id=v_resource_id))
    or (v_resource_type='customer' and not exists(select 1 from public.builder_contacts where site_id=v_site_id and id=v_resource_id))
  then raise exception 'record tag not authorized' using errcode='42501';end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.record-tag.set.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed');end if;
  if v_resource_type='lead' then
    if v_operation='add' then
      insert into public.builder_lead_tag_links(site_id,lead_id,tag_id,created_by) values(v_site_id,v_resource_id,v_tag_id,v_actor_id) on conflict do nothing;v_changed:=found;
    else delete from public.builder_lead_tag_links where site_id=v_site_id and lead_id=v_resource_id and tag_id=v_tag_id;v_changed:=found;end if;
    if v_changed then insert into public.builder_lead_events(site_id,lead_id,event_kind,actor_id,metadata) values(v_site_id,v_resource_id,'correction',v_actor_id,jsonb_build_object('field','tag','operation',v_operation,'tagId',v_tag_id,'commandId',p_request->>'commandId'));end if;
  else
    if v_operation='add' then
      insert into public.builder_contact_tag_links(site_id,contact_id,tag_id,created_by) values(v_site_id,v_resource_id,v_tag_id,v_actor_id) on conflict do nothing;v_changed:=found;
    else delete from public.builder_contact_tag_links where site_id=v_site_id and contact_id=v_resource_id and tag_id=v_tag_id;v_changed:=found;end if;
  end if;
  if v_changed then
    insert into public.builder_audit_events(site_id,id,action,actor_id,summary,after_value,correlation_id)
    values(v_site_id,v_audit_id,'growth.record_tag.'||v_operation,v_actor_id,'Changed a record tag',jsonb_build_object('resourceType',v_resource_type,'resourceId',v_resource_id,'tagId',v_tag_id,'operation',v_operation),p_request->>'commandId');
    insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
    values(v_site_id,'growth.record-tag.'||v_operation,jsonb_build_object('version',1,'resourceType',v_resource_type,'resourceId',v_resource_id,'tagId',v_tag_id),
      'growth.record-tag:'||(p_request->>'commandId'),1,v_resource_type,v_resource_id,(p_request->>'commandId')::uuid);
  end if;
  v_result:=jsonb_build_object('version',1,'status','applied','resourceType',v_resource_type,'resourceId',v_resource_id,'tagId',v_tag_id,'operation',v_operation,'changed',v_changed);
  return builder_private.complete_operational_command_v1(p_request,'growth.record-tag.set.v1',v_result);
end;
$$;

revoke all on function public.builder_set_customer_preference_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_clear_customer_preference_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_set_customer_suppression_v1(jsonb) from public,anon,authenticated;
revoke all on function public.builder_set_record_tag_v1(jsonb) from public,anon,authenticated;
grant execute on function public.builder_set_customer_preference_v1(jsonb) to service_role;
grant execute on function public.builder_clear_customer_preference_v1(jsonb) to service_role;
grant execute on function public.builder_set_customer_suppression_v1(jsonb) to service_role;
grant execute on function public.builder_set_record_tag_v1(jsonb) to service_role;

create function public.builder_request_leads_export_v1(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $$
declare
  v_site_id uuid;v_actor_id uuid;v_filters jsonb;v_export_id uuid:=gen_random_uuid();v_audit_id uuid:=gen_random_uuid();v_claim jsonb;v_result jsonb;
begin
  perform builder_private.phase2c_residual_validate_common(p_request,
    array['version','commandId','idempotencyKey','siteId','actorId','filters'],
    array['version','commandId','idempotencyKey','siteId','actorId','filters'],'invalid lead export payload');
  v_site_id:=(p_request->>'siteId')::uuid;v_actor_id:=(p_request->>'actorId')::uuid;v_filters:=p_request->'filters';
  if jsonb_typeof(v_filters)<>'object' or octet_length(v_filters::text)>16384
    or exists(select 1 from jsonb_object_keys(v_filters) key where key not in ('statuses','services','assigneeIds','sources','priorities','createdFrom','createdTo','unassigned','query'))
    or exists(select 1 from jsonb_each(v_filters) pair where pair.key in ('statuses','services','assigneeIds','sources','priorities')
      and (jsonb_typeof(pair.value)<>'array' or jsonb_array_length(pair.value)>100
        or exists(select 1 from jsonb_array_elements(pair.value) item where jsonb_typeof(item)<>'string' or char_length(item#>>'{}') not between 1 and 160)))
    or exists(select 1 from jsonb_array_elements_text(coalesce(v_filters->'statuses','[]'::jsonb)) value where value not in ('new','contacted','qualified','won','lost','spam'))
    or exists(select 1 from jsonb_array_elements_text(coalesce(v_filters->'sources','[]'::jsonb)) value where value not in ('website_form','phone','walk_in','staff_entry','import'))
    or exists(select 1 from jsonb_array_elements_text(coalesce(v_filters->'priorities','[]'::jsonb)) value where value not in ('low','normal','high','urgent'))
    or exists(select 1 from jsonb_array_elements_text(coalesce(v_filters->'assigneeIds','[]'::jsonb)) value where value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    or (v_filters?'unassigned' and jsonb_typeof(v_filters->'unassigned')<>'boolean')
    or (v_filters?'query' and (jsonb_typeof(v_filters->'query')<>'string' or char_length(btrim(v_filters->>'query')) not between 1 and 200))
    or (v_filters?'createdFrom' and jsonb_typeof(v_filters->'createdFrom')<>'string')
    or (v_filters?'createdTo' and jsonb_typeof(v_filters->'createdTo')<>'string')
  then raise exception 'invalid lead export filters' using errcode='22023';end if;
  begin
    if v_filters?'createdFrom' then perform (v_filters->>'createdFrom')::timestamptz;end if;
    if v_filters?'createdTo' then perform (v_filters->>'createdTo')::timestamptz;end if;
  exception when others then raise exception 'invalid lead export filters' using errcode='22023';end;
  if not builder_private.dependent_action_allowed(v_site_id,'growth.customers','growth.leads','export')
    or not builder_private.member_has_capability(v_site_id,v_actor_id,'leads.export','site')
  then raise exception 'lead export not authorized' using errcode='42501';end if;
  v_claim:=builder_private.claim_operational_command_v1(p_request,'growth.lead-export.request.v1');
  if v_claim->>'status'='replay' then return(v_claim->'result')||jsonb_build_object('status','replayed');end if;
  insert into public.builder_audit_events(site_id,id,action,actor_id,summary,after_value,correlation_id)
  values(v_site_id,v_audit_id,'growth.lead_export.requested',v_actor_id,'Requested a lead export',jsonb_build_object('exportId',v_export_id),p_request->>'commandId');
  insert into public.builder_data_exports(site_id,id,requester_id,domain,frozen_scope,state,schema_version)
  values(v_site_id,v_export_id,v_actor_id,'leads',v_filters,'requested',1);
  insert into public.builder_outbox(site_id,topic,payload,idempotency_key,schema_version,aggregate_type,aggregate_id,correlation_id)
  values(v_site_id,'growth.lead-export.requested',jsonb_build_object('version',1,'exportId',v_export_id),
    'growth.lead-export:'||(p_request->>'commandId'),1,'data_export',v_export_id,(p_request->>'commandId')::uuid);
  v_result:=jsonb_build_object('version',1,'status','requested','exportId',v_export_id);
  return builder_private.complete_operational_command_v1(p_request,'growth.lead-export.request.v1',v_result);
end;
$$;

revoke all on function public.builder_request_leads_export_v1(jsonb) from public,anon,authenticated;
grant execute on function public.builder_request_leads_export_v1(jsonb) to service_role;
