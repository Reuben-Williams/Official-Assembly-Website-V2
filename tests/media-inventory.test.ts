import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import {
  verifyInventoryBytes,
  verifyExistingMediaInventory,
} from "../lib/builder/media-inventory";
import type { SupabaseClient } from "@supabase/supabase-js";
const actor = {
  siteId: "site",
  siteKey: "site",
  userId: "owner",
  role: "owner" as const,
  sessionGeneration: 1,
  tokenGeneration: 1,
  csrfToken: "csrf",
};
async function fixture() {
  const bytes = await sharp({
    create: { width: 8, height: 6, channels: 3, background: "navy" },
  })
    .jpeg()
    .toBuffer();
  const row = {
    id: "revision",
    media_id: "media",
    object_key: "private.jpg",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byte_size: bytes.length,
    mime_type: "image/jpeg",
    width: 8,
    height: 6,
  };
  return { row, bytes };
}
it("verifies bytes, dimensions and mime type rather than trusting database metadata", async () => {
  const { row, bytes } = await fixture();
  await expect(verifyInventoryBytes(row, bytes)).resolves.toBeUndefined();
  await expect(
    verifyInventoryBytes({ ...row, width: 9 }, bytes),
  ).rejects.toThrow("METADATA");
  await expect(
    verifyInventoryBytes({ ...row, sha256: "0".repeat(64) }, bytes),
  ).rejects.toThrow("DIGEST");
});
it.each(["healthy", "unreadable", "revoked"])(
  "records accurate verification evidence for a %s library",
  async (mode) => {
    const { row, bytes } = await fixture();
    const writes: { table: string; value: Record<string, unknown> }[] = [];
    const client = {
      from: (table: string) => {
        const result = () => ({
          data:
            table === "builder_media_revisions"
              ? [row]
              : table === "builder_media_identities"
                ? row
                : table === "builder_site_members"
                  ? {
                      role: "owner",
                      session_generation: mode === "revoked" ? 2 : 1,
                    }
                  : null,
          error: null,
        });
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          range: async () => result(),
          single: async () => result(),
          insert: (value: Record<string, unknown>) => {
            writes.push({ table, value });
            return query;
          },
          update: (value: Record<string, unknown>) => {
            writes.push({ table, value });
            return query;
          },
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve),
        };
        return query;
      },
      storage: {
        from: () => ({
          download: async () =>
            mode === "unreadable"
              ? { error: {}, data: null }
              : { error: null, data: new Blob([bytes]) },
        }),
      },
    } as unknown as SupabaseClient;
    const result = await verifyExistingMediaInventory(client, actor);
    expect(result.status).toBe(mode === "healthy" ? "succeeded" : "blocked");
    expect(
      writes.every((write) =>
        [
          "builder_media_inventory_receipts",
          "builder_media_inventory_items",
        ].includes(write.table),
      ),
    ).toBe(true);
    const receipt = writes.at(-1)!.value;
    expect(receipt.valid_until !== null).toBe(mode === "healthy");
    expect(receipt.created_by).toBeUndefined();
    expect(writes[0].value.created_by).toBe("owner");
  },
);
it("rejects non-owner callers before any database access", async () => {
  await expect(
    verifyExistingMediaInventory({} as SupabaseClient, {
      ...actor,
      role: "editor",
    }),
  ).rejects.toThrow("OWNER_REQUIRED");
});
