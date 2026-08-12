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
      or jsonb_typeof(v_item -> 'enabled') <> 'boolean'
      or (v_item ? 'scroll' and jsonb_typeof(v_item -> 'scroll') <> 'boolean') then
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

create or replace function public.builder_read_published_alerts_v1(
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
    'scroll', case when item -> 'scroll' = 'true'::jsonb then 'true'::jsonb else null end,
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
