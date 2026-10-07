import type { AttachedSiteEditorClient } from '@reuben-williams/editor';
type Scope={regions:Readonly<Record<string,unknown>>;versionId?:string|null};
export type PagePublicationStatus={state:'draft'|'published';sharedPending:boolean};
function stable(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if(value && typeof value==='object') return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function readPagePublicationStatus(path:string,read:(path:string,mode:'draft'|'published')=>Promise<Scope>):Promise<PagePublicationStatus> {
  const [sharedDraft,sharedPublished,draft,published]=await Promise.all([
    read('/__builder/global','draft'),read('/__builder/global','published'),read(path,'draft'),read(path,'published'),
  ]);
  const pending=(draft:Scope,published:Scope)=>Boolean(draft.versionId) && stable(draft.regions)!==stable(published.regions);
  const sharedPending=pending(sharedDraft,sharedPublished);
  return {state:sharedPending || pending(draft,published)?'draft':'published',sharedPending};
}
export type PublicationFeedback={path:string;action:'save'|'publish';ok:boolean;message?:string};
const SAFE_CODES=new Set(['PROTECTED_IMAGE_INVALID','PAGE_IMAGE_INVALID','PAGE_IMAGE_ALT_REQUIRED','PAGE_IMAGE_NOT_READY','STALE_REVISION','CONTENT_COMMAND_DENIED']);
export function withPublicationFeedback<T extends Pick<AttachedSiteEditorClient,'saveDraft'|'publish'>>(client:T,callback:(result:PublicationFeedback)=>void):T {
  async function run(path:string,action:'save'|'publish',call:()=>Promise<unknown>) {
    try {const value=await call();callback({path,action,ok:true});return value;}
    catch(error){
      const safe=error instanceof Error && 'code' in error && SAFE_CODES.has(String(error.code));
      callback({path,action,ok:false,message:safe?error.message:'The change could not be confirmed. Refresh and try again; your saved draft is preserved.'});throw error;
    }
  }
  return {...client,saveDraft:input=>run(input.pagePath,'save',()=>client.saveDraft(input)),publish:path=>run(path,'publish',()=>client.publish(path))};
}
