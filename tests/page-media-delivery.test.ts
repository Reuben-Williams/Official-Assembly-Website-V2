import { describe, it, expect, vi } from 'vitest';
import { deliverPageMedia } from '../lib/builder/page-media-delivery';
import type { PageMediaReference } from '../lib/builder/page-media';
const id='ab4beae6-28e7-487a-8e99-cafe8ce2881a';
const ref:PageMediaReference={mediaId:'a427ae63-eb85-48fc-b62c-e5cf3eee4e4e',revisionId:id,objectKey:'exact/key.jpg',mimeType:'image/jpeg',byteSize:3,ready:true,archived:false};
function fixture(published=false) {
  return {byRevision:vi.fn(async()=>ref),isPublished:vi.fn(async()=>published),
    authorizePreview:vi.fn(async()=>{}),download:vi.fn(async()=>new Uint8Array([1,2,3]))};
}
describe('private page image delivery',()=>{
  it('does not expose a private draft or retained historical image',async()=>{
    const deps=fixture(); const response=await deliverPageMedia(new Request(`https://site.test/api/builder/media/${id}`),id,deps);
    expect(response.status).toBe(404); expect(deps.download).not.toHaveBeenCalled();
  });
  it('serves only the current published revision without a storage token',async()=>{
    const deps=fixture(true);const response=await deliverPageMedia(new Request(`https://site.test/api/builder/media/${id}`),id,deps);
    expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('location')).toBeNull();
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1,2,3]);
  });
  it('authorizes private previews before looking up or downloading an image',async()=>{
    const deps=fixture();deps.authorizePreview.mockRejectedValue(new Error('denied'));
    const response=await deliverPageMedia(new Request(`https://site.test/api/builder/media/${id}?preview=1`),id,deps);
    expect(response.status).toBe(404);expect(deps.byRevision).not.toHaveBeenCalled();expect(deps.download).not.toHaveBeenCalled();
  });
  it('allows an authenticated draft preview and rejects corrupt bytes',async()=>{
    const deps=fixture();const req=new Request(`https://site.test/api/builder/media/${id}?preview=1`);
    expect((await deliverPageMedia(req,id,deps)).status).toBe(200);
    deps.download.mockResolvedValue(new Uint8Array([1]));expect((await deliverPageMedia(req,id,deps)).status).toBe(404);
  });
  it('rejects malformed IDs and extra query options',async()=>{
    const deps=fixture(true);
    expect((await deliverPageMedia(new Request('https://site.test/x'), '../key',deps)).status).toBe(404);
    expect((await deliverPageMedia(new Request('https://site.test/x?download=anything'),id,deps)).status).toBe(404);
    expect(deps.byRevision).not.toHaveBeenCalled();
  });
});
