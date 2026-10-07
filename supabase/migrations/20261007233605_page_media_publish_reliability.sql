-- Add exact page-image retention to the existing authorized, atomic command.
-- No editorial drafts or immutable historical snapshots are rewritten.
create index if not exists builder_media_revisions_object_lookup_idx
  on public.builder_media_revisions(site_id,object_key);

create or replace function builder_private.page_media_decode_path(p_value text)
returns text language plpgsql immutable strict set search_path=pg_catalog as $$
declare v_bytes bytea := ''::bytea; v_pos integer:=1; v_pair text;
begin
  if char_length(p_value)>2048 then raise exception 'PAGE_IMAGE_INVALID' using errcode='22023'; end if;
  while v_pos<=char_length(p_value) loop
    if substr(p_value,v_pos,1)='%' then
      v_pair:=substr(p_value,v_pos+1,2);
      if v_pair !~ '^[0-9a-fA-F]{2}$' then raise exception 'PAGE_IMAGE_INVALID' using errcode='22023'; end if;
      v_bytes:=v_bytes || decode(v_pair,'hex'); v_pos:=v_pos+3;
    else
      v_bytes:=v_bytes || convert_to(substr(p_value,v_pos,1),'UTF8'); v_pos:=v_pos+1;
    end if;
  end loop;
  return convert_from(v_bytes,'UTF8');
end $$;

create or replace function builder_private.canonical_page_media_values(
  p_site_id uuid,p_regions jsonb,p_require_ready boolean,p_restore boolean)
returns jsonb language plpgsql set search_path=pg_catalog,public,builder_private as $$
declare v_key text; v_value jsonb; v_src text; v_object text; v_revision public.builder_media_revisions%rowtype;
  v_count integer; v_canonical boolean; v_archived boolean; v_result jsonb:=p_regions;
  v_prefix constant text:='https://rriebibkxymeqhafssvw.supabase.co/storage/v1/object/sign/builder-media/';
begin
  if jsonb_typeof(p_regions)<>'object' then raise exception 'PAGE_IMAGE_INVALID' using errcode='22023'; end if;
  for v_key,v_value in select key,value from jsonb_each(p_regions) loop
    if v_value->>'type'<>'image' then continue; end if;
    v_src:=v_value->>'src'; v_canonical:=v_src like '/api/builder/media/%';
    if v_canonical then
      if v_src !~ '^/api/builder/media/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'PAGE_IMAGE_INVALID' using errcode='22023';
      end if;
      select * into v_revision from public.builder_media_revisions
      where site_id=p_site_id and id=substr(v_src,20)::uuid;
      if not found then raise exception 'PAGE_IMAGE_INVALID' using errcode='22023'; end if;
    elsif strpos(v_src,'/storage/v1/object/')>0 then
      if left(v_src,char_length(v_prefix))<>v_prefix then raise exception 'PAGE_IMAGE_INVALID' using errcode='22023'; end if;
      v_object:=builder_private.page_media_decode_path(split_part(split_part(substr(v_src,char_length(v_prefix)+1),'?',1),'#',1));
      if v_object='' or v_object ~ '(^|/)(\.{1,2}|)(/|$)' or v_object ~ '[\\[:cntrl:]]' then
        raise exception 'PAGE_IMAGE_INVALID' using errcode='22023';
      end if;
      select count(*) into v_count from public.builder_media_revisions where site_id=p_site_id and object_key=v_object;
      if v_count<>1 then raise exception 'PAGE_IMAGE_INVALID' using errcode='22023'; end if;
      select * into v_revision from public.builder_media_revisions where site_id=p_site_id and object_key=v_object;
    else continue;
    end if;
    if v_revision.mime_type not in ('image/jpeg','image/png','image/webp','image/avif') or
       (v_value ? 'mediaId' and v_value->>'mediaId' is distinct from v_revision.media_id::text) or
       coalesce(char_length(btrim(v_value->>'alt')),0) not between 1 and 500 then
      raise exception 'PAGE_IMAGE_INVALID' using errcode='22023';
    end if;
    select archived_at is not null into v_archived from public.builder_media_assets where site_id=p_site_id and id=v_revision.media_id;
    if not found or (v_archived and not p_restore and not (v_canonical and exists(
      select 1 from public.builder_page_version_media where site_id=p_site_id and media_id=v_revision.media_id and revision_id=v_revision.id))) then
      raise exception 'PAGE_IMAGE_INVALID' using errcode='22023';
    end if;
    if p_require_ready and not exists(select 1 from public.builder_media_recovery_replicas
      where site_id=p_site_id and media_id=v_revision.media_id and revision_id=v_revision.id and status='ready') then
      raise exception 'PAGE_IMAGE_NOT_READY' using errcode='22023';
    end if;
    v_result:=jsonb_set(v_result,array[v_key],v_value || jsonb_build_object('mediaId',v_revision.media_id::text,'src','/api/builder/media/'||v_revision.id::text));
  end loop;
  return v_result;
end $$;

create or replace function builder_private.retain_page_version_media()
returns trigger language plpgsql set search_path=pg_catalog,public,builder_private as $$
begin
  insert into public.builder_page_version_media(site_id,version_id,region_id,media_id,revision_id,alt)
  select new.site_id,new.id,item.key,revision.media_id,revision.id,item.value->>'alt'
  from jsonb_each(new.snapshot->'regions') item
  join public.builder_media_revisions revision on revision.site_id=new.site_id
    and item.value->>'src'='/api/builder/media/'||revision.id::text
    and item.value->>'mediaId'=revision.media_id::text
  where item.value->>'type'='image';
  return new;
end $$;
create trigger builder_retain_page_version_media after insert on public.builder_versions
for each row execute function builder_private.retain_page_version_media();

-- Verify the known command shape rather than replace its authorization, locking,
-- receipt, history, and complete-generation implementation with an old copy.
do $$
declare v_def text:=pg_get_functiondef('public.builder_execute_content_command_v2(text,jsonb)'::regprocedure);
  v_marker constant text:='    insert into public.builder_versions (';
begin
  if (char_length(v_def)-char_length(replace(v_def,v_marker,'')))/char_length(v_marker)<>1 then
    raise exception 'PAGE_MEDIA_COMMAND_SHAPE_CHANGED';
  end if;
  execute replace(v_def,v_marker,
    E'    v_snapshot := jsonb_set(v_snapshot,\'{regions}\', builder_private.canonical_page_media_values(v_site_id, v_snapshot->\'regions\', v_operation <> \'save\', v_operation = \'restore\'));\n\n'||v_marker);
end $$;
revoke all on function builder_private.page_media_decode_path(text) from public,anon,authenticated;
revoke all on function builder_private.canonical_page_media_values(uuid,jsonb,boolean,boolean) from public,anon,authenticated;
revoke all on function builder_private.retain_page_version_media() from public,anon,authenticated;
