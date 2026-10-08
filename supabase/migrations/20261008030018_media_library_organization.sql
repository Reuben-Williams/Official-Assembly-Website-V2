-- Library organization is separate from immutable media bytes and publication.
-- Trash hides a choice from new selections; existing published uses stay intact.
create table public.builder_media_library_state (
  site_id uuid primary key references public.builder_sites(id),
  version bigint not null default 0,
  state jsonb not null default '{"folders":[],"placements":{},"trashed":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.builder_media_library_audit (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.builder_sites(id),
  actor_id uuid not null,
  action text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);
create index builder_media_library_audit_site_date on public.builder_media_library_audit(site_id, created_at desc);
alter table public.builder_media_library_state enable row level security;
alter table public.builder_media_library_audit enable row level security;
revoke all on public.builder_media_library_state, public.builder_media_library_audit from public, anon, authenticated;
grant select, insert, update on public.builder_media_library_state to service_role;
grant select, insert on public.builder_media_library_audit to service_role;

create function public.builder_media_library_command_v1(p_site_id uuid, p_actor_id uuid, p_generation integer, p_expected_version bigint, p_action text, p_value jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_state jsonb; current_version bigint; next_state jsonb; folder_id text; media_id text; selected_ids jsonb;
begin
  if not exists(select 1 from public.builder_site_members where site_id=p_site_id and user_id=p_actor_id
    and role in ('owner','editor') and session_generation=p_generation) then
    raise exception 'MEDIA_LIBRARY_DENIED' using errcode='42501';
  end if;
  insert into public.builder_media_library_state(site_id) values(p_site_id) on conflict do nothing;
  select state,version into current_state,current_version from public.builder_media_library_state where site_id=p_site_id for update;
  if current_version<>p_expected_version then raise exception 'MEDIA_LIBRARY_STALE' using errcode='40001'; end if;
  next_state := current_state;
  if p_action='create-folder' then
    if length(btrim(coalesce(p_value->>'name',''))) not between 1 and 80 then raise exception 'MEDIA_LIBRARY_INVALID' using errcode='22023'; end if;
    if jsonb_array_length(current_state->'folders')>=100 then raise exception 'MEDIA_LIBRARY_INVALID' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(current_state->'folders') f where lower(f->>'name')=lower(btrim(p_value->>'name'))) then
      raise exception 'MEDIA_FOLDER_EXISTS' using errcode='23505'; end if;
    next_state := jsonb_set(next_state,'{folders}',(current_state->'folders')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name',btrim(p_value->>'name'))));
  elsif p_action in ('move','trash','restore') then
    selected_ids := p_value->'ids';
    if jsonb_typeof(selected_ids)<>'array' or jsonb_array_length(selected_ids) not between 1 and 100 then raise exception 'MEDIA_LIBRARY_INVALID' using errcode='22023'; end if;
    folder_id := p_value->>'folderId';
    if p_action='move' and folder_id is not null and not exists(select 1 from jsonb_array_elements(current_state->'folders') f where f->>'id'=folder_id) then
      raise exception 'MEDIA_LIBRARY_INVALID' using errcode='22023'; end if;
    for media_id in select jsonb_array_elements_text(selected_ids) loop
      if not exists(select 1 from public.builder_media_assets where site_id=p_site_id and id::text=media_id and archived_at is null) then
        raise exception 'MEDIA_LIBRARY_INVALID' using errcode='22023'; end if;
      if p_action='move' then
        next_state := jsonb_set(next_state,array['placements',media_id],coalesce(to_jsonb(folder_id),'null'::jsonb));
      elsif p_action='trash' then
        if not (next_state->'trashed') ? media_id then next_state := jsonb_set(next_state,'{trashed}',(next_state->'trashed')||jsonb_build_array(media_id)); end if;
      else
        next_state := jsonb_set(next_state,'{trashed}',(next_state->'trashed')-media_id);
      end if;
    end loop;
  else raise exception 'MEDIA_LIBRARY_INVALID' using errcode='22023'; end if;
  update public.builder_media_library_state set state=next_state,version=current_version+1,updated_at=clock_timestamp() where site_id=p_site_id;
  insert into public.builder_media_library_audit(site_id,actor_id,action,before_state,after_state) values(p_site_id,p_actor_id,p_action,current_state,next_state);
  return jsonb_build_object('version',current_version+1,'state',next_state);
end; $$;
revoke all on function public.builder_media_library_command_v1(uuid,uuid,integer,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.builder_media_library_command_v1(uuid,uuid,integer,bigint,text,jsonb) to service_role;
