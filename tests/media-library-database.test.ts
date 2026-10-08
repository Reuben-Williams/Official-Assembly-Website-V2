import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { validateLibraryCommand } from "../lib/builder/media-library";
const site = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", actor = crypto.randomUUID(), media = crypto.randomUUID(), foreign = crypto.randomUUID();
let db: PGlite;
async function command(version: number, action: string, value: unknown, user = actor, generation = 0) {
  return (await db.query<{ value: { version: number; state: { folders: { id: string }[]; trashed: string[]; placements: Record<string, string> } } }>(
    "select builder_media_library_command_v1($1,$2,$3,$4,$5,$6) value", [site, user, generation, version, action, JSON.stringify(value)])).rows[0].value;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table builder_sites(id uuid primary key); insert into builder_sites values('${site}');
    create table builder_site_members(site_id uuid,user_id uuid,role text,session_generation int);
    insert into builder_site_members values('${site}','${actor}','owner',0);
    create table builder_media_assets(site_id uuid,id uuid,archived_at timestamptz);
    insert into builder_media_assets values('${site}','${media}',null),('${foreign}','${foreign}',null);`);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261008030018_media_library_organization.sql", import.meta.url), "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });
describe("private media library", () => {
  it("creates folders, moves selections and restores recoverable trash without changing asset rows", async () => {
    const created = await command(0, "create-folder", { name: "Community" });
    const folderId = created.state.folders[0].id;
    const moved = await command(1, "move", { ids: [media], folderId });
    expect(moved.state.placements[media]).toBe(folderId);
    expect((await command(2, "trash", { ids: [media] })).state.trashed).toEqual([media]);
    expect((await command(3, "restore", { ids: [media] })).state.trashed).toEqual([]);
    expect((await db.query<{ archived_at: string | null }>("select archived_at from builder_media_assets where id=$1", [media])).rows[0].archived_at).toBeNull();
    expect((await db.query<{ n: number }>("select count(*)::int n from builder_media_library_audit")).rows[0].n).toBe(4);
  });
  it("rejects stale versions, foreign assets, invalid folders and revoked sessions atomically", async () => {
    await expect(command(0, "trash", { ids: [media] })).rejects.toThrow("MEDIA_LIBRARY_STALE");
    await expect(command(4, "trash", { ids: [media, foreign] })).rejects.toThrow("MEDIA_LIBRARY_INVALID");
    await expect(command(4, "move", { ids: [media], folderId: foreign })).rejects.toThrow("MEDIA_LIBRARY_INVALID");
    await expect(command(4, "trash", { ids: [media] }, actor, 1)).rejects.toThrow("MEDIA_LIBRARY_DENIED");
    await expect(command(4, "trash", { ids: [media] }, foreign)).rejects.toThrow("MEDIA_LIBRARY_DENIED");
    expect((await db.query<{ version: number }>("select version::int from builder_media_library_state")).rows[0].version).toBe(4);
  });
  it("keeps direct anonymous and authenticated database access disabled", async () => {
    const result = await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','builder_media_library_command_v1(uuid,uuid,integer,bigint,text,jsonb)','execute') allowed");
    expect(result.rows[0].allowed).toBe(false);
    expect((await db.query<{ allowed: boolean }>("select has_table_privilege('anon','builder_media_library_state','select') allowed")).rows[0].allowed).toBe(false);
  });
  it("validates bounded commands before database access", () => {
    expect(() => validateLibraryCommand({ action: "trash", version: 0, ids: [] })).toThrow();
    expect(() => validateLibraryCommand({ action: "create-folder", version: 0, name: "  " })).toThrow();
    expect(validateLibraryCommand({ action: "move", version: 0, folderId: null, ids: [media, media] }).value).toEqual({ folderId: null, ids: [media] });
  });
});
