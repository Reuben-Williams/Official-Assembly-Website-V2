import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { STAFF_HISTORY_MANIFEST, planStaffHistory } from "../lib/newsletter/staff-auth-delivery.ts";
import { staffReceiptRow } from "../lib/newsletter/staff-auth-repository.ts";
import { createProductionNewsletterOwnerLoginEmailReader } from "../lib/newsletter/resend/inventory-adapter.ts";
import { getBuilderAdminClient, resolveBuilderSiteId } from "../lib/supabase/admin.ts";

// Read-only preparation. Apply uses the authenticated management connection, not this script.
async function main() {
  const metadataOnly = process.argv.length === 3 && process.argv[2] === "--metadata-only";
  if (!metadataOnly && (process.argv.length !== 4 || process.argv[2] !== "--output")) throw new Error("invalid_arguments");
  const client = getBuilderAdminClient(), key = process.env.RESEND_MANAGEMENT_API_KEY;
  if (!client || !key || key.includes("SENSITIVE")) throw new Error("protected_configuration_unavailable");
  const siteId = await resolveBuilderSiteId(client); if (!siteId) throw new Error("site_unavailable");
  const members = await client.from("builder_site_members").select("user_id,role").eq("site_id", siteId);
  if (members.error || !members.data) throw new Error("membership_unavailable");
  const accounts = new Map(); let ownerId;
  for (const member of members.data) {
    const result = await client.auth.admin.getUserById(member.user_id);
    const user = result.data.user;
    if (result.error || !user?.email_confirmed_at || user.is_anonymous) continue;
    const email = user.email?.trim().toLowerCase();
    if (STAFF_HISTORY_MANIFEST.some((m) => m.email === email)) accounts.set(email, user.id);
    if (email === "anotherstory713@gmail.com" && member.role === "owner") ownerId = user.id;
  }
  if (!ownerId) throw new Error("approved_owner_unavailable");
  const reader = createProductionNewsletterOwnerLoginEmailReader(key);
  const wanted = new Set(STAFF_HISTORY_MANIFEST.map((m) => m.id)); const found = new Map(); const cursors = new Set();
  let after; const started = Date.now();
  for (let n = 0; n < 20 && found.size < 5; n++) {
    if (Date.now() - started >= 5000) throw new Error("metadata_unavailable");
    let timer;
    const page = await Promise.race([reader.listEmails({ limit: 100, after }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("metadata_unavailable")), 5000 - (Date.now() - started)); })
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (Date.now() - started >= 5000) throw new Error("metadata_unavailable");
    for (const email of page.items) {
      if (!Number.isFinite(Date.parse(email.createdAt))) throw new Error("metadata_unavailable");
      if (wanted.has(email.id)) { if (found.has(email.id)) throw new Error("metadata_ambiguous"); found.set(email.id, email); }
    }
    if (!page.hasMore) break;
    if (!page.after || cursors.has(page.after)) throw new Error("metadata_unavailable");
    cursors.add(page.after); after = page.after;
  }
  if (found.size !== 5) throw new Error("metadata_incomplete");
  const receipts = await client.from("builder_newsletter_webhook_receipts")
    .select("id,site_id,provider_message_id,provider_scope_id,provider_broadcast_id,disposition,event_type")
    .eq("site_id", siteId).in("provider_message_id", [...wanted]);
  if (receipts.error || !receipts.data) throw new Error("receipts_unavailable");
  const plan = planStaffHistory({ siteId, ownerId, emails: [...found.values()], receipts: receipts.data.map(staffReceiptRow), accounts });
  if (metadataOnly) {
    // Never print addresses, recipient hashes, bodies, links, credentials or raw payloads.
    process.stdout.write(JSON.stringify({ status: "dry_run_ready", count: 5, digest: plan.digest,
      verifiedMetadata: plan.entries.map((e) => ({ id: e.providerMessageId, createdAt: e.providerCreatedAt })) }) + "\n");
    return;
  }
  const output = path.resolve(process.argv[3]); await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ siteId, ownerId, ...plan }), { encoding: "utf8", flag: "wx" });
  process.stdout.write(JSON.stringify({ status: "dry_run_ready", count: 5, digest: plan.digest }) + "\n");
}
main().catch(() => { process.stderr.write('{"status":"dry_run_unavailable"}\n'); process.exitCode = 1; });
