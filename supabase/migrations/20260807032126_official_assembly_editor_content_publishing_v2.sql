-- Attached from platform migration 20260807030715_editor_content_publishing_v2.sql.
-- Upstream SHA-256: ec83d54e6a9a14d64038645cf88e7f1e274c6ff7ad3a7a95dbf6592bdf43772c

alter table public.builder_versions
  add column parent_version_id uuid references public.builder_versions(id) on delete restrict,
  add column source_version_id uuid references public.builder_versions(id) on delete restrict,
  add column command_id uuid;

create unique index builder_versions_site_id_id_idx
  on public.builder_versions (site_id, id);
create index builder_versions_command_idx
  on public.builder_versions (site_id, command_id) where command_id is not null;

create trigger builder_page_versions_immutable
before update or delete on public.builder_versions
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_content_command_receipts (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  command_id uuid not null,
  operation text not null check (operation in ('save', 'publish', 'restore')),
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (site_id, idempotency_key),
  unique (site_id, command_id)
);

create trigger builder_content_command_receipts_immutable
before update or delete on public.builder_content_command_receipts
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_site_routes (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  path text not null check (path like '/%' and path <> '/__builder/global'),
  label text not null check (char_length(label) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (site_id, path)
);

create table public.builder_site_generations (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  generation_id bigint not null check (generation_id > 0),
  command_id uuid not null,
  global_version_id uuid not null,
  page_versions jsonb not null check (jsonb_typeof(page_versions) = 'object'),
  created_at timestamptz not null default now(),
  primary key (site_id, generation_id),
  unique (site_id, command_id),
  foreign key (site_id, global_version_id)
    references public.builder_versions(site_id, id) on delete restrict
);

create trigger builder_site_generations_immutable
before update or delete on public.builder_site_generations
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_history_events_v1 (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  source text not null check (source in ('page', 'media', 'post', 'form')),
  source_event_id text not null check (char_length(source_event_id) between 1 and 300),
  event_id text not null check (char_length(event_id) between 1 and 1000),
  category text not null check (category in ('text', 'media', 'links', 'sections', 'posts', 'forms', 'publishing')),
  action text not null check (char_length(action) between 1 and 200),
  workspace text not null check (char_length(workspace) between 1 and 200),
  page_path text check (page_path is null or page_path like '/%'),
  target_id text not null check (char_length(target_id) between 1 and 500),
  target_label text not null check (char_length(target_label) between 1 and 500),
  actor_id uuid not null references auth.users(id) on delete restrict,
  actor_label text not null check (char_length(actor_label) between 1 and 500),
  parent_version_id uuid,
  source_version_id uuid,
  result_version_id uuid,
  change_summary jsonb not null check (jsonb_typeof(change_summary) = 'object'),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  primary key (site_id, source, source_event_id),
  unique (site_id, event_id),
  foreign key (site_id, parent_version_id) references public.builder_versions(site_id, id) on delete restrict,
  foreign key (site_id, source_version_id) references public.builder_versions(site_id, id) on delete restrict,
  foreign key (site_id, result_version_id) references public.builder_versions(site_id, id) on delete restrict
);

create index builder_history_events_v1_keyset_idx
  on public.builder_history_events_v1 (site_id, created_at desc, source desc, source_event_id desc);
create index builder_history_events_v1_category_idx
  on public.builder_history_events_v1 (site_id, category, created_at desc);

create trigger builder_history_events_v1_immutable
before update or delete on public.builder_history_events_v1
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_page_version_media (
  site_id uuid not null,
  version_id uuid not null,
  region_id text not null,
  media_id uuid not null,
  revision_id uuid not null,
  alt text not null check (char_length(btrim(alt)) between 1 and 500),
  primary key (site_id, version_id, region_id),
  foreign key (site_id, version_id) references public.builder_versions(site_id, id) on delete restrict,
  foreign key (site_id, media_id, revision_id)
    references public.builder_media_revisions(site_id, media_id, id) on delete restrict
);

create trigger builder_page_version_media_immutable
before update or delete on public.builder_page_version_media
for each row execute function builder_private.builder_reject_immutable_change();

create table public.builder_media_recovery_replicas (
  site_id uuid not null,
  media_id uuid not null,
  revision_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  content_digest text check (content_digest is null or content_digest ~ '^[a-f0-9]{64}$'),
  byte_size bigint check (byte_size is null or byte_size > 0),
  mime_type text check (mime_type is null or mime_type like 'image/%'),
  object_path text,
  verified_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (site_id, media_id, revision_id),
  foreign key (site_id, media_id, revision_id)
    references public.builder_media_revisions(site_id, media_id, id) on delete restrict,
  check (
    status <> 'ready' or
    (content_digest is not null and byte_size is not null and mime_type is not null and object_path is not null and verified_at is not null)
  )
);

create table public.builder_content_recovery_jobs (
  site_id uuid not null,
  generation_id bigint not null,
  command_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'retry', 'completed', 'dead_letter', 'superseded')),
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  fence_token bigint not null default 0 check (fence_token >= 0),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, generation_id),
  foreign key (site_id, generation_id)
    references public.builder_site_generations(site_id, generation_id) on delete restrict,
  check ((lease_owner is null) = (lease_expires_at is null)),
  check (status = 'claimed' or lease_owner is null)
);

create index builder_content_recovery_jobs_due_idx
  on public.builder_content_recovery_jobs (available_at, site_id, generation_id)
  where status in ('pending', 'retry');

alter table public.builder_content_command_receipts enable row level security;
alter table public.builder_site_routes enable row level security;
alter table public.builder_site_generations enable row level security;
alter table public.builder_history_events_v1 enable row level security;
alter table public.builder_page_version_media enable row level security;
alter table public.builder_media_recovery_replicas enable row level security;
alter table public.builder_content_recovery_jobs enable row level security;

create policy builder_content_command_receipts_read
on public.builder_content_command_receipts for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor', 'contributor']));

create policy builder_site_routes_read
on public.builder_site_routes for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor', 'contributor', 'viewer']));

create policy builder_site_generations_read
on public.builder_site_generations for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor', 'contributor', 'viewer']));

create policy builder_history_events_v1_read
on public.builder_history_events_v1 for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor', 'contributor', 'viewer']));

create policy builder_page_version_media_read
on public.builder_page_version_media for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor', 'contributor', 'viewer']));

create policy builder_media_recovery_replicas_read
on public.builder_media_recovery_replicas for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor']));

create policy builder_content_recovery_jobs_read
on public.builder_content_recovery_jobs for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor']));

revoke all on public.builder_content_command_receipts, public.builder_site_routes,
  public.builder_site_generations, public.builder_history_events_v1,
  public.builder_page_version_media, public.builder_media_recovery_replicas,
  public.builder_content_recovery_jobs from anon, authenticated;

grant select on public.builder_content_command_receipts, public.builder_site_routes,
  public.builder_site_generations, public.builder_history_events_v1,
  public.builder_page_version_media, public.builder_media_recovery_replicas,
  public.builder_content_recovery_jobs to authenticated;

grant all on public.builder_content_command_receipts, public.builder_site_routes,
  public.builder_site_generations, public.builder_history_events_v1,
  public.builder_page_version_media, public.builder_media_recovery_replicas,
  public.builder_content_recovery_jobs to service_role;

create or replace function public.builder_execute_content_command_v2(
  p_site_key text,
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid;
  v_command_id uuid;
  v_idempotency_key text;
  v_operation text;
  v_payload_digest text;
  v_existing public.builder_content_command_receipts%rowtype;
  v_scope jsonb;
  v_scope_path text;
  v_scope_kind text;
  v_expected_draft uuid;
  v_expected_published uuid;
  v_current_draft uuid;
  v_current_published uuid;
  v_parent_version uuid;
  v_source_version uuid;
  v_result_version uuid;
  v_snapshot jsonb;
  v_results jsonb := '[]'::jsonb;
  v_generation_id bigint;
  v_global_version uuid;
  v_page_versions jsonb;
  v_route_count integer;
  v_page_count integer;
  v_response jsonb;
  v_source_event_id text;
  v_seen_paths text[] := '{}'::text[];
begin
  if jsonb_typeof(p_command) <> 'object' or (p_command ->> 'schemaVersion') <> '2' then
    raise exception 'CONTENT_COMMAND_INVALID' using errcode = '22023';
  end if;

  v_actor_id := coalesce(auth.uid(), nullif(p_command ->> 'actorId', '')::uuid);
  if v_actor_id is null
    or (auth.uid() is not null and v_actor_id <> auth.uid())
    or (auth.uid() is null and coalesce(auth.role(), '') <> 'service_role') then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select id into v_site_id from public.builder_sites where site_key = p_site_key;
  if v_site_id is null or (
    coalesce(auth.role(), '') <> 'service_role'
    and not builder_private.has_site_role(v_site_id, array['owner', 'editor'])
  ) then
    raise exception 'CONTENT_COMMAND_DENIED' using errcode = '42501';
  end if;

  v_command_id := (p_command ->> 'commandId')::uuid;
  v_idempotency_key := p_command ->> 'idempotencyKey';
  v_operation := p_command ->> 'operation';
  v_payload_digest := p_command ->> 'payloadDigest';

  if p_command ->> 'siteId' <> p_site_key
    or v_operation not in ('save', 'publish', 'restore')
    or v_idempotency_key is null or char_length(v_idempotency_key) not between 1 and 200
    or v_payload_digest is null or v_payload_digest !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_command -> 'scopes') <> 'array'
    or jsonb_array_length(p_command -> 'scopes') = 0 then
    raise exception 'CONTENT_COMMAND_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_site_id::text || ':' || v_idempotency_key, 0));
  select * into v_existing
  from public.builder_content_command_receipts
  where site_id = v_site_id and idempotency_key = v_idempotency_key;

  if found then
    if v_existing.payload_digest <> v_payload_digest then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return v_existing.response;
  end if;

  perform 1 from public.builder_sites where id = v_site_id for update;

  for v_scope in select value from jsonb_array_elements(p_command -> 'scopes')
  loop
    v_scope_path := v_scope #>> '{scope,path}';
    v_scope_kind := v_scope #>> '{scope,kind}';
    if v_scope_path is null or v_scope_path !~ '^/'
      or (v_scope_kind = 'global' and v_scope_path <> '/__builder/global')
      or (v_scope_kind = 'page' and v_scope_path = '/__builder/global')
      or v_scope_kind not in ('global', 'page') then
      raise exception 'CONTENT_SCOPE_INVALID' using errcode = '22023';
    end if;
    if not (v_scope ? 'expectedDraftVersionId')
      or not (v_scope ? 'expectedPublishedVersionId')
      or v_scope_path = any(v_seen_paths) then
      raise exception 'CONTENT_SCOPE_INVALID' using errcode = '22023';
    end if;
    v_seen_paths := array_append(v_seen_paths, v_scope_path);
    if v_scope_kind = 'page' and not exists (
      select 1 from public.builder_site_routes where site_id = v_site_id and path = v_scope_path
    ) then
      raise exception 'CONTENT_SCOPE_UNREGISTERED' using errcode = '22023';
    end if;

    insert into public.builder_draft_pages (site_id, path, regions)
    values (v_site_id, v_scope_path, '{}'::jsonb)
    on conflict (site_id, path) do nothing;
    insert into public.builder_published_pages (site_id, path, regions)
    values (v_site_id, v_scope_path, '{}'::jsonb)
    on conflict (site_id, path) do nothing;

    select version_id into v_current_draft
    from public.builder_draft_pages
    where site_id = v_site_id and path = v_scope_path
    for update;
    select version_id into v_current_published
    from public.builder_published_pages
    where site_id = v_site_id and path = v_scope_path
    for update;

    v_expected_draft := nullif(v_scope ->> 'expectedDraftVersionId', '')::uuid;
    v_expected_published := nullif(v_scope ->> 'expectedPublishedVersionId', '')::uuid;
    if v_current_draft is distinct from v_expected_draft
      or v_current_published is distinct from v_expected_published then
      raise exception 'STALE_REVISION' using errcode = '40001';
    end if;

    if v_operation = 'restore' then
      v_source_version := nullif(v_scope ->> 'sourceVersionId', '')::uuid;
      select snapshot into v_snapshot
      from public.builder_versions
      where id = v_source_version and site_id = v_site_id and page_path = v_scope_path;
      if v_snapshot is null then
        raise exception 'SOURCE_VERSION_NOT_FOUND' using errcode = '22023';
      end if;
      v_parent_version := v_current_published;
    else
      v_snapshot := jsonb_build_object('path', v_scope_path, 'regions', coalesce(v_scope -> 'values', '{}'::jsonb));
      if jsonb_typeof(v_scope -> 'values') <> 'object' then
        raise exception 'CONTENT_VALUES_INVALID' using errcode = '22023';
      end if;
      v_source_version := null;
      v_parent_version := case when v_operation = 'save' then v_current_draft else v_current_published end;
    end if;

    insert into public.builder_versions (
      site_id, page_path, status, snapshot, user_id,
      parent_version_id, source_version_id, command_id
    ) values (
      v_site_id, v_scope_path,
      case v_operation when 'save' then 'draft' when 'publish' then 'published' else 'rollback' end,
      v_snapshot, v_actor_id::text,
      v_parent_version, v_source_version, v_command_id
    ) returning id into v_result_version;

    if v_operation = 'save' then
      update public.builder_draft_pages
      set regions = v_snapshot -> 'regions', version_id = v_result_version, updated_at = now()
      where site_id = v_site_id and path = v_scope_path;
    else
      update public.builder_published_pages
      set regions = v_snapshot -> 'regions', version_id = v_result_version, updated_at = now()
      where site_id = v_site_id and path = v_scope_path;
    end if;

    v_source_event_id := v_command_id::text || ':' || v_scope_path;
    insert into public.builder_history_events_v1 (
      site_id, source, source_event_id, event_id, category, action, workspace,
      page_path, target_id, target_label, actor_id, actor_label,
      parent_version_id, source_version_id, result_version_id,
      change_summary, provenance
    ) values (
      v_site_id, 'page', v_source_event_id,
      'history:v1:' || v_site_id::text || ':page:' || replace(v_source_event_id, '/', '%2F'),
      case when v_operation = 'save' then 'text' else 'publishing' end,
      case v_operation when 'save' then 'draft.saved' when 'publish' then 'version.published' else 'version.restored' end,
      'website.pages', v_scope_path, v_scope_path,
      case when v_scope_kind = 'global' then 'Global content' else v_scope_path end,
      v_actor_id, coalesce(auth.jwt() ->> 'email', 'Team member'),
      v_parent_version, v_source_version, v_result_version,
      jsonb_build_object(
        'before', null,
        'after', null,
        'changedFieldCount', (select count(*) from jsonb_object_keys(v_snapshot -> 'regions'))
      ),
      jsonb_build_object('legacy', false, 'limited', false, 'redactedFields', '[]'::jsonb)
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'path', v_scope_path, 'kind', v_scope_kind, 'resultVersionId', v_result_version
    ));
  end loop;

  if v_operation in ('publish', 'restore') then
    select version_id into v_global_version
    from public.builder_published_pages
    where site_id = v_site_id and path = '/__builder/global';
    if v_global_version is null then
      raise exception 'INCOMPLETE_GENERATION_GLOBAL' using errcode = '23514';
    end if;

    select count(*), coalesce(jsonb_object_agg(route.path, page.version_id), '{}'::jsonb), count(page.version_id)
      into v_route_count, v_page_versions, v_page_count
    from public.builder_site_routes route
    left join public.builder_published_pages page
      on page.site_id = route.site_id and page.path = route.path
    where route.site_id = v_site_id;

    if v_route_count = 0 or v_page_count <> v_route_count then
      raise exception 'INCOMPLETE_GENERATION_PAGES' using errcode = '23514';
    end if;

    select coalesce(max(generation_id), 0) + 1 into v_generation_id
    from public.builder_site_generations where site_id = v_site_id;

    insert into public.builder_site_generations (
      site_id, generation_id, command_id, global_version_id, page_versions
    ) values (
      v_site_id, v_generation_id, v_command_id, v_global_version, v_page_versions
    );

    insert into public.builder_content_recovery_jobs (site_id, generation_id, command_id)
    values (v_site_id, v_generation_id, v_command_id);
  end if;

  v_response := jsonb_build_object(
    'commandId', v_command_id,
    'operation', v_operation,
    'scopes', v_results,
    'siteGenerationId', v_generation_id
  );

  insert into public.builder_content_command_receipts (
    site_id, idempotency_key, command_id, operation, payload_digest, actor_id, response
  ) values (
    v_site_id, v_idempotency_key, v_command_id, v_operation, v_payload_digest, v_actor_id, v_response
  );

  return v_response;
end;
$$;

create or replace function public.builder_claim_content_recovery_job_v1(
  p_worker text,
  p_lease_seconds integer default 60
)
returns setof public.builder_content_recovery_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.builder_content_recovery_jobs%rowtype;
begin
  if p_worker is null or btrim(p_worker) = '' or p_lease_seconds not between 15 and 300 then
    raise exception 'RECOVERY_CLAIM_INVALID' using errcode = '22023';
  end if;
  select * into v_job
  from public.builder_content_recovery_jobs
  where status in ('pending', 'retry') and available_at <= now()
  order by available_at, site_id, generation_id
  for update skip locked limit 1;
  if not found then return; end if;
  update public.builder_content_recovery_jobs
  set status = 'claimed', lease_owner = p_worker,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      fence_token = fence_token + 1, attempt_count = attempt_count + 1, updated_at = now()
  where site_id = v_job.site_id and generation_id = v_job.generation_id
  returning * into v_job;
  return next v_job;
end;
$$;

create or replace function public.builder_complete_content_recovery_job_v1(
  p_site_id uuid,
  p_generation_id bigint,
  p_worker text,
  p_fence_token bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.builder_content_recovery_jobs
  set status = 'completed', completed_at = now(), lease_owner = null,
      lease_expires_at = null, updated_at = now()
  where site_id = p_site_id and generation_id = p_generation_id
    and status = 'claimed' and lease_owner = p_worker
    and fence_token = p_fence_token and lease_expires_at > now();
  return found;
end;
$$;

revoke all on function public.builder_execute_content_command_v2(text, jsonb) from public, anon;
grant execute on function public.builder_execute_content_command_v2(text, jsonb) to authenticated, service_role;
revoke all on function public.builder_claim_content_recovery_job_v1(text, integer) from public, anon, authenticated;
revoke all on function public.builder_complete_content_recovery_job_v1(uuid, bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.builder_claim_content_recovery_job_v1(text, integer) to service_role;
grant execute on function public.builder_complete_content_recovery_job_v1(uuid, bigint, text, bigint) to service_role;

-- Official Assembly attachment: reconcile every configured public editor route.
create or replace function public.builder_register_official_assembly_routes_v1()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_registered integer;
begin
  insert into public.builder_site_routes (site_id, path, label)
  select site.id, route.path, route.label
  from public.builder_sites site
  cross join (values
    ('/', 'Home'),
    ('/about', 'About'),
    ('/resources', 'Resources'),
    ('/news', 'News'),
    ('/community', 'Community'),
    ('/voting', 'Voting'),
    ('/contact', 'Contact'),
    ('/newsletter', 'Newsletter'),
    ('/survey', 'Survey'),
    ('/social', 'Social'),
    ('/404', '404 - Page not found')
  ) as route(path, label)
  where site.site_key = 'official-assembly-website-v2'
  on conflict (site_id, path) do update set label = excluded.label;

  get diagnostics v_registered = row_count;
  return v_registered;
end;
$$;

revoke all on function public.builder_register_official_assembly_routes_v1() from public, anon, authenticated;
grant execute on function public.builder_register_official_assembly_routes_v1() to service_role;

select public.builder_register_official_assembly_routes_v1();
