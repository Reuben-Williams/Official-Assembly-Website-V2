import {describe,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureEventsRecoveryBaseline} from '../lib/carousel/events-baseline';
const identity={siteId:'site',siteKey:'official-assembly-website-v2',userId:'owner',role:'owner' as const};
function client(published:unknown=null,draft:unknown=null,error:unknown=null){
 const rpc=vi.fn<(name:string,args:{p_command:Record<string,unknown>})=>Promise<{error:null,data:object}>>(async()=>({error:null,data:{}}));
 const from=vi.fn((table:string)=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='builder_published_pages'?published:draft,error})};return q;});
 return {db:{from,rpc} as unknown as SupabaseClient,rpc,from};
}
describe('missing Events recovery baseline',()=>{
 it('publishes only the unchanged Events fallback and retains an unrelated draft',async()=>{
  const c=client(null,{version_id:'draft',regions:{'events.hero.title':{type:'text',value:'Unpublished change'}}});
  await ensureEventsRecoveryBaseline(c.db,identity);
  const command=c.rpc.mock.calls[0][1].p_command;
  expect(command.actorId).toBe('owner');
  expect(command.scopes).toEqual([{scope:{kind:'page',path:'/events'},expectedDraftVersionId:'draft',expectedPublishedVersionId:null,values:{}}]);
  expect(command.operation).toBe('publish');
 });
 it('does not republish an existing version',async()=>{const c=client({version_id:'existing',regions:{}});await ensureEventsRecoveryBaseline(c.db,identity);expect(c.rpc).not.toHaveBeenCalled();});
 it('rejects a nonowner before database reads',async()=>{const c=client();await expect(ensureEventsRecoveryBaseline(c.db,{...identity,role:'editor'})).rejects.toThrow();expect(c.from).not.toHaveBeenCalled();});
 it('never overwrites unversioned published overrides',async()=>{const c=client({version_id:null,regions:{title:'keep'}});await expect(ensureEventsRecoveryBaseline(c.db,identity)).rejects.toThrow();expect(c.rpc).not.toHaveBeenCalled();});
 it('fails closed on read errors',async()=>{const c=client(null,null,{message:'offline'});await expect(ensureEventsRecoveryBaseline(c.db,identity)).rejects.toThrow();expect(c.rpc).not.toHaveBeenCalled();});
});
