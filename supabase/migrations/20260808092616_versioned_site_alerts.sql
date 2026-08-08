create or replace function builder_private.alert_items_valid(p_items jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_start text;
  v_end text;
begin
  if jsonb_typeof(p_items) <> 'array' then return false; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    group by item ->> 'id'
    having count(*) > 1
  ) then return false; end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or coalesce(char_length(btrim(v_item ->> 'id')), 0) not between 1 and 200
      or v_item ->> 'category' not in ('news', 'office', 'urgent', 'general')
      or coalesce(char_length(btrim(v_item ->> 'message')), 0) not between 1 and 280
      or v_item ->> 'lifecycle' not in ('active', 'archived')
      or jsonb_typeof(v_item -> 'enabled') <> 'boolean' then
      return false;
    end if;
    if v_item ? 'link' and jsonb_typeof(v_item -> 'link') <> 'null' and (
      jsonb_typeof(v_item -> 'link') <> 'string'
      or char_length(v_item ->> 'link') not between 1 and 2048
      or (v_item ->> 'link') like '//%'
      or ((v_item ->> 'link') not like '/%' and (v_item ->> 'link') !~ '^https?://')
    ) then return false; end if;

    v_start := null;
    v_end := null;
    if v_item ? 'startsAt' and jsonb_typeof(v_item -> 'startsAt') <> 'null' then
      if jsonb_typeof(v_item -> 'startsAt') <> 'string'
        or (v_item ->> 'startsAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then return false; end if;
      v_start := v_item ->> 'startsAt';
    end if;
    if v_item ? 'endsAt' and jsonb_typeof(v_item -> 'endsAt') <> 'null' then
      if jsonb_typeof(v_item -> 'endsAt') <> 'string'
        or (v_item ->> 'endsAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then return false; end if;
      v_end := v_item ->> 'endsAt';
    end if;
    if v_start is not null and v_end is not null and v_end <= v_start then return false; end if;
  end loop;
  return true;
end;
$$;

create table public.builder_alert_revisions (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  collection_key text not null check (collection_key = 'alerts'),
  parent_revision_id uuid,
  items jsonb not null check (builder_private.alert_items_valid(items)),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (site_id, id),
  foreign key (site_id, parent_revision_id)
    references public.builder_alert_revisions(site_id, id) on delete restrict
);

create index builder_alert_revisions_collection_created_idx
  on public.builder_alert_revisions (site_id, collection_key, created_at desc, id desc);

create table public.builder_alert_collections (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  collection_key text not null check (collection_key = 'alerts'),
  draft_revision_id uuid not null,
  published_revision_id uuid not null,
  lock_version bigint not null default 0 check (lock_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, collection_key),
  foreign key (site_id, draft_revision_id)
    references public.builder_alert_revisions(site_id, id) on delete restrict,
  foreign key (site_id, published_revision_id)
    references public.builder_alert_revisions(site_id, id) on delete restrict
);

create table public.builder_alert_command_receipts (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  command_id uuid not null,
  operation text not null check (operation in ('create', 'edit', 'reorder', 'set_enabled', 'schedule', 'archive', 'publish')),
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (site_id, idempotency_key),
  unique (site_id, command_id)
);

create table public.builder_alert_recovery_jobs (
  site_id uuid not null,
  revision_id uuid not null,
  publication_number bigint not null check (publication_number > 0),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'retry', 'completed', 'dead_letter', 'superseded')),
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  fence_token bigint not null default 0 check (fence_token >= 0),
  environment text,
  site_key text,
  artifact_path text,
  content_digest text check (content_digest is null or content_digest ~ '^[a-f0-9]{64}$'),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, revision_id),
  unique (site_id, publication_number),
  foreign key (site_id, revision_id)
    references public.builder_alert_revisions(site_id, id) on delete restrict,
  check ((lease_owner is null) = (lease_expires_at is null)),
  check (status = 'claimed' or lease_owner is null),
  check (
    status <> 'completed' or
    (environment is not null and site_key is not null and artifact_path is not null and content_digest is not null and completed_at is not null)
  )
);

create index builder_alert_recovery_jobs_due_idx
  on public.builder_alert_recovery_jobs (available_at, site_id, publication_number)
  where status in ('pending', 'retry');

create trigger builder_alert_revisions_immutable
before update or delete on public.builder_alert_revisions
for each row execute function builder_private.builder_reject_immutable_change();

create trigger builder_alert_command_receipts_immutable
before update or delete on public.builder_alert_command_receipts
for each row execute function builder_private.builder_reject_immutable_change();

alter table public.builder_history_events_v1
  drop constraint builder_history_events_v1_source_check,
  add constraint builder_history_events_v1_source_check
    check (source in ('page', 'media', 'post', 'form', 'alert')),
  drop constraint builder_history_events_v1_category_check,
  add constraint builder_history_events_v1_category_check
    check (category in ('text', 'media', 'links', 'sections', 'posts', 'forms', 'publishing', 'alerts')),
  add column alert_parent_revision_id uuid,
  add column alert_result_revision_id uuid,
  add foreign key (site_id, alert_parent_revision_id)
    references public.builder_alert_revisions(site_id, id) on delete restrict,
  add foreign key (site_id, alert_result_revision_id)
    references public.builder_alert_revisions(site_id, id) on delete restrict;

alter table public.builder_audit_log
  drop constraint builder_audit_log_action_check,
  add constraint builder_audit_log_action_check check (action in (
    'draft.saved', 'version.published', 'version.rolled_back', 'rollback.undone', 'media.uploaded',
    'alert.created', 'alert.draft_edited', 'alert.reordered', 'alert.enabled_changed',
    'alert.schedule_changed', 'alert.archived', 'alert.published'
  )),
  drop constraint builder_audit_log_kind_check,
  add constraint builder_audit_log_kind_check
    check (kind in ('text', 'richText', 'image', 'link', 'sections', 'icon', 'alert'));

alter table public.builder_alert_revisions enable row level security;
alter table public.builder_alert_collections enable row level security;
alter table public.builder_alert_command_receipts enable row level security;
alter table public.builder_alert_recovery_jobs enable row level security;

revoke all on public.builder_alert_revisions, public.builder_alert_collections,
  public.builder_alert_command_receipts, public.builder_alert_recovery_jobs
  from public, anon, authenticated;

grant select, insert on public.builder_alert_revisions to service_role;
grant select, insert, update on public.builder_alert_collections to service_role;
grant select, insert on public.builder_alert_command_receipts to service_role;
grant all on public.builder_alert_recovery_jobs to service_role;

create function public.builder_initialize_alert_collection_v1(
  p_site_key text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid;
  v_role text;
  v_revision_id uuid;
  v_collection public.builder_alert_collections%rowtype;
begin
  select id into v_site_id from public.builder_sites where site_key = p_site_key;
  select role into v_role
  from public.builder_site_members
  where site_id = v_site_id and user_id = p_actor_id;
  if v_site_id is null or v_role is null or v_role not in ('owner', 'editor', 'contributor') then
    raise exception 'ALERT_COMMAND_DENIED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_site_id::text || ':alerts:initialize', 0));
  select * into v_collection
  from public.builder_alert_collections
  where site_id = v_site_id and collection_key = 'alerts';
  if not found then
    insert into public.builder_alert_revisions (site_id, collection_key, parent_revision_id, items, created_by)
    values (v_site_id, 'alerts', null, '[]'::jsonb, p_actor_id)
    returning id into v_revision_id;
    insert into public.builder_alert_collections (
      site_id, collection_key, draft_revision_id, published_revision_id, lock_version
    ) values (
      v_site_id, 'alerts', v_revision_id, v_revision_id, 0
    ) returning * into v_collection;
  end if;

  return jsonb_build_object(
    'collectionId', v_collection.collection_key,
    'draftRevisionId', v_collection.draft_revision_id,
    'publishedRevisionId', v_collection.published_revision_id,
    'lockVersion', v_collection.lock_version
  );
end;
$$;

create function public.builder_execute_alert_command_v1(
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
  v_actor_role text;
  v_command_id uuid;
  v_idempotency_key text;
  v_operation text;
  v_payload_digest text;
  v_expected_lock bigint;
  v_expected_draft uuid;
  v_collection public.builder_alert_collections%rowtype;
  v_current_items jsonb;
  v_next_items jsonb;
  v_item jsonb;
  v_alert_id text;
  v_result_revision uuid;
  v_parent_revision uuid;
  v_action text;
  v_response jsonb;
  v_existing public.builder_alert_command_receipts%rowtype;
  v_new_lock bigint;
  v_target_label text;
begin
  if jsonb_typeof(p_command) <> 'object' or p_command ->> 'schemaVersion' <> '1' then
    raise exception 'ALERT_COMMAND_INVALID' using errcode = '22023';
  end if;

  begin
    v_actor_id := (p_command ->> 'actorId')::uuid;
    v_command_id := (p_command ->> 'commandId')::uuid;
    v_expected_lock := (p_command ->> 'expectedLockVersion')::bigint;
    v_expected_draft := (p_command ->> 'expectedDraftRevisionId')::uuid;
  exception when others then
    raise exception 'ALERT_COMMAND_INVALID' using errcode = '22023';
  end;
  v_idempotency_key := p_command ->> 'idempotencyKey';
  v_operation := p_command ->> 'operation';
  v_payload_digest := p_command ->> 'payloadDigest';

  select id into v_site_id from public.builder_sites where site_key = p_site_key;
  select role into v_actor_role
  from public.builder_site_members
  where site_id = v_site_id and user_id = v_actor_id;

  if v_site_id is null or p_command ->> 'siteId' <> p_site_key
    or p_command ->> 'collectionId' <> 'alerts'
    or v_operation not in ('create', 'edit', 'reorder', 'set_enabled', 'schedule', 'archive', 'publish')
    or v_expected_lock < 0
    or coalesce(char_length(v_idempotency_key), 0) not between 1 and 200
    or v_payload_digest is null or v_payload_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'ALERT_COMMAND_INVALID' using errcode = '22023';
  end if;

  if v_actor_role is null
    or (v_operation in ('create', 'edit', 'set_enabled', 'schedule') and v_actor_role not in ('owner', 'editor', 'contributor'))
    or (v_operation in ('reorder', 'archive', 'publish') and v_actor_role not in ('owner', 'editor')) then
    raise exception 'ALERT_COMMAND_DENIED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_site_id::text || ':alerts:' || v_idempotency_key, 0));
  select * into v_existing
  from public.builder_alert_command_receipts
  where site_id = v_site_id and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.payload_digest <> v_payload_digest then
      raise exception 'IDEMPOTENCY_MISMATCH' using errcode = '23505';
    end if;
    return v_existing.response;
  end if;

  select * into v_collection
  from public.builder_alert_collections
  where site_id = v_site_id and collection_key = 'alerts'
  for update;
  if not found then raise exception 'ALERT_COLLECTION_NOT_INITIALIZED' using errcode = '55000'; end if;
  if v_collection.lock_version <> v_expected_lock or v_collection.draft_revision_id <> v_expected_draft then
    raise exception 'STALE_REVISION' using errcode = '40001';
  end if;

  select items into v_current_items
  from public.builder_alert_revisions
  where site_id = v_site_id and id = v_collection.draft_revision_id;
  v_parent_revision := v_collection.draft_revision_id;
  v_alert_id := p_command ->> 'alertId';

  if v_operation in ('create', 'edit') then
    v_item := p_command -> 'item';
    if not builder_private.alert_items_valid(jsonb_build_array(v_item)) then
      raise exception 'ALERT_ITEM_INVALID' using errcode = '22023';
    end if;
    v_alert_id := v_item ->> 'id';
  end if;

  case v_operation
    when 'create' then
      if exists (select 1 from jsonb_array_elements(v_current_items) item where item ->> 'id' = v_alert_id) then
        raise exception 'ALERT_ITEM_EXISTS' using errcode = '23505';
      end if;
      v_next_items := v_current_items || jsonb_build_array(v_item);
      v_action := 'alert.created';
    when 'edit' then
      if not exists (select 1 from jsonb_array_elements(v_current_items) item where item ->> 'id' = v_alert_id) then
        raise exception 'ALERT_ITEM_NOT_FOUND' using errcode = '22023';
      end if;
      select jsonb_agg(case when item ->> 'id' = v_alert_id then v_item else item end order by ordinal)
      into v_next_items
      from jsonb_array_elements(v_current_items) with ordinality as current_items(item, ordinal);
      v_action := 'alert.draft_edited';
    when 'reorder' then
      if jsonb_typeof(p_command -> 'orderedItemIds') <> 'array'
        or jsonb_array_length(p_command -> 'orderedItemIds') <> jsonb_array_length(v_current_items)
        or (select count(distinct value) from jsonb_array_elements_text(p_command -> 'orderedItemIds'))
          <> jsonb_array_length(v_current_items) then
        raise exception 'ALERT_ORDER_INVALID' using errcode = '22023';
      end if;
      select jsonb_agg(item order by requested.ordinal)
      into v_next_items
      from jsonb_array_elements_text(p_command -> 'orderedItemIds') with ordinality requested(id, ordinal)
      join jsonb_array_elements(v_current_items) item on item ->> 'id' = requested.id;
      if coalesce(jsonb_array_length(v_next_items), -1) <> jsonb_array_length(v_current_items) then
        raise exception 'ALERT_ORDER_INVALID' using errcode = '22023';
      end if;
      v_action := 'alert.reordered';
    when 'set_enabled' then
      if coalesce(char_length(btrim(v_alert_id)), 0) = 0 or jsonb_typeof(p_command -> 'enabled') <> 'boolean' then
        raise exception 'ALERT_ITEM_INVALID' using errcode = '22023';
      end if;
      select jsonb_agg(
        case when item ->> 'id' = v_alert_id then jsonb_set(item, '{enabled}', p_command -> 'enabled', true) else item end
        order by ordinal
      ) into v_next_items
      from jsonb_array_elements(v_current_items) with ordinality as current_items(item, ordinal);
      if not exists (select 1 from jsonb_array_elements(v_current_items) item where item ->> 'id' = v_alert_id) then
        raise exception 'ALERT_ITEM_NOT_FOUND' using errcode = '22023';
      end if;
      v_action := 'alert.enabled_changed';
    when 'schedule' then
      if coalesce(char_length(btrim(v_alert_id)), 0) = 0
        or not (p_command ? 'startsAt') or not (p_command ? 'endsAt') then
        raise exception 'ALERT_ITEM_INVALID' using errcode = '22023';
      end if;
      select jsonb_agg(
        case when item ->> 'id' = v_alert_id then
          jsonb_set(jsonb_set(item, '{startsAt}', p_command -> 'startsAt', true), '{endsAt}', p_command -> 'endsAt', true)
        else item end order by ordinal
      ) into v_next_items
      from jsonb_array_elements(v_current_items) with ordinality as current_items(item, ordinal);
      if not exists (select 1 from jsonb_array_elements(v_current_items) item where item ->> 'id' = v_alert_id) then
        raise exception 'ALERT_ITEM_NOT_FOUND' using errcode = '22023';
      end if;
      v_action := 'alert.schedule_changed';
    when 'archive' then
      if coalesce(char_length(btrim(v_alert_id)), 0) = 0 then
        raise exception 'ALERT_ITEM_INVALID' using errcode = '22023';
      end if;
      select jsonb_agg(
        case when item ->> 'id' = v_alert_id then
          jsonb_set(jsonb_set(item, '{lifecycle}', '"archived"'::jsonb, true), '{enabled}', 'false'::jsonb, true)
        else item end order by ordinal
      ) into v_next_items
      from jsonb_array_elements(v_current_items) with ordinality as current_items(item, ordinal);
      if not exists (select 1 from jsonb_array_elements(v_current_items) item where item ->> 'id' = v_alert_id) then
        raise exception 'ALERT_ITEM_NOT_FOUND' using errcode = '22023';
      end if;
      v_action := 'alert.archived';
    when 'publish' then
      v_next_items := v_current_items;
      v_result_revision := v_collection.draft_revision_id;
      v_action := 'alert.published';
  end case;

  if not builder_private.alert_items_valid(v_next_items) then
    raise exception 'ALERT_ITEM_INVALID' using errcode = '22023';
  end if;

  v_new_lock := v_collection.lock_version + 1;
  if v_operation <> 'publish' then
    insert into public.builder_alert_revisions (
      site_id, collection_key, parent_revision_id, items, created_by
    ) values (
      v_site_id, 'alerts', v_collection.draft_revision_id, v_next_items, v_actor_id
    ) returning id into v_result_revision;
    update public.builder_alert_collections
    set draft_revision_id = v_result_revision, lock_version = v_new_lock, updated_at = now()
    where site_id = v_site_id and collection_key = 'alerts';
  else
    update public.builder_alert_collections
    set published_revision_id = v_result_revision, lock_version = v_new_lock, updated_at = now()
    where site_id = v_site_id and collection_key = 'alerts';
    insert into public.builder_alert_recovery_jobs (site_id, revision_id, publication_number)
    values (v_site_id, v_result_revision, v_new_lock)
    on conflict (site_id, revision_id) do nothing;
  end if;

  v_target_label := case
    when v_alert_id is null then 'Site alerts'
    when v_operation in ('create', 'edit') then left(v_item ->> 'message', 500)
    else coalesce((select item ->> 'message' from jsonb_array_elements(v_next_items) item where item ->> 'id' = v_alert_id), 'Site alerts')
  end;

  insert into public.builder_audit_log (
    site_id, page_path, action, user_id, user_label, summary, region_id, kind, before, after
  ) values (
    v_site_id, '/__builder/alerts', v_action, v_actor_id::text, 'Team member',
    v_action || ' ' || coalesce(v_alert_id, 'alerts'), v_alert_id, 'alert', v_current_items, v_next_items
  );

  insert into public.builder_history_events_v1 (
    site_id, source, source_event_id, event_id, category, action, workspace,
    page_path, target_id, target_label, actor_id, actor_label,
    change_summary, provenance, alert_parent_revision_id, alert_result_revision_id
  ) values (
    v_site_id, 'alert', v_command_id::text,
    'history:v1:' || v_site_id::text || ':alert:' || v_command_id::text,
    'alerts', v_action, 'website.alerts', null,
    coalesce(v_alert_id, 'alerts'), v_target_label, v_actor_id, 'Team member',
    jsonb_build_object('before', null, 'after', null, 'changedFieldCount', 1),
    jsonb_build_object('legacy', false, 'limited', false, 'redactedFields', '[]'::jsonb),
    v_parent_revision, v_result_revision
  );

  select * into v_collection
  from public.builder_alert_collections
  where site_id = v_site_id and collection_key = 'alerts';
  v_response := jsonb_build_object(
    'commandId', v_command_id,
    'operation', v_operation,
    'collectionId', v_collection.collection_key,
    'draftRevisionId', v_collection.draft_revision_id,
    'publishedRevisionId', v_collection.published_revision_id,
    'resultRevisionId', v_result_revision,
    'lockVersion', v_collection.lock_version
  );

  insert into public.builder_alert_command_receipts (
    site_id, idempotency_key, command_id, operation, payload_digest, actor_id, response
  ) values (
    v_site_id, v_idempotency_key, v_command_id, v_operation, v_payload_digest, v_actor_id, v_response
  );
  return v_response;
end;
$$;

create function public.builder_read_alert_collection_v1(
  p_site_key text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid;
  v_role text;
  v_collection public.builder_alert_collections%rowtype;
  v_items jsonb;
begin
  select id into v_site_id from public.builder_sites where site_key = p_site_key;
  select role into v_role
  from public.builder_site_members
  where site_id = v_site_id and user_id = p_actor_id;
  if v_site_id is null or v_role is null or v_role not in ('owner', 'editor', 'contributor', 'viewer') then
    raise exception 'ALERT_READ_DENIED' using errcode = '42501';
  end if;

  select * into v_collection
  from public.builder_alert_collections
  where site_id = v_site_id and collection_key = 'alerts';
  if not found then return null; end if;
  select items into v_items
  from public.builder_alert_revisions
  where site_id = v_site_id and id = v_collection.draft_revision_id;

  return jsonb_build_object(
    'collectionId', v_collection.collection_key,
    'draftRevisionId', v_collection.draft_revision_id,
    'publishedRevisionId', v_collection.published_revision_id,
    'lockVersion', v_collection.lock_version,
    'items', v_items,
    'updatedAt', v_collection.updated_at
  );
end;
$$;

create function public.builder_read_published_alerts_v1(
  p_site_key text,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_revision_id uuid;
  v_items jsonb;
  v_active jsonb;
  v_next timestamptz;
begin
  select collection.published_revision_id, revision.items
  into v_revision_id, v_items
  from public.builder_sites site
  join public.builder_alert_collections collection on collection.site_id = site.id and collection.collection_key = 'alerts'
  join public.builder_alert_revisions revision on revision.site_id = site.id and revision.id = collection.published_revision_id
  where site.site_key = p_site_key;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', item ->> 'id',
    'category', item ->> 'category',
    'message', item ->> 'message',
    'link', item -> 'link',
    'endsAt', item -> 'endsAt'
  )) order by ordinal), '[]'::jsonb)
  into v_active
  from jsonb_array_elements(v_items) with ordinality listed(item, ordinal)
  where (item ->> 'enabled')::boolean
    and item ->> 'lifecycle' = 'active'
    and (not (item ? 'startsAt') or jsonb_typeof(item -> 'startsAt') = 'null' or (item ->> 'startsAt')::timestamptz <= p_at)
    and (not (item ? 'endsAt') or jsonb_typeof(item -> 'endsAt') = 'null' or (item ->> 'endsAt')::timestamptz > p_at);

  select min(transition_at) into v_next
  from (
    select (item ->> 'startsAt')::timestamptz as transition_at
    from jsonb_array_elements(v_items) item
    where (item ->> 'enabled')::boolean and item ->> 'lifecycle' = 'active'
      and item ? 'startsAt' and jsonb_typeof(item -> 'startsAt') = 'string'
      and (item ->> 'startsAt')::timestamptz > p_at
    union all
    select (item ->> 'endsAt')::timestamptz
    from jsonb_array_elements(v_items) item
    where (item ->> 'enabled')::boolean and item ->> 'lifecycle' = 'active'
      and item ? 'endsAt' and jsonb_typeof(item -> 'endsAt') = 'string'
      and (item ->> 'endsAt')::timestamptz > p_at
  ) transitions;

  return jsonb_build_object(
    'schemaVersion', 1,
    'revisionId', v_revision_id,
    'activeAlerts', v_active,
    'evaluatedAt', p_at,
    'nextTransitionAt', v_next
  );
end;
$$;

create function public.builder_claim_alert_recovery_job_v1(
  p_worker text,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.builder_alert_recovery_jobs%rowtype;
  v_site_key text;
  v_revision public.builder_alert_revisions%rowtype;
begin
  if p_worker is null or btrim(p_worker) = '' or p_lease_seconds not between 15 and 300 then
    raise exception 'ALERT_RECOVERY_CLAIM_INVALID' using errcode = '22023';
  end if;
  select * into v_job
  from public.builder_alert_recovery_jobs
  where status in ('pending', 'retry') and available_at <= now()
  order by available_at, site_id, publication_number
  for update skip locked limit 1;
  if not found then return null; end if;
  update public.builder_alert_recovery_jobs
  set status = 'claimed', lease_owner = p_worker,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      fence_token = fence_token + 1, attempt_count = attempt_count + 1, updated_at = now()
  where site_id = v_job.site_id and revision_id = v_job.revision_id
  returning * into v_job;
  select site_key into v_site_key from public.builder_sites where id = v_job.site_id;
  select * into v_revision
  from public.builder_alert_revisions
  where site_id = v_job.site_id and id = v_job.revision_id;
  return jsonb_build_object(
    'siteId', v_job.site_id,
    'siteKey', v_site_key,
    'revisionId', v_job.revision_id,
    'publicationNumber', v_job.publication_number,
    'status', v_job.status,
    'attemptCount', v_job.attempt_count,
    'workerId', v_job.lease_owner,
    'fenceToken', v_job.fence_token,
    'leaseExpiresAt', v_job.lease_expires_at,
    'revision', jsonb_build_object(
      'schemaVersion', 1,
      'revisionId', v_revision.id,
      'collectionId', v_revision.collection_key,
      'parentRevisionId', v_revision.parent_revision_id,
      'createdBy', v_revision.created_by,
      'createdAt', v_revision.created_at,
      'items', v_revision.items
    )
  );
end;
$$;

create function public.builder_fail_alert_recovery_job_v1(
  p_site_id uuid,
  p_revision_id uuid,
  p_worker text,
  p_fence_token bigint,
  p_error_code text,
  p_retry_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.builder_alert_recovery_jobs%rowtype;
  v_status text;
begin
  if p_worker is null or btrim(p_worker) = ''
    or p_error_code is null or p_error_code !~ '^[a-z0-9][a-z0-9_.-]{0,127}$'
    or p_retry_at < statement_timestamp() - interval '1 minute'
    or p_retry_at > statement_timestamp() + interval '24 hours' then
    raise exception 'ALERT_RECOVERY_FAILURE_INVALID' using errcode = '22023';
  end if;

  select * into v_job
  from public.builder_alert_recovery_jobs
  where site_id = p_site_id and revision_id = p_revision_id
    and status = 'claimed' and lease_owner = p_worker
    and fence_token = p_fence_token and lease_expires_at > now()
  for update;
  if not found then
    return jsonb_build_object('status', 'stale_lease', 'attemptCount', 0);
  end if;

  v_status := case when v_job.attempt_count >= 5 then 'dead_letter' else 'retry' end;
  update public.builder_alert_recovery_jobs
  set status = v_status,
      available_at = p_retry_at,
      last_error = p_error_code,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where site_id = p_site_id and revision_id = p_revision_id;
  return jsonb_build_object('status', v_status, 'attemptCount', v_job.attempt_count);
end;
$$;

create function public.builder_complete_alert_recovery_job_v1(
  p_site_id uuid,
  p_revision_id uuid,
  p_worker text,
  p_fence_token bigint,
  p_environment text,
  p_site_key text,
  p_artifact_path text,
  p_content_digest text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_publication_number bigint;
  v_actual_site_key text;
begin
  select job.publication_number, site.site_key
  into v_publication_number, v_actual_site_key
  from public.builder_alert_recovery_jobs job
  join public.builder_sites site on site.id = job.site_id
  where job.site_id = p_site_id and job.revision_id = p_revision_id;
  if not found
    or p_environment !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    or p_site_key <> v_actual_site_key
    or p_content_digest !~ '^[a-f0-9]{64}$'
    or p_artifact_path <> format(
      '%s/%s/alerts/revisions/%s-%s.json',
      p_environment, p_site_key, v_publication_number, p_content_digest
    ) then
    raise exception 'ALERT_RECOVERY_COMPLETION_INVALID' using errcode = '22023';
  end if;
  update public.builder_alert_recovery_jobs
  set status = 'completed', environment = p_environment, site_key = p_site_key,
      artifact_path = p_artifact_path, content_digest = p_content_digest,
      completed_at = now(), lease_owner = null, lease_expires_at = null, updated_at = now()
  where site_id = p_site_id and revision_id = p_revision_id
    and status = 'claimed' and lease_owner = p_worker
    and fence_token = p_fence_token and lease_expires_at > now();
  return found;
end;
$$;

revoke all on function builder_private.alert_items_valid(jsonb) from public, anon, authenticated;
revoke all on function public.builder_initialize_alert_collection_v1(text, uuid) from public, anon, authenticated;
revoke all on function public.builder_execute_alert_command_v1(text, jsonb) from public, anon, authenticated;
revoke all on function public.builder_read_alert_collection_v1(text, uuid) from public, anon, authenticated;
revoke all on function public.builder_read_published_alerts_v1(text, timestamptz) from public, anon, authenticated;
revoke all on function public.builder_claim_alert_recovery_job_v1(text, integer) from public, anon, authenticated;
revoke all on function public.builder_fail_alert_recovery_job_v1(uuid, uuid, text, bigint, text, timestamptz) from public, anon, authenticated;
revoke all on function public.builder_complete_alert_recovery_job_v1(uuid, uuid, text, bigint, text, text, text, text) from public, anon, authenticated;

grant execute on function public.builder_initialize_alert_collection_v1(text, uuid) to service_role;
grant execute on function public.builder_execute_alert_command_v1(text, jsonb) to service_role;
grant execute on function public.builder_read_alert_collection_v1(text, uuid) to service_role;
grant execute on function public.builder_read_published_alerts_v1(text, timestamptz) to service_role;
grant execute on function public.builder_claim_alert_recovery_job_v1(text, integer) to service_role;
grant execute on function public.builder_fail_alert_recovery_job_v1(uuid, uuid, text, bigint, text, timestamptz) to service_role;
grant execute on function public.builder_complete_alert_recovery_job_v1(uuid, uuid, text, bigint, text, text, text, text) to service_role;
