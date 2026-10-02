import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {communityPhotos} from '../app/data/community-photos.ts';
let input='';for await(const chunk of process.stdin)input+=chunk;
const records=JSON.parse(input);const key=records.find(record=>record.name==='service_role')?.api_key;if(!key)throw new Error('Service credential was not supplied.');
const client=createClient('https://rriebibkxymeqhafssvw.supabase.co',key,{auth:{persistSession:false,autoRefreshToken:false}});
const site=await client.from('builder_sites').select('id').eq('site_key','official-assembly-website-v2').single();if(site.error||site.data.id!=='a3f57b25-df25-4d98-9ff6-a4a3f3a00a68')throw new Error('Site identity mismatch.');
const rows=[];
for(const photo of communityPhotos){
  const bytes=await readFile(new URL('../public'+photo.src,import.meta.url));const sha256=createHash('sha256').update(bytes).digest('hex');
  const identity=await client.from('builder_media_revisions').select('media_id,id').eq('site_id',site.data.id).eq('sha256',sha256);
  if(identity.error)throw new Error('Media inventory unavailable.');rows.push({id:photo.id,matchingManagedRevisions:identity.data.length});
}
console.log(JSON.stringify({siteVerified:true,photos:rows,changesMade:false}));
