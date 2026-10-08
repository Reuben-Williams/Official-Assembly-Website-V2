import { describe, expect, it, vi } from 'vitest';
import { runTeamNoticeWorker, readTeamNoticeMessageIds, reconcileVerifiedTeamNotice } from '../lib/team-notices/service';
const payload={from:'Office of Assemblywoman Carmen Morales <newsletter@updates.assemblywomanmorales.com>',to:['aswcmoralesteam@gmail.com'],subject:'New website submission — Morales Staff Portal',text:'fixed',html:'fixed',tags:[{name:'purpose',value:'website_team_notice'},{name:'policy',value:'website-team-notice-v1'},{name:'notice_correlation',value:crypto.randomUUID()}]};
const job={id:crypto.randomUUID(),fence:1,payload,idempotencyKey:'fixed-key',firstAttemptAt:null,retryDeadline:null};
describe('team notices service',()=>{
 it('only binds tagged verified events, using the endpoint scope and the email creation timestamp',async()=>{
  const rpc=vi.fn(async(_name:string,_args:unknown)=>({data:{matched:true},error:null}));
  const event={svixId:'receipt',type:'email.delivered',createdAt:'2026-10-08T12:00:00Z',data:{email_id:'staff-id',created_at:'2026-10-07T22:00:00Z',from:payload.from,to:payload.to,subject:payload.subject,tags:Object.fromEntries(payload.tags.map(t=>[t.name,t.value]))}};
  expect(await reconcileVerifiedTeamNotice({rpc} as never,'site','resend-team-production',event)).toBe(true);
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({p_input:{providerScope:'resend-team-production',emailCreatedAt:'2026-10-07T22:00:00Z',eventCreatedAt:'2026-10-08T12:00:00Z'}});
  rpc.mockClear();expect(await reconcileVerifiedTeamNotice({rpc} as never,'site','resend-team-production',{...event,data:{...event.data,tags:{purpose:'auth_login'}}})).toBe(false);expect(rpc).not.toHaveBeenCalled();
 });
 it('persists the attempt before sending the frozen payload and idempotency key',async()=>{
  const calls:string[]=[]; const rpc=vi.fn(async(_name,args)=>{calls.push(args.p_operation);return {data:args.p_operation==='claim'?[job]:args.p_operation==='begin'?{firstAttemptAt:new Date().toISOString(),retryDeadline:new Date(Date.now()+10000).toISOString()}:'recorded',error:null};});
  const send=vi.fn(async(p,o)=>{calls.push('send');expect(p).toEqual(payload);expect(o).toEqual({idempotencyKey:'fixed-key'});return {data:{id:'provider-id'},error:null};});
  await expect(runTeamNoticeWorker({client:{rpc} as never,siteId:'site',send,pace:async()=>{}})).resolves.toMatchObject({completed:1});expect(calls).toEqual(['claim','begin','send','finish']);
 });
 it('does not send after the deadline or when a signed webhook has already bound the ID',async()=>{
  const send=vi.fn();const rpc=vi.fn<(...args:any[])=>Promise<{error:null;data:unknown}>>(async(_n,args)=>({error:null,data:args.p_operation==='claim'?[{...job,retryDeadline:'2020-01-01'}]:null}));
  await runTeamNoticeWorker({client:{rpc} as never,siteId:'site',send,pace:async()=>{}});expect(send).not.toHaveBeenCalled();
  rpc.mockImplementation(async(_n,args)=>({error:null,data:args.p_operation==='claim'?[job]:null}));
  await runTeamNoticeWorker({client:{rpc} as never,siteId:'site',send,pace:async()=>{}});expect(send).not.toHaveBeenCalled();
 });
 it('retains an ambiguous provider outcome for identical retry, never logs or sends residents details',async()=>{
  const rpc=vi.fn(async(_n,args)=>({error:null,data:args.p_operation==='claim'?[job]:args.p_operation==='begin'?{firstAttemptAt:new Date().toISOString(),retryDeadline:new Date(Date.now()+10000).toISOString()}:'recorded'}));
  await runTeamNoticeWorker({client:{rpc} as never,siteId:'site',send:async()=>{throw new Error('ambiguous');},pace:async()=>{}});
  expect(rpc.mock.calls.at(-1)?.[1].p_input).toMatchObject({code:'retryable'});
 });
 it('loads only proven service-ledger IDs and fails closed on unavailable or malformed evidence',async()=>{
  const rpc=vi.fn(async()=>({data:['staff-id'],error:null}));expect([...await readTeamNoticeMessageIds({rpc} as never,'site')]).toEqual(['staff-id']);
  rpc.mockResolvedValue({data:[''],error:null});await expect(readTeamNoticeMessageIds({rpc} as never,'site')).rejects.toThrow('notice evidence unavailable');
 });
});
