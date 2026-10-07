import { existsSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({admin:vi.fn(),resolve:vi.fn(),authenticate:vi.fn(),deliver:vi.fn()}));
vi.mock('../lib/supabase/admin',()=>({getBuilderAdminClient:mocks.admin,resolveBuilderSiteId:mocks.resolve}));
vi.mock('../lib/builder/request-auth',()=>({authenticateBuilderRequest:mocks.authenticate}));
vi.mock('../lib/builder/page-media-delivery',()=>({deliverPageMedia:mocks.deliver}));
import { GET,POST } from '../app/api/builder/media/[[...segments]]/route';
beforeEach(()=>vi.clearAllMocks());
it('keeps image delivery and upload commands in one route so GET cannot shadow POST',()=>{
  expect(existsSync(new URL('../app/api/builder/media/[revisionId]/route.ts',import.meta.url))).toBe(false);
  expect(typeof GET).toBe('function');expect(typeof POST).toBe('function');
});
it('rejects invalid GET paths before accessing storage',async()=>{
  for(const segments of [undefined,['plans'],['manifests'],['one','two']]) {
    expect((await GET(new Request('https://example.com/api/builder/media/plans'),{params:Promise.resolve({segments})})).status).toBe(404);
  }
  expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.deliver).not.toHaveBeenCalled();
});
it('still handles unauthenticated upload commands with authorization rather than method-not-allowed',async()=>{
  mocks.authenticate.mockResolvedValue(null);
  for(const segment of ['plans','manifests']) {
    const response=await POST(new Request(`http://localhost:3000/api/builder/media/${segment}`,{method:'POST',headers:{origin:'http://localhost:3000'}}),{params:Promise.resolve({segments:[segment]})});
    expect(response.status).toBe(401);
  }
  expect(mocks.admin).not.toHaveBeenCalled();
});
