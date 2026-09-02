import { describe, expect, it } from "vitest";

import {
  RecoveryStoreError,
  createRecoveryArtifactStore,
  createRecoveryContentReader,
  createRecoveryMediaGrant,
  createRecoveryMediaHandler,
  verifyRecoveryMediaGrant,
  type RecoveryObjectStore
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

const secret = "recovery-media-grant-secret-with-at-least-32-characters";
const mediaDigest = "2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c";

describe("recovery media grants", () => {
  it("seals exact-scope claims and rejects tampering or the wrong generation", () => {
    const token = createRecoveryMediaGrant({
      schemaVersion: 1,
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      generationId: 4,
      route: "/",
      mediaDigest,
      manifestPath: "private/manifest.json",
      expiresAt: 1_786_035_900
    }, secret);

    expect(token).not.toContain("private/manifest.json");
    expect(verifyRecoveryMediaGrant(token, secret, {
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      generationId: 4,
      mediaDigest,
      nowEpochSeconds: 1_786_035_840
    })).toMatchObject({ route: "/", generationId: 4 });
    const tamperedIndex = 15;
    const tamperedToken = `${token.slice(0, tamperedIndex)}${token[tamperedIndex] === "A" ? "B" : "A"}${token.slice(tamperedIndex + 1)}`;
    expect(() => verifyRecoveryMediaGrant(tamperedToken, secret, {
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      generationId: 4,
      mediaDigest,
      nowEpochSeconds: 1_786_035_840
    })).toThrow("invalid");
    expect(() => verifyRecoveryMediaGrant(token, secret, {
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      generationId: 5,
      mediaDigest,
      nowEpochSeconds: 1_786_035_840
    })).toThrow("scope");
  });
});

describe("recovery media delivery", () => {
  async function fixture() {
    const objects = new MemoryObjects();
    const artifacts = createRecoveryArtifactStore({ objects, environment: "preview", siteKey: "official-assembly-website-v2" });
    const namespace = "recovery/v1/preview/official-assembly-website-v2";
    const mediaPath = `${namespace}/media/ffffffff-ffff-4fff-8fff-ffffffffffff/11111111-1111-4111-8111-111111111111/${mediaDigest}.webp`;
    const routePath = `${namespace}/generations/4/routes/home.json`;
    const manifestPath = `${namespace}/generations/4/manifest.json`;
    const media = {
      mediaId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      revisionId: "11111111-1111-4111-8111-111111111111",
      artifactPath: mediaPath,
      artifactDigest: mediaDigest,
      byteLength: 11,
      mimeType: "image/webp"
    };
    await artifacts.writeImmutableBytes(mediaPath, new TextEncoder().encode("image-bytes"), { contentType: "image/webp", expectedDigest: mediaDigest });
    const routeWrite = await artifacts.writeImmutableJson(routePath, {
      schemaVersion: 1,
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      generationId: 4,
      route: "/",
      values: {
        "home.image": {
          type: "image",
          src: "",
          alt: "Community",
          mediaId: "ffffffff-ffff-4fff-8fff-ffffffffffff"
        }
      },
      media: [media]
    });
    const manifestWrite = await artifacts.writeImmutableJson(manifestPath, {
      schemaVersion: 1,
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      generationId: 4,
      commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      globalVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      routes: [{ path: "/", pageVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", artifactPath: routePath, artifactDigest: routeWrite.digest }],
      media: [media],
      createdAt: "2026-08-06T12:00:00.000Z"
    });
    await artifacts.advanceLatest({
      schemaVersion: 1,
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      generationId: 4,
      manifestPath,
      manifestDigest: manifestWrite.digest
    });
    const token = createRecoveryMediaGrant({
      schemaVersion: 1,
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      generationId: 4,
      route: "/",
      mediaDigest,
      manifestPath,
      expiresAt: 1_786_035_900
    }, secret);
    const handler = createRecoveryMediaHandler({
      environment: "preview",
      siteKey: "official-assembly-website-v2",
      configuredRoutes: ["/"],
      grantSecret: secret,
      nowEpochSeconds: () => 1_786_035_840,
      artifacts
    });
    return { handler, token, objects, mediaPath, artifacts };
  }

  it("streams only media referenced by the exact granted route and generation", async () => {
    const { handler, token } = await fixture();
    const response = await handler(new Request(`http://localhost/recovery?grant=${encodeURIComponent(token)}`), {
      generation: "4",
      digest: mediaDigest
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("image-bytes");
    expect([...response.headers.values()].join(" ")).not.toContain("blob.vercel-storage.com");
  });

  it("rejects tampered recovered bytes", async () => {
    const { handler, token, objects, mediaPath } = await fixture();
    objects.values.set(mediaPath, {
      bytes: new TextEncoder().encode("wrong-bytes"),
      etag: "tampered",
      contentType: "image/webp"
    });
    const response = await handler(new Request(`http://localhost/recovery?grant=${encodeURIComponent(token)}`), {
      generation: "4",
      digest: mediaDigest
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: "RECOVERY_MEDIA_INVALID" } });
  });

  it("returns managed images only through a short-lived application grant", async () => {
    const { artifacts } = await fixture();
    const reader = createRecoveryContentReader({
      artifacts,
      configuredRoutes: ["/"],
      grantSecret: secret,
      nowEpochSeconds: () => 1_786_035_840
    });

    const content = await reader("/");
    const image = content?.regions["home.image"];
    expect(image).toMatchObject({ type: "image", alt: "Community" });
    expect(image?.type === "image" ? image.src : "").toMatch(/^\/api\/builder\/recovery\/media\/4\//);
    expect(JSON.stringify(content)).not.toContain("blob.vercel-storage.com");
  });
});
