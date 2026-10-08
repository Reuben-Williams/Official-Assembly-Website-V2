import type { MediaAsset } from "@reuben-williams/core";
import { describe, expect, it, vi } from "vitest";

import { createHttpMediaUploadClient } from "../lib/builder/media-client";

const asset: MediaAsset = {
  id: "media-1",
  siteId: "site-1",
  path: "site-1/plan-1/photo.jpg",
  url: "https://storage.example/signed-photo",
  alt: "photo.jpg",
  label: "photo.jpg",
  mimeType: "image/jpeg",
  source: "upload",
  userId: "user-1",
  createdAt: "2026-08-05T20:00:00.000Z"
};

describe("direct private media upload client", () => {
  it('prepares a PNG before inspection and uploads the converted JPEG bytes, not the original PNG', async () => {
    const png = new File(['png'], 'community.png', { type: 'image/png' });
    const jpeg = new File(['jpeg'], 'community.jpg', { type: 'image/jpeg' });
    const inspectFile = vi.fn(async (file: File) => ({ name: file.name, mimeType: file.type, byteSize: file.size, width: 1, height: 1, sha256: 'a'.repeat(64) }));
    const uploadToSignedUrl = vi.fn(async () => ({ data: {}, error: null }));
    const states = vi.fn();
    const client = createHttpMediaUploadClient({ baseUrl: '/api/builder/media', getCsrfToken: () => 'csrf', storage: { uploadToSignedUrl },
      prepareFile: async () => jpeg, inspectFile, onUploadState: states,
      fetcher: vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ outcome: 'upload', planId: 'plan', path: 'photo.jpg', token: 'token' })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ outcome: 'finalized', asset }))),
    });
    await client.uploadMedia(png);
    expect(inspectFile).toHaveBeenCalledWith(jpeg);
    expect(uploadToSignedUrl).toHaveBeenCalledWith('photo.jpg', 'token', jpeg, expect.anything());
    expect(states).toHaveBeenNthCalledWith(1, { status: 'uploading', name: 'community.png' });
    expect(states).toHaveBeenLastCalledWith({ status: 'selected', name: 'community.png' });
  });

  it('reports rejected files and leaves the previous selection unchanged instead of silently swallowing the failure', async () => {
    const states = vi.fn();
    const client = createHttpMediaUploadClient({ baseUrl: '/api/builder/media', getCsrfToken: () => 'csrf', storage: { uploadToSignedUrl: vi.fn() },
      inspectFile: async () => { throw new TypeError('Each image must be no larger than 10 MiB.'); }, onUploadState: states,
    });
    await expect(client.uploadMedia(new File(['jpeg'], 'large.jpg', { type: 'image/jpeg' }))).rejects.toThrow('10 MiB');
    expect(states).toHaveBeenLastCalledWith({ status: 'error', name: 'large.jpg', message: 'Each image must be no larger than 10 MiB.' });
  });
  it("plans, directly uploads, and finalizes one image without sending bytes through the app", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "upload", planId: "plan-1", path: asset.path, token: "signed-token"
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ outcome: "finalized", asset }), {
        status: 200, headers: { "content-type": "application/json" }
      }));
    const uploadToSignedUrl = vi.fn(async () => ({ data: { path: asset.path }, error: null }));
    const client = createHttpMediaUploadClient({
      baseUrl: "/api/builder/media",
      getCsrfToken: () => "csrf-token",
      fetcher,
      storage: { uploadToSignedUrl },
      inspectFile: async () => ({
        name: "photo.jpg", mimeType: "image/jpeg", byteSize: 4, width: 1, height: 1,
        sha256: "a".repeat(64)
      })
    });
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "photo.jpg", { type: "image/jpeg" });

    await expect(client.uploadMedia(file, {
      label: "Community town hall",
      alt: "Residents speaking at a community town hall"
    })).resolves.toEqual(asset);
    expect(uploadToSignedUrl).toHaveBeenCalledWith(asset.path, "signed-token", file, {
      contentType: "image/jpeg",
      upsert: false
    });
    expect(fetcher.mock.calls[0]?.[1]?.body).toEqual(expect.any(String));
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain("255,216,255");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      label: "Community town hall",
      alt: "Residents speaking at a community town hall"
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/builder/media/plans/plan-1/finalize");
  });

  it("creates one owner batch manifest and reports skips without uploading duplicate bytes", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ manifestId: "manifest-1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ outcome: "skipped_active", asset }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ receiptId: "receipt-1", result: "completed" }), { status: 201 }));
    const uploadToSignedUrl = vi.fn();
    const progress = vi.fn();
    const client = createHttpMediaUploadClient({
      baseUrl: "/api/builder/media",
      getCsrfToken: () => "csrf-token",
      fetcher,
      storage: { uploadToSignedUrl },
      inspectFile: async (file) => ({
        name: file.name, mimeType: "image/jpeg", byteSize: file.size, width: 1, height: 1,
        sha256: "b".repeat(64)
      })
    });
    const file = new File([new Uint8Array([0xff])], "duplicate.jpg", { type: "image/jpeg" });

    const result = await client.uploadMediaBatch([file], progress);
    expect(result.assets).toEqual([asset]);
    expect(result.results).toEqual([{ name: "duplicate.jpg", status: "skipped" }]);
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 1, skipped: 1, failed: 0 }));
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/builder/media/manifests");
    expect(fetcher.mock.calls[2]?.[0]).toBe("/api/builder/media/manifests/manifest-1/complete");
    expect(String(fetcher.mock.calls[2]?.[1]?.body)).toContain('"status":"skipped"');
  });
});
