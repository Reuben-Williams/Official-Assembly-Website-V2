import { describe, expect, it, vi } from "vitest";

import { createSupabaseRecoveryWorkerRepository } from "../lib/builder/recovery";

function thenable(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const name of ["update", "eq", "select", "maybeSingle"]) chain[name] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

describe("Supabase recovery worker repository", () => {
  it('associates retained shared images with every recovered page',async()=>{
    const rows:Record<string,unknown>={
      builder_site_generations:{site_id:'site',generation_id:4,global_version_id:'global',page_versions:{'/':'home','/news':'news'},command_id:'command'},
      builder_sites:{site_key:'site-key'},
      builder_versions:[{id:'global',page_path:'/__builder/global',snapshot:{regions:{}}},{id:'home',page_path:'/',snapshot:{regions:{}}},{id:'news',page_path:'/news',snapshot:{regions:{}}}],
      builder_page_version_media:[{version_id:'global',media_id:'image',revision_id:'revision'}],
      builder_media_revisions:[{media_id:'image',id:'revision',object_key:'exact/key',sha256:'a'.repeat(64),mime_type:'image/jpeg',byte_size:3}],
    };
    const from=(table:string)=>{
      const chain:Record<string,unknown>={};
      for(const name of ['select','eq','in','single']) chain[name]=()=>chain;
      chain.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows[table],error:null}).then(resolve);return chain;
    };
    const repo=createSupabaseRecoveryWorkerRepository({from,storage:{from:()=>({download:async()=>({data:new Blob(['abc']),error:null})})}} as never);
    const result=await repo.loadGeneration({siteId:'site',generationId:4,fenceToken:1});
    expect(result.media[0].routePaths).toEqual(['/','/news']);
  });
  it("claims and completes only through the fenced service RPCs", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{
          site_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          generation_id: 4,
          fence_token: 3,
          attempt_count: 2
        }],
        error: null
      })
      .mockResolvedValueOnce({ data: true, error: null });
    const repository = createSupabaseRecoveryWorkerRepository({ rpc, from: vi.fn() } as never);

    const claim = await repository.claim({ workerId: "worker-a", leaseSeconds: 60 });
    expect(claim).toEqual({
      siteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      generationId: 4,
      fenceToken: 3,
      attemptCount: 2
    });
    await expect(repository.complete({ ...claim!, workerId: "worker-a" })).resolves.toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(1, "builder_claim_content_recovery_job_v1", {
      p_worker: "worker-a",
      p_lease_seconds: 60
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "builder_complete_content_recovery_job_v1", {
      p_site_id: claim!.siteId,
      p_generation_id: 4,
      p_worker: "worker-a",
      p_fence_token: 3
    });
  });

  it("releases a fenced job for retry without retaining raw failure details", async () => {
    const chain = thenable({ data: { status: "retry" }, error: null });
    const from = vi.fn(() => chain);
    const repository = createSupabaseRecoveryWorkerRepository(
      { rpc: vi.fn(), from } as never,
      { now: () => new Date("2026-08-06T12:00:00.000Z") }
    );

    await expect(repository.retry({
      siteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      generationId: 4,
      fenceToken: 3,
      attemptCount: 2,
      workerId: "worker-a",
      safeCode: "RECOVERY_WRITE_FAILED"
    })).resolves.toBe("retry");

    expect(from).toHaveBeenCalledWith("builder_content_recovery_jobs");
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "retry",
      lease_owner: null,
      lease_expires_at: null,
      last_error: "RECOVERY_WRITE_FAILED"
    }));
    expect(chain.update).not.toHaveBeenCalledWith(expect.objectContaining({ raw_error: expect.anything() }));
  });
});
