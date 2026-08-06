create or replace function builder_private.phase2c_saved_view_ast_valid(p_domain text,p_ast jsonb)
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
        when 'leads' then clause->>'field' not in (
          'status','service','assignee_id','source','priority','created_at','updated_at',
          'unassigned','estimate_scheduled'
        )
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

revoke all on function builder_private.phase2c_saved_view_ast_valid(text,jsonb) from public,anon,authenticated;
grant execute on function builder_private.phase2c_saved_view_ast_valid(text,jsonb) to service_role;
