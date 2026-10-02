import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActiveBuilderIdentity } from "./authorization";

type Row = {
  id: string;
  media_id: string;
  object_key: string;
  sha256: string;
  byte_size: number;
  mime_type: string;
  width: number;
  height: number;
};
export async function verifyInventoryBytes(row: Row, bytes: Uint8Array) {
  if (
    !row.sha256 ||
    bytes.byteLength !== row.byte_size ||
    createHash("sha256").update(bytes).digest("hex") !== row.sha256
  )
    throw new Error("MEDIA_DIGEST_MISMATCH");
  const image = sharp(bytes, { failOn: "warning", limitInputPixels: 40000000 });
  const meta = await image.metadata();
  if (
    meta.width !== row.width ||
    meta.height !== row.height ||
    `image/${meta.format}` !== row.mime_type
  )
    throw new Error("MEDIA_METADATA_MISMATCH");
  await image.resize(1, 1).raw().toBuffer();
}
export async function verifyExistingMediaInventory(
  client: SupabaseClient,
  identity: ActiveBuilderIdentity,
) {
  if (identity.role !== "owner") throw new Error("OWNER_REQUIRED");
  async function rows() {
    const all: Row[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await client
        .from("builder_media_revisions")
        .select(
          "id,media_id,object_key,sha256,byte_size,mime_type,width,height",
        )
        .eq("site_id", identity.siteId)
        .order("id")
        .range(offset, offset + 499);
      if (result.error) throw new Error("MEDIA_INVENTORY_UNAVAILABLE");
      all.push(...(result.data as Row[]));
      if (result.data.length < 500) return all;
    }
  }
  const source = await rows();
  const receiptId = crypto.randomUUID();
  const start = await client
    .from("builder_media_inventory_receipts")
    .insert({
      site_id: identity.siteId,
      id: receiptId,
      status: "scanning",
      created_by: identity.userId,
    });
  if (start.error) throw new Error("MEDIA_INVENTORY_UNAVAILABLE");
  const verified: Record<string, unknown>[] = [];
  const problems: string[] = [];
  const digests = new Map<string, string>();
  for (let offset = 0; offset < source.length; offset += 4) {
    await Promise.all(
      source.slice(offset, offset + 4).map(async (row) => {
        try {
          const previous = digests.get(row.sha256);
          if (previous && previous !== row.media_id)
            throw new Error("MEDIA_DIGEST_CONFLICT");
          digests.set(row.sha256, row.media_id);
          const downloaded = await client.storage
            .from("builder-media")
            .download(row.object_key);
          if (downloaded.error || !downloaded.data)
            throw new Error("MEDIA_UNREADABLE");
          await verifyInventoryBytes(
            row,
            new Uint8Array(await downloaded.data.arrayBuffer()),
          );
          const canonical = await client
            .from("builder_media_identities")
            .select("media_id,byte_size,mime_type,width,height")
            .eq("site_id", identity.siteId)
            .eq("sha256", row.sha256)
            .single();
          if (
            canonical.error ||
            !canonical.data ||
            (["media_id", "byte_size", "mime_type", "width", "height"] as const).some(
              (key) => canonical.data[key] !== row[key],
            )
          )
            throw new Error("MEDIA_IDENTITY_MISMATCH");
          verified.push({
            site_id: identity.siteId,
            receipt_id: receiptId,
            media_id: row.media_id,
            revision_id: row.id,
            sha256: row.sha256,
            object_key: row.object_key,
            byte_size: row.byte_size,
            mime_type: row.mime_type,
            width: row.width,
            height: row.height,
            result: "verified",
          });
        } catch (error) {
          problems.push(
            `${row.id}:${error instanceof Error ? error.message : "MEDIA_UNREADABLE"}`,
          );
        }
      }),
    );
  }
  const after = await rows();
  if (JSON.stringify(after) !== JSON.stringify(source))
    problems.push("MEDIA_LIBRARY_CHANGED_DURING_SCAN");
  // Recheck membership after the long read-only scan before recording usable evidence.
  const membership = await client
    .from("builder_site_members")
    .select("role,session_generation")
    .eq("site_id", identity.siteId)
    .eq("user_id", identity.userId)
    .single();
  if (
    membership.error ||
    membership.data?.role !== "owner" ||
    membership.data.session_generation !== identity.sessionGeneration
  )
    problems.push("OWNER_SESSION_CHANGED");
  if (verified.length) {
    const inserted = await client
      .from("builder_media_inventory_items")
      .insert(verified);
    if (inserted.error) throw new Error("MEDIA_INVENTORY_UNAVAILABLE");
  }
  const completed = new Date();
  const status = problems.length ? "blocked" : "succeeded";
  const result = await client
    .from("builder_media_inventory_receipts")
    .update({
      status,
      asset_count: new Set(source.map((row) => row.media_id)).size,
      revision_count: source.length,
      digest_count: digests.size,
      problems,
      manifest_sha256: createHash("sha256")
        .update(JSON.stringify(source))
        .digest("hex"),
      completed_at: completed.toISOString(),
      valid_until: problems.length
        ? null
        : new Date(completed.getTime() + 7 * 86400000).toISOString(),
    })
    .eq("site_id", identity.siteId)
    .eq("id", receiptId)
    .eq("status", "scanning");
  if (result.error) throw new Error("MEDIA_INVENTORY_UNAVAILABLE");
  return { status, verified: verified.length, problems: problems.length };
}
