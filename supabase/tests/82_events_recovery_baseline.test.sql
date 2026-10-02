begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values('91100000-0000-4000-8000-000000000001','isolated-events@example.test');
insert into public.builder_sites(id,site_key,display_name) values('91000000-0000-4000-8000-000000000001','isolated-events-baseline','Isolated Events baseline');
insert into public.builder_site_members(site_id,user_id,role) values('91000000-0000-4000-8000-000000000001','91100000-0000-4000-8000-000000000001','owner');
insert into public.builder_site_routes(site_id,path,label) values('91000000-0000-4000-8000-000000000001','/','Home'),('91000000-0000-4000-8000-000000000001','/events','Events');
insert into public.builder_versions(id,site_id,page_path,status,snapshot,user_id) values
('91200000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','/__builder/global','published','{"regions":{"global.title":{"type":"text","value":"Keep published"}}}','91100000-0000-4000-8000-000000000001'),
('91200000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','/','published','{"regions":{}}','91100000-0000-4000-8000-000000000001');
insert into public.builder_published_pages(site_id,path,version_id,regions) select site_id,page_path,id,snapshot->'regions' from public.builder_versions where site_id='91000000-0000-4000-8000-000000000001';
insert into public.builder_draft_pages(site_id,path,regions) values('91000000-0000-4000-8000-000000000001','/events','{"events.hero.title":{"type":"text","value":"Keep private draft"}}');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.builder_execute_content_command_v2('isolated-events-baseline',jsonb_build_object('schemaVersion',2,'siteId','isolated-events-baseline','actorId','91100000-0000-4000-8000-000000000001','commandId','91300000-0000-4000-8000-000000000001','idempotencyKey','isolated-events-baseline','payloadDigest',repeat('a',64),'operation','publish','scopes','[{"scope":{"kind":"page","path":"/events"},"expectedDraftVersionId":null,"expectedPublishedVersionId":null,"values":{}}]'::jsonb))$$,'normal content command can publish the unchanged Events fallback');
select is((select regions#>>'{events.hero.title,value}' from public.builder_draft_pages where site_id='91000000-0000-4000-8000-000000000001' and path='/events'),'Keep private draft','unpublished draft is preserved');
select is((select version_id from public.builder_published_pages where site_id='91000000-0000-4000-8000-000000000001' and path='/__builder/global'),'91200000-0000-4000-8000-000000000001'::uuid,'global published version is untouched');
select is((select count(*)::integer from public.builder_site_generations g cross join lateral jsonb_object_keys(g.page_versions) where g.site_id='91000000-0000-4000-8000-000000000001'),2,'generation contains both routes');
select is((select count(*)::integer from public.builder_history_events_v1 where site_id='91000000-0000-4000-8000-000000000001'),1,'baseline creates an audited publication');
select * from finish();
rollback;
