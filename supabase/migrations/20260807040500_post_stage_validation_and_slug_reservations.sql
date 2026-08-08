create or replace function builder_private.post_rich_text_value(p_node jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_value text := '';
begin
  if p_node is null or jsonb_typeof(p_node) = 'null' then return ''; end if;
  if jsonb_typeof(p_node) = 'array' then
    for v_item in select value from jsonb_array_elements(p_node) loop
      v_value := v_value || ' ' || builder_private.post_rich_text_value(v_item);
    end loop;
    return v_value;
  end if;
  if jsonb_typeof(p_node) <> 'object' then return ''; end if;
  if jsonb_typeof(p_node->'text') = 'string' then v_value := p_node->>'text'; end if;
  if p_node ? 'content' then
    v_value := v_value || ' ' || builder_private.post_rich_text_value(p_node->'content');
  end if;
  return v_value;
end;
$$;

create or replace function builder_private.assert_post_publishable(p_snapshot jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_alt text;
  v_image jsonb;
begin
  if btrim(coalesce(p_snapshot#>>'{data,title}', '')) = '' then
    raise exception 'Enter a post title before saving the draft.' using errcode = '22023';
  end if;
  if btrim(builder_private.post_rich_text_value(p_snapshot#>'{data,body}')) = '' then
    raise exception 'Add post body text before publishing.' using errcode = '22023';
  end if;
  v_image := p_snapshot#>'{data,featuredImage}';
  if v_image is not null and jsonb_typeof(v_image) <> 'null' then
    v_alt := btrim(coalesce(v_image->>'alt', ''));
    if v_alt = '' then
      raise exception 'Add descriptive image alt text before publishing.' using errcode = '22023';
    end if;
    if v_alt ~* '^[^/\\]+\.(avif|gif|jpe?g|png|svg|webp)$' then
      raise exception 'Describe the image instead of using its filename.' using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function builder_private.enforce_post_publishable()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform builder_private.assert_post_publishable(new.snapshot);
  return new;
end;
$$;

drop trigger if exists builder_published_entries_publishable on public.builder_published_entries;
create trigger builder_published_entries_publishable
before insert or update of snapshot on public.builder_published_entries
for each row execute function builder_private.enforce_post_publishable();

create or replace function builder_private.create_post(
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
  v_snapshot jsonb;
  v_slug_base text;
  v_slug text;
  v_suffix integer := 1;
begin
  if v_actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'idempotency key is required' using errcode = '22023'; end if;
  if jsonb_typeof(p_snapshot) <> 'object' then raise exception 'snapshot is required' using errcode = '22023'; end if;
  if btrim(coalesce(p_snapshot#>>'{data,title}', '')) = '' then
    raise exception 'Enter a post title before saving the draft.' using errcode = '22023';
  end if;

  v_slug_base := btrim(coalesce(p_snapshot->>'slug', ''));
  if v_slug_base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'The post slug must use lowercase letters, numbers, and hyphens.' using errcode = '22023';
  end if;

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

  perform pg_advisory_xact_lock(hashtextextended(v_site_id::text || ':post-slug', 0));
  v_slug := v_slug_base;
  while exists (
    select 1 from public.builder_slug_claims claim
    where claim.site_id = v_site_id and claim.slug = v_slug
    union all
    select 1
    from public.builder_entries entry
    join public.builder_entry_versions version
      on version.site_id = entry.site_id
     and version.entry_id = entry.id
     and version.id = coalesce(entry.active_draft_version_id, entry.active_published_version_id)
    where entry.site_id = v_site_id and version.slug = v_slug
  ) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix::text;
  end loop;
  v_snapshot := jsonb_set(p_snapshot, '{slug}', to_jsonb(v_slug), true);

  insert into public.builder_content_types (site_id, key) values (v_site_id, 'post') on conflict do nothing;
  insert into public.builder_idempotency_requests (site_id, request_key, operation, request_hash, created_by)
  values (v_site_id, p_idempotency_key, 'create_post', v_request_hash, v_actor_id);
  insert into public.builder_entries (site_id, id, content_type, status, created_by, updated_by)
  values (v_site_id, p_entry_id, 'post', 'draft', v_actor_id, v_actor_id);
  insert into public.builder_entry_versions
    (site_id, entry_id, id, version_kind, slug, snapshot, display_date, expires_at, created_by)
  values (
    v_site_id, p_entry_id, v_version_id, 'draft', v_slug, v_snapshot,
    (v_snapshot->>'displayDate')::timestamptz, nullif(v_snapshot->>'expiresAt', '')::timestamptz, v_actor_id
  );
  perform builder_private.capture_version_references(v_site_id, p_entry_id, v_version_id, v_snapshot);
  update public.builder_entries set active_draft_version_id = v_version_id where site_id = v_site_id and id = p_entry_id;
  insert into public.builder_slug_claims (site_id, slug, entry_id, first_version_id, is_current)
  values (v_site_id, v_slug, p_entry_id, v_version_id, true);
  insert into public.builder_audit_events (site_id, entry_id, action, actor_id, summary, result_version_id)
  values (v_site_id, p_entry_id, 'post.created', v_actor_id, 'Created post draft', v_version_id);

  v_result := jsonb_build_object('siteId', v_site_id, 'entryId', p_entry_id, 'versionId', v_version_id, 'status', 'draft', 'slug', v_slug);
  update public.builder_idempotency_requests set response = v_result where site_id = v_site_id and request_key = p_idempotency_key;
  return v_result;
end;
$$;

revoke all on function builder_private.post_rich_text_value(jsonb) from public, anon, authenticated;
revoke all on function builder_private.assert_post_publishable(jsonb) from public, anon, authenticated;
revoke all on function builder_private.enforce_post_publishable() from public, anon, authenticated;
