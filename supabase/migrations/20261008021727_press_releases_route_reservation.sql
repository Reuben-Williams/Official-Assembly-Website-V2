-- Audit all versions, including archived/restorable drafts, before claiming this static route.
do $$
begin
  if exists(select 1 from public.builder_entry_versions v join public.builder_sites s on s.id=v.site_id
    where s.site_key='official-assembly-website-v2' and (v.slug='press-releases' or v.snapshot->>'slug'='press-releases'))
    or exists(select 1 from public.builder_published_entries v join public.builder_sites s on s.id=v.site_id
      where s.site_key='official-assembly-website-v2' and (v.slug='press-releases' or v.snapshot->>'slug'='press-releases'))
  then raise exception 'PRESS_RELEASES_ROUTE_COLLISION'; end if;
end;
$$;
create function builder_private.reserve_press_releases_route() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (new.slug='press-releases' or new.snapshot->>'slug'='press-releases')
    and exists(select 1 from public.builder_sites where id=new.site_id and site_key='official-assembly-website-v2')
  then raise exception 'The post slug press-releases is reserved for the Press Releases page.' using errcode='22023'; end if;
  return new;
end;
$$;
revoke all on function builder_private.reserve_press_releases_route() from public;
create trigger builder_entry_press_releases_reserved before insert or update of slug,snapshot on public.builder_entry_versions
  for each row execute function builder_private.reserve_press_releases_route();
create trigger builder_published_press_releases_reserved before insert or update of slug,snapshot on public.builder_published_entries
  for each row execute function builder_private.reserve_press_releases_route();
