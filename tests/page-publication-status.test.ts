import { describe,it,expect,vi } from 'vitest';
import { readPagePublicationStatus, withPublicationFeedback } from '../lib/builder/page-publication-status';
const scope=(regions:Record<string,unknown>,versionId:string|null='version')=>({regions,versionId});
describe('saved server publication status',()=>{
 it('compares values, not different draft and publish version IDs',async()=>{
  const read=vi.fn(async(_path:string,mode:string)=>scope({'photo':{type:'image',src:'/same.jpg',alt:'Photo'}},mode));
  expect(await readPagePublicationStatus('/news',read)).toEqual({state:'published',sharedPending:false});
 });
 it('shows pending shared changes even while the page itself is unchanged',async()=>{
  const read=async(path:string,mode:string)=>scope({'title':{type:'text',value:path==='/__builder/global' && mode==='draft'?'New':'Old'}});
  expect(await readPagePublicationStatus('/news',read)).toEqual({state:'draft',sharedPending:true});
 });
 it('does not treat a nonexistent draft as unpublished changes',async()=>{
  const read=async(_path:string,mode:string)=>mode==='draft'?scope({},null):scope({'text':{type:'text',value:'Live'}});
  expect((await readPagePublicationStatus('/news',read)).state).toBe('published');
 });
 it('fails closed when status cannot be read',async()=>{
  await expect(readPagePublicationStatus('/news',async()=>{throw new Error('offline');})).rejects.toThrow('offline');
 });
 it('reports successful saved/published actions and failed publication without retrying writes',async()=>{
  const onResult=vi.fn();const raw={saveDraft:vi.fn(async(_input:{pagePath:string;regionId:string;value:unknown})=>1),publish:vi.fn(async(_path:string)=>{throw Object.assign(new Error('Keep the approved single-person portrait for the homepage. Other photos can be changed separately.'),{code:'PROTECTED_IMAGE_INVALID'});})};
  const client=withPublicationFeedback(raw,onResult);
  expect(await client.saveDraft({pagePath:'/news',regionId:'title',value:{type:'text',value:'News'}})).toBe(1);
  await expect(client.publish('/news')).rejects.toThrow('approved');
  expect(onResult.mock.calls.map(call=>call[0])).toEqual([
   {path:'/news',action:'save',ok:true},{path:'/news',action:'publish',ok:false,message:expect.stringContaining('approved')},
  ]);expect(raw.publish).toHaveBeenCalledTimes(1);
 });
});
