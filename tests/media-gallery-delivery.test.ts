import { expect, it } from 'vitest';
import { listNormalizedMediaAssets } from '../lib/builder/repositories';
import type { SupabaseClient } from '@supabase/supabase-js';

it('lists private gallery assets with durable authenticated revision URLs rather than one-hour bearer links', async () => {
  const tables: Record<string, unknown[]> = {
    builder_media_assets: [{ id: '11111111-1111-4111-8111-111111111111', site_id: 'site', label: 'Community', alt_text: 'Residents', created_by: 'staff', created_at: '2026-10-07' }],
    builder_media_revisions: [{ media_id: '11111111-1111-4111-8111-111111111111', id: '22222222-2222-4222-8222-222222222222', object_key: 'site/private.jpg', mime_type: 'image/jpeg', created_at: '2026-10-07' }],
    builder_media_recovery_replicas: [],
  };
  let signedLinks = 0;
  const client = {
    from(table: string) {
      const query = { select: () => query, eq: () => query, is: () => query, in: () => query, order: () => query,
        then: (done: (result: unknown) => unknown) => Promise.resolve({ data: tables[table], error: null }).then(done) };
      return query;
    },
    storage: { from: () => ({ createSignedUrl: async () => { signedLinks++; return { data: { signedUrl: 'https://storage.example/expired-token' }, error: null }; } }) },
  } as unknown as SupabaseClient;
  const assets = await listNormalizedMediaAssets(client, 'site');
  expect(assets[0].url).toBe('/api/builder/media/22222222-2222-4222-8222-222222222222?preview=1');
  expect(signedLinks).toBe(0);
});
