import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

// Explicit owner-authorized account only. No email verification bypass or outbound email.
const email = 'damonyoung@dtvprods.com';
const keys = process.argv.includes('--keys-stdin') ? JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '')) : null;
const env = keys ? {
  NEXT_PUBLIC_SUPABASE_URL: 'https://rriebibkxymeqhafssvw.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: keys.find(key => key.name === 'service_role')?.api_key,
} : parseEnv(readFileSync('.env.local', 'utf8'));
if (!env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY === '[SENSITIVE]') throw Error('A usable server credential is unavailable');
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'rriebibkxymeqhafssvw.supabase.co') throw Error('Unexpected project');
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const site = await client.from('builder_sites').select('id,site_key').eq('site_key','official-assembly-website-v2').single();
if(site.error || !site.data) throw Error('Site lookup failed');
let user;
for(let page=1;page<=100;page++) {
  const result=await client.auth.admin.listUsers({page,perPage:100});
  if(result.error) throw Error('Account lookup failed');
  user=result.data.users.find(candidate=>candidate.email?.toLowerCase()===email);
  if(user || result.data.users.length<100)break;
  if(page===100)throw Error('Account lookup bound exceeded');
}
if(!process.argv.includes('--apply')) {console.log(JSON.stringify({siteVerified:true,accountExists:!!user,mode:'read-only'}));process.exit(0)}
if(!user) {
  const result=await client.auth.admin.createUser({email,email_confirm:false});
  if(result.error||!result.data.user)throw Error('Account provisioning failed; no membership changed');
  user=result.data.user;
}
const existing=await client.from('builder_site_members').select('role').eq('site_id',site.data.id).eq('user_id',user.id).maybeSingle();
if(existing.error)throw Error('Account exists; membership lookup failed');
if(existing.data && !['editor','owner'].includes(existing.data.role))throw Error('Existing different role needs explicit reconciliation');
if(!existing.data) {
  const result=await client.from('builder_site_members').insert({site_id:site.data.id,user_id:user.id,role:'editor'});
  if(result.error)throw Error('Account exists; membership provisioning failed');
}
const verified=await client.from('builder_site_members').select('role,session_generation').eq('site_id',site.data.id).eq('user_id',user.id).single();
if(verified.error)throw Error('Membership verification failed');
console.log(JSON.stringify({accountProvisioned:true,siteVerified:true,role:verified.data.role,emailVerified:!!user.email_confirmed_at,loginTested:false,emailSent:false}));
