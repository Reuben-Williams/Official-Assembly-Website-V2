import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
const site='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', worker=crypto.randomUUID();
let db:PGlite;
async function rpc(op:string,input:Record<string,unknown>={}) {
 const r=await db.query<{v:any}>(`select builder_team_notices_v1($1,$2,$3::jsonb) v`,[site,op,JSON.stringify(input)]); return r.rows[0].v;
}
async function addSubmission(options:{old?:boolean;test?:boolean;template?:string}={}) {
 const id=crypto.randomUUID(), q=crypto.randomUUID();
 await db.query(`insert into builder_form_submissions values($1,$2,'public_form',$3,$4,clock_timestamp())`,[site,id,options.template ?? 'local-business.newsletter-signup',options.old?'2020-01-01':new Date(Date.now()+1000).toISOString()]);
 await db.query(`insert into builder_private.builder_form_notification_queue values($1,$2,$3,'form.submission.accepted',$4,'pending')`,[site,q,id,options.old?'2020-01-01':new Date(Date.now()+1000).toISOString()]);
 if(options.test) await rpc('mark_test',{submissionId:id}); return {id,q};
}
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role;create schema auth;create schema builder_private;
 create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'service_role')$$;
 create table builder_sites(id uuid primary key);insert into builder_sites values('${site}'),('${other}');
 create table builder_form_submissions(site_id uuid,id uuid,source text,template_id text,received_at timestamptz,created_at timestamptz,primary key(site_id,id));
 create table builder_private.builder_form_notification_queue(site_id uuid,id uuid,submission_id uuid,event_type text,created_at timestamptz,state text,primary key(site_id,id));
 create table builder_staff_auth_delivery_evidence(site_id uuid,provider_message_id text);
 create table builder_newsletter_auth_login_evidence(site_id uuid,provider_message_id text);`);
 const migration=readFileSync(new URL('../supabase/migrations/20261008021107_website_team_notices.sql',import.meta.url),'utf8'); await db.exec(migration);
},30000);
afterAll(async()=>{await db?.close();});
describe('private team notice delivery ledger',()=>{
 it('retains activation cutoff/epoch on disable and re-enable, excluding historic/test/survey submissions',async()=>{
  const first=await rpc('activation',{enabled:true}); await rpc('activation',{enabled:false}); const again=await rpc('activation',{enabled:true});
  expect(again.cutoff).toBe(first.cutoff); expect(again.epoch).toBe(first.epoch);
  await addSubmission({old:true});await addSubmission({test:true});await addSubmission({template:'local-business.survey'});await addSubmission();
  const jobs=await rpc('claim',{workerId:worker}); expect(jobs).toHaveLength(1);
  expect(jobs[0].payload.to).toEqual(['aswcmoralesteam@gmail.com']);expect(JSON.stringify(jobs[0].payload)).not.toContain('submissionId');
  expect(jobs[0].payload.tags).toContainEqual({name:'purpose',value:'website_team_notice'});
  await rpc('begin',{jobId:jobs[0].id,workerId:worker,fence:jobs[0].fence});
  await rpc('finish',{jobId:jobs[0].id,workerId:worker,fence:jobs[0].fence,providerMessageId:'first-id'});
 });
 it('serializes claims, freezes content, persists first attempt, rejects stale workers and cross-site changes',async()=>{
  await db.exec(`update builder_private.builder_team_notice_activation set worker_until=null`); await addSubmission();
  const [job]=await rpc('claim',{workerId:worker});expect(job.firstAttemptAt).toBeNull();
  expect(await rpc('claim',{workerId:crypto.randomUUID()})).toEqual([]);
  await expect(rpc('begin',{jobId:job.id,workerId:crypto.randomUUID(),fence:job.fence})).rejects.toThrow('STALE_NOTICE_LEASE');
  const attempt=await rpc('begin',{jobId:job.id,workerId:worker,fence:job.fence});expect(attempt.firstAttemptAt).toBeTruthy();
  const scope=await db.query<{v:any}>(`select builder_team_notices_v1($1,'begin',$2::jsonb) v`,[other,JSON.stringify({jobId:job.id,workerId:worker,fence:job.fence})]);expect(scope.rows[0].v).toBeNull();
  await rpc('finish',{jobId:job.id,workerId:worker,fence:job.fence,code:'retryable'});
  await db.exec(`update builder_private.builder_team_notice_activation set worker_until=null;update builder_private.builder_team_notice_deliveries set next_attempt_at=clock_timestamp() where id='${job.id}'`);
  const [retry]=await rpc('claim',{workerId:worker});expect(retry.payload).toEqual(job.payload);expect(retry.idempotencyKey).toBe(job.idempotencyKey);expect(retry.firstAttemptAt).toBe(attempt.firstAttemptAt);
  await expect(rpc('finish',{jobId:job.id,workerId:worker,fence:job.fence,providerMessageId:'stale'})).rejects.toThrow('STALE_NOTICE_LEASE');
  await rpc('finish',{jobId:retry.id,workerId:worker,fence:retry.fence,providerMessageId:'retry-id'});
 });
 it('binds signed receipts before worker completion, rejects mismatches/conflicts and never downgrades terminal delivery',async()=>{
  await db.exec(`update builder_private.builder_team_notice_activation set worker_until=null`);await addSubmission();
  const [job]=await rpc('claim',{workerId:worker}); const attempt=await rpc('begin',{jobId:job.id,workerId:worker,fence:job.fence});
  const event={providerScope:'resend-team-production',emailId:'early-id',eventType:'email.delivered',emailCreatedAt:attempt.firstAttemptAt,eventCreatedAt:new Date().toISOString(),svixId:'receipt-1',from:job.payload.from,to:job.payload.to,subject:job.payload.subject,tags:Object.fromEntries(job.payload.tags.map((t:any)=>[t.name,t.value]))};
  expect(await rpc('receipt',{...event,tags:{...event.tags,notice_correlation:crypto.randomUUID()}})).toEqual({matched:false});
  expect(await rpc('receipt',{...event,to:[...event.to,'extra@example.test']})).toEqual({matched:false});
  expect(await rpc('receipt',{...event,providerScope:'foreign'})).toEqual({matched:false});
  expect(await rpc('receipt',event)).toMatchObject({matched:true});expect(await rpc('receipt',event)).toMatchObject({matched:true});
  expect(await rpc('receipt',{...event,svixId:'receipt-2',eventType:'email.sent'})).toMatchObject({matched:true});
  expect(await rpc('finish',{jobId:job.id,workerId:worker,fence:job.fence,providerMessageId:'early-id'})).toBe('recorded');
  expect((await db.query<{state:string}>(`select outcome state from builder_private.builder_team_notice_deliveries where id=$1`,[job.id])).rows[0].state).toBe('delivered');
  expect(await rpc('receipt',{...event,svixId:'conflicting',emailId:'other-id'})).toEqual({matched:false,review:true});
  expect((await rpc('message_ids',{offset:0}))).toContain('early-id');expect((await rpc('message_ids',{offset:0}))).not.toContain('other-id');
  await expect(db.query(`insert into builder_staff_auth_delivery_evidence values($1,'early-id')`,[site])).rejects.toThrow('NOTICE_AUTH_EVIDENCE_CONFLICT');
  await expect(db.query(`insert into builder_newsletter_auth_login_evidence values($1,'early-id')`,[site])).rejects.toThrow('NOTICE_AUTH_EVIDENCE_CONFLICT');
 });
 it('stops expired ambiguous sends and leaves existing notification projection unchanged',async()=>{
  await db.exec(`update builder_private.builder_team_notice_activation set worker_until=null`);await addSubmission();const [job]=await rpc('claim',{workerId:worker});await rpc('begin',{jobId:job.id,workerId:worker,fence:job.fence});
  await db.exec(`update builder_private.builder_team_notice_deliveries set first_attempt_at=clock_timestamp()-interval '24 hours',retry_deadline=clock_timestamp()-interval '1 hour',lease_until=null where id='${job.id}';update builder_private.builder_team_notice_activation set worker_until=null`);
  expect(await rpc('claim',{workerId:worker})).toEqual([]);const status=await rpc('status');expect(status.reviewRequired).toBeGreaterThan(0);
  expect((await db.query<{n:number}>(`select count(*)::int n from builder_private.builder_form_notification_queue where state!='pending'`)).rows[0].n).toBe(0);
 });
 it('denies all browser roles and table reads; service RPC grants only',async()=>{
  for(const role of ['anon','authenticated']) { await db.exec(`set test.role='${role}'`);await expect(rpc('activation',{enabled:true})).rejects.toThrow('NOTICE_SERVICE_ONLY'); }
  await db.exec(`set test.role='service_role'`);
  const grants=await db.query<{role:string;allowed:boolean}>(`select r role,has_function_privilege(r,'builder_team_notices_v1(uuid,text,jsonb)','execute') allowed from unnest(array['anon','authenticated','service_role']) r`);
  expect(grants.rows).toEqual([{role:'anon',allowed:false},{role:'authenticated',allowed:false},{role:'service_role',allowed:true}]);
 });
 it('permits privacy cleanup while retaining payload-free provider accounting',async()=>{
  await db.exec(`delete from builder_private.builder_form_notification_queue`);
  expect((await rpc('message_ids',{offset:0}))).toContain('early-id');
  expect((await db.query<{n:number}>(`select count(*)::int n from builder_private.builder_team_notice_deliveries where queue_id is not null`)).rows[0].n).toBe(0);
 });
 it('recovers an accepted-send process crash through an identical retry and a later signed receipt after lease loss',async()=>{
  await db.exec(`update builder_private.builder_team_notice_activation set worker_until=null`);await addSubmission();
  const [job]=await rpc('claim',{workerId:worker});const attempt=await rpc('begin',{jobId:job.id,workerId:worker,fence:job.fence});
  // Provider accepts, process dies before finish. No ID is recorded yet.
  await db.exec(`update builder_private.builder_team_notice_deliveries set lease_until=null where id='${job.id}';update builder_private.builder_team_notice_activation set worker_until=null`);
  const newWorker=crypto.randomUUID();const [retry]=await rpc('claim',{workerId:newWorker});
  expect(retry.payload).toEqual(job.payload);expect(retry.idempotencyKey).toBe(job.idempotencyKey);expect(retry.firstAttemptAt).toBe(attempt.firstAttemptAt);
  const event={providerScope:'resend-team-production',emailId:'crash-recovered',eventType:'email.delivered',emailCreatedAt:attempt.firstAttemptAt,eventCreatedAt:new Date(Date.now()+3600000).toISOString(),svixId:'crash-receipt',from:job.payload.from,to:job.payload.to,subject:job.payload.subject,tags:Object.fromEntries(job.payload.tags.map((t:any)=>[t.name,t.value]))};
  expect(await rpc('receipt',{...event,from:'another sender'})).toEqual({matched:false});
  expect(await rpc('receipt',{...event,emailCreatedAt:'2020-01-01'})).toEqual({matched:false});
  expect(await rpc('receipt',event)).toEqual({matched:true});
  await expect(rpc('finish',{jobId:job.id,workerId:worker,fence:job.fence,providerMessageId:'crash-recovered'})).rejects.toThrow('STALE_NOTICE_LEASE');
  expect(await rpc('begin',{jobId:retry.id,workerId:newWorker,fence:retry.fence})).toBeNull();
 });
});
