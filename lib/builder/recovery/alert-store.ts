import type {
  AlertRecoveryDigest,
  AlertRecoveryStore,
} from "@reuben-williams/next/alerts/server";

import {
  RecoveryStoreError,
  type RecoveryObjectStore,
} from "./blob-store";

const JSON_CONTENT_TYPE = "application/json";

function precondition(error: unknown) {
  return error instanceof RecoveryStoreError && error.code === "PRECONDITION_FAILED";
}

function encode(value: string) {
  return new TextEncoder().encode(value);
}

function decode(value: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}

export const alertRecoveryDigest: AlertRecoveryDigest = Object.freeze({
  async sha256(value: string) {
    const digest = await crypto.subtle.digest("SHA-256", encode(value).buffer);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  },
});

export function createAlertRecoveryStore(objects: RecoveryObjectStore): AlertRecoveryStore {
  return Object.freeze({
    async putImmutable(path: string, value: string) {
      const bytes = encode(value);
      try {
        await objects.put(path, bytes, {
          allowOverwrite: false,
          contentType: JSON_CONTENT_TYPE,
        });
        return "created" as const;
      } catch (error) {
        if (!precondition(error)) throw error;
        const existing = await objects.get(path, { useCache: false });
        if (!existing || existing.contentType !== JSON_CONTENT_TYPE) return "conflict" as const;
        try {
          return decode(existing.bytes) === value ? "exists" as const : "conflict" as const;
        } catch {
          return "conflict" as const;
        }
      }
    },
    async read(path: string) {
      const existing = await objects.get(path, { useCache: false });
      if (!existing || existing.contentType !== JSON_CONTENT_TYPE) return null;
      try {
        return { value: decode(existing.bytes), etag: existing.etag };
      } catch {
        return null;
      }
    },
    async compareAndSwap(path: string, expectedEtag: string | null, value: string) {
      try {
        await objects.put(path, encode(value), {
          allowOverwrite: expectedEtag !== null,
          ...(expectedEtag !== null ? { ifMatch: expectedEtag } : {}),
          contentType: JSON_CONTENT_TYPE,
        });
        return true;
      } catch (error) {
        if (precondition(error)) return false;
        throw error;
      }
    },
  });
}
