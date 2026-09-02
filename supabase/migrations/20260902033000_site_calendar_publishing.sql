create table public.builder_calendar_events (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  lifecycle_state text not null default 'active' check (lifecycle_state in ('active', 'archived')),
  draft_revision_id uuid,
  published_revision_id uuid,
  created_by_member_id uuid not null references auth.users(id) on delete restrict,
  updated_by_member_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  command_version bigint not null default 0 check (command_version >= 0),
  primary key (site_id, id),
  check (
    (lifecycle_state = 'active' and archived_at is null)
    or (lifecycle_state = 'archived' and archived_at is not null and published_revision_id is null)
  ),
  check ((published_revision_id is null) = (published_at is null))
);

create table public.builder_calendar_event_revisions (
  site_id uuid not null,
  event_id uuid not null,
  id uuid not null default gen_random_uuid(),
  parent_revision_id uuid,
  title_en text not null check (char_length(title_en) <= 160),
  title_es text not null check (char_length(title_es) <= 160),
  description_en text not null check (char_length(description_en) <= 5000),
  description_es text not null check (char_length(description_es) <= 5000),
  start_at timestamptz,
  end_at timestamptz,
  display_timezone text not null default 'America/New_York' check (display_timezone = 'America/New_York'),
  location_name text not null check (char_length(location_name) <= 200),
  location_address text not null check (char_length(location_address) <= 500),
  action_url text check (action_url is null or char_length(action_url) <= 2048),
  action_label_en text not null check (char_length(action_label_en) <= 120),
  action_label_es text not null check (char_length(action_label_es) <= 120),
  media_asset_id uuid,
  public_approved boolean not null default false,
  hosted_by_office boolean not null default false,
  author_member_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (site_id, event_id, id),
  unique (site_id, id),
  foreign key (site_id, event_id)
    references public.builder_calendar_events(site_id, id) on delete restrict,
  foreign key (site_id, event_id, parent_revision_id)
    references public.builder_calendar_event_revisions(site_id, event_id, id) on delete restrict,
  foreign key (site_id, media_asset_id)
    references public.builder_media_assets(site_id, id) on delete restrict,
  check (end_at is null or (start_at is not null and end_at > start_at))
);

alter table public.builder_calendar_events
  add constraint builder_calendar_events_draft_pointer_fk
    foreign key (site_id, id, draft_revision_id)
    references public.builder_calendar_event_revisions(site_id, event_id, id)
    deferrable initially deferred,
  add constraint builder_calendar_events_published_pointer_fk
    foreign key (site_id, id, published_revision_id)
    references public.builder_calendar_event_revisions(site_id, event_id, id)
    deferrable initially deferred;

create table public.builder_calendar_command_receipts (
  site_id uuid not null references public.builder_sites(id) on delete restrict,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'),
  command text not null check (command in ('create_draft', 'save_draft', 'publish', 'unpublish', 'archive', 'restore_to_draft')),
  event_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (site_id, idempotency_key),
  foreign key (site_id, event_id)
    references public.builder_calendar_events(site_id, id) on delete restrict
);

create index builder_calendar_events_management_idx
  on public.builder_calendar_events (site_id, lifecycle_state, updated_at desc, id desc);
create index builder_calendar_events_published_idx
  on public.builder_calendar_events (site_id, published_at desc, id)
  where lifecycle_state = 'active' and published_revision_id is not null;
create index builder_calendar_revisions_start_idx
  on public.builder_calendar_event_revisions (site_id, start_at, event_id, id);

create trigger builder_calendar_event_revisions_immutable
before update or delete on public.builder_calendar_event_revisions
for each row execute function builder_private.builder_reject_immutable_change();

create trigger builder_calendar_command_receipts_immutable
before update or delete on public.builder_calendar_command_receipts
for each row execute function builder_private.builder_reject_immutable_change();

create trigger builder_calendar_events_no_delete
before delete on public.builder_calendar_events
for each row execute function builder_private.builder_reject_immutable_change();

create function builder_private.builder_calendar_action_url_valid_v1(p_url text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_url is null or (
    char_length(p_url) between 1 and 2048
    and p_url ~* '^https://(www[.]essexclerk[.]com|www[.]nj[.]gov|www[.]njleg[.]state[.]nj[.]us|docs[.]google[.]com|nj-34-district[.]web[.]fireside21[.]app)([/#?]|$)'
  );
$$;

create function builder_private.builder_calendar_draft_valid_v1(p_draft jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, builder_private
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_media uuid;
begin
  if jsonb_typeof(p_draft) <> 'object'
    or not (p_draft ?& array[
      'titleEn', 'titleEs', 'descriptionEn', 'descriptionEs', 'startAt', 'endAt',
      'displayTimeZone', 'locationName', 'locationAddress', 'actionUrl',
      'actionLabelEn', 'actionLabelEs', 'mediaAssetId', 'publicApproved', 'hostedByOffice'
    ])
    or p_draft - array[
      'titleEn', 'titleEs', 'descriptionEn', 'descriptionEs', 'startAt', 'endAt',
      'displayTimeZone', 'locationName', 'locationAddress', 'actionUrl',
      'actionLabelEn', 'actionLabelEs', 'mediaAssetId', 'publicApproved', 'hostedByOffice'
    ] <> '{}'::jsonb
    or jsonb_typeof(p_draft -> 'titleEn') <> 'string'
    or jsonb_typeof(p_draft -> 'titleEs') <> 'string'
    or jsonb_typeof(p_draft -> 'descriptionEn') <> 'string'
    or jsonb_typeof(p_draft -> 'descriptionEs') <> 'string'
    or jsonb_typeof(p_draft -> 'locationName') <> 'string'
    or jsonb_typeof(p_draft -> 'locationAddress') <> 'string'
    or jsonb_typeof(p_draft -> 'actionLabelEn') <> 'string'
    or jsonb_typeof(p_draft -> 'actionLabelEs') <> 'string'
    or jsonb_typeof(p_draft -> 'publicApproved') <> 'boolean'
    or jsonb_typeof(p_draft -> 'hostedByOffice') <> 'boolean'
    or p_draft ->> 'displayTimeZone' <> 'America/New_York'
    or char_length(p_draft ->> 'titleEn') > 160
    or char_length(p_draft ->> 'titleEs') > 160
    or char_length(p_draft ->> 'descriptionEn') > 5000
    or char_length(p_draft ->> 'descriptionEs') > 5000
    or char_length(p_draft ->> 'locationName') > 200
    or char_length(p_draft ->> 'locationAddress') > 500
    or char_length(p_draft ->> 'actionLabelEn') > 120
    or char_length(p_draft ->> 'actionLabelEs') > 120
    or jsonb_typeof(p_draft -> 'startAt') not in ('string', 'null')
    or jsonb_typeof(p_draft -> 'endAt') not in ('string', 'null')
    or jsonb_typeof(p_draft -> 'actionUrl') not in ('string', 'null')
    or jsonb_typeof(p_draft -> 'mediaAssetId') not in ('string', 'null') then
    return false;
  end if;

  if jsonb_typeof(p_draft -> 'startAt') = 'string' then
    v_start := (p_draft ->> 'startAt')::timestamptz;
  end if;
  if jsonb_typeof(p_draft -> 'endAt') = 'string' then
    v_end := (p_draft ->> 'endAt')::timestamptz;
  end if;
  if v_end is not null and (v_start is null or v_end <= v_start) then return false; end if;

  if jsonb_typeof(p_draft -> 'mediaAssetId') = 'string' then
    v_media := (p_draft ->> 'mediaAssetId')::uuid;
  end if;
  if not builder_private.builder_calendar_action_url_valid_v1(
    case when jsonb_typeof(p_draft -> 'actionUrl') = 'string' then p_draft ->> 'actionUrl' else null end
  ) then return false; end if;

  return true;
exception when others then
  return false;
end;
$$;

create function builder_private.builder_calendar_insert_revision_v1(
  p_site_id uuid,
  p_event_id uuid,
  p_parent_revision_id uuid,
  p_actor_id uuid,
  p_draft jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_revision_id uuid := gen_random_uuid();
  v_media_id uuid;
begin
  if not builder_private.builder_calendar_draft_valid_v1(p_draft) then
    raise exception 'CALENDAR_VALIDATION' using errcode = '22023';
  end if;

  v_media_id := case
    when jsonb_typeof(p_draft -> 'mediaAssetId') = 'string' then (p_draft ->> 'mediaAssetId')::uuid
    else null
  end;
  if v_media_id is not null and not exists (
    select 1
    from public.builder_media_assets asset
    where asset.site_id = p_site_id
      and asset.id = v_media_id
      and asset.archived_at is null
      and exists (
        select 1 from public.builder_media_revisions revision
        where revision.site_id = asset.site_id and revision.media_id = asset.id
      )
  ) then
    raise exception 'CALENDAR_VALIDATION' using errcode = '22023';
  end if;

  insert into public.builder_calendar_event_revisions (
    site_id, event_id, id, parent_revision_id,
    title_en, title_es, description_en, description_es,
    start_at, end_at, display_timezone, location_name, location_address,
    action_url, action_label_en, action_label_es, media_asset_id,
    public_approved, hosted_by_office, author_member_id
  ) values (
    p_site_id, p_event_id, v_revision_id, p_parent_revision_id,
    p_draft ->> 'titleEn', p_draft ->> 'titleEs',
    p_draft ->> 'descriptionEn', p_draft ->> 'descriptionEs',
    case when jsonb_typeof(p_draft -> 'startAt') = 'string' then (p_draft ->> 'startAt')::timestamptz else null end,
    case when jsonb_typeof(p_draft -> 'endAt') = 'string' then (p_draft ->> 'endAt')::timestamptz else null end,
    p_draft ->> 'displayTimeZone', p_draft ->> 'locationName', p_draft ->> 'locationAddress',
    case when jsonb_typeof(p_draft -> 'actionUrl') = 'string' then p_draft ->> 'actionUrl' else null end,
    p_draft ->> 'actionLabelEn', p_draft ->> 'actionLabelEs', v_media_id,
    (p_draft ->> 'publicApproved')::boolean, (p_draft ->> 'hostedByOffice')::boolean,
    p_actor_id
  );
  return v_revision_id;
end;
$$;

create function builder_private.builder_calendar_revision_publishable_v1(
  p_revision public.builder_calendar_event_revisions
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    char_length(btrim(p_revision.title_en)) between 1 and 160
    and char_length(btrim(p_revision.title_es)) between 1 and 160
    and char_length(btrim(p_revision.description_en)) between 1 and 5000
    and char_length(btrim(p_revision.description_es)) between 1 and 5000
    and p_revision.start_at is not null
    and char_length(btrim(p_revision.location_name)) between 1 and 200
    and char_length(btrim(p_revision.location_address)) between 1 and 500
    and p_revision.public_approved
    and p_revision.hosted_by_office
    and (
      (p_revision.action_url is null and p_revision.action_label_en = '' and p_revision.action_label_es = '')
      or (
        p_revision.action_url is not null
        and char_length(btrim(p_revision.action_label_en)) between 1 and 120
        and char_length(btrim(p_revision.action_label_es)) between 1 and 120
      )
    )
    and (
      p_revision.media_asset_id is null
      or exists (
        select 1
        from public.builder_media_assets asset
        where asset.site_id = p_revision.site_id
          and asset.id = p_revision.media_asset_id
          and asset.archived_at is null
          and exists (
            select 1 from public.builder_media_revisions media_revision
            where media_revision.site_id = asset.site_id and media_revision.media_id = asset.id
          )
      )
    );
$$;

create function builder_private.builder_calendar_revision_json_v1(
  p_revision public.builder_calendar_event_revisions
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'id', p_revision.id,
    'parentRevisionId', p_revision.parent_revision_id,
    'eventId', p_revision.event_id,
    'siteId', p_revision.site_id,
    'titleEn', p_revision.title_en,
    'titleEs', p_revision.title_es,
    'descriptionEn', p_revision.description_en,
    'descriptionEs', p_revision.description_es,
    'startAt', p_revision.start_at,
    'endAt', p_revision.end_at,
    'displayTimeZone', p_revision.display_timezone,
    'locationName', p_revision.location_name,
    'locationAddress', p_revision.location_address,
    'actionUrl', p_revision.action_url,
    'actionLabelEn', p_revision.action_label_en,
    'actionLabelEs', p_revision.action_label_es,
    'mediaAssetId', p_revision.media_asset_id,
    'publicApproved', p_revision.public_approved,
    'hostedByOffice', p_revision.hosted_by_office,
    'authorMemberId', p_revision.author_member_id,
    'createdAt', p_revision.created_at
  );
$$;

create function builder_private.builder_calendar_management_event_v1(
  p_site_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_event public.builder_calendar_events%rowtype;
  v_draft public.builder_calendar_event_revisions%rowtype;
  v_published public.builder_calendar_event_revisions%rowtype;
begin
  select * into strict v_event
  from public.builder_calendar_events
  where site_id = p_site_id and id = p_event_id;

  if v_event.draft_revision_id is not null then
    select * into strict v_draft
    from public.builder_calendar_event_revisions
    where site_id = p_site_id and event_id = p_event_id and id = v_event.draft_revision_id;
  end if;
  if v_event.published_revision_id is not null then
    select * into strict v_published
    from public.builder_calendar_event_revisions
    where site_id = p_site_id and event_id = p_event_id and id = v_event.published_revision_id;
  end if;

  return jsonb_build_object(
    'entity', jsonb_build_object(
      'id', v_event.id,
      'siteId', v_event.site_id,
      'lifecycleState', v_event.lifecycle_state,
      'draftRevisionId', v_event.draft_revision_id,
      'publishedRevisionId', v_event.published_revision_id,
      'createdByMemberId', v_event.created_by_member_id,
      'updatedByMemberId', v_event.updated_by_member_id,
      'createdAt', v_event.created_at,
      'updatedAt', v_event.updated_at,
      'publishedAt', v_event.published_at,
      'archivedAt', v_event.archived_at,
      'commandVersion', v_event.command_version
    ),
    'draftRevision', case when v_event.draft_revision_id is null then null else builder_private.builder_calendar_revision_json_v1(v_draft) end,
    'publishedRevision', case when v_event.published_revision_id is null then null else builder_private.builder_calendar_revision_json_v1(v_published) end
  );
end;
$$;

alter table public.builder_history_events_v1
  drop constraint builder_history_events_v1_source_check,
  add constraint builder_history_events_v1_source_check
    check (source in ('page', 'media', 'post', 'form', 'alert', 'translation', 'calendar')),
  drop constraint builder_history_events_v1_category_check,
  add constraint builder_history_events_v1_category_check
    check (category in (
      'text', 'media', 'links', 'sections', 'posts', 'forms', 'publishing', 'alerts',
      'translations', 'translation_approval', 'language_neutral_exemption', 'events'
    )),
  add column calendar_event_id uuid,
  add column calendar_parent_revision_id uuid,
  add column calendar_result_revision_id uuid,
  add constraint builder_history_calendar_event_fk
    foreign key (site_id, calendar_event_id)
    references public.builder_calendar_events(site_id, id) on delete restrict,
  add constraint builder_history_calendar_parent_revision_fk
    foreign key (site_id, calendar_event_id, calendar_parent_revision_id)
    references public.builder_calendar_event_revisions(site_id, event_id, id) on delete restrict,
  add constraint builder_history_calendar_result_revision_fk
    foreign key (site_id, calendar_event_id, calendar_result_revision_id)
    references public.builder_calendar_event_revisions(site_id, event_id, id) on delete restrict,
  add constraint builder_history_calendar_revision_event_check
    check (
      (calendar_parent_revision_id is null and calendar_result_revision_id is null)
      or calendar_event_id is not null
    );

create function public.builder_calendar_list_v1(p_site_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, builder_private
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'events', coalesce(
      jsonb_agg(
        builder_private.builder_calendar_management_event_v1(entity.site_id, entity.id)
        order by entity.updated_at desc, entity.id desc
      ),
      '[]'::jsonb
    )
  )
  from public.builder_calendar_events entity
  where entity.site_id = p_site_id;
$$;

create function public.builder_calendar_public_v1(
  p_site_key text,
  p_evaluated_at timestamptz,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if p_site_key is null or p_evaluated_at is null or p_limit not between 1 and 100 then
    raise exception 'CALENDAR_VALIDATION' using errcode = '22023';
  end if;

  with eligible as (
    select
      entity.id,
      revision.title_en,
      revision.title_es,
      revision.description_en,
      revision.description_es,
      revision.start_at,
      revision.end_at,
      coalesce(
        revision.end_at,
        (((revision.start_at at time zone 'America/New_York')::date + 1)::timestamp at time zone 'America/New_York')
      ) as effective_end_at,
      revision.display_timezone,
      revision.location_name,
      revision.location_address,
      revision.action_url,
      revision.action_label_en,
      revision.action_label_es,
      revision.media_asset_id
    from public.builder_sites site
    join public.builder_calendar_events entity
      on entity.site_id = site.id
      and entity.lifecycle_state = 'active'
      and entity.published_revision_id is not null
    join public.builder_calendar_event_revisions revision
      on revision.site_id = entity.site_id
      and revision.event_id = entity.id
      and revision.id = entity.published_revision_id
    where site.site_key = p_site_key
      and revision.public_approved
      and revision.hosted_by_office
      and revision.start_at is not null
  ), limited as (
    select *
    from eligible
    where effective_end_at > p_evaluated_at
    order by start_at asc, id asc
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'titleEn', title_en,
    'titleEs', title_es,
    'descriptionEn', description_en,
    'descriptionEs', description_es,
    'startAt', start_at,
    'endAt', end_at,
    'effectiveEndAt', effective_end_at,
    'displayTimeZone', display_timezone,
    'locationName', location_name,
    'locationAddress', location_address,
    'actionUrl', action_url,
    'actionLabelEn', action_label_en,
    'actionLabelEs', action_label_es,
    'mediaAssetId', media_asset_id
  ) order by start_at asc, id asc), '[]'::jsonb)
  into v_result
  from limited;

  return v_result;
end;
$$;

create function public.builder_calendar_command_v1(
  p_site_id uuid,
  p_actor_id uuid,
  p_command text,
  p_event_id uuid,
  p_expected_version bigint,
  p_idempotency_key text,
  p_draft jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, builder_private
as $$
declare
  v_role text;
  v_event public.builder_calendar_events%rowtype;
  v_revision public.builder_calendar_event_revisions%rowtype;
  v_event_id uuid;
  v_parent_revision_id uuid;
  v_result_revision_id uuid;
  v_request_digest text;
  v_existing public.builder_calendar_command_receipts%rowtype;
  v_response jsonb;
  v_target_label text;
begin
  select member.role into v_role
  from public.builder_site_members member
  where member.site_id = p_site_id and member.user_id = p_actor_id;

  if v_role is null then
    raise exception 'CALENDAR_ROLE_DENIED' using errcode = '42501';
  end if;
  if p_command is null
    or p_command not in ('create_draft', 'save_draft', 'publish', 'unpublish', 'archive', 'restore_to_draft')
    or p_expected_version is null or p_expected_version < 0
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'
    or (p_command = 'create_draft' and (p_event_id is not null or p_expected_version <> 0))
    or (p_command <> 'create_draft' and p_event_id is null)
    or (p_command in ('create_draft', 'save_draft') and p_draft is null)
    or (p_command not in ('create_draft', 'save_draft') and p_draft is not null) then
    raise exception 'CALENDAR_VALIDATION' using errcode = '22023';
  end if;
  if (p_command in ('create_draft', 'save_draft') and v_role not in ('owner', 'editor', 'contributor'))
    or (p_command in ('publish', 'unpublish', 'archive', 'restore_to_draft') and v_role not in ('owner', 'editor')) then
    raise exception 'CALENDAR_ROLE_DENIED' using errcode = '42501';
  end if;

  v_request_digest := encode(digest(convert_to(jsonb_build_object(
    'siteId', p_site_id,
    'actorId', p_actor_id,
    'command', p_command,
    'eventId', p_event_id,
    'expectedVersion', p_expected_version,
    'draft', p_draft
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_site_id::text || ':calendar:' || p_idempotency_key, 0));
  select * into v_existing
  from public.builder_calendar_command_receipts
  where site_id = p_site_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_digest <> v_request_digest then
      raise exception 'CALENDAR_VALIDATION' using errcode = '22023';
    end if;
    return v_existing.response;
  end if;

  if p_command = 'create_draft' then
    v_event_id := gen_random_uuid();
    insert into public.builder_calendar_events (
      site_id, id, lifecycle_state, created_by_member_id, updated_by_member_id, command_version
    ) values (
      p_site_id, v_event_id, 'active', p_actor_id, p_actor_id, 0
    );
    v_result_revision_id := builder_private.builder_calendar_insert_revision_v1(
      p_site_id, v_event_id, null, p_actor_id, p_draft
    );
    update public.builder_calendar_events
    set draft_revision_id = v_result_revision_id,
        command_version = 1,
        updated_at = now()
    where site_id = p_site_id and id = v_event_id
    returning * into v_event;
  else
    v_event_id := p_event_id;
    select * into v_event
    from public.builder_calendar_events
    where site_id = p_site_id and id = v_event_id
    for update;
    if not found then
      raise exception 'CALENDAR_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_event.command_version <> p_expected_version then
      raise exception 'STALE_CALENDAR_VERSION' using errcode = '40001';
    end if;

    case p_command
      when 'save_draft' then
        if v_event.lifecycle_state <> 'active' then
          raise exception 'CALENDAR_VALIDATION' using errcode = '22023';
        end if;
        v_parent_revision_id := v_event.draft_revision_id;
        v_result_revision_id := builder_private.builder_calendar_insert_revision_v1(
          p_site_id, v_event_id, v_parent_revision_id, p_actor_id, p_draft
        );
        update public.builder_calendar_events
        set draft_revision_id = v_result_revision_id,
            updated_by_member_id = p_actor_id,
            updated_at = now(),
            command_version = command_version + 1
        where site_id = p_site_id and id = v_event_id
        returning * into v_event;
      when 'publish' then
        if v_event.lifecycle_state <> 'active' or v_event.draft_revision_id is null then
          raise exception 'CALENDAR_VALIDATION' using errcode = '22023';
        end if;
        select * into strict v_revision
        from public.builder_calendar_event_revisions
        where site_id = p_site_id and event_id = v_event_id and id = v_event.draft_revision_id;
        if not builder_private.builder_calendar_revision_publishable_v1(v_revision) then
          raise exception 'CALENDAR_VALIDATION' using errcode = '22023';
        end if;
        v_parent_revision_id := v_event.published_revision_id;
        v_result_revision_id := v_event.draft_revision_id;
        update public.builder_calendar_events
        set published_revision_id = draft_revision_id,
            published_at = now(),
            updated_by_member_id = p_actor_id,
            updated_at = now(),
            command_version = command_version + 1
        where site_id = p_site_id and id = v_event_id
        returning * into v_event;
      when 'unpublish' then
        if v_event.lifecycle_state <> 'active' or v_event.published_revision_id is null then
          raise exception 'CALENDAR_VALIDATION' using errcode = '22023';
        end if;
        v_parent_revision_id := v_event.published_revision_id;
        update public.builder_calendar_events
        set published_revision_id = null,
            published_at = null,
            updated_by_member_id = p_actor_id,
            updated_at = now(),
            command_version = command_version + 1
        where site_id = p_site_id and id = v_event_id
        returning * into v_event;
      when 'archive' then
        if v_event.lifecycle_state <> 'active' then
          raise exception 'CALENDAR_VALIDATION' using errcode = '22023';
        end if;
        v_parent_revision_id := coalesce(v_event.published_revision_id, v_event.draft_revision_id);
        v_result_revision_id := v_event.draft_revision_id;
        update public.builder_calendar_events
        set lifecycle_state = 'archived',
            published_revision_id = null,
            published_at = null,
            archived_at = now(),
            updated_by_member_id = p_actor_id,
            updated_at = now(),
            command_version = command_version + 1
        where site_id = p_site_id and id = v_event_id
        returning * into v_event;
      when 'restore_to_draft' then
        if v_event.lifecycle_state <> 'archived' or v_event.draft_revision_id is null then
          raise exception 'CALENDAR_VALIDATION' using errcode = '22023';
        end if;
        v_parent_revision_id := v_event.draft_revision_id;
        v_result_revision_id := v_event.draft_revision_id;
        update public.builder_calendar_events
        set lifecycle_state = 'active',
            published_revision_id = null,
            published_at = null,
            archived_at = null,
            updated_by_member_id = p_actor_id,
            updated_at = now(),
            command_version = command_version + 1
        where site_id = p_site_id and id = v_event_id
        returning * into v_event;
    end case;
  end if;

  select coalesce(nullif(btrim(title_en), ''), 'Untitled event')
  into v_target_label
  from public.builder_calendar_event_revisions
  where site_id = p_site_id and event_id = v_event_id and id = v_event.draft_revision_id;

  insert into public.builder_history_events_v1 (
    site_id, source, source_event_id, event_id, category, action, workspace,
    page_path, target_id, target_label, actor_id, actor_label,
    change_summary, provenance,
    calendar_event_id, calendar_parent_revision_id, calendar_result_revision_id
  ) values (
    p_site_id, 'calendar', p_idempotency_key,
    'history:v1:' || p_site_id::text || ':calendar:' || p_idempotency_key,
    'events', 'calendar.' || p_command, 'website.calendar',
    null, v_event_id::text, v_target_label, p_actor_id, 'Team member',
    jsonb_build_object(
      'before', null,
      'after', null,
      'changedFieldCount', case when p_command in ('create_draft', 'save_draft') then 1 else 0 end
    ),
    jsonb_build_object('legacy', false, 'limited', false, 'redactedFields', '[]'::jsonb),
    v_event_id, v_parent_revision_id, v_result_revision_id
  );

  v_response := jsonb_build_object(
    'schemaVersion', 1,
    'command', p_command,
    'event', builder_private.builder_calendar_management_event_v1(p_site_id, v_event_id)
  );
  insert into public.builder_calendar_command_receipts (
    site_id, idempotency_key, command, event_id, actor_id, request_digest, response
  ) values (
    p_site_id, p_idempotency_key, p_command, v_event_id, p_actor_id, v_request_digest, v_response
  );
  return v_response;
end;
$$;

alter table public.builder_calendar_events enable row level security;
alter table public.builder_calendar_event_revisions enable row level security;
alter table public.builder_calendar_command_receipts enable row level security;

create policy builder_calendar_events_member_read
on public.builder_calendar_events for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor', 'contributor', 'viewer']));

create policy builder_calendar_revisions_member_read
on public.builder_calendar_event_revisions for select to authenticated
using (builder_private.has_site_role(site_id, array['owner', 'editor', 'contributor', 'viewer']));

revoke all on public.builder_calendar_events, public.builder_calendar_event_revisions,
  public.builder_calendar_command_receipts from public, anon, authenticated;
grant select on public.builder_calendar_events, public.builder_calendar_event_revisions to authenticated;
grant select on public.builder_calendar_events, public.builder_calendar_event_revisions,
  public.builder_calendar_command_receipts to service_role;

revoke all on function builder_private.builder_calendar_action_url_valid_v1(text) from public, anon, authenticated;
revoke all on function builder_private.builder_calendar_draft_valid_v1(jsonb) from public, anon, authenticated;
revoke all on function builder_private.builder_calendar_insert_revision_v1(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function builder_private.builder_calendar_revision_publishable_v1(public.builder_calendar_event_revisions) from public, anon, authenticated;
revoke all on function builder_private.builder_calendar_revision_json_v1(public.builder_calendar_event_revisions) from public, anon, authenticated;
revoke all on function builder_private.builder_calendar_management_event_v1(uuid,uuid) from public, anon, authenticated;

revoke all on function public.builder_calendar_list_v1(uuid) from public, anon, authenticated;
revoke all on function public.builder_calendar_public_v1(text,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.builder_calendar_command_v1(uuid,uuid,text,uuid,bigint,text,jsonb) from public, anon, authenticated;

grant execute on function public.builder_calendar_list_v1(uuid) to service_role;
grant execute on function public.builder_calendar_public_v1(text,timestamptz,integer) to service_role;
grant execute on function public.builder_calendar_command_v1(uuid,uuid,text,uuid,bigint,text,jsonb) to service_role;
