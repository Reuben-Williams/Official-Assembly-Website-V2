import { describe, expect, it, vi } from "vitest";

import {
  RecoveryStoreError,
  createRecoveryArtifactStore,
  runRecoveryWorkerOnce,
  type RecoveryGenerationSource,
  type RecoveryObjectStore,
  type RecoveryWorkerRepository
} from "../lib/builder/recovery";

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

describe("published snapshot recovery worker", () => {
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
