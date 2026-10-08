import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),send:vi.fn()}));
vi.mock('../lib/newsletter/operations-route',()=>({authorizeNewsletterOperation:f.auth,newsletterOperationBody:async(r:Request)=>r.json(),newsletterOperationCommandId:(v:string)=>v,newsletterOperationError:()=>Response.json({error:'denied'},{status:403})}));
vi.mock('../lib/supabase/admin',()=>({getBuilderAdminClient:()=>({rpc:f.rpc}),resolveBuilderSiteId:async()=> 'site'}));
vi.mock('../lib/newsletter/config',()=>({readNewsletterConfiguration:()=>({status:'ready'})}));
vi.mock('resend',()=>({Resend:class{emails={send:f.send};}}));
import {GET,POST} from '../app/api/team-notices/status/route';
import {GET as cron} from '../app/api/team-notices/jobs/run/route';
beforeEach(()=>{f.auth.mockReset();f.rpc.mockReset();f.send.mockReset();});
describe('team notice private routes',()=>{
 it('enforces owner authorization before every status read or investigation',async()=>{
  f.auth.mockRejectedValue(new Error('denied'));
  expect((await GET(new Request('https://test/api/team-notices/status'))).status).toBe(403);
  expect((await POST(new Request('https://test/api/team-notices/status',{method:'POST',body:'{}'}))).status).toBe(403);
  expect(f.rpc).not.toHaveBeenCalled();expect(f.auth.mock.calls.map(v=>v.slice(1))).toEqual([[false,true],[true,true]]);
 });
 it('returns counts only and records an investigation without any provider send',async()=>{
  f.auth.mockResolvedValue({siteId:'site',userId:'owner'});f.rpc.mockResolvedValue({data:{pending:1},error:null});
  const response=await GET(new Request('https://test/api/team-notices/status'));expect(await response.json()).toEqual({pending:1});
  await POST(new Request('https://test/api/team-notices/status',{method:'POST',body:JSON.stringify({jobId:'job'})}));
  expect(f.rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_operation:'investigate',p_input:{actorId:'owner',jobId:'job'}});expect(f.send).not.toHaveBeenCalled();
 });
 it('rejects unauthenticated cron requests before touching the queue or provider',async()=>{
  vi.stubEnv('CRON_SECRET','test-secret');
  expect((await cron(new Request('https://test/api/team-notices/jobs/run'))).status).toBe(401);
  expect(f.rpc).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();vi.unstubAllEnvs();
 });
});
