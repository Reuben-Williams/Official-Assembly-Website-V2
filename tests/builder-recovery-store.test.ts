import { describe, expect, it, vi } from "vitest";

import {
  RecoveryStoreError,
  createRecoveryArtifactStore,
  validateGenerationManifest,
  type RecoveryObjectStore
} from "../lib/builder/recovery";

class MemoryObjects implements RecoveryObjectStore {
  readonly values = new Map<string, { bytes: Uint8Array; etag: string; contentType: string }>();
  readonly reads: Array<{ path: string; useCache: boolean }> = [];
  readonly writes: Array<{ path: string; allowOverwrite: boolean; ifMatch?: string }> = [];
  private serial = 0;

  async get(path: string, options: { useCache: boolean }) {
    this.reads.push({ path, ...options });
    const value = this.values.get(path);
    return value ? { ...value, bytes: value.bytes.slice() } : null;
  }

  async put(path: string, bytes: Uint8Array, options: {
    allowOverwrite: boolean;
    ifMatch?: string;
    contentType: string;
  }) {
    this.writes.push({ path, allowOverwrite: options.allowOverwrite, ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}) });
    const current = this.values.get(path);
    if (current && !options.allowOverwrite) throw new RecoveryStoreError("PRECONDITION_FAILED");
    if (options.ifMatch && current?.etag !== options.ifMatch) throw new RecoveryStoreError("PRECONDITION_FAILED");
    const etag = `etag-${++this.serial}`;
    this.values.set(path, { bytes: bytes.slice(), etag, contentType: options.contentType });
    return { etag };
  }
}

describe("published snapshot recovery store", () => {
  it("writes immutable artifacts once and rejects different bytes at the same path", async () => {
    const objects = new MemoryObjects();
    const recovery = createRecoveryArtifactStore({
      objects,
      environment: "preview",
      siteKey: "official-assembly-website-v2"
    });
    const path = "recovery/v1/preview/official-assembly-website-v2/generations/4/routes/home-a.json";

    const first = await recovery.writeImmutableJson(path, { route: "/", generationId: 4 });
    const replay = await recovery.writeImmutableJson(path, { route: "/", generationId: 4 });

    expect(replay).toEqual(first);
    await expect(recovery.writeImmutableJson(path, { route: "/about", generationId: 4 }))
      .rejects.toMatchObject({ code: "IMMUTABLE_CONFLICT" });
    expect(objects.writes.filter((write) => write.path === path)).toHaveLength(3);
  });

  it("reads and advances latest with uncached reads and an ETag precondition", async () => {
    const objects = new MemoryObjects();
    const recovery = createRecoveryArtifactStore({
      objects,
      environment: "production",
      siteKey: "official-assembly-website-v2"
    });

    await expect(recovery.advanceLatest({ schemaVersion: 1, environment: "production", siteKey: "official-assembly-website-v2", generationId: 2, manifestPath: "manifest-2.json", manifestDigest: "a".repeat(64) }))
      .resolves.toEqual({ status: "advanced", generationId: 2 });
    await expect(recovery.advanceLatest({ schemaVersion: 1, environment: "production", siteKey: "official-assembly-website-v2", generationId: 3, manifestPath: "manifest-3.json", manifestDigest: "b".repeat(64) }))
      .resolves.toEqual({ status: "advanced", generationId: 3 });
    await expect(recovery.advanceLatest({ schemaVersion: 1, environment: "production", siteKey: "official-assembly-website-v2", generationId: 1, manifestPath: "manifest-1.json", manifestDigest: "c".repeat(64) }))
      .resolves.toEqual({ status: "superseded", generationId: 3 });

    expect(objects.reads.every((read) => read.useCache === false)).toBe(true);
    expect(objects.writes[1]).toMatchObject({ allowOverwrite: true, ifMatch: "etag-1" });
  });

  it("re-reads after a conditional race and never lowers the latest generation", async () => {
    const objects = new MemoryObjects();
    const recovery = createRecoveryArtifactStore({ objects, environment: "preview", siteKey: "site" });
    await recovery.advanceLatest({ schemaVersion: 1, environment: "preview", siteKey: "site", generationId: 5, manifestPath: "five", manifestDigest: "d".repeat(64) });
    const originalPut = objects.put.bind(objects);
    const put = vi.spyOn(objects, "put").mockImplementationOnce(async (path, bytes, options) => {
      if (options.allowOverwrite) {
        await originalPut(path, new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, environment: "preview", siteKey: "site", generationId: 7, manifestPath: "seven", manifestDigest: "e".repeat(64) })), { ...options, ifMatch: options.ifMatch });
        throw new RecoveryStoreError("PRECONDITION_FAILED");
      }
      return originalPut(path, bytes, options);
    });

    await expect(recovery.advanceLatest({ schemaVersion: 1, environment: "preview", siteKey: "site", generationId: 6, manifestPath: "six", manifestDigest: "f".repeat(64) }))
      .resolves.toEqual({ status: "superseded", generationId: 7 });
    expect(put).toHaveBeenCalled();
  });
});

describe("generation manifest validation", () => {
  const manifest = {
    schemaVersion: 1 as const,
    environment: "production" as const,
    siteKey: "official-assembly-website-v2",
    generationId: 9,
    commandId: "11111111-1111-4111-8111-111111111111",
    globalVersionId: "22222222-2222-4222-8222-222222222222",
    routes: [
      { path: "/", pageVersionId: "33333333-3333-4333-8333-333333333333", artifactPath: "home", artifactDigest: "a".repeat(64) },
      { path: "/about", pageVersionId: "44444444-4444-4444-8444-444444444444", artifactPath: "about", artifactDigest: "b".repeat(64) }
    ],
    media: [],
    createdAt: "2026-08-06T12:00:00.000Z"
  };

  it("accepts one exact complete generation and rejects mixed or unregistered routes", () => {
    expect(validateGenerationManifest(manifest, {
      environment: "production",
      siteKey: "official-assembly-website-v2",
      routes: ["/", "/about"]
    })).toEqual(manifest);
    expect(() => validateGenerationManifest({ ...manifest, generationId: 8 }, {
      environment: "production",
      siteKey: "official-assembly-website-v2",
      routes: ["/", "/about"],
      expectedGenerationId: 9
    })).toThrow("generation");
    expect(() => validateGenerationManifest({ ...manifest, routes: [...manifest.routes, { ...manifest.routes[0]!, path: "/extra" }] }, {
      environment: "production",
      siteKey: "official-assembly-website-v2",
      routes: ["/", "/about"]
    })).toThrow("routes");
  });
});
