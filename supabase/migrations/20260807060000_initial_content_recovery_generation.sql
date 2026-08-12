-- Create one exact recovery generation for sites that already had published content
-- before transactional publishing began producing generations automatically.

create or replace function public.builder_enqueue_initial_content_recovery_generation_v1(
  p_site_key text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_site_id uuid;
  v_existing_generation bigint;
  v_generation_id bigint;
  v_command_id uuid;
  v_global_version uuid;
  v_page_versions jsonb;
  v_route_count integer;
  v_page_count integer;
begin
  if p_site_key is null or btrim(p_site_key) = '' or char_length(p_site_key) > 200 then
    raise exception 'RECOVERY_BOOTSTRAP_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('initial-recovery:' || p_site_key, 0));
  select site.id into v_site_id
  from public.builder_sites site
  where site.site_key = p_site_key;
  if v_site_id is null then return 0; end if;

  perform 1 from public.builder_sites where id = v_site_id for update;
  select max(generation.generation_id) into v_existing_generation
  from public.builder_site_generations generation
  where generation.site_id = v_site_id;
  if v_existing_generation is not null then return v_existing_generation; end if;

  select page.version_id into v_global_version
  from public.builder_published_pages page
  where page.site_id = v_site_id and page.path = '/__builder/global';

  select
    count(*)::integer,
    coalesce(jsonb_object_agg(route.path, page.version_id order by route.path), '{}'::jsonb),
    count(page.version_id)::integer
  into v_route_count, v_page_versions, v_page_count
  from public.builder_site_routes route
  left join public.builder_published_pages page
    on page.site_id = route.site_id and page.path = route.path
  where route.site_id = v_site_id;

  if v_global_version is null or v_route_count = 0 or v_page_count <> v_route_count then
    raise exception 'INCOMPLETE_INITIAL_RECOVERY_GENERATION' using errcode = '23514';
  end if;

  v_generation_id := 1;
  v_command_id := extensions.gen_random_uuid();
  insert into public.builder_site_generations (
    site_id, generation_id, command_id, global_version_id, page_versions
  ) values (
    v_site_id, v_generation_id, v_command_id, v_global_version, v_page_versions
  );
  insert into public.builder_content_recovery_jobs (
    site_id, generation_id, command_id
  ) values (
    v_site_id, v_generation_id, v_command_id
  );
  return v_generation_id;
end;
$$;

revoke all on function public.builder_enqueue_initial_content_recovery_generation_v1(text)
  from public, anon, authenticated;
grant execute on function public.builder_enqueue_initial_content_recovery_generation_v1(text)
  to service_role;

select public.builder_enqueue_initial_content_recovery_generation_v1('official-assembly-website-v2');
