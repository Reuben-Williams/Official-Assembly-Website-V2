// Read-only production diagnosis. Credentials stay in memory; no provider writes.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseRecoveryWorkerRepository } from '../lib/builder/recovery/repository.ts';
import { prepareRecoveryGeneration } from '../lib/builder/recovery/worker.ts';
import { createRecoveryArtifactStore } from '../lib/builder/recovery/blob-store.ts';
import site from '../builder.config.ts';
const keys=JSON.parse(readFileSync(0,'utf8').replace(/^\uFEFF/,''));
const key=keys.find(value=>value.name==='service_role')?.api_key;
if(!key)throw Error('Missing credential');
const client=createClient('https://rriebibkxymeqhafssvw.supabase.co',key,{auth:{persistSession:false}});
const siteId='a3f57b25-df25-4d98-9ff6-a4a3f3a00a68';
const latest=await client.from('builder_site_generations').select('generation_id').eq('site_id',siteId).order('generation_id',{ascending:false}).limit(1).single();
const revision=await client.from('builder_carousel_revisions').select('id').eq('site_id',siteId).order('created_at',{ascending:false}).limit(1).single();
let stage='load';
try {
 const repository=createSupabaseRecoveryWorkerRepository(client,{carouselRevisionId:revision.data.id});
 const source=await repository.loadGeneration({siteId,generationId:Number(latest.data.generation_id),fenceToken:1});
 console.log(JSON.stringify({stage:'source',pages:source.pages.length,media:source.media.length,carousel:!!source.carousel,missing:site.pages.filter(page=>!source.pages.some(sourcePage=>sourcePage.path===page.path)).map(page=>page.path)}));
 stage='prepare-in-memory';
 const objects=new Map();
 const artifacts=createRecoveryArtifactStore({environment:'production',siteKey:site.siteId,objects:{get:async path=>objects.get(path)??null,put:async(path,bytes,options)=>{objects.set(path,{bytes,etag:path,contentType:options.contentType});return {etag:path};}}});
 await prepareRecoveryGeneration({source:{...source,generationId:source.generationId+1},environment:'production',configuredRoutes:site.pages.map(page=>page.path),artifacts});
 console.log(JSON.stringify({stage:'prepared-in-memory',objects:objects.size,externalWrites:false}));
}catch(error){console.log(JSON.stringify({stage,errorName:error.name,message:error.message}));process.exitCode=1;}
