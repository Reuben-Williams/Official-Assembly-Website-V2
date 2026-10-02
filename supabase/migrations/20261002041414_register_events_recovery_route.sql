-- Register the already-live Events page. Its unchanged fallback is published
-- through the normal audited content command under the verified owner session.
insert into public.builder_site_routes(site_id,path,label)
select id,'/events','Events' from public.builder_sites
where site_key='official-assembly-website-v2'
on conflict(site_id,path) do nothing;
