begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_table('public','builder_carousels','carousel aggregate exists');
select has_table('public','builder_carousel_revisions','immutable revisions exist');
select has_table('public','builder_carousel_commands','idempotency receipts exist');
select has_column('public','builder_site_generations','carousel_revision_id','carousel belongs to existing recovery generation');
select ok(not has_table_privilege('anon','public.builder_carousel_revisions','SELECT'),'anonymous cannot read drafts');
select ok(not has_table_privilege('authenticated','public.builder_carousel_revisions','INSERT'),'browser cannot write revisions directly');
select ok(not has_function_privilege('authenticated','public.builder_carousel_command_v1(uuid,uuid,integer,jsonb)','EXECUTE'),'commands require verified server context');
select ok(not builder_private.carousel_document_valid('{}',false),'empty document rejected');
create function pg_temp.document() returns jsonb language sql as $$
select jsonb_build_object('schemaVersion',1,'key','home-community','defaults',jsonb_build_object('transition','none','seconds',7,'speed',700,'blend',null),
'entries',(select jsonb_agg(jsonb_build_object('id','photo-'||i,'media',jsonb_build_object('mediaId','10000000-0000-4000-8000-'||lpad(i::text,12,'0'),'revisionId','20000000-0000-4000-8000-'||lpad(i::text,12,'0')),
'en',jsonb_build_object('title','Photo','caption','Caption','alt','Description'),'es',jsonb_build_object('title','Foto','caption','Leyenda','alt','Descripción'),
'desktop',jsonb_build_object('fit','cover','x',50,'y',33),'mobile',null,'captionSafeMobile',false,'transition',null,'seconds',null,'blend',null,'zoom',false)) from generate_series(1,8) i));
$$;
select ok(builder_private.carousel_document_valid(pg_temp.document(),true),'complete bilingual document valid');
select ok(not builder_private.carousel_document_valid(pg_temp.document() || '{"unknown":true}',false),'unknown document field rejected');
select ok(not builder_private.carousel_document_valid(jsonb_set(pg_temp.document(),'{entries,0,desktop,x}','101'),false),'framing bounds enforced');
select ok(not builder_private.carousel_document_valid(jsonb_set(pg_temp.document(),'{entries,1,id}','"photo-1"'),false),'duplicate identities rejected');
select ok(builder_private.carousel_document_valid(jsonb_set(pg_temp.document(),'{entries,0,es,alt}','""'),false),'incomplete draft can be saved');
select ok(not builder_private.carousel_document_valid(jsonb_set(pg_temp.document(),'{entries,0,es,alt}','""'),true),'incomplete accessibility text cannot publish');
select ok(not builder_private.carousel_document_valid(jsonb_set(pg_temp.document(),'{entries,0,es,title}','""'),true),'unpaired title cannot publish');
select ok(not builder_private.carousel_document_valid(jsonb_set(pg_temp.document(),'{entries,0,blend}','{"top":76,"bottom":60}'),true),'blend bounds enforced');
select ok(not builder_private.carousel_document_valid(jsonb_set(pg_temp.document(),'{defaults,seconds}','6'),false),'unsupported timing rejected');
select ok(not builder_private.carousel_document_valid(jsonb_set(pg_temp.document(),'{key}','null'),false),'null key rejected');
select ok(not builder_private.carousel_document_valid(jsonb_set(pg_temp.document(),'{entries,0,desktop,fit}','null'),false),'null image fit rejected');
insert into auth.users(id,aud,role,email,created_at,updated_at) select ('81000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','carousel-'||i||'@example.test',now(),now() from generate_series(1,4) i;
insert into public.builder_sites(id,site_key,display_name) values ('80000000-0000-4000-8000-000000000001','carousel-local-test','Carousel Local Test'),('80000000-0000-4000-8000-000000000002','carousel-other-test','Other Test');
insert into public.builder_site_members(site_id,user_id,role) select '80000000-0000-4000-8000-000000000001',('81000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,(array['owner','editor','contributor','viewer'])[i] from generate_series(1,4) i;
insert into public.builder_media_assets(site_id,id,label,alt_text,created_by) select '80000000-0000-4000-8000-000000000001',('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Test photo','Local test image','81000000-0000-4000-8000-000000000001' from generate_series(1,8) i;
insert into public.builder_media_identities(site_id,sha256,media_id,byte_size,mime_type,width,height,created_by) select '80000000-0000-4000-8000-000000000001',lpad(i::text,64,'a'),('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,12,'image/webp',1600,900,'81000000-0000-4000-8000-000000000001' from generate_series(1,8) i;
insert into public.builder_media_revisions(site_id,media_id,id,object_key,mime_type,byte_size,width,height,created_by,sha256) select '80000000-0000-4000-8000-000000000001',('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'carousel-test/'||i||'.webp','image/webp',12,1600,900,'81000000-0000-4000-8000-000000000001',lpad(i::text,64,'a') from generate_series(1,8) i;
savepoint baseline_stage;
set local role service_role;
select throws_ok($$select public.builder_stage_carousel_baseline_v1('80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002',1,'82000000-0000-4000-8000-000000000099',pg_temp.document())$$,'42501','CAROUSEL_FORBIDDEN','editor cannot initialize the site baseline');
select lives_ok($$select public.builder_stage_carousel_baseline_v1('80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',1,'82000000-0000-4000-8000-000000000099',pg_temp.document())$$,'owner can stage the immutable baseline');
select is((select count(*)::integer from public.builder_carousels),0,'staging does not publish or enable authoring');
select lives_ok($$select public.builder_stage_carousel_baseline_v1('80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',1,'82000000-0000-4000-8000-000000000099',pg_temp.document())$$,'staging is idempotent');
select throws_ok($$select public.builder_stage_carousel_baseline_v1('80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',0,'82000000-0000-4000-8000-000000000099',pg_temp.document())$$,'42501','CAROUSEL_FORBIDDEN','revocation blocks initialization retry');
reset role;
-- Retain pgTAP's assertions while reverting the isolated candidate via the test transaction later.
insert into public.builder_carousel_revisions(site_id,id,document) values ('80000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',pg_temp.document());
insert into public.builder_carousels(site_id,draft_revision_id,published_revision_id,enabled) values ('80000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',true);
create function pg_temp.command(action text default 'save',command_number integer default 1,expected integer default 1) returns jsonb language sql as $$select jsonb_build_object('action',action,'commandId','83000000-0000-4000-8000-'||lpad(command_number::text,12,'0'),'digest',repeat('a',64),'expectedVersion',expected,'expectedPublishedId','82000000-0000-4000-8000-000000000001','document',pg_temp.document())$$;
create function pg_temp.run(actor integer,command jsonb,generation integer default 1,site_id uuid default '80000000-0000-4000-8000-000000000001') returns jsonb language sql as $$select public.builder_carousel_command_v1(site_id,('81000000-0000-4000-8000-'||lpad(actor::text,12,'0'))::uuid,generation,command)$$;
set local role service_role;
select throws_ok($$select pg_temp.run(4,pg_temp.command())$$,'42501','CAROUSEL_FORBIDDEN','viewer cannot save');
select throws_ok($$select pg_temp.run(2,pg_temp.command(),0)$$,'42501','CAROUSEL_FORBIDDEN','revoked session cannot save');
select throws_ok($$select pg_temp.run(2,pg_temp.command(),1,'80000000-0000-4000-8000-000000000002')$$,'42501','CAROUSEL_FORBIDDEN','membership does not cross sites');
select throws_ok($$select pg_temp.run(3,pg_temp.command('publish'))$$,'42501','CAROUSEL_FORBIDDEN','contributor cannot publish');
select lives_ok($$select pg_temp.run(3,pg_temp.command())$$,'contributor can save a draft');
select is((select version from public.builder_carousels where site_id='80000000-0000-4000-8000-000000000001'),2,'save increments optimistic version');
select lives_ok($$select pg_temp.run(3,pg_temp.command())$$,'exact retry returns the same receipt');
select is((select count(*)::integer from public.builder_carousel_revisions),3,'retry does not create another revision');
select throws_ok($$select pg_temp.run(2,pg_temp.command())$$,'40001','CAROUSEL_IDEMPOTENCY_CONFLICT','other actor cannot reuse a receipt');
select throws_ok($$select pg_temp.run(3,pg_temp.command()||jsonb_build_object('digest',repeat('b',64)))$$,'40001','CAROUSEL_IDEMPOTENCY_CONFLICT','different payload cannot reuse a receipt');
select throws_ok($$select pg_temp.run(2,pg_temp.command('save',2,1))$$,'40001','CAROUSEL_STALE','stale save cannot overwrite');
select throws_ok($$select pg_temp.run(2,pg_temp.command('publish',3,2)||jsonb_build_object('revisionId',(select draft_revision_id from public.builder_carousels limit 1)))$$,'55000','CAROUSEL_MEDIA_NOT_READY','unverified backups block publication');
select is((select published_revision_id::text from public.builder_carousels limit 1),'82000000-0000-4000-8000-000000000001','blocked publication retains original live revision');
select is((select count(*)::integer from public.builder_carousel_revision_media),24,'every immutable revision retains eight image revisions');
reset role;
update public.builder_media_recovery_replicas r set status='ready',content_digest=lpad(right(r.revision_id::text,1),64,'a'),byte_size=12,mime_type='image/webp',object_path='test/ready.webp',verified_at=now() where site_id='80000000-0000-4000-8000-000000000001';
insert into public.builder_site_routes(site_id,path,label) values('80000000-0000-4000-8000-000000000001','/','Home');
insert into public.builder_versions(id,site_id,page_path,status,snapshot,user_id) values
('84000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','/__builder/global','published','{"path":"/__builder/global","regions":{}}','bootstrap'),
('84000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','/','published','{"path":"/","regions":{}}','bootstrap');
insert into public.builder_published_pages(site_id,path,regions,version_id) values
('80000000-0000-4000-8000-000000000001','/__builder/global','{}','84000000-0000-4000-8000-000000000001'),
('80000000-0000-4000-8000-000000000001','/','{}','84000000-0000-4000-8000-000000000002');
create function pg_temp.publish_command() returns jsonb language sql as $$select pg_temp.command('publish',4,2)||jsonb_build_object('revisionId',(select draft_revision_id from public.builder_carousels limit 1),'prepared',jsonb_build_object('manifestDigest',repeat('b',64),'manifestPath','test/manifest.json','baseGeneration',0,'generationId',1,'globalVersionId','84000000-0000-4000-8000-000000000001','pageVersions',jsonb_build_object('/','84000000-0000-4000-8000-000000000002'),'createdAt',now()))$$;
set local role service_role;
select throws_ok($$select pg_temp.run(2,pg_temp.command('publish',4,2)||jsonb_build_object('revisionId',(select draft_revision_id from public.builder_carousels limit 1)))$$,'40001','CAROUSEL_PREPARATION_STALE','missing full generation preparation blocks publication');
select throws_ok($$select pg_temp.run(2,jsonb_set(pg_temp.publish_command(),'{prepared,pageVersions}','{}'))$$,'40001','CAROUSEL_PREPARATION_STALE','changed page versions invalidate prepared backup');
select lives_ok($$select pg_temp.run(2,pg_temp.publish_command())$$,'editor can publish an exact prepared revision');
select is((select carousel_revision_id from public.builder_site_generations limit 1),(select published_revision_id from public.builder_carousels limit 1),'generation captures exact published carousel');
select is((select count(*)::integer from public.builder_content_recovery_jobs),1,'publication durably queues recovery pointer repair');
select is((select count(*)::integer from public.builder_carousel_audit where action='publish'),1,'publication is audited once');
select lives_ok($$select pg_temp.run(2,pg_temp.command('restore',5,3)||jsonb_build_object('expectedPublishedId',(select published_revision_id from public.builder_carousels limit 1),'revisionId','82000000-0000-4000-8000-000000000001'))$$,'restore creates a new draft');
select isnt((select draft_revision_id from public.builder_carousels limit 1),(select published_revision_id from public.builder_carousels limit 1),'restore leaves published revision untouched');
reset role;
insert into public.builder_site_generations(site_id,generation_id,command_id,global_version_id,page_versions) values('80000000-0000-4000-8000-000000000001',2,'85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','{"/":"84000000-0000-4000-8000-000000000002"}');
select is((select carousel_revision_id from public.builder_site_generations where generation_id=2),(select published_revision_id from public.builder_carousels limit 1),'unrelated future publication retains the published carousel, not its restored draft');
select throws_ok($$update public.builder_carousel_revisions set document=pg_temp.document()$$,'55000',null,'revisions cannot be overwritten');
-- Simulate first activation using only disposable rows in this rolled-back test database.
delete from public.builder_carousels where site_id='80000000-0000-4000-8000-000000000001';
create function pg_temp.bootstrap_command() returns jsonb language sql as $$select pg_temp.publish_command() || jsonb_build_object('action','bootstrap','expectedVersion',0,'expectedPublishedId',null,'commandId','82000000-0000-4000-8000-000000000099','document',pg_temp.document(),'prepared',(pg_temp.publish_command()->'prepared')||'{"baseGeneration":2,"generationId":3}'::jsonb)$$;
set local role service_role;
select throws_ok($$select pg_temp.run(2,pg_temp.bootstrap_command())$$,'42501','CAROUSEL_FORBIDDEN','editor cannot activate the initial baseline');
select throws_ok($$select pg_temp.run(1,jsonb_set(pg_temp.bootstrap_command(),'{prepared,pageVersions}','{}'))$$,'40001','CAROUSEL_PREPARATION_STALE','baseline activation requires a complete current generation');
select is((select count(*)::integer from public.builder_carousels),0,'failed initial preparation keeps authoring disabled');
select lives_ok($$select pg_temp.run(1,pg_temp.bootstrap_command())$$,'owner activates a verified baseline atomically');
select is((select published_revision_id::text from public.builder_carousels),'82000000-0000-4000-8000-000000000099','baseline activation selects only the staged immutable revision');
select is((select carousel_revision_id::text from public.builder_site_generations where generation_id=3),'82000000-0000-4000-8000-000000000099','baseline activation captures the same recovery revision');
select lives_ok($$select pg_temp.run(1,pg_temp.bootstrap_command())$$,'baseline activation retry is idempotent');
select is((select count(*)::integer from public.builder_carousel_audit where action='bootstrap'),1,'initialization is audited only once');
reset role;
select * from finish();
rollback;
