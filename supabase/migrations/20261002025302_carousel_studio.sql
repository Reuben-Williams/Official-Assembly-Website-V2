-- Site-local carousel domain. No package migrations or existing revisions are rewritten.
create function builder_private.carousel_exact_keys(v jsonb, keys text[]) returns boolean
language sql immutable set search_path=pg_catalog as $$
  select jsonb_typeof(v)='object' and v ?& keys and not exists(select 1 from jsonb_object_keys(v) k where not k=any(keys));
$$;
create function builder_private.carousel_frame_valid(v jsonb) returns boolean
language sql immutable set search_path=pg_catalog,builder_private as $$
  select carousel_exact_keys(v,array['fit','x','y']) and v->'fit' in ('"cover"','"contain"')
    and jsonb_typeof(v->'x')='number' and jsonb_typeof(v->'y')='number'
    and (v->>'x')::numeric between 0 and 100 and (v->>'y')::numeric between 0 and 100;
$$;
create function builder_private.carousel_blend_valid(v jsonb) returns boolean
language sql immutable set search_path=pg_catalog,builder_private as $$
  select v='null'::jsonb or (carousel_exact_keys(v,array['top','bottom'])
    and jsonb_typeof(v->'top')='number' and jsonb_typeof(v->'bottom')='number'
    and (v->>'top')::numeric between 0 and 75 and (v->>'bottom')::numeric between 30 and 85);
$$;
create function builder_private.carousel_document_valid(v jsonb, publication boolean) returns boolean
language plpgsql immutable set search_path=pg_catalog,builder_private as $$
declare e jsonb; t jsonb; k text; d jsonb; ids text[]='{}'; uuid_pattern text='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if carousel_exact_keys(v,array['schemaVersion','key','defaults','entries']) is not true or v->'schemaVersion' is distinct from '1'::jsonb or v->'key' is distinct from '"home-community"'::jsonb then return false; end if;
  d=v->'defaults';
  if not carousel_exact_keys(d,array['transition','seconds','speed','blend']) or d->'transition' not in ('"none"','"fade"','"slide"')
    or d->'seconds' not in ('5','7','10') or d->'speed' not in ('350','700','1100') or not carousel_blend_valid(d->'blend') then return false; end if;
  if jsonb_typeof(v->'entries')<>'array' or jsonb_array_length(v->'entries')<>8 then return false; end if;
  for e in select value from jsonb_array_elements(v->'entries') loop
    if not carousel_exact_keys(e,array['id','media','en','es','desktop','mobile','captionSafeMobile','transition','seconds','blend','zoom'])
      or jsonb_typeof(e->'id')<>'string' or e->>'id' !~ '^[a-z0-9][a-z0-9-]{0,63}$' or e->>'id'=any(ids) then return false; end if;
    ids=array_append(ids,e->>'id');
    if not carousel_exact_keys(e->'media',array['mediaId','revisionId']) or jsonb_typeof(e#>'{media,mediaId}')<>'string' or jsonb_typeof(e#>'{media,revisionId}')<>'string' or e#>>'{media,mediaId}' !~* uuid_pattern or e#>>'{media,revisionId}' !~* uuid_pattern
      or not carousel_frame_valid(e->'desktop') or (e->'mobile'<>'null'::jsonb and not carousel_frame_valid(e->'mobile'))
      or e->'transition' not in ('null','"none"','"fade"','"slide"') or e->'seconds' not in ('null','5','7','10')
      or not carousel_blend_valid(e->'blend') or jsonb_typeof(e->'zoom')<>'boolean' or jsonb_typeof(e->'captionSafeMobile')<>'boolean' then return false; end if;
    foreach k in array array['en','es'] loop
      t=e->k;
      if not carousel_exact_keys(t,array['title','caption','alt']) or jsonb_typeof(t->'title')<>'string' or jsonb_typeof(t->'caption')<>'string' or jsonb_typeof(t->'alt')<>'string'
        or length(t->>'title')>100 or length(t->>'caption')>300 or length(t->>'alt')>300 or ((t->>'title')||(t->>'caption')||(t->>'alt')) ~ '[<>[:cntrl:]]'
        or (publication and btrim(t->>'alt')='') then return false; end if;
    end loop;
    if publication and ((btrim(e#>>'{en,title}')='')<>(btrim(e#>>'{es,title}')='') or (btrim(e#>>'{en,caption}')='')<>(btrim(e#>>'{es,caption}')='')) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end; $$;

create table public.builder_carousel_revisions (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  id uuid not null default gen_random_uuid(), document jsonb not null,
  parent_revision_id uuid, restored_from_id uuid, actor_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(site_id,id), check(builder_private.carousel_document_valid(document,false)),
  foreign key(site_id,parent_revision_id) references public.builder_carousel_revisions(site_id,id),
  foreign key(site_id,restored_from_id) references public.builder_carousel_revisions(site_id,id)
);
create table public.builder_carousels (
  site_id uuid primary key references public.builder_sites(id) on delete restrict,
  key text not null default 'home-community' check(key='home-community'),
  draft_revision_id uuid not null, published_revision_id uuid not null,
  version integer not null default 1 check(version>0), enabled boolean not null default false,
  foreign key(site_id,draft_revision_id) references public.builder_carousel_revisions(site_id,id),
  foreign key(site_id,published_revision_id) references public.builder_carousel_revisions(site_id,id)
);
create table public.builder_carousel_revision_media (
  site_id uuid not null, revision_id uuid not null, entry_id text not null, media_id uuid not null, media_revision_id uuid not null,
  primary key(site_id,revision_id,entry_id),
  foreign key(site_id,revision_id) references public.builder_carousel_revisions(site_id,id) on delete restrict,
  foreign key(site_id,media_id,media_revision_id) references public.builder_media_revisions(site_id,media_id,id) on delete restrict
);
create table public.builder_carousel_commands (
  site_id uuid not null references public.builder_sites(id), command_id uuid not null,
  actor_id uuid not null references auth.users(id), payload_digest text not null check(payload_digest ~ '^[a-f0-9]{64}$'),
  result jsonb not null, created_at timestamptz not null default now(), primary key(site_id,command_id)
);
create table public.builder_carousel_audit (
  site_id uuid not null references public.builder_sites(id), id uuid not null default gen_random_uuid(),
  action text not null check(action in ('save','restore','publish','bootstrap')), actor_id uuid references auth.users(id),
  parent_revision_id uuid, result_revision_id uuid not null, restored_from_id uuid, changes jsonb not null,
  created_at timestamptz not null default now(), primary key(site_id,id),
  foreign key(site_id,parent_revision_id) references public.builder_carousel_revisions(site_id,id),
  foreign key(site_id,result_revision_id) references public.builder_carousel_revisions(site_id,id),
  foreign key(site_id,restored_from_id) references public.builder_carousel_revisions(site_id,id)
);
create index builder_carousel_audit_history on public.builder_carousel_audit(site_id,created_at desc,id desc);
create trigger builder_carousel_revisions_immutable before update or delete on public.builder_carousel_revisions for each row execute function builder_private.builder_reject_immutable_change();
create trigger builder_carousel_commands_immutable before update or delete on public.builder_carousel_commands for each row execute function builder_private.builder_reject_immutable_change();
create trigger builder_carousel_audit_immutable before update or delete on public.builder_carousel_audit for each row execute function builder_private.builder_reject_immutable_change();
create trigger builder_carousel_revision_media_immutable before update or delete on public.builder_carousel_revision_media for each row execute function builder_private.builder_reject_immutable_change();

create function builder_private.carousel_retain_media() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  insert into public.builder_carousel_revision_media(site_id,revision_id,entry_id,media_id,media_revision_id)
  select new.site_id,new.id,e->>'id',(e#>>'{media,mediaId}')::uuid,(e#>>'{media,revisionId}')::uuid from jsonb_array_elements(new.document->'entries') e;
  return new;
end; $$;
create trigger builder_carousel_media_retention after insert on public.builder_carousel_revisions for each row execute function builder_private.carousel_retain_media();

alter table public.builder_site_generations add column carousel_revision_id uuid,
  add constraint builder_generation_carousel_fk foreign key(site_id,carousel_revision_id) references public.builder_carousel_revisions(site_id,id) on delete restrict;
create function builder_private.carousel_generation_snapshot() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.carousel_revision_id is null then select published_revision_id into new.carousel_revision_id from public.builder_carousels where site_id=new.site_id; end if;
  return new;
end; $$;
create trigger builder_generation_carousel_snapshot before insert on public.builder_site_generations for each row execute function builder_private.carousel_generation_snapshot();

alter table public.builder_carousels enable row level security;
alter table public.builder_carousel_revisions enable row level security;
alter table public.builder_carousel_revision_media enable row level security;
alter table public.builder_carousel_commands enable row level security;
alter table public.builder_carousel_audit enable row level security;
revoke all on public.builder_carousels,public.builder_carousel_revisions,public.builder_carousel_revision_media,public.builder_carousel_commands,public.builder_carousel_audit from public,anon,authenticated;
grant select,insert,update on public.builder_carousels to service_role;
grant select,insert on public.builder_carousel_revisions,public.builder_carousel_revision_media,public.builder_carousel_commands,public.builder_carousel_audit to service_role;

-- A staged baseline is immutable but is not published or visible to generation snapshots.
create function public.builder_stage_carousel_baseline_v1(p_site_id uuid,p_actor_id uuid,p_generation integer,p_revision_id uuid,p_document jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,builder_private as $$
declare previous public.builder_carousel_revisions%rowtype; member_role text;
begin
  perform 1 from public.builder_sites where id=p_site_id for update;
  select role into member_role from public.builder_site_members where site_id=p_site_id and user_id=p_actor_id and session_generation=p_generation for share;
  if member_role is distinct from 'owner' then raise exception 'CAROUSEL_FORBIDDEN' using errcode='42501'; end if;
  if exists(select 1 from public.builder_carousels where site_id=p_site_id) then raise exception 'CAROUSEL_STALE' using errcode='40001'; end if;
  if p_revision_id is null or carousel_document_valid(p_document,true) is not true then raise exception 'CAROUSEL_INVALID' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_document->'entries') e where not exists(
    select 1 from public.builder_media_revisions r join public.builder_media_assets m on m.site_id=r.site_id and m.id=r.media_id
    where r.site_id=p_site_id and r.media_id=(e#>>'{media,mediaId}')::uuid and r.id=(e#>>'{media,revisionId}')::uuid and m.archived_at is null
  )) then raise exception 'CAROUSEL_MEDIA_DENIED' using errcode='42501'; end if;
  select * into previous from public.builder_carousel_revisions where site_id=p_site_id and id=p_revision_id;
  if found then
    if previous.actor_id is distinct from p_actor_id or previous.document is distinct from p_document then raise exception 'CAROUSEL_IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return previous.id;
  end if;
  insert into public.builder_carousel_revisions(site_id,id,document,actor_id) values(p_site_id,p_revision_id,p_document,p_actor_id);
  return p_revision_id;
end; $$;
revoke all on function public.builder_stage_carousel_baseline_v1(uuid,uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.builder_stage_carousel_baseline_v1(uuid,uuid,integer,uuid,jsonb) to service_role;

create function public.builder_carousel_command_v1(p_site_id uuid,p_actor_id uuid,p_generation integer,p_command jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,builder_private as $$
declare
  a public.builder_carousels%rowtype; receipt public.builder_carousel_commands%rowtype; member_role text;
  operation text=p_command->>'action'; cid uuid=(p_command->>'commandId')::uuid; digest text=p_command->>'digest';
  doc jsonb; rid uuid; parent_id uuid; source_id uuid; prepared jsonb=p_command->'prepared';
  latest_generation bigint; pages jsonb; global_id uuid; result jsonb; expected_revision uuid;
begin
  -- Matches page publication's site-row lock. Membership is checked again inside the transaction.
  perform 1 from public.builder_sites where id=p_site_id for update;
  select role into member_role from public.builder_site_members where site_id=p_site_id and user_id=p_actor_id and session_generation=p_generation for share;
  if member_role is null or member_role not in ('owner','editor','contributor') or (operation='publish' and member_role not in ('owner','editor')) or (operation='bootstrap' and member_role<>'owner') then raise exception 'CAROUSEL_FORBIDDEN' using errcode='42501'; end if;
  if operation is null or operation not in ('save','restore','publish','bootstrap') or cid is null or digest is null or digest !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_command->'expectedVersion') is distinct from 'number' or (operation<>'bootstrap' and p_command->>'expectedPublishedId' is null) then raise exception 'CAROUSEL_INVALID' using errcode='22023'; end if;
  select * into receipt from public.builder_carousel_commands where site_id=p_site_id and command_id=cid;
  if found then
    if receipt.actor_id<>p_actor_id or receipt.payload_digest<>digest then raise exception 'CAROUSEL_IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return receipt.result;
  end if;
  select * into a from public.builder_carousels where site_id=p_site_id for update;
  if operation='bootstrap' then
    if found or p_command->'expectedVersion' is distinct from '0'::jsonb or p_command->'expectedPublishedId' is distinct from 'null'::jsonb then raise exception 'CAROUSEL_STALE' using errcode='40001'; end if;
    select document into doc from public.builder_carousel_revisions where site_id=p_site_id and id=cid and actor_id=p_actor_id;
    if doc is distinct from p_command->'document' or doc is null then raise exception 'CAROUSEL_INVALID' using errcode='22023'; end if;
    a.version=0; expected_revision=cid;
  else
  if not found or not a.enabled then raise exception 'CAROUSEL_UNAVAILABLE' using errcode='55000'; end if;
  if a.version<>(p_command->>'expectedVersion')::integer or a.published_revision_id is distinct from (p_command->>'expectedPublishedId')::uuid then raise exception 'CAROUSEL_STALE' using errcode='40001'; end if;
  parent_id=a.draft_revision_id;
  if operation='save' then doc=p_command->'document';
  elsif operation='restore' then
    source_id=(p_command->>'revisionId')::uuid;
    select document into doc from public.builder_carousel_revisions where site_id=p_site_id and id=source_id;
  else
    expected_revision=(p_command->>'revisionId')::uuid;
    if expected_revision is distinct from a.draft_revision_id then raise exception 'CAROUSEL_STALE_REVIEW' using errcode='40001'; end if;
    select document into doc from public.builder_carousel_revisions where site_id=p_site_id and id=expected_revision;
    parent_id=a.published_revision_id;
  end if;
  end if;
  if doc is null or not carousel_document_valid(doc,operation in ('publish','bootstrap')) then raise exception 'CAROUSEL_INVALID' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(doc->'entries') e where not exists(
    select 1 from public.builder_media_revisions r join public.builder_media_assets m on m.site_id=r.site_id and m.id=r.media_id
    where r.site_id=p_site_id and r.media_id=(e#>>'{media,mediaId}')::uuid and r.id=(e#>>'{media,revisionId}')::uuid and m.archived_at is null
  )) then raise exception 'CAROUSEL_MEDIA_DENIED' using errcode='42501'; end if;
  if operation not in ('publish','bootstrap') then
    if (select array_agg(e->>'id' order by e->>'id') from jsonb_array_elements(doc->'entries') e) is distinct from
       (select array_agg(e->>'id' order by e->>'id') from public.builder_carousel_revisions r,jsonb_array_elements(r.document->'entries') e where r.site_id=p_site_id and r.id=a.draft_revision_id) then raise exception 'CAROUSEL_ENTRY_ID_CHANGED' using errcode='22023'; end if;
    insert into public.builder_carousel_revisions(site_id,document,parent_revision_id,restored_from_id,actor_id)
    values(p_site_id,doc,parent_id,source_id,p_actor_id) returning id into rid;
    update public.builder_carousels set draft_revision_id=rid,version=version+1 where site_id=p_site_id;
  else
    if exists(select 1 from jsonb_array_elements(doc->'entries') e where not exists(
      select 1 from public.builder_media_recovery_replicas r where r.site_id=p_site_id and r.media_id=(e#>>'{media,mediaId}')::uuid and r.revision_id=(e#>>'{media,revisionId}')::uuid and r.status='ready'
    )) then raise exception 'CAROUSEL_MEDIA_NOT_READY' using errcode='55000'; end if;
    select coalesce(max(generation_id),0) into latest_generation from public.builder_site_generations where site_id=p_site_id;
    select version_id into global_id from public.builder_published_pages where site_id=p_site_id and path='/__builder/global';
    select jsonb_object_agg(r.path,p.version_id) into pages from public.builder_site_routes r left join public.builder_published_pages p on p.site_id=r.site_id and p.path=r.path where r.site_id=p_site_id;
    if prepared is null or not prepared ?& array['manifestDigest','manifestPath','baseGeneration','generationId','globalVersionId','pageVersions','createdAt']
      or prepared->>'manifestDigest' is null or prepared->>'manifestDigest' !~ '^[a-f0-9]{64}$' or prepared->>'manifestPath' is null
      or prepared->>'baseGeneration' is null or prepared->>'generationId' is null or prepared->>'createdAt' is null
      or (prepared->>'baseGeneration')::bigint<>latest_generation or (prepared->>'generationId')::bigint<>latest_generation+1
      or (prepared->>'globalVersionId')::uuid is distinct from global_id or prepared->'pageVersions' is distinct from pages
      or global_id is null or pages is null or exists(select 1 from jsonb_each(pages) p where p.value='null'::jsonb) then raise exception 'CAROUSEL_PREPARATION_STALE' using errcode='40001'; end if;
    rid=expected_revision;
    if operation='bootstrap' then
      insert into public.builder_carousels(site_id,draft_revision_id,published_revision_id,enabled) values(p_site_id,rid,rid,true);
    else update public.builder_carousels set published_revision_id=rid,version=version+1 where site_id=p_site_id; end if;
    insert into public.builder_site_generations(site_id,generation_id,command_id,global_version_id,page_versions,carousel_revision_id,created_at)
      values(p_site_id,latest_generation+1,cid,global_id,pages,rid,(prepared->>'createdAt')::timestamptz);
    insert into public.builder_content_recovery_jobs(site_id,generation_id,command_id) values(p_site_id,latest_generation+1,cid);
  end if;
  insert into public.builder_carousel_audit(site_id,action,actor_id,parent_revision_id,result_revision_id,restored_from_id,changes)
  values(p_site_id,operation,p_actor_id,parent_id,rid,source_id,coalesce(p_command->'changes','[]'::jsonb));
  result=jsonb_build_object('revisionId',rid,'version',a.version+1,'generationId',case when operation in ('publish','bootstrap') then latest_generation+1 else null end,'prepared',case when operation in ('publish','bootstrap') then prepared else null end);
  insert into public.builder_carousel_commands(site_id,command_id,actor_id,payload_digest,result) values(p_site_id,cid,p_actor_id,digest,result);
  return result;
end; $$;
revoke all on function public.builder_carousel_command_v1(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.builder_carousel_command_v1(uuid,uuid,integer,jsonb) to service_role;
