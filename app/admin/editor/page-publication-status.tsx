'use client';
import { editorFetch } from '../../../lib/builder/editor-fetch';
import { useEffect,useState } from 'react';
import type { PagePublicationStatus,PublicationFeedback } from '../../../lib/builder/page-publication-status';
export function PagePublicationStatusPanel({path,revision,result}:{path:string;revision:number;result:PublicationFeedback|null}) {
  const [status,setStatus]=useState<{path:string;value:PagePublicationStatus|null;loading:boolean}>({path,value:null,loading:true});
  useEffect(()=>{
    const abort=new AbortController();
    void editorFetch(`/api/builder?resource=publication-status&path=${encodeURIComponent(path)}`,{credentials:'same-origin',cache:'no-store',signal:abort.signal})
      .then(async response=>{if(!response.ok) throw new Error('unavailable');return response.json() as Promise<PagePublicationStatus>;})
      .then(value=>{if(!abort.signal.aborted)setStatus({path,value,loading:false});})
      .catch(()=>{if(!abort.signal.aborted)setStatus({path,value:null,loading:false});});
    return ()=>abort.abort();
  },[path,revision]);
  const current=status.path===path ? status : {path,value:null,loading:true};
  const label=current.loading?'Checking saved changes…':!current.value?'Publication status unavailable':
    current.value.state==='draft'?'Saved draft — not visible live':'Published — saved changes are live';
  return <section aria-label="Page publication status" aria-live="polite" style={{padding:'12px 24px',background:'#f3f6f9',borderBottom:'1px solid #d7e0ea',color:'#062343'}}>
    <strong>{label}</strong>
    <p style={{margin:'5px 0',fontSize:14}}>Choose a photo → Save draft → Publish. This status describes saved changes, not unsaved edits.</p>
    {current.value?.sharedPending ? <p style={{margin:'5px 0',fontSize:14}}>Shared changes are waiting to publish. Publishing this page also publishes saved shared content used on other pages.</p> : null}
    {result?.path===path && !result.ok ? <p role="alert" style={{margin:'7px 0 0',color:'#9c182a',fontWeight:600}}>{result.message}</p> : null}
  </section>;
}
