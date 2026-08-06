"use client";

import type { MediaAsset } from "@reuben-williams/core";
import type {
  MediaBatchFileResult,
  MediaBatchUploadHandler,
  MediaBatchUploadProgress
} from "@reuben-williams/editor";

import {
  MEDIA_BATCH_MAX_BYTES,
  MEDIA_BATCH_MAX_FILES,
  validateMediaClaim
} from "./media-constraints";

export type InspectedMediaFile = {
  name: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
};

type SignedUploadStorage = {
  uploadToSignedUrl(
    path: string,
    token: string,
    file: File,
    options: { contentType: string; upsert: boolean }
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

type MediaUploadClientOptions = {
  baseUrl: string;
  getCsrfToken: () => string | null;
  storage: SignedUploadStorage;
  fetcher?: typeof fetch;
  inspectFile?: (file: File) => Promise<InspectedMediaFile>;
};

async function sha256Hex(bytes: BufferSource) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function inspectBrowserMediaFile(file: File): Promise<InspectedMediaFile> {
  validateMediaClaim({
    name: file.name,
    mimeType: file.type,
    byteSize: file.size,
    width: 1,
    height: 1
  });
  if (typeof createImageBitmap !== "function") throw new TypeError("This browser cannot inspect selected images.");
  const [sha256, bitmap] = await Promise.all([
    file.arrayBuffer().then(sha256Hex),
    createImageBitmap(file)
  ]);
  const claim = validateMediaClaim({
    name: file.name,
    mimeType: file.type,
    byteSize: file.size,
    width: bitmap.width,
    height: bitmap.height
  });
  bitmap.close();
  return { name: claim.name, mimeType: claim.mimeType, byteSize: claim.byteSize, width: claim.width, height: claim.height, sha256 };
}

function emptyProgress(total: number): MediaBatchUploadProgress {
  return { total, completed: 0, uploaded: 0, skipped: 0, archived: 0, failed: 0 };
}

export function createHttpMediaUploadClient(options: MediaUploadClientOptions): {
  uploadMedia(file: File): Promise<MediaAsset>;
  uploadMediaBatch: MediaBatchUploadHandler;
} {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const inspectFile = options.inspectFile ?? inspectBrowserMediaFile;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, body: Record<string, unknown>, status?: number): Promise<T> {
    const csrf = options.getCsrfToken();
    if (!csrf) throw new Error("The editor session could not be verified. Sign in again.");
    const response = await fetcher(`${baseUrl}${path}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-builder-csrf": csrf,
        "x-idempotency-key": `media:${crypto.randomUUID()}`
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    if (!response.ok || (status !== undefined && response.status !== status)) {
      throw new Error(payload?.error?.message ?? "The media service is unavailable.");
    }
    return payload as T;
  }

  async function uploadOne(file: File, inspected: InspectedMediaFile, manifestId?: string): Promise<{
    asset?: MediaAsset;
    result: MediaBatchFileResult;
  }> {
    type PlanResponse =
      | { outcome: "upload"; planId: string; path: string; token: string }
      | { outcome: "skipped_active"; asset: MediaAsset }
      | { outcome: "skipped_archived" };
    const plan = await request<PlanResponse>("/plans", {
      mode: manifestId ? "batch" : "single",
      ...(manifestId ? { manifestId } : {}),
      sourceName: inspected.name,
      claimedMimeType: inspected.mimeType,
      claimedByteSize: inspected.byteSize,
      claimedWidth: inspected.width,
      claimedHeight: inspected.height,
      expectedSha256: inspected.sha256
    });
    if (plan.outcome === "skipped_active") {
      return { asset: plan.asset, result: { name: file.name, status: "skipped" } };
    }
    if (plan.outcome === "skipped_archived") {
      return { result: { name: file.name, status: "archived", message: "An archived asset already has these bytes." } };
    }

    const uploaded = await options.storage.uploadToSignedUrl(plan.path, plan.token, file, {
      contentType: "image/jpeg",
      upsert: false
    });
    if (uploaded.error) throw new Error(uploaded.error.message ?? "The private Storage upload failed.");
    const finalized = await request<{ outcome: "finalized" | "deduplicated"; asset: MediaAsset }>(
      `/plans/${encodeURIComponent(plan.planId)}/finalize`,
      {}
    );
    return {
      asset: finalized.asset,
      result: {
        name: file.name,
        status: finalized.outcome === "finalized" ? "uploaded" : "skipped"
      }
    };
  }

  async function uploadMedia(file: File) {
    const completed = await uploadOne(file, await inspectFile(file));
    if (!completed.asset || completed.result.status === "archived") {
      throw new Error(completed.result.message ?? "The selected image matches an archived media asset.");
    }
    return completed.asset;
  }

  const uploadMediaBatch: MediaBatchUploadHandler = async (files, onProgress) => {
    if (files.length === 0 || files.length > MEDIA_BATCH_MAX_FILES) {
      throw new Error(`Select between 1 and ${MEDIA_BATCH_MAX_FILES} JPEG images.`);
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MEDIA_BATCH_MAX_BYTES) throw new Error("The selected batch must be no larger than 250 MiB.");
    const inspected = await Promise.all(files.map(inspectFile));
    const manifestSource = inspected
      .map((item) => `${item.name}\u0000${item.byteSize}\u0000${item.sha256}`)
      .sort()
      .join("\n");
    const sourceManifestSha256 = await sha256Hex(new TextEncoder().encode(manifestSource));
    const manifest = await request<{ manifestId: string }>("/manifests", {
      sourceLabel: "Selected private media",
      sourceManifestSha256,
      fileCount: files.length,
      totalBytes
    }, 201);

    const progress = emptyProgress(files.length);
    const assets: MediaAsset[] = [];
    const results: MediaBatchFileResult[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      try {
        const completed = await uploadOne(file, inspected[index]!, manifest.manifestId);
        results.push(completed.result);
        if (completed.asset) assets.push(completed.asset);
        progress[completed.result.status] += 1;
      } catch (candidate) {
        progress.failed += 1;
        results.push({
          name: file.name,
          status: "failed",
          message: candidate instanceof Error ? candidate.message : "The media upload failed."
        });
      }
      progress.completed += 1;
      onProgress({ ...progress, currentFileName: file.name });
    }
    await request<{ receiptId: string; result: string }>(
      `/manifests/${encodeURIComponent(manifest.manifestId)}/complete`,
      { report: results },
      201
    );
    return { assets, results };
  };

  return { uploadMedia, uploadMediaBatch };
}
