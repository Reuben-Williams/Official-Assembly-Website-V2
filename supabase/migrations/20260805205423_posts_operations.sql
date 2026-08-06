create function builder_private.create_post(
  p_site_key text,
  p_entry_id uuid,
  p_snapshot jsonb,
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
  v_version_id uuid := gen_random_uuid();
  v_request_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_result jsonb;
begin
  if v_actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'idempotency key is required' using errcode = '22023'; end if;
  if jsonb_typeof(p_snapshot) <> 'object' then raise exception 'snapshot is required' using errcode = '22023'; end if;

  select id into v_site_id from public.builder_sites where site_key = p_site_key;
  select role into v_role from public.builder_site_members where site_id = v_site_id and user_id = v_actor_id;
  if v_role not in ('owner', 'editor', 'contributor') then raise exception 'site editor membership required' using errcode = '42501'; end if;

  v_request_hash := encode(public.digest(convert_to(jsonb_build_object('entryId', p_entry_id, 'snapshot', p_snapshot)::text, 'UTF8'), 'sha256'), 'hex');
  select request_hash, response into v_existing_hash, v_existing_response
  from public.builder_idempotency_requests where site_id = v_site_id and request_key = p_idempotency_key;
  if found then
    if v_existing_hash <> v_request_hash then raise exception 'idempotency key reused with different seed payload' using errcode = '23505'; end if;
    return v_existing_response;
  end if;

  insert into public.builder_content_types (site_id, key) values (v_site_id, 'post') on conflict do nothing;
  insert into public.builder_idempotency_requests (site_id, request_key, operation, request_hash, created_by)
  values (v_site_id, p_idempotency_key, 'create_post', v_request_hash, v_actor_id);
  insert into public.builder_entries (site_id, id, content_type, status, created_by, updated_by)
  values (v_site_id, p_entry_id, 'post', 'draft', v_actor_id, v_actor_id);
  insert into public.builder_entry_versions
    (site_id, entry_id, id, version_kind, slug, snapshot, display_date, expires_at, created_by)
  values (
    v_site_id, p_entry_id, v_version_id, 'draft', p_snapshot->>'slug', p_snapshot,
    (p_snapshot->>'displayDate')::timestamptz, nullif(p_snapshot->>'expiresAt', '')::timestamptz, v_actor_id
  );
  perform builder_private.capture_version_references(v_site_id, p_entry_id, v_version_id, p_snapshot);
  update public.builder_entries set active_draft_version_id = v_version_id where site_id = v_site_id and id = p_entry_id;
  insert into public.builder_audit_events (site_id, entry_id, action, actor_id, summary, result_version_id)
  values (v_site_id, p_entry_id, 'post.created', v_actor_id, 'Created post draft', v_version_id);

  v_result := jsonb_build_object('siteId', v_site_id, 'entryId', p_entry_id, 'versionId', v_version_id, 'status', 'draft');
  update public.builder_idempotency_requests set response = v_result where site_id = v_site_id and request_key = p_idempotency_key;
  return v_result;
end;
$$;

create function public.builder_create_post(p_site_key text, p_entry_id uuid, p_snapshot jsonb, p_idempotency_key text)
returns jsonb language sql security invoker set search_path = pg_catalog, public, builder_private
as $$ select builder_private.create_post(p_site_key, p_entry_id, p_snapshot, p_idempotency_key); $$;

create function public.builder_resolve_post_slug(p_site_key text, p_slug text)
returns table(entry_id uuid, canonical_slug text, redirected boolean)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  with selected_site as (
    select id from public.builder_sites where site_key = p_site_key
  ), resolved as (
    select published.entry_id, published.slug as canonical_slug, false as redirected
    from public.builder_published_entries published join selected_site on selected_site.id = published.site_id
    where published.slug = p_slug and published.version_published_at <= now()
      and (published.expires_at is null or published.expires_at > now())
    union all
    select published.entry_id, published.slug, true
    from public.builder_slug_redirects redirect
    join selected_site on selected_site.id = redirect.site_id
    join public.builder_published_entries published on published.site_id = redirect.site_id and published.entry_id = redirect.entry_id
    where redirect.from_slug = p_slug and published.version_published_at <= now()
      and (published.expires_at is null or published.expires_at > now())
  )
  select * from resolved order by redirected asc limit 1;
$$;

create function public.builder_list_public_posts(p_site_key text)
returns setof public.builder_public_posts
language sql
security definer
stable
set search_path = ''
as $$
  select post.*
  from public.builder_public_posts post
  join public.builder_sites site on site.id = post.site_id
  where site.site_key = p_site_key
    and post.version_published_at <= now()
    and (post.expires_at is null or post.expires_at > now());
$$;

create function public.builder_get_public_post_by_slug(p_site_key text, p_slug text)
returns setof public.builder_public_posts
language sql
security definer
stable
set search_path = ''
as $$
  with selected_site as (
    select id
    from public.builder_sites
    where site_key = p_site_key
  ), resolved as (
    select published.entry_id, 0 as priority
    from public.builder_published_entries published
    join selected_site on selected_site.id = published.site_id
    where published.slug = p_slug
      and published.version_published_at <= now()
      and (published.expires_at is null or published.expires_at > now())
    union all
    select redirect.entry_id, 1
    from public.builder_slug_redirects redirect
    join selected_site on selected_site.id = redirect.site_id
    join public.builder_published_entries published
      on published.site_id = redirect.site_id and published.entry_id = redirect.entry_id
    where redirect.from_slug = p_slug
      and published.version_published_at <= now()
      and (published.expires_at is null or published.expires_at > now())
  ), selected_entry as (
    select entry_id from resolved order by priority limit 1
  )
  select post.*
  from public.builder_public_posts post
  join selected_site on selected_site.id = post.site_id
  join selected_entry on selected_entry.entry_id = post.entry_id;
$$;

create function public.builder_claim_schedule_work(p_worker text, p_lease_seconds integer default 60, p_limit integer default 10)
returns setof public.builder_schedules
language sql security invoker set search_path = pg_catalog, public
as $$
  with candidates as (
    select site_id, id from public.builder_schedules
    where publish_at <= now() and (
      status = 'pending' or (status = 'claimed' and lease_expires_at < now())
    )
    order by publish_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.builder_schedules schedule
  set status = 'claimed', lease_owner = p_worker,
      lease_expires_at = now() + make_interval(secs => greatest(5, p_lease_seconds)), updated_at = now()
  from candidates where schedule.site_id = candidates.site_id and schedule.id = candidates.id
  returning schedule.*;
$$;

create function public.builder_complete_schedule_work(p_site_id uuid, p_schedule_id uuid, p_worker text)
returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_schedule public.builder_schedules%rowtype;
  v_entry public.builder_entries%rowtype;
  v_source public.builder_entry_versions%rowtype;
  v_version_id uuid := gen_random_uuid();
  v_old_slug text;
begin
  select * into strict v_schedule from public.builder_schedules
  where site_id = p_site_id and id = p_schedule_id and status = 'claimed'
    and lease_owner = p_worker and lease_expires_at > now() for update;
  select * into strict v_entry from public.builder_entries
  where site_id = p_site_id and id = v_schedule.entry_id for update;
  if v_entry.active_draft_version_id is distinct from v_schedule.draft_version_id
     or v_entry.active_published_version_id is distinct from v_schedule.expected_published_version_id then
    update public.builder_schedules set status = 'cancelled', lease_owner = null, lease_expires_at = null, updated_at = now()
    where site_id = p_site_id and id = p_schedule_id;
    return jsonb_build_object('status', 'superseded', 'entryId', v_schedule.entry_id);
  end if;
  select * into strict v_source from public.builder_entry_versions
  where site_id = p_site_id and entry_id = v_schedule.entry_id and id = v_schedule.draft_version_id;
  select slug into v_old_slug from public.builder_published_entries where site_id = p_site_id and entry_id = v_schedule.entry_id;
  insert into public.builder_entry_versions
    (site_id, entry_id, id, version_kind, schema_version, slug, snapshot, display_date, expires_at, created_by)
  values (p_site_id, v_schedule.entry_id, v_version_id, 'published', v_source.schema_version, v_source.slug,
    v_source.snapshot, v_source.display_date, v_source.expires_at, v_schedule.created_by);
  perform builder_private.capture_version_references(
    p_site_id, v_schedule.entry_id, v_version_id, v_source.snapshot
  );
  update public.builder_entries set active_published_version_id = v_version_id,
    first_published_at = coalesce(first_published_at, now()), status = 'published', updated_by = v_schedule.created_by, updated_at = now()
  where site_id = p_site_id and id = v_schedule.entry_id;
  insert into public.builder_published_entries
    (site_id, entry_id, version_id, slug, title, excerpt, snapshot, category_keys, tag_keys,
     display_date, first_published_at, version_published_at, expires_at, featured, pinned)
  values (
    p_site_id, v_schedule.entry_id, v_version_id, v_source.slug,
    v_source.snapshot#>>'{data,title}', v_source.snapshot#>>'{data,excerpt}', v_source.snapshot,
    coalesce(array(select jsonb_array_elements_text(v_source.snapshot#>'{taxonomyKeys,categories}')), '{}'),
    coalesce(array(select jsonb_array_elements_text(v_source.snapshot#>'{taxonomyKeys,tags}')), '{}'),
    v_source.display_date, coalesce(v_entry.first_published_at, now()), now(), v_source.expires_at,
    coalesce((v_source.snapshot#>>'{data,featured}')::boolean, false), coalesce((v_source.snapshot#>>'{data,pinned}')::boolean, false)
  ) on conflict (site_id, entry_id) do update set version_id = excluded.version_id, slug = excluded.slug,
    title = excluded.title, excerpt = excluded.excerpt, snapshot = excluded.snapshot,
    category_keys = excluded.category_keys, tag_keys = excluded.tag_keys, display_date = excluded.display_date,
    version_published_at = excluded.version_published_at, expires_at = excluded.expires_at,
    featured = excluded.featured, pinned = excluded.pinned;
  insert into public.builder_slug_claims (site_id, slug, entry_id, first_version_id, is_current)
  values (p_site_id, v_source.slug, v_schedule.entry_id, v_version_id, true)
  on conflict (site_id, slug) do update set is_current = true where public.builder_slug_claims.entry_id = excluded.entry_id;
  update public.builder_slug_claims
  set is_current = (slug = v_source.slug)
  where site_id = p_site_id and entry_id = v_schedule.entry_id;
  delete from public.builder_slug_redirects
  where site_id = p_site_id and entry_id = v_schedule.entry_id and from_slug = v_source.slug;
  if v_old_slug is not null and v_old_slug <> v_source.slug then
    update public.builder_slug_claims set is_current = false where site_id = p_site_id and entry_id = v_schedule.entry_id and slug = v_old_slug;
    insert into public.builder_slug_redirects (site_id, from_slug, entry_id, current_slug)
    values (p_site_id, v_old_slug, v_schedule.entry_id, v_source.slug)
    on conflict (site_id, from_slug) do update set current_slug = excluded.current_slug
    where public.builder_slug_redirects.entry_id = excluded.entry_id;
  end if;
  update public.builder_slug_redirects
  set current_slug = v_source.slug
  where site_id = p_site_id and entry_id = v_schedule.entry_id;
  update public.builder_schedules set status = 'completed', lease_owner = null, lease_expires_at = null, updated_at = now()
  where site_id = p_site_id and id = p_schedule_id;
  insert into public.builder_audit_events (site_id, entry_id, action, actor_id, summary, source_version_id, result_version_id)
  values (p_site_id, v_schedule.entry_id, 'post.published', v_schedule.created_by, 'Published scheduled post', v_source.id, v_version_id);
  insert into public.builder_outbox (site_id, topic, payload, idempotency_key)
  values (p_site_id, 'content.revalidate', jsonb_build_object('entryId', v_schedule.entry_id, 'operation', 'scheduled_publish'), v_schedule.idempotency_key || ':revalidate');
  return jsonb_build_object('status', 'completed', 'entryId', v_schedule.entry_id, 'versionId', v_version_id);
end;
$$;

create function public.builder_fail_schedule_work(p_site_id uuid, p_schedule_id uuid, p_worker text, p_error text)
returns void language sql security invoker set search_path = pg_catalog, public
as $$
  update public.builder_schedules set status = 'failed', lease_owner = null, lease_expires_at = null, updated_at = now()
  where site_id = p_site_id and id = p_schedule_id and status = 'claimed' and lease_owner = p_worker;
$$;

create function public.builder_claim_outbox_work(p_worker text, p_lease_seconds integer default 60, p_limit integer default 20)
returns setof public.builder_outbox
language sql security invoker set search_path = pg_catalog, public
as $$
  with candidates as (
    select site_id, id from public.builder_outbox
    where available_at <= now() and (status = 'pending' or (status = 'claimed' and lease_expires_at < now()))
    order by available_at, created_at for update skip locked limit greatest(1, least(p_limit, 100))
  )
  update public.builder_outbox item set status = 'claimed', lease_owner = p_worker,
    lease_expires_at = now() + make_interval(secs => greatest(5, p_lease_seconds)), attempt_count = attempt_count + 1
  from candidates where item.site_id = candidates.site_id and item.id = candidates.id returning item.*;
$$;

create function public.builder_complete_outbox_work(p_site_id uuid, p_outbox_id uuid, p_worker text)
returns void language sql security invoker set search_path = pg_catalog, public
as $$
  update public.builder_outbox set status = 'completed', completed_at = now(), lease_owner = null, lease_expires_at = null
  where site_id = p_site_id and id = p_outbox_id and status = 'claimed' and lease_owner = p_worker;
$$;

create function public.builder_fail_outbox_work(p_site_id uuid, p_outbox_id uuid, p_worker text, p_error text, p_max_attempts integer default 5, p_retry_seconds integer default 60)
returns void language sql security invoker set search_path = pg_catalog, public
as $$
  update public.builder_outbox set
    status = case when attempt_count >= p_max_attempts then 'failed' else 'pending' end,
    available_at = case when attempt_count >= p_max_attempts then available_at else now() + make_interval(secs => greatest(1, p_retry_seconds)) end,
    lease_owner = null, lease_expires_at = null, last_error = left(p_error, 2000)
  where site_id = p_site_id and id = p_outbox_id and status = 'claimed' and lease_owner = p_worker;
$$;

revoke all on function builder_private.create_post(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.builder_create_post(text, uuid, jsonb, text) from public, anon;
grant execute on function public.builder_create_post(text, uuid, jsonb, text) to authenticated;

revoke all on function public.builder_resolve_post_slug(text, text) from public;
grant execute on function public.builder_resolve_post_slug(text, text) to anon, authenticated;

revoke all on function public.builder_list_public_posts(text) from public;
revoke all on function public.builder_get_public_post_by_slug(text, text) from public;
grant execute on function public.builder_list_public_posts(text) to anon, authenticated;
grant execute on function public.builder_get_public_post_by_slug(text, text) to anon, authenticated;

revoke all on function public.builder_claim_schedule_work(text, integer, integer) from public, anon, authenticated;
revoke all on function public.builder_complete_schedule_work(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.builder_fail_schedule_work(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.builder_claim_outbox_work(text, integer, integer) from public, anon, authenticated;
revoke all on function public.builder_complete_outbox_work(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.builder_fail_outbox_work(uuid, uuid, text, text, integer, integer) from public, anon, authenticated;

grant execute on function public.builder_claim_schedule_work(text, integer, integer) to service_role;
grant execute on function public.builder_complete_schedule_work(uuid, uuid, text) to service_role;
grant execute on function public.builder_fail_schedule_work(uuid, uuid, text, text) to service_role;
grant execute on function public.builder_claim_outbox_work(text, integer, integer) to service_role;
grant execute on function public.builder_complete_outbox_work(uuid, uuid, text) to service_role;
grant execute on function public.builder_fail_outbox_work(uuid, uuid, text, text, integer, integer) to service_role;

create function public.builder_save_taxonomy(p_site_key text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid;
  v_actor_id uuid := auth.uid();
  v_role text;
  v_row public.builder_taxonomies%rowtype;
begin
  select id into v_site_id from public.builder_sites where site_key = p_site_key;
  select role into v_role from public.builder_site_members where site_id = v_site_id and user_id = v_actor_id;
  if v_role not in ('owner', 'editor', 'contributor') then raise exception 'site editor membership required' using errcode = '42501'; end if;
  insert into public.builder_taxonomies (site_id, key, kind, label, slug, description, color_token)
  values (v_site_id, p_payload->>'key', p_payload->>'kind', p_payload->>'label', p_payload->>'slug', p_payload->>'description', p_payload->>'colorToken')
  on conflict (site_id, key) do update set
    label = excluded.label, slug = excluded.slug, description = excluded.description,
    color_token = excluded.color_token, updated_at = now()
  where public.builder_taxonomies.kind = excluded.kind
  returning * into v_row;
  if v_row.id is null then raise exception 'taxonomy kind is immutable' using errcode = '22023'; end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.builder_save_taxonomy(text, jsonb) from public, anon;
grant execute on function public.builder_save_taxonomy(text, jsonb) to authenticated;

create function public.builder_revoke_preview_sessions(p_site_key text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_site_id uuid;
  v_generation integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select id into v_site_id from public.builder_sites where site_key = p_site_key;
  update public.builder_site_members
  set session_generation = session_generation + 1, updated_at = now()
  where site_id = v_site_id and user_id = auth.uid()
  returning session_generation into v_generation;
  if v_generation is null then
    raise exception 'site membership required' using errcode = '42501';
  end if;
  return v_generation;
end;
$$;

revoke all on function public.builder_revoke_preview_sessions(text) from public, anon;
grant execute on function public.builder_revoke_preview_sessions(text) to authenticated;
