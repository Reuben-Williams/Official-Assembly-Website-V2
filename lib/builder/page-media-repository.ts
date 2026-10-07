import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeRegionDefinitions, type BuilderSiteConfig, type EditableValue } from '@reuben-williams/core';
import { normalizePageMediaValue, pageMediaRevisionId, type PageMediaRepository, type PageMediaReference } from './page-media';

export function createPageMediaRepository(client:SupabaseClient,siteId:string):PageMediaRepository {
  async function read(column:'id'|'object_key',value:string):Promise<PageMediaReference|null> {
    const revisions=await client.from('builder_media_revisions').select('id,media_id,object_key,mime_type,byte_size')
      .eq('site_id',siteId).eq(column,value).limit(2);
    if(revisions.error) throw new Error('PAGE_MEDIA_READ_FAILED');
    if(revisions.data?.length!==1) return null;
    const row=revisions.data[0];
    const [asset,replica]=await Promise.all([
      client.from('builder_media_assets').select('archived_at').eq('site_id',siteId).eq('id',row.media_id).maybeSingle(),
      client.from('builder_media_recovery_replicas').select('status').eq('site_id',siteId).eq('media_id',row.media_id).eq('revision_id',row.id).maybeSingle(),
    ]);
    if(asset.error || replica.error) throw new Error('PAGE_MEDIA_READ_FAILED');
    if(!asset.data) return null;
    return {mediaId:String(row.media_id),revisionId:String(row.id),objectKey:String(row.object_key),
      mimeType:String(row.mime_type),byteSize:Number(row.byte_size),ready:replica.data?.status==='ready',archived:Boolean(asset.data.archived_at)};
  }
  return {byRevision:id=>read('id',id),byObjectKey:key=>read('object_key',key),async isRetained(ref){
    const result=await client.from('builder_page_version_media').select('version_id').eq('site_id',siteId)
      .eq('media_id',ref.mediaId).eq('revision_id',ref.revisionId).limit(1);
    if(result.error) throw new Error('PAGE_MEDIA_READ_FAILED');
    return Boolean(result.data?.length);
  }};
}

// Retention proves recoverability, not public visibility. Only current registered
// published image regions can authorize anonymous delivery.
export async function pageMediaIsPublished(client:SupabaseClient,siteId:string,site:BuilderSiteConfig,
  repository:PageMediaRepository,origin:string,ref:PageMediaReference) {
  const result=await client.from('builder_published_pages').select('path,regions').eq('site_id',siteId)
    .in('path',['/__builder/global',...site.pages.map(page=>page.path)]);
  if(result.error) throw new Error('PAGE_MEDIA_READ_FAILED');
  for(const row of result.data ?? []) {
    const definitions=row.path==='/__builder/global' ? site.globalRegions ?? [] :
      site.pages.find(page=>page.path===row.path)?.regions ?? [];
    for(const region of normalizeRegionDefinitions(definitions)) {
      const value=(row.regions as Record<string,EditableValue>)[region.id];
      if(region.kind!=='image' || value?.type!=='image') continue;
      const canonical=await normalizePageMediaValue(value,repository,origin,'read');
      if(canonical.type==='image' && canonical.mediaId===ref.mediaId && pageMediaRevisionId(canonical.src)===ref.revisionId) return true;
    }
  }
  return false;
}
