import { describe, expect, it, vi } from "vitest";
import { createCarouselBaseline } from '../lib/carousel/contract';
import { createRecoveryContentReader } from '../lib/builder/recovery/reader';

import { RecoveryStoreError, createRecoveryArtifactStore, recoveryDigest, type RecoveryObjectStore } from '../lib/builder/recovery/blob-store';
import { runRecoveryWorkerOnce, type RecoveryGenerationSource, type RecoveryWorkerRepository } from '../lib/builder/recovery/worker';
import { runMediaReplicaWorkerOnce, type MediaReplicaClaim, type MediaReplicaRepository } from '../lib/builder/recovery/media-replica-worker';

class MemoryObjects implements RecoveryObjectStore {
  readonly values = new Map<string, { bytes: Uint8Array; etag: string; contentType: string }>();
  private serial = 0;

  async get(path: string) {
    const value = this.values.get(path);
    return value ? { ...value, bytes: value.bytes.slice() } : null;
  }

  async put(path: string, bytes: Uint8Array, options: { allowOverwrite: boolean; ifMatch?: string; contentType: string }) {
    const current = this.values.get(path);
    if (current && !options.allowOverwrite) throw new RecoveryStoreError("PRECONDITION_FAILED");
    if (options.ifMatch && current?.etag !== options.ifMatch) throw new RecoveryStoreError("PRECONDITION_FAILED");
    const etag = `etag-${++this.serial}`;
    this.values.set(path, { bytes: bytes.slice(), etag, contentType: options.contentType });
    return { etag };
  }
}

const source: RecoveryGenerationSource = {
  siteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  siteKey: "official-assembly-website-v2",
  generationId: 4,
  commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  fenceToken: 3,
  global: {
    versionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    values: { "global.brand": { type: "text", value: "Office" } }
  },
  pages: [
    { path: "/", versionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", values: { "home.title": { type: "text", value: "Home" } } },
    { path: "/about", versionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", values: { "about.title": { type: "text", value: "About" } } }
  ],
  media: [{
    mediaId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    revisionId: "11111111-1111-4111-8111-111111111111",
    bytes: new TextEncoder().encode("image-bytes"),
    digest: "2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c",
    mimeType: "image/webp"
  }]
};

function repository(overrides: Partial<RecoveryWorkerRepository> = {}): RecoveryWorkerRepository {
  return {
    claim: vi.fn(async () => ({ siteId: source.siteId, generationId: 4, fenceToken: 3 })),
    loadGeneration: vi.fn(async () => source),
    complete: vi.fn(async () => true),
    retry: vi.fn(async () => "retry" as const),
    ...overrides
  };
}

const mediaClaim: MediaReplicaClaim = {
  siteId: source.siteId,
  siteKey: source.siteKey,
  mediaId: source.media[0]!.mediaId,
  revisionId: source.media[0]!.revisionId,
  objectKey: "private/source.webp",
  contentDigest: source.media[0]!.digest,
  byteSize: source.media[0]!.bytes.byteLength,
  mimeType: source.media[0]!.mimeType,
  fenceToken: 5,
  attemptCount: 1,
};

function mediaRepository(overrides: Partial<MediaReplicaRepository> = {}): MediaReplicaRepository {
  return {
    claim: vi.fn(async () => mediaClaim),
    download: vi.fn(async () => source.media[0]!.bytes),
    complete: vi.fn(async () => true),
    retry: vi.fn(async () => "pending" as const),
    ...overrides,
  };
}

describe("managed media recovery worker", () => {
  it('restores the exact page revision when one asset has two revisions, including shared images',async()=>{
    const objects=new MemoryObjects();
    const artifacts=createRecoveryArtifactStore({objects,environment:'preview',siteKey:source.siteKey});
    const bytes=new TextEncoder().encode('second-photo');
    const second={...source.media[0],revisionId:'22222222-2222-4222-8222-222222222222',bytes,digest:await recoveryDigest(bytes)};
    const pageImage={type:'image' as const,mediaId:second.mediaId,src:`/api/builder/media/${second.revisionId}`,alt:'Approved photo'};
    const updated={...source,global:{...source.global,values:{'shared.photo':pageImage}},media:[source.media[0],second]};
    const repo=repository({loadGeneration:vi.fn(async()=>updated)});
    expect((await runRecoveryWorkerOnce({environment:'preview',workerId:'test',configuredRoutes:['/','/about'],repository:repo,artifacts})).status).toBe('completed');
    const latest=await artifacts.readLatest();const manifest=await artifacts.readJson(latest!.pointer.manifestPath,{useCache:false});
    const path=(manifest!.value as any).routes.find((route:any)=>route.path==='/about').artifactPath;
    const artifact=await artifacts.readJson(path,{useCache:false});
    expect((artifact!.value as any).values['shared.photo'].src).toBe(pageImage.src);
    const read=createRecoveryContentReader({artifacts,configuredRoutes:['/','/about'],grantSecret:'test-secret-that-is-at-least-32-characters',nowEpochSeconds:()=>1000});
    const restored=(await read('/about'))?.regions['shared.photo'];
    expect(restored).toMatchObject({type:'image',alt:'Approved photo'});
    expect(restored?.type==='image' && restored.src).toContain(second.digest);
  });
  it("verifies and writes an immutable media revision before marking it ready", async () => {
    const objects = new MemoryObjects();
    const artifacts = createRecoveryArtifactStore({ objects, environment: "preview", siteKey: source.siteKey });
    const repo = mediaRepository();

    await expect(runMediaReplicaWorkerOnce({
      environment: "preview",
      workerId: "media-worker-a",
      repository: repo,
      artifacts,
    })).resolves.toMatchObject({ status: "media_completed", revisionId: mediaClaim.revisionId });

    expect(repo.complete).toHaveBeenCalledWith(expect.objectContaining({
      workerId: "media-worker-a",
      contentDigest: mediaClaim.contentDigest,
      objectPath: expect.stringMatching(/recovery\/v1\/preview\/official-assembly-website-v2\/media\/.*\.webp$/),
    }));
    expect([...objects.values.keys()]).toEqual([
      expect.stringMatching(/media\/ffffffff-ffff-4fff-8fff-ffffffffffff\/11111111-1111-4111-8111-111111111111\/2c8648d1.*\.webp$/),
    ]);
  });

  it("never marks a revision ready when the downloaded bytes fail verification", async () => {
    const artifacts = createRecoveryArtifactStore({
      objects: new MemoryObjects(), environment: "preview", siteKey: source.siteKey,
    });
    const repo = mediaRepository({ download: vi.fn(async () => new TextEncoder().encode("wrong")) });

    await expect(runMediaReplicaWorkerOnce({
      environment: "preview",
      workerId: "media-worker-a",
      repository: repo,
      artifacts,
    })).resolves.toMatchObject({ status: "media_retry", safeCode: "MEDIA_DIGEST_MISMATCH" });
    expect(repo.complete).not.toHaveBeenCalled();
    expect(repo.retry).toHaveBeenCalledWith(expect.objectContaining({ safeCode: "MEDIA_DIGEST_MISMATCH" }));
  });
});

describe("published snapshot recovery worker", () => {
  it('retains the explicit carousel revision in a version-two generation and home artifact', async () => {
    const objects=new MemoryObjects();
    const document=createCarouselBaseline(Array.from({length:8},()=>({mediaId:source.media[0].mediaId,revisionId:source.media[0].revisionId})));
    const carousel={revisionId:'22222222-2222-4222-8222-222222222222',document};
    const artifacts=createRecoveryArtifactStore({objects,environment:'preview',siteKey:source.siteKey});
    const repo=repository({loadGeneration:async()=>({...source,carousel,media:source.media.map(media=>({...media,width:1600,height:900}))})});
    const result=await runRecoveryWorkerOnce({environment:'preview',workerId:'test-worker',configuredRoutes:['/','/about'],repository:repo,artifacts});
    expect(result.status).toBe('completed');
    const latest=await artifacts.readLatest(); const manifest=await artifacts.readJson(latest!.pointer.manifestPath,{useCache:false});
    expect(manifest!.value).toMatchObject({schemaVersion:2,carousel:{revisionId:carousel.revisionId}});
    const homePath=(manifest!.value as any).routes.find((route:any)=>route.path==='/').artifactPath;
    expect((await artifacts.readJson(homePath,{useCache:false}))!.value).toMatchObject({carousel});
    const read=createRecoveryContentReader({artifacts,configuredRoutes:['/','/about'],grantSecret:'test-secret-that-is-at-least-32-characters',nowEpochSeconds:()=>1000});
    expect(await read('/')).toMatchObject({carousel:{revisionId:carousel.revisionId,document,images:[{mediaId:source.media[0].mediaId,width:1600,height:900,ready:true}]}});
  });
  it("replicates media, exact route snapshots, a manifest, and then advances latest", async () => {
    const objects = new MemoryObjects();
    const artifacts = createRecoveryArtifactStore({
      objects,
      environment: "preview",
      siteKey: source.siteKey
    });
    const repo = repository();

    await expect(runRecoveryWorkerOnce({
      environment: "preview",
      workerId: "worker-a",
      configuredRoutes: ["/", "/about"],
      repository: repo,
      artifacts
    })).resolves.toMatchObject({ status: "completed", generationId: 4 });

    expect(repo.complete).toHaveBeenCalledWith({
      siteId: source.siteId,
      generationId: 4,
      workerId: "worker-a",
      fenceToken: 3
    });
    expect(repo.retry).not.toHaveBeenCalled();
    expect([...objects.values.keys()]).toEqual(expect.arrayContaining([
      expect.stringMatching(/media\/ffffffff-ffff-4fff-8fff-ffffffffffff\/11111111-1111-4111-8111-111111111111\/2c8648d1.*\.webp$/),
      expect.stringMatching(/generations\/4\/routes\/.*\.json$/),
      expect.stringMatching(/generations\/4\/manifest-.*\.json$/),
      "recovery/v1/preview/official-assembly-website-v2/latest.json"
    ]));
  });

  it("fails closed before latest when a configured route is missing", async () => {
    const objects = new MemoryObjects();
    const incomplete = { ...source, pages: source.pages.slice(0, 1) };
    const repo = repository({ loadGeneration: vi.fn(async () => incomplete) });
    const artifacts = createRecoveryArtifactStore({ objects, environment: "preview", siteKey: source.siteKey });

    await expect(runRecoveryWorkerOnce({
      environment: "preview",
      workerId: "worker-a",
      configuredRoutes: ["/", "/about"],
      repository: repo,
      artifacts
    })).resolves.toMatchObject({ status: "retry", safeCode: "INCOMPLETE_ROUTES" });

    expect(repo.complete).not.toHaveBeenCalled();
    expect(repo.retry).toHaveBeenCalledWith(expect.objectContaining({ safeCode: "INCOMPLETE_ROUTES" }));
    expect(objects.values.has(artifacts.latestPath)).toBe(false);
  });

  it("does not report completion when the database fence became stale", async () => {
    const objects = new MemoryObjects();
    const repo = repository({ complete: vi.fn(async () => false) });
    const artifacts = createRecoveryArtifactStore({ objects, environment: "preview", siteKey: source.siteKey });

    await expect(runRecoveryWorkerOnce({
      environment: "preview",
      workerId: "worker-a",
      configuredRoutes: ["/", "/about"],
      repository: repo,
      artifacts
    })).resolves.toEqual({ status: "stale_fence", generationId: 4 });
  });

  it("returns idle without reading or writing when no job is due", async () => {
    const objects = new MemoryObjects();
    const repo = repository({ claim: vi.fn(async () => null) });
    const artifacts = createRecoveryArtifactStore({ objects, environment: "preview", siteKey: source.siteKey });

    await expect(runRecoveryWorkerOnce({
      environment: "preview",
      workerId: "worker-a",
      configuredRoutes: ["/", "/about"],
      repository: repo,
      artifacts
    })).resolves.toEqual({ status: "idle" });
    expect(repo.loadGeneration).not.toHaveBeenCalled();
    expect(objects.values.size).toBe(0);
  });
});
