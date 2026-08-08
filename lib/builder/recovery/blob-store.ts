import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

import {
  recoveryNamespace,
  validateLatestPointer,
  type RecoveryEnvironment,
  type RecoveryLatestPointer
} from "./contracts";

export interface RecoveryObjectValue {
  readonly bytes: Uint8Array;
  readonly etag: string;
  readonly contentType: string;
}

export interface RecoveryObjectStore {
  get(path: string, options: { useCache: boolean }): Promise<RecoveryObjectValue | null>;
  put(path: string, bytes: Uint8Array, options: {
    allowOverwrite: boolean;
    ifMatch?: string;
    contentType: string;
  }): Promise<{ etag: string }>;
}

export type RecoveryStoreErrorCode =
  | "PRECONDITION_FAILED"
  | "IMMUTABLE_CONFLICT"
  | "INVALID_ARTIFACT"
  | "POINTER_CONFLICT";

export class RecoveryStoreError extends Error {
  constructor(readonly code: RecoveryStoreErrorCode) {
    super(code);
    this.name = "RecoveryStoreError";
  }
}

export function canonicalRecoveryJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRecoveryJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) throw new RecoveryStoreError("INVALID_ARTIFACT");
      return `${JSON.stringify(key)}:${canonicalRecoveryJson(entry)}`;
    }).join(",")}}`;
  }
  throw new RecoveryStoreError("INVALID_ARTIFACT");
}

export async function recoveryDigest(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RecoveryStoreError("INVALID_ARTIFACT");
  }
}

export function createVercelBlobObjectStore(input: { token: string }): RecoveryObjectStore {
  if (!input.token) throw new TypeError("A private recovery Blob token is required.");
  return {
    async get(path, options) {
      const result = await get(path, {
        access: "private",
        token: input.token,
        useCache: options.useCache
      });
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream || !result.blob.contentType) {
        throw new RecoveryStoreError("INVALID_ARTIFACT");
      }
      const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
      return { bytes, etag: result.blob.etag, contentType: result.blob.contentType };
    },
    async put(path, bytes, options) {
      try {
        const result = await put(path, new Blob([bytes.slice().buffer], { type: options.contentType }), {
          access: "private",
          token: input.token,
          addRandomSuffix: false,
          allowOverwrite: options.allowOverwrite,
          ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
          contentType: options.contentType
        });
        return { etag: result.etag };
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) {
          throw new RecoveryStoreError("PRECONDITION_FAILED");
        }
        throw error;
      }
    }
  };
}

export function createRecoveryArtifactStore(input: {
  objects: RecoveryObjectStore;
  environment: RecoveryEnvironment;
  siteKey: string;
}) {
  const namespace = recoveryNamespace(input.environment, input.siteKey);
  const latestPath = `${namespace}/latest.json`;

  async function readLatest() {
    const current = await input.objects.get(latestPath, { useCache: false });
    if (!current) return null;
    return {
      pointer: validateLatestPointer(parseJson(current.bytes), input),
      etag: current.etag
    };
  }

  return {
    environment: input.environment,
    siteKey: input.siteKey,
    latestPath,
    async readJson(path: string, options: { useCache: boolean }) {
      const value = await input.objects.get(path, options);
      if (!value || value.contentType !== "application/json") return null;
      return { value: parseJson(value.bytes), etag: value.etag };
    },
    readObject(path: string, options: { useCache: boolean }) {
      return input.objects.get(path, options);
    },
    async writeImmutableJson(path: string, value: unknown) {
      if (!path.startsWith(`${namespace}/`)) throw new RecoveryStoreError("INVALID_ARTIFACT");
      const bytes = new TextEncoder().encode(canonicalRecoveryJson(value));
      const digest = await recoveryDigest(bytes);
      try {
        const result = await input.objects.put(path, bytes, {
          allowOverwrite: false,
          contentType: "application/json"
        });
        return { path, digest, byteLength: bytes.byteLength, etag: result.etag };
      } catch (error) {
        if (!(error instanceof RecoveryStoreError) || error.code !== "PRECONDITION_FAILED") throw error;
        const existing = await input.objects.get(path, { useCache: false });
        if (!existing || existing.contentType !== "application/json" || !sameBytes(existing.bytes, bytes)) {
          throw new RecoveryStoreError("IMMUTABLE_CONFLICT");
        }
        return { path, digest, byteLength: bytes.byteLength, etag: existing.etag };
      }
    },
    async writeImmutableBytes(path: string, bytes: Uint8Array, options: {
      contentType: string;
      expectedDigest: string;
    }) {
      if (!path.startsWith(`${namespace}/`) || !options.contentType ||
          await recoveryDigest(bytes) !== options.expectedDigest) {
        throw new RecoveryStoreError("INVALID_ARTIFACT");
      }
      try {
        const result = await input.objects.put(path, bytes, {
          allowOverwrite: false,
          contentType: options.contentType
        });
        return { path, digest: options.expectedDigest, byteLength: bytes.byteLength, etag: result.etag };
      } catch (error) {
        if (!(error instanceof RecoveryStoreError) || error.code !== "PRECONDITION_FAILED") throw error;
        const existing = await input.objects.get(path, { useCache: false });
        if (!existing || existing.contentType !== options.contentType || !sameBytes(existing.bytes, bytes)) {
          throw new RecoveryStoreError("IMMUTABLE_CONFLICT");
        }
        return { path, digest: options.expectedDigest, byteLength: bytes.byteLength, etag: existing.etag };
      }
    },
    readLatest,
    async advanceLatest(pointer: RecoveryLatestPointer): Promise<{
      status: "advanced" | "superseded";
      generationId: number;
    }> {
      validateLatestPointer(pointer, input);
      const bytes = new TextEncoder().encode(canonicalRecoveryJson(pointer));
      const current = await readLatest();
      if (current && current.pointer.generationId >= pointer.generationId) {
        return { status: "superseded", generationId: current.pointer.generationId };
      }
      try {
        await input.objects.put(latestPath, bytes, {
          allowOverwrite: Boolean(current),
          ...(current ? { ifMatch: current.etag } : {}),
          contentType: "application/json"
        });
        return { status: "advanced", generationId: pointer.generationId };
      } catch (error) {
        if (!(error instanceof RecoveryStoreError) || error.code !== "PRECONDITION_FAILED") throw error;
        const raced = await readLatest();
        if (raced && raced.pointer.generationId >= pointer.generationId) {
          return { status: "superseded", generationId: raced.pointer.generationId };
        }
        throw new RecoveryStoreError("POINTER_CONFLICT");
      }
    }
  };
}

export type RecoveryArtifactStore = ReturnType<typeof createRecoveryArtifactStore>;
