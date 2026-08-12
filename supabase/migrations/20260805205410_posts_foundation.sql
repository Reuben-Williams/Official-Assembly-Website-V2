create extension if not exists pgcrypto;
create schema if not exists builder_private;

revoke all on schema builder_private from public, anon, authenticated;

create table public.builder_sites (
  id uuid primary key default gen_random_uuid(),
  site_key text not null unique check (site_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.builder_site_members (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'contributor', 'viewer')),
  session_generation integer not null default 1 check (session_generation > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, user_id)
);

create table public.builder_content_types (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  key text not null check (key = 'post'),
  schema_version integer not null default 1 check (schema_version > 0),
  created_at timestamptz not null default now(),
  primary key (site_id, key)
);

create table public.builder_entries (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  content_type text not null default 'post' check (content_type = 'post'),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'archived')),
  active_draft_version_id uuid,
  active_published_version_id uuid,
  first_published_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, id, content_type),
  foreign key (site_id, content_type) references public.builder_content_types(site_id, key)
);

create table public.builder_entry_versions (
  site_id uuid not null,
  entry_id uuid not null,
  id uuid not null default gen_random_uuid(),
  version_kind text not null check (version_kind in ('draft', 'published', 'rollback', 'undo_rollback')),
  schema_version integer not null default 1 check (schema_version > 0),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  display_date timestamptz not null,
  expires_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (site_id, entry_id, id),
  unique (site_id, id),
  foreign key (site_id, entry_id) references public.builder_entries(site_id, id) on delete restrict,
  check (expires_at is null or expires_at > display_date)
);

alter table public.builder_entries
  add constraint builder_entries_draft_pointer_fk
  foreign key (site_id, id, active_draft_version_id)
  references public.builder_entry_versions (site_id, entry_id, id)
  deferrable initially deferred;

alter table public.builder_entries
  add constraint builder_entries_published_pointer_fk
  foreign key (site_id, id, active_published_version_id)
  references public.builder_entry_versions (site_id, entry_id, id)
  deferrable initially deferred;

create table public.builder_published_entries (
  site_id uuid not null,
  entry_id uuid not null,
  version_id uuid not null,
  slug text not null,
  title text not null,
  excerpt text not null,
  snapshot jsonb not null,
  category_keys text[] not null default '{}',
  tag_keys text[] not null default '{}',
  display_date timestamptz not null,
  first_published_at timestamptz not null,
  version_published_at timestamptz not null default now(),
  expires_at timestamptz,
  featured boolean not null default false,
  pinned boolean not null default false,
  primary key (site_id, entry_id),
  unique (site_id, slug),
  foreign key (site_id, entry_id, version_id)
    references public.builder_entry_versions(site_id, entry_id, id) on delete restrict
);

create table public.builder_taxonomies (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  key text not null,
  kind text not null check (kind in ('category', 'tag')),
  label text not null,
  slug text not null,
  description text,
  color_token text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, key),
  unique (site_id, kind, slug)
);

create table public.builder_entry_version_taxonomies (
  site_id uuid not null,
  entry_id uuid not null,
  version_id uuid not null,
  taxonomy_id uuid not null,
  taxonomy_kind text not null check (taxonomy_kind in ('category', 'tag')),
  primary key (site_id, version_id, taxonomy_id),
  foreign key (site_id, entry_id, version_id)
    references public.builder_entry_versions(site_id, entry_id, id) on delete restrict,
  foreign key (site_id, taxonomy_id)
    references public.builder_taxonomies(site_id, id) on delete restrict
);

create table public.builder_media_assets (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  label text not null,
  archived_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (site_id, id)
);

create table public.builder_media_revisions (
  site_id uuid not null,
  media_id uuid not null,
  id uuid not null default gen_random_uuid(),
  object_key text not null,
  mime_type text not null check (mime_type like 'image/%'),
  byte_size bigint not null check (byte_size > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (site_id, media_id, id),
  unique (site_id, id),
  unique (object_key),
  foreign key (site_id, media_id) references public.builder_media_assets(site_id, id) on delete restrict
);

create table public.builder_entry_version_media (
  site_id uuid not null,
  entry_id uuid not null,
  version_id uuid not null,
  media_id uuid not null,
  revision_id uuid not null,
  field_path text not null,
  primary key (site_id, version_id, revision_id, field_path),
  foreign key (site_id, entry_id, version_id)
    references public.builder_entry_versions(site_id, entry_id, id) on delete restrict,
  foreign key (site_id, media_id, revision_id)
    references public.builder_media_revisions(site_id, media_id, id) on delete restrict
);

create function builder_private.capture_version_references(
  p_site_id uuid,
  p_entry_id uuid,
  p_version_id uuid,
  p_snapshot jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_expected integer;
  v_inserted integer;
  v_field_path text;
  v_image jsonb;
begin
  v_expected := jsonb_array_length(coalesce(p_snapshot#>'{taxonomyKeys,categories}', '[]'::jsonb));
  insert into public.builder_entry_version_taxonomies
    (site_id, entry_id, version_id, taxonomy_id, taxonomy_kind)
  select p_site_id, p_entry_id, p_version_id, taxonomy.id, 'category'
  from jsonb_array_elements_text(coalesce(p_snapshot#>'{taxonomyKeys,categories}', '[]'::jsonb)) requested(key)
  join public.builder_taxonomies taxonomy
    on taxonomy.site_id = p_site_id
   and taxonomy.key = requested.key
   and taxonomy.kind = 'category'
   and taxonomy.archived_at is null;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_expected then
    raise exception 'unknown or archived category key' using errcode = '22023';
  end if;

  v_expected := jsonb_array_length(coalesce(p_snapshot#>'{taxonomyKeys,tags}', '[]'::jsonb));
  insert into public.builder_entry_version_taxonomies
    (site_id, entry_id, version_id, taxonomy_id, taxonomy_kind)
  select p_site_id, p_entry_id, p_version_id, taxonomy.id, 'tag'
  from jsonb_array_elements_text(coalesce(p_snapshot#>'{taxonomyKeys,tags}', '[]'::jsonb)) requested(key)
  join public.builder_taxonomies taxonomy
    on taxonomy.site_id = p_site_id
   and taxonomy.key = requested.key
   and taxonomy.kind = 'tag'
   and taxonomy.archived_at is null;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_expected then
    raise exception 'unknown or archived tag key' using errcode = '22023';
  end if;

  for v_field_path, v_image in
    select reference.field_path, reference.image
    from (values
      ('data.featuredImage', p_snapshot#>'{data,featuredImage}'),
      ('data.seo.socialImage', p_snapshot#>'{data,seo,socialImage}')
    ) as reference(field_path, image)
  loop
    if coalesce(v_image->>'kind', '') = 'managed' then
      begin
        insert into public.builder_entry_version_media
          (site_id, entry_id, version_id, media_id, revision_id, field_path)
        select p_site_id, p_entry_id, p_version_id, revision.media_id, revision.id, v_field_path
        from public.builder_media_revisions revision
        where revision.site_id = p_site_id
          and revision.media_id = (v_image->>'mediaId')::uuid
          and revision.id = (v_image->>'revisionId')::uuid;
      exception when invalid_text_representation then
        raise exception 'invalid managed media reference' using errcode = '22023';
      end;
      if not found then
        raise exception 'invalid managed media reference' using errcode = '22023';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function builder_private.capture_version_references(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function builder_private.capture_version_references(uuid, uuid, uuid, jsonb)
  to service_role;

create table public.builder_slug_claims (
  site_id uuid not null,
  slug text not null,
  entry_id uuid not null,
  first_version_id uuid not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (site_id, slug),
  foreign key (site_id, entry_id, first_version_id)
    references public.builder_entry_versions(site_id, entry_id, id) on delete restrict
);

create table public.builder_slug_redirects (
  site_id uuid not null,
  from_slug text not null,
  entry_id uuid not null,
  current_slug text not null,
  created_at timestamptz not null default now(),
  primary key (site_id, from_slug),
  foreign key (site_id, entry_id) references public.builder_entries(site_id, id) on delete restrict,
  check (from_slug <> current_slug)
);

create table public.builder_schedules (
  site_id uuid not null,
  id uuid not null default gen_random_uuid(),
  entry_id uuid not null,
  draft_version_id uuid not null,
  expected_published_version_id uuid,
  publish_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'completed', 'cancelled', 'failed')),
  lease_owner text,
  lease_expires_at timestamptz,
  idempotency_key text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, id),
  unique (site_id, idempotency_key),
  foreign key (site_id, entry_id, draft_version_id)
    references public.builder_entry_versions(site_id, entry_id, id) on delete restrict,
  foreign key (site_id, entry_id, expected_published_version_id)
    references public.builder_entry_versions(site_id, entry_id, id) on delete restrict
);

create table public.builder_import_ledger (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  manifest_id text not null,
  source_record_key text not null,
  source_scope_key text not null,
  seed_hash text not null check (seed_hash ~ '^[a-f0-9]{64}$'),
  entry_id uuid not null,
  draft_version_id uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (site_id, manifest_id, source_record_key),
  foreign key (site_id, entry_id, draft_version_id)
    references public.builder_entry_versions(site_id, entry_id, id) on delete restrict
);

create table public.builder_idempotency_requests (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  request_key text not null,
  operation text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (site_id, request_key)
);

create table public.builder_outbox (
  site_id uuid not null references public.builder_sites(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  topic text not null,
  payload jsonb not null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'completed', 'failed')),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (site_id, id),
  unique (site_id, idempotency_key)
);

create table public.builder_audit_events (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  entry_id uuid,
  page_path text,
  region_id text,
  action text not null,
  actor_id uuid not null references auth.users(id),
  actor_email text,
  summary text not null,
  before_value jsonb,
  after_value jsonb,
  source_version_id uuid,
  result_version_id uuid,
  correlation_id text,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, entry_id) references public.builder_entries(site_id, id) on delete restrict
);

create index builder_published_collection_idx
  on public.builder_published_entries (site_id, display_date desc, entry_id);
create index builder_published_categories_idx
  on public.builder_published_entries using gin (category_keys);
create index builder_published_tags_idx
  on public.builder_published_entries using gin (tag_keys);
create index builder_schedules_due_idx
  on public.builder_schedules (publish_at, site_id) where status = 'pending';
create index builder_outbox_due_idx
  on public.builder_outbox (available_at, site_id) where status = 'pending';
create index builder_versions_entry_idx
  on public.builder_entry_versions (site_id, entry_id, created_at desc);

create function builder_private.builder_reject_immutable_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
begin
  raise exception 'immutable builder record cannot be updated or deleted' using errcode = '55000';
end;
$$;

create trigger builder_entry_versions_immutable
before update or delete on public.builder_entry_versions
for each row execute function builder_private.builder_reject_immutable_change();

create trigger builder_media_revisions_immutable
before update or delete on public.builder_media_revisions
for each row execute function builder_private.builder_reject_immutable_change();

create trigger builder_version_taxonomies_immutable
before update or delete on public.builder_entry_version_taxonomies
for each row execute function builder_private.builder_reject_immutable_change();

create trigger builder_version_media_immutable
before update or delete on public.builder_entry_version_media
for each row execute function builder_private.builder_reject_immutable_change();

create function builder_private.has_site_role(p_site_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select exists (
    select 1
    from public.builder_site_members member
    where member.site_id = p_site_id
      and member.user_id = auth.uid()
      and member.role = any (p_roles)
  );
$$;

revoke all on function builder_private.builder_reject_immutable_change() from public, anon, authenticated;
revoke all on function builder_private.has_site_role(uuid, text[]) from public, anon, authenticated;

alter table public.builder_sites enable row level security;
alter table public.builder_site_members enable row level security;
alter table public.builder_content_types enable row level security;
alter table public.builder_entries enable row level security;
alter table public.builder_entry_versions enable row level security;
alter table public.builder_published_entries enable row level security;
alter table public.builder_taxonomies enable row level security;
alter table public.builder_entry_version_taxonomies enable row level security;
alter table public.builder_media_assets enable row level security;
alter table public.builder_media_revisions enable row level security;
alter table public.builder_entry_version_media enable row level security;
alter table public.builder_slug_claims enable row level security;
alter table public.builder_slug_redirects enable row level security;
alter table public.builder_schedules enable row level security;
alter table public.builder_import_ledger enable row level security;
alter table public.builder_idempotency_requests enable row level security;
alter table public.builder_outbox enable row level security;
alter table public.builder_audit_events enable row level security;

create policy builder_sites_member_read on public.builder_sites
for select to authenticated
using (builder_private.has_site_role(id, array['owner','editor','contributor','viewer']));

create policy builder_members_member_read on public.builder_site_members
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));

create policy builder_members_owner_write on public.builder_site_members
for all to authenticated
using (builder_private.has_site_role(site_id, array['owner']))
with check (builder_private.has_site_role(site_id, array['owner']));

create policy builder_published_public_read on public.builder_published_entries
for select to anon, authenticated
using (version_published_at <= now() and (expires_at is null or expires_at > now()));

create policy builder_editor_content_types on public.builder_content_types
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));
create policy builder_editor_entries on public.builder_entries
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));
create policy builder_editor_versions on public.builder_entry_versions
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));
create policy builder_editor_taxonomies on public.builder_taxonomies
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));
create policy builder_editor_version_taxonomies on public.builder_entry_version_taxonomies
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));
create policy builder_editor_media_assets on public.builder_media_assets
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));
create policy builder_editor_media_revisions on public.builder_media_revisions
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));
create policy builder_editor_version_media on public.builder_entry_version_media
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));
create policy builder_editor_slug_claims on public.builder_slug_claims
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));
create policy builder_editor_slug_redirects on public.builder_slug_redirects
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));
create policy builder_editor_schedules on public.builder_schedules
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','viewer']));
create policy builder_editor_imports on public.builder_import_ledger
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor']));
create policy builder_editor_idempotency on public.builder_idempotency_requests
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor']));
create policy builder_editor_outbox on public.builder_outbox
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor']));
create policy builder_editor_audit on public.builder_audit_events
for select to authenticated
using (builder_private.has_site_role(site_id, array['owner','editor','contributor','viewer']));

create view public.builder_public_posts
with (security_invoker = true)
as
select
  site_id,
  entry_id,
  version_id,
  slug,
  title,
  excerpt,
  snapshot,
  category_keys,
  tag_keys,
  display_date,
  first_published_at,
  version_published_at,
  expires_at,
  featured,
  pinned
from public.builder_published_entries
where version_published_at <= now()
  and (expires_at is null or expires_at > now());

revoke all on all tables in schema public from anon, authenticated;
grant select on public.builder_public_posts to anon, authenticated;
grant select on public.builder_sites, public.builder_site_members, public.builder_content_types,
  public.builder_entries, public.builder_entry_versions, public.builder_taxonomies,
  public.builder_entry_version_taxonomies, public.builder_media_assets, public.builder_media_revisions,
  public.builder_entry_version_media, public.builder_slug_claims, public.builder_slug_redirects,
  public.builder_schedules, public.builder_import_ledger, public.builder_idempotency_requests,
  public.builder_outbox, public.builder_audit_events to authenticated;
grant all on all tables in schema public to service_role;

insert into storage.buckets (id, name, public)
values ('builder-media', 'builder-media', false)
on conflict (id) do nothing;

create policy builder_media_member_read on storage.objects
for select to authenticated
using (
  bucket_id = 'builder-media'
  and builder_private.has_site_role(((storage.foldername(name))[1])::uuid, array['owner','editor','contributor','viewer'])
);

create policy builder_media_member_upload on storage.objects
for insert to authenticated
with check (
  bucket_id = 'builder-media'
  and builder_private.has_site_role(((storage.foldername(name))[1])::uuid, array['owner','editor','contributor'])
);

create function builder_private.transition_post(
  p_site_key text,
  p_operation text,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_site_id uuid;
  v_actor_id uuid := auth.uid();
  v_role text;
  v_entry public.builder_entries%rowtype;
  v_source public.builder_entry_versions%rowtype;
  v_new_version_id uuid;
  v_schedule_id uuid;
  v_snapshot jsonb;
  v_expected_draft uuid;
  v_expected_published uuid;
  v_request_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_old_slug text;
  v_result jsonb;
  v_action text;
  v_before_value jsonb;
  v_after_value jsonb;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  select id into v_site_id from public.builder_sites where site_key = p_site_key;
  if v_site_id is null then
    raise exception 'site not found' using errcode = 'P0002';
  end if;

  select role into v_role
  from public.builder_site_members
  where site_id = v_site_id and user_id = v_actor_id;
  if v_role is null then
    raise exception 'site membership required' using errcode = '42501';
  end if;

  if p_operation in ('publish', 'schedule', 'cancel_schedule', 'reschedule', 'archive', 'rollback', 'undo_rollback')
     and v_role not in ('owner', 'editor') then
    raise exception 'role cannot perform lifecycle transition' using errcode = '42501';
  end if;
  if p_operation in ('save_draft', 'restore_draft')
     and v_role not in ('owner', 'editor', 'contributor') then
    raise exception 'role cannot edit drafts' using errcode = '42501';
  end if;

  v_request_hash := encode(public.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  select request_hash, response into v_existing_hash, v_existing_response
  from public.builder_idempotency_requests
  where site_id = v_site_id and request_key = p_idempotency_key;
  if found then
    if v_existing_hash <> v_request_hash then
      raise exception 'idempotency key reused with different payload' using errcode = '23505';
    end if;
    return coalesce(v_existing_response, jsonb_build_object('status', 'in_progress'));
  end if;

  insert into public.builder_idempotency_requests
    (site_id, request_key, operation, request_hash, created_by)
  values (v_site_id, p_idempotency_key, p_operation, v_request_hash, v_actor_id);

  select * into v_entry
  from public.builder_entries
  where site_id = v_site_id and id = (p_payload->>'entryId')::uuid
  for update;
  if not found then
    raise exception 'entry not found' using errcode = 'P0002';
  end if;

  v_expected_draft := nullif(p_payload->>'expectedDraftVersionId', '')::uuid;
  v_expected_published := nullif(p_payload->>'expectedPublishedVersionId', '')::uuid;
  if v_entry.active_draft_version_id is distinct from v_expected_draft then
    raise exception 'draft version conflict' using errcode = '40001';
  end if;
  if v_entry.active_published_version_id is distinct from v_expected_published then
    raise exception 'published version conflict' using errcode = '40001';
  end if;

  if p_operation = 'save_draft' and v_entry.active_draft_version_id is not null then
    select snapshot into v_before_value from public.builder_entry_versions
    where site_id = v_site_id and entry_id = v_entry.id and id = v_entry.active_draft_version_id;
  elsif p_operation in ('publish', 'archive', 'rollback', 'undo_rollback')
      and v_entry.active_published_version_id is not null then
    select snapshot, slug into v_before_value, v_old_slug from public.builder_entry_versions
    where site_id = v_site_id and entry_id = v_entry.id and id = v_entry.active_published_version_id;
  end if;

  case
    when p_operation = 'save_draft' then
      v_snapshot := p_payload->'snapshot';
      if jsonb_typeof(v_snapshot) <> 'object' then
        raise exception 'snapshot is required' using errcode = '22023';
      end if;
      v_new_version_id := gen_random_uuid();
      insert into public.builder_entry_versions
        (site_id, entry_id, id, version_kind, slug, snapshot, display_date, expires_at, created_by)
      values (
        v_site_id, v_entry.id, v_new_version_id, 'draft', v_snapshot->>'slug', v_snapshot,
        (v_snapshot->>'displayDate')::timestamptz,
        nullif(v_snapshot->>'expiresAt', '')::timestamptz,
        v_actor_id
      );
      perform builder_private.capture_version_references(v_site_id, v_entry.id, v_new_version_id, v_snapshot);
      update public.builder_entries
      set active_draft_version_id = v_new_version_id, status = 'draft', updated_by = v_actor_id, updated_at = now()
      where site_id = v_site_id and id = v_entry.id;
      v_after_value := v_snapshot;
      v_action := 'post.draft_saved';

    when p_operation = 'publish' then
      select * into strict v_source from public.builder_entry_versions
      where site_id = v_site_id and entry_id = v_entry.id and id = v_entry.active_draft_version_id;
      v_snapshot := v_source.snapshot;
      v_new_version_id := gen_random_uuid();
      select slug into v_old_slug from public.builder_published_entries
      where site_id = v_site_id and entry_id = v_entry.id;
      insert into public.builder_entry_versions
        (site_id, entry_id, id, version_kind, schema_version, slug, snapshot, display_date, expires_at, created_by)
      values (
        v_site_id, v_entry.id, v_new_version_id, 'published', v_source.schema_version,
        v_source.slug, v_snapshot, v_source.display_date, v_source.expires_at, v_actor_id
      );
      perform builder_private.capture_version_references(v_site_id, v_entry.id, v_new_version_id, v_snapshot);
      update public.builder_entries
      set active_published_version_id = v_new_version_id,
          first_published_at = coalesce(first_published_at, now()),
          status = 'published', updated_by = v_actor_id, updated_at = now()
      where site_id = v_site_id and id = v_entry.id;
      insert into public.builder_published_entries
        (site_id, entry_id, version_id, slug, title, excerpt, snapshot, category_keys, tag_keys,
         display_date, first_published_at, version_published_at, expires_at, featured, pinned)
      select
        v_site_id, v_entry.id, v_new_version_id, v_source.slug,
        v_snapshot#>>'{data,title}', v_snapshot#>>'{data,excerpt}', v_snapshot,
        coalesce(array(select jsonb_array_elements_text(v_snapshot#>'{taxonomyKeys,categories}')), '{}'),
        coalesce(array(select jsonb_array_elements_text(v_snapshot#>'{taxonomyKeys,tags}')), '{}'),
        v_source.display_date, coalesce(v_entry.first_published_at, now()), now(), v_source.expires_at,
        coalesce((v_snapshot#>>'{data,featured}')::boolean, false),
        coalesce((v_snapshot#>>'{data,pinned}')::boolean, false)
      on conflict (site_id, entry_id) do update set
        version_id = excluded.version_id, slug = excluded.slug, title = excluded.title,
        excerpt = excluded.excerpt, snapshot = excluded.snapshot, category_keys = excluded.category_keys,
        tag_keys = excluded.tag_keys, display_date = excluded.display_date,
        version_published_at = excluded.version_published_at, expires_at = excluded.expires_at,
        featured = excluded.featured, pinned = excluded.pinned;
      insert into public.builder_slug_claims (site_id, slug, entry_id, first_version_id, is_current)
      values (v_site_id, v_source.slug, v_entry.id, v_new_version_id, true)
      on conflict (site_id, slug) do update set is_current = true
      where public.builder_slug_claims.entry_id = excluded.entry_id;
      if v_old_slug is not null and v_old_slug <> v_source.slug then
        update public.builder_slug_claims set is_current = false
        where site_id = v_site_id and slug = v_old_slug and entry_id = v_entry.id;
        insert into public.builder_slug_redirects (site_id, from_slug, entry_id, current_slug)
        values (v_site_id, v_old_slug, v_entry.id, v_source.slug)
        on conflict (site_id, from_slug) do update set current_slug = excluded.current_slug
        where public.builder_slug_redirects.entry_id = excluded.entry_id;
      end if;
      delete from public.builder_slug_redirects
      where site_id = v_site_id and entry_id = v_entry.id and from_slug = v_source.slug;
      update public.builder_slug_redirects
      set current_slug = v_source.slug
      where site_id = v_site_id and entry_id = v_entry.id;
      v_after_value := v_snapshot;
      v_action := 'post.published';

    when p_operation = 'schedule' then
      if (p_payload->>'publishAt')::timestamptz <= now() then
        raise exception 'schedule time must be in the future' using errcode = '22023';
      end if;
      v_schedule_id := gen_random_uuid();
      insert into public.builder_schedules
        (site_id, id, entry_id, draft_version_id, expected_published_version_id,
         publish_at, idempotency_key, created_by)
      values (
        v_site_id, v_schedule_id, v_entry.id, v_entry.active_draft_version_id,
        v_entry.active_published_version_id, (p_payload->>'publishAt')::timestamptz,
        p_idempotency_key, v_actor_id
      );
      update public.builder_entries set status = 'scheduled', updated_by = v_actor_id, updated_at = now()
      where site_id = v_site_id and id = v_entry.id;
      v_after_value := jsonb_build_object('publishAt', p_payload->>'publishAt', 'draftVersionId', v_entry.active_draft_version_id);
      v_action := 'post.scheduled';

    when p_operation = 'cancel_schedule' then
      update public.builder_schedules set status = 'cancelled', updated_at = now()
      where site_id = v_site_id and id = (p_payload->>'scheduleId')::uuid and entry_id = v_entry.id and status = 'pending';
      if not found then raise exception 'pending schedule not found' using errcode = 'P0002'; end if;
      update public.builder_entries
      set status = case when active_published_version_id is null then 'draft' else 'published' end,
          updated_by = v_actor_id, updated_at = now()
      where site_id = v_site_id and id = v_entry.id;
      v_after_value := jsonb_build_object('scheduleId', p_payload->>'scheduleId', 'status', 'cancelled');
      v_action := 'post.schedule_cancelled';

    when p_operation = 'reschedule' then
      if (p_payload->>'publishAt')::timestamptz <= now() then
        raise exception 'schedule time must be in the future' using errcode = '22023';
      end if;
      update public.builder_schedules
      set publish_at = (p_payload->>'publishAt')::timestamptz, updated_at = now()
      where site_id = v_site_id and id = (p_payload->>'scheduleId')::uuid and entry_id = v_entry.id and status = 'pending';
      if not found then raise exception 'pending schedule not found' using errcode = 'P0002'; end if;
      v_after_value := jsonb_build_object('scheduleId', p_payload->>'scheduleId', 'publishAt', p_payload->>'publishAt');
      v_action := 'post.schedule_rescheduled';

    when p_operation = 'archive' then
      delete from public.builder_published_entries where site_id = v_site_id and entry_id = v_entry.id;
      update public.builder_entries set status = 'archived', updated_by = v_actor_id, updated_at = now()
      where site_id = v_site_id and id = v_entry.id;
      v_after_value := null;
      v_action := 'post.archived';

    when p_operation = 'restore_draft' then
      select * into strict v_source from public.builder_entry_versions
      where site_id = v_site_id and entry_id = v_entry.id
        and id = coalesce(v_entry.active_published_version_id, v_entry.active_draft_version_id);
      v_new_version_id := gen_random_uuid();
      insert into public.builder_entry_versions
        (site_id, entry_id, id, version_kind, schema_version, slug, snapshot, display_date, expires_at, created_by)
      values (
        v_site_id, v_entry.id, v_new_version_id, 'draft', v_source.schema_version,
        v_source.slug, v_source.snapshot, v_source.display_date, v_source.expires_at, v_actor_id
      );
      perform builder_private.capture_version_references(v_site_id, v_entry.id, v_new_version_id, v_source.snapshot);
      update public.builder_entries set active_draft_version_id = v_new_version_id,
        status = 'draft', updated_by = v_actor_id, updated_at = now()
      where site_id = v_site_id and id = v_entry.id;
      v_after_value := v_source.snapshot;
      v_action := 'post.draft_restored';

    when p_operation in ('rollback', 'undo_rollback') then
      select * into strict v_source from public.builder_entry_versions
      where site_id = v_site_id and entry_id = v_entry.id and id = (p_payload->>'sourceVersionId')::uuid;
      v_new_version_id := gen_random_uuid();
      insert into public.builder_entry_versions
        (site_id, entry_id, id, version_kind, schema_version, slug, snapshot, display_date, expires_at, created_by)
      values (
        v_site_id, v_entry.id, v_new_version_id,
        case when p_operation = 'rollback' then 'rollback' else 'undo_rollback' end,
        v_source.schema_version, v_source.slug, v_source.snapshot, v_source.display_date, v_source.expires_at, v_actor_id
      );
      perform builder_private.capture_version_references(v_site_id, v_entry.id, v_new_version_id, v_source.snapshot);
      update public.builder_entries set active_published_version_id = v_new_version_id,
        status = 'published', updated_by = v_actor_id, updated_at = now()
      where site_id = v_site_id and id = v_entry.id;
      insert into public.builder_published_entries
        (site_id, entry_id, version_id, slug, title, excerpt, snapshot, category_keys, tag_keys,
         display_date, first_published_at, version_published_at, expires_at, featured, pinned)
      select
        v_site_id, v_entry.id, v_new_version_id, v_source.slug,
        v_source.snapshot#>>'{data,title}', v_source.snapshot#>>'{data,excerpt}', v_source.snapshot,
        coalesce(array(select jsonb_array_elements_text(v_source.snapshot#>'{taxonomyKeys,categories}')), '{}'),
        coalesce(array(select jsonb_array_elements_text(v_source.snapshot#>'{taxonomyKeys,tags}')), '{}'),
        v_source.display_date, coalesce(v_entry.first_published_at, now()), now(), v_source.expires_at,
        coalesce((v_source.snapshot#>>'{data,featured}')::boolean, false),
        coalesce((v_source.snapshot#>>'{data,pinned}')::boolean, false)
      on conflict (site_id, entry_id) do update set
        version_id = excluded.version_id, slug = excluded.slug, title = excluded.title,
        excerpt = excluded.excerpt, snapshot = excluded.snapshot, category_keys = excluded.category_keys,
        tag_keys = excluded.tag_keys, display_date = excluded.display_date,
        version_published_at = excluded.version_published_at, expires_at = excluded.expires_at,
        featured = excluded.featured, pinned = excluded.pinned;
      insert into public.builder_slug_claims (site_id, slug, entry_id, first_version_id, is_current)
      values (v_site_id, v_source.slug, v_entry.id, v_new_version_id, true)
      on conflict (site_id, slug) do update set is_current = true
      where public.builder_slug_claims.entry_id = excluded.entry_id;
      update public.builder_slug_claims
      set is_current = (slug = v_source.slug)
      where site_id = v_site_id and entry_id = v_entry.id;
      delete from public.builder_slug_redirects
      where site_id = v_site_id and entry_id = v_entry.id and from_slug = v_source.slug;
      if v_old_slug is not null and v_old_slug <> v_source.slug then
        insert into public.builder_slug_redirects (site_id, from_slug, entry_id, current_slug)
        values (v_site_id, v_old_slug, v_entry.id, v_source.slug)
        on conflict (site_id, from_slug) do update set current_slug = excluded.current_slug
        where public.builder_slug_redirects.entry_id = excluded.entry_id;
      end if;
      update public.builder_slug_redirects
      set current_slug = v_source.slug
      where site_id = v_site_id and entry_id = v_entry.id;
      v_after_value := v_source.snapshot;
      v_action := case when p_operation = 'rollback' then 'post.rolled_back' else 'post.rollback_undone' end;

    else
      raise exception 'unsupported post transition' using errcode = '22023';
  end case;

  if p_operation in ('publish', 'archive', 'rollback', 'undo_rollback') then
    update public.builder_schedules
    set status = 'cancelled', lease_owner = null, lease_expires_at = null, updated_at = now()
    where site_id = v_site_id and entry_id = v_entry.id and status in ('pending', 'claimed');
  end if;

  insert into public.builder_audit_events
    (site_id, entry_id, action, actor_id, summary, before_value, after_value, source_version_id, result_version_id)
  values (
    v_site_id, v_entry.id, v_action, v_actor_id, replace(v_action, '.', ' '), v_before_value, v_after_value,
    case when p_operation = 'save_draft' then v_entry.active_draft_version_id else v_entry.active_published_version_id end,
    coalesce(v_new_version_id, v_entry.active_published_version_id)
  );

  if p_operation in ('publish', 'archive', 'rollback', 'undo_rollback') then
    insert into public.builder_outbox (site_id, topic, payload, idempotency_key)
    values (
      v_site_id, 'content.revalidate',
      jsonb_build_object('entryId', v_entry.id, 'operation', p_operation, 'oldSlug', v_old_slug),
      p_idempotency_key || ':revalidate'
    );
  end if;

  v_result := jsonb_build_object(
    'siteId', v_site_id,
    'entryId', v_entry.id,
    'operation', p_operation,
    'versionId', v_new_version_id,
    'scheduleId', v_schedule_id
  );
  update public.builder_idempotency_requests set response = v_result
  where site_id = v_site_id and request_key = p_idempotency_key;
  return v_result;
end;
$$;

create function public.builder_transition_post(
  p_site_key text,
  p_operation text,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, builder_private
as $$
  select builder_private.transition_post(p_site_key, p_operation, p_payload, p_idempotency_key);
$$;

revoke all on function builder_private.transition_post(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.builder_transition_post(text, text, jsonb, text) from public, anon;
grant execute on function public.builder_transition_post(text, text, jsonb, text) to authenticated;
