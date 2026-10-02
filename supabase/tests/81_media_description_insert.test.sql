begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values ('81100000-0000-4000-8000-000000000001','isolated-media@example.test');
insert into public.builder_sites(id,site_key,display_name) values('81000000-0000-4000-8000-000000000001','isolated-media-description','Isolated media description');
insert into public.builder_site_members(site_id,user_id,role) values('81000000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001','owner');
insert into public.builder_media_upload_plans(site_id,id,mode,status,source_name,object_key,claimed_mime_type,claimed_byte_size,claimed_width,claimed_height,expected_sha256,idempotency_key,request_fingerprint,expires_at,capability_expires_at,object_uploaded_at,created_by,requested_label,requested_alt)
values('81000000-0000-4000-8000-000000000001','81200000-0000-4000-8000-000000000001','single','uploaded','photo.jpg','isolated-media-description/photo.jpg','image/jpeg',20,2,2,repeat('d',64),'isolated-description-plan',repeat('a',64),now()+interval '1 hour',now()+interval '30 minutes',now(),'81100000-0000-4000-8000-000000000001','Approved photo','Approved accessible description');
select lives_ok($$select public.builder_claim_media_identity_v2('81000000-0000-4000-8000-000000000001','81200000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001',repeat('d',64),'image/jpeg',20::bigint,2,2)$$,'new media is inserted with its required description atomically');
select is((select alt_text from public.builder_media_assets where site_id='81000000-0000-4000-8000-000000000001'),'Approved accessible description','description is preserved');
select is((select label from public.builder_media_assets where site_id='81000000-0000-4000-8000-000000000001'),'Approved photo','label is preserved');
select is((select count(*)::int from public.builder_media_recovery_replicas where site_id='81000000-0000-4000-8000-000000000001'),1,'new media still queues a recovery replica');
select * from finish();
rollback;
