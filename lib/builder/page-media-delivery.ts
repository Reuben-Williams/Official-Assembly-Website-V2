import { PAGE_MEDIA_MIMES, PAGE_MEDIA_UUID, type PageMediaReference } from './page-media';
export async function deliverPageMedia(request:Request,id:string,deps:{
  byRevision:(id:string)=>Promise<PageMediaReference|null>;
  isPublished:(ref:PageMediaReference)=>Promise<boolean>;
  authorizePreview:()=>Promise<void>;
  download:(ref:PageMediaReference)=>Promise<Uint8Array>;
}) {
  const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
  const missing=()=>new Response(null,{status:404,headers});
  try {
    const query=new URL(request.url).searchParams;
    if(!PAGE_MEDIA_UUID.test(id) || [...query.keys()].some(key=>key!=='preview') ||
       query.getAll('preview').length>1 || (query.has('preview') && query.get('preview')!=='1')) return missing();
    const preview=query.get('preview')==='1';
    if(preview) await deps.authorizePreview();
    const ref=await deps.byRevision(id.toLowerCase());
    if(!ref || !PAGE_MEDIA_MIMES.has(ref.mimeType) || ref.byteSize<=0 || ref.byteSize>25*1024*1024 ||
       (!preview && (!ref.ready || !await deps.isPublished(ref)))) return missing();
    const bytes=await deps.download(ref);
    if(bytes.byteLength!==ref.byteSize) return missing();
    return new Response(new Uint8Array(bytes),{headers:{...headers,'content-type':ref.mimeType,'content-length':String(bytes.byteLength)}});
  } catch { return missing(); }
}
