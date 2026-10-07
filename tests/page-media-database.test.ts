import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const site='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', media='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',revision='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const actor='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const migration=readFileSync(new URL('../supabase/migrations/20261007233605_page_media_publish_reliability.sql',import.meta.url),'utf8');
const original=readFileSync(new URL('../supabase/migrations/20260807032126_official_assembly_editor_content_publishing_v2.sql',import.meta.url),'utf8');
const rpc=original.slice(original.indexOf('create or replace function public.builder_execute_content_command_v2'),original.indexOf('revoke all on function public.builder_execute_content_command_v2'));
let db:PGlite;
const photo=(src=`/api/builder/media/${revision}`)=>({'news.photo':{type:'image',src,alt:'Approved community photo',mediaId:media}});
async function command(operation:string,values:unknown,sourceVersionId?:string) {
  const draft=await db.query<{version_id:string|null}>(`select version_id from builder_draft_pages where path='/news'`);
  const published=await db.query<{version_id:string|null}>(`select version_id from builder_published_pages where path='/news'`);
  const id=crypto.randomUUID();
  return db.query<{result:any}>(`select builder_execute_content_command_v2('test-site',$1::jsonb) as result`,[JSON.stringify({schemaVersion:2,siteId:'test-site',actorId:actor,commandId:id,idempotencyKey:id,payloadDigest:'a'.repeat(64),operation,
    scopes:[{scope:{kind:'page',path:'/news'},expectedDraftVersionId:draft.rows[0]?.version_id ?? null,expectedPublishedVersionId:published.rows[0]?.version_id ?? null,values,sourceVersionId}]})]);
}
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema builder_private;
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'service_role')$$;
 create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
 create function builder_private.has_site_role(uuid,text[]) returns boolean language sql as $$select false$$;
 create table builder_sites(id uuid primary key,site_key text);
 create table builder_draft_pages(site_id uuid,path text,regions jsonb,version_id uuid,updated_at timestamptz,primary key(site_id,path));
 create table builder_published_pages(like builder_draft_pages including all);
 create table builder_site_routes(site_id uuid,path text);
 create table builder_versions(id uuid primary key default gen_random_uuid(),site_id uuid,page_path text,status text,snapshot jsonb,user_id text,parent_version_id uuid,source_version_id uuid,command_id uuid);
 create table builder_content_command_receipts(site_id uuid,idempotency_key text,command_id uuid,operation text,payload_digest text,actor_id uuid,response jsonb);
 create table builder_history_events_v1(site_id uuid,source text,source_event_id text,event_id text,category text,action text,workspace text,page_path text,target_id text,target_label text,actor_id uuid,actor_label text,parent_version_id uuid,source_version_id uuid,result_version_id uuid,change_summary jsonb,provenance jsonb);
 create table builder_site_generations(site_id uuid,generation_id bigint,command_id uuid,global_version_id uuid,page_versions jsonb);
 create table builder_content_recovery_jobs(site_id uuid,generation_id bigint,command_id uuid);
 create table builder_media_assets(site_id uuid,id uuid,archived_at timestamptz);
 create table builder_media_revisions(site_id uuid,media_id uuid,id uuid,object_key text,mime_type text,byte_size bigint);
 create table builder_media_recovery_replicas(site_id uuid,media_id uuid,revision_id uuid,status text);
 create table builder_page_version_media(site_id uuid,version_id uuid,region_id text,media_id uuid,revision_id uuid,alt text,primary key(site_id,version_id,region_id));
 insert into builder_sites values('${site}','test-site');
 insert into builder_site_routes values('${site}','/news');
 insert into builder_published_pages values('${site}','/__builder/global','{}',gen_random_uuid(),now()),('${site}','/news','{}',null,now());
 insert into builder_media_assets values('${site}','${media}',null);
 insert into builder_media_revisions values('${site}','${media}','${revision}','${site}/legacy/object.jpg','image/jpeg',100);
 insert into builder_media_recovery_replicas values('${site}','${media}','${revision}','ready');`);
 await db.exec(rpc);await db.exec(migration);
},30000);
afterAll(async()=>{await db?.close();});
describe('transactional page image publication',()=>{
 it('retains exact saved and published media references without publishing the draft',async()=>{
   await command('save',photo());
   expect((await db.query(`select regions from builder_published_pages where path='/news'`)).rows[0]).toEqual({regions:{}});
   expect((await db.query(`select revision_id from builder_page_version_media`)).rows).toEqual([{revision_id:revision}]);
   await command('publish',photo());
   expect((await db.query(`select regions from builder_published_pages where path='/news'`)).rows[0]).toEqual({regions:photo()});
   expect((await db.query(`select * from builder_content_recovery_jobs`)).rows).toHaveLength(1);
 });
 it('rejects a pending backup atomically',async()=>{
   const before=await db.query(`select count(*)::int as n from builder_versions`);
   await db.exec(`update builder_media_recovery_replicas set status='pending'`);
   await expect(command('publish',photo())).rejects.toThrow('PAGE_IMAGE_NOT_READY');
   expect((await db.query(`select count(*)::int as n from builder_versions`)).rows).toEqual(before.rows);
   await db.exec(`update builder_media_recovery_replicas set status='ready'`);
 });
 it('restores an expired legacy URL as a canonical revision without mutating its source history',async()=>{
   const id=crypto.randomUUID();const legacy=photo(`https://rriebibkxymeqhafssvw.supabase.co/storage/v1/object/sign/builder-media/${site}/legacy/object.jpg?token=expired`);
   await db.query(`insert into builder_versions(id,site_id,page_path,status,snapshot) values($1,$2,'/news','published',$3)`,[id,site,JSON.stringify({path:'/news',regions:legacy})]);
   await command('restore',{},id);
   expect((await db.query(`select regions from builder_published_pages where path='/news'`)).rows[0]).toEqual({regions:photo()});
   expect((await db.query(`select snapshot from builder_versions where id=$1`,[id])).rows[0]).toEqual({snapshot:{path:'/news',regions:legacy}});
 });
 it('rejects foreign storage URLs and non-member RPC calls',async()=>{
   await expect(command('save',photo('https://other.test/storage/v1/object/sign/builder-media/x'))).rejects.toThrow('PAGE_IMAGE_INVALID');
   await db.exec(`set test.role='authenticated'`);
   await expect(command('publish',photo())).rejects.toThrow('AUTH_REQUIRED');
   await db.exec(`set test.role='service_role'`);
 });
});
