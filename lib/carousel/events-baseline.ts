import type { SupabaseClient } from '@supabase/supabase-js';
import { createBuilderContentCommand, createSupabaseContentCommandExecutor } from '../builder/repositories';

// The existing Events route predates its recovery registration. Bootstrap the
// current checked-in fallback only; never publish any staff draft or global edits.
// This is called exclusively inside the authenticated owner carousel bootstrap.
export async function ensureEventsRecoveryBaseline(client: SupabaseClient, identity: {
  siteId: string; siteKey: string; userId: string; role: string;
}) {
  if(identity.role !== 'owner' || identity.siteKey !== 'official-assembly-website-v2')
    throw new Error('EVENTS_BASELINE_OWNER_REQUIRED');
  const published=await client.from('builder_published_pages').select('version_id,regions').eq('site_id',identity.siteId).eq('path','/events').maybeSingle();
  if(published.error)throw new Error('EVENTS_BASELINE_READ_FAILED');
  if(published.data?.version_id)return;
  if(published.data?.regions && Object.keys(published.data.regions).length)
    throw new Error('EVENTS_BASELINE_UNVERSIONED_CONTENT');
  const draft=await client.from('builder_draft_pages').select('version_id').eq('site_id',identity.siteId).eq('path','/events').maybeSingle();
  if(draft.error)throw new Error('EVENTS_BASELINE_READ_FAILED');
  const command=await createBuilderContentCommand({siteId:identity.siteKey,actorId:identity.userId,operation:'publish',scopes:[{
    scope:{kind:'page',path:'/events'},expectedDraftVersionId:draft.data?.version_id??null,
    expectedPublishedVersionId:null,values:{},
  }]});
  await createSupabaseContentCommandExecutor(client).execute(identity.siteKey,command);
}
