import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { STAFF_HISTORY_MANIFEST, STAFF_DELIVERY_POLICY, digestRecipient, deliveryDigest, planStaffHistory, type StaffDeliveryEvidence } from "../lib/newsletter/staff-auth-delivery";

const site = "10000000-0000-4000-8000-000000000001";
const owner = "20000000-0000-4000-8000-000000000001";
const damon = "20000000-0000-4000-8000-000000000002";
const worker = "30000000-0000-4000-8000-000000000001";
const otherWorker = "30000000-0000-4000-8000-000000000002";
let db: PGlite;
const rpc = async <T = unknown>(name: string, args: unknown[], casts: string[]) =>
  (await db.query<{ result: T }>(`select public.${name}(${args.map((_, i) => `$${i + 1}::${casts[i]}`).join(",")}) as result`, args)).rows[0]!.result;
const reserve = () => rpc<{ id: string; reserved_at: string } | null>("builder_staff_auth_reserve", ["official-assembly-website-v2", "damonyoung@dtvprods.com", crypto.randomUUID()], ["text", "text", "uuid"]);
const finalize = (id: string, state = "accepted") => rpc("builder_staff_auth_finalize", [id, state, state === "accepted" ? "auth_accepted" : "auth_uncertain"], ["uuid", "text", "text"]);
const count = async (table: string) => (await db.query<{ count: number }>(`select count(*)::int as count from public.${table}`)).rows[0]!.count;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, is_anonymous boolean default false);
    create table public.builder_sites(id uuid primary key, site_key text unique);
    create table public.builder_site_members(site_id uuid, user_id uuid, role text, session_generation integer, primary key(site_id,user_id));
    create table public.builder_audit_events(id uuid default gen_random_uuid(), site_id uuid, action text, actor_id uuid not null, summary text not null, correlation_id text, after_value jsonb, created_at timestamptz default clock_timestamp());
    create table public.builder_newsletter_webhook_receipts(id uuid, site_id uuid, provider_message_id text, provider_scope_id text, disposition text, provider_broadcast_id text, event_type text, primary key(site_id,id));
    create table public.builder_newsletter_jobs(site_id uuid, kind text, provider_message_id text);
    create table public.builder_newsletter_staff_test_observations(site_id uuid, provider_message_id text, state text);
    create table public.builder_newsletter_auth_smtp_proofs(site_id uuid, provider_message_id text);
    create table public.builder_newsletter_provider_history_reconciliations(site_id uuid, provider_message_id text);
    insert into builder_sites values ('${site}','official-assembly-website-v2');
    insert into auth.users values ('${owner}','anotherstory713@gmail.com',now(),false), ('${damon}','damonyoung@dtvprods.com',now(),false);
    insert into builder_site_members values ('${site}','${owner}','owner',3), ('${site}','${damon}','owner',2);
  `);
  await db.exec(readFileSync("supabase/migrations/20261006044819_staff_auth_delivery_evidence.sql", "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`truncate builder_staff_auth_delivery_evidence, builder_staff_auth_accounting_jobs, builder_staff_auth_requests, builder_audit_events, builder_newsletter_webhook_receipts;
    update builder_site_members set role='owner',session_generation=2 where user_id='${damon}';
    update auth.users set email_confirmed_at=now(),is_anonymous=false where id='${damon}';`);
});

describe("real isolated PostgreSQL staff accounting", () => {
  it("reserves confirmed members for all four roles, never unknown or anonymous accounts", async () => {
    for (const role of ["owner", "editor", "contributor", "viewer"]) {
      await db.exec(`truncate builder_staff_auth_requests cascade; update builder_site_members set role='${role}' where user_id='${damon}';`);
      expect(await reserve()).not.toBeNull();
    }
    expect(await rpc("builder_staff_auth_reserve", ["official-assembly-website-v2", "unknown@example.com", crypto.randomUUID()], ["text", "text", "uuid"])).toBeNull();
    await db.exec(`truncate builder_staff_auth_requests cascade; update auth.users set is_anonymous=true where id='${damon}'`);
    expect(await reserve()).toBeNull();
    await db.exec(`update auth.users set is_anonymous=false,email_confirmed_at=null where id='${damon}'`);
    expect(await reserve()).toBeNull();
  });
  it("enforces persistent concurrency and rolling-hour limits", async () => {
    const results = await Promise.all([reserve(), reserve(), reserve()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    for (let i = 0; i < 5; i++) {
      await db.exec("update builder_staff_auth_requests set reserved_at=reserved_at-interval '61 seconds'");
      expect(await reserve()).not.toBeNull();
    }
    await db.exec("update builder_staff_auth_requests set reserved_at=reserved_at-interval '61 seconds'");
    expect(await reserve()).toBeNull(); expect(await count("builder_staff_auth_requests")).toBe(6);
  });
  it("queues acceptance once, rejects conflicting finalizations and seals late/interrupted outcomes", async () => {
    const row = (await reserve())!;
    expect(await finalize(row.id)).toBe("accepted"); expect(await finalize(row.id)).toBe("accepted");
    expect(await count("builder_staff_auth_accounting_jobs")).toBe(1);
    await expect(finalize(row.id, "uncertain")).rejects.toThrow();
    await db.exec("truncate builder_staff_auth_requests cascade");
    const late = (await reserve())!;
    await db.exec("update builder_staff_auth_requests set reserved_at=reserved_at-interval '21 seconds'");
    expect(await finalize(late.id)).toBe("uncertain"); expect(await count("builder_staff_auth_accounting_jobs")).toBe(0);
    await expect(finalize(late.id)).rejects.toThrow();
    await db.exec("truncate builder_staff_auth_requests cascade");
    const interrupted = (await reserve())!;
    await db.exec("update builder_staff_auth_requests set reserved_at=reserved_at-interval '31 seconds'");
    await rpc("builder_staff_auth_housekeeping", [], []);
    expect((await db.query<{ state: string }>("select state from builder_staff_auth_requests where id=$1", [interrupted.id])).rows[0]!.state).toBe("uncertain");
  });
  it("does not accept a transaction that crosses the twenty-second deadline while queuing", async () => {
    const row = (await reserve())!;
    await db.exec(`update builder_staff_auth_requests set reserved_at=clock_timestamp()-interval '19 seconds';
      create function public.test_slow_staff_queue() returns trigger language plpgsql as $$ begin perform pg_sleep(1.1); return new; end; $$;
      create trigger test_slow_staff_queue after insert on builder_staff_auth_accounting_jobs for each row execute function public.test_slow_staff_queue();`);
    try {
      expect(await finalize(row.id)).toBe("uncertain");
      expect(await count("builder_staff_auth_accounting_jobs")).toBe(0);
    } finally { await db.exec("drop trigger test_slow_staff_queue on builder_staff_auth_accounting_jobs; drop function public.test_slow_staff_queue()"); }
  });
  it("enforces the shared twenty-per-site rolling-hour cap", async () => {
    const users = Array.from({ length: 21 }, () => crypto.randomUUID());
    try {
      for (const [i, id] of users.entries()) {
        await db.query("insert into auth.users values ($1,$2,now(),false)", [id, `staff${i}@example.test`]);
        await db.query("insert into builder_site_members values ($1,$2,'viewer',1)", [site, id]);
        const result = await rpc("builder_staff_auth_reserve", ["official-assembly-website-v2", `staff${i}@example.test`, crypto.randomUUID()], ["text", "text", "uuid"]);
        expect(Boolean(result)).toBe(i < 20);
      }
      expect(await count("builder_staff_auth_requests")).toBe(20);
    } finally {
      await db.exec("truncate builder_staff_auth_requests cascade");
      await db.query("delete from builder_site_members where user_id=any($1::uuid[])", [users]);
      await db.query("delete from auth.users where id=any($1::uuid[])", [users]);
    }
  });
  it("fences expired workers and retries with database exponential backoff", async () => {
    const row = (await reserve())!; await finalize(row.id);
    const claim = await rpc<{ request_id: string; fencing_token: number }[]>("builder_staff_auth_claim", [site, worker, 2], ["uuid", "uuid", "integer"]);
    expect(claim).toHaveLength(1);
    await db.exec("update builder_staff_auth_accounting_jobs set lease_until=clock_timestamp()-interval '1 second'");
    const reclaimed = await rpc<{ fencing_token: number }[]>("builder_staff_auth_claim", [site, otherWorker, 2], ["uuid", "uuid", "integer"]);
    expect(reclaimed[0]!.fencing_token).toBeGreaterThan(claim[0]!.fencing_token);
    await expect(rpc("builder_staff_auth_fail", [row.id, worker, claim[0]!.fencing_token, "missing_receipts"], ["uuid", "uuid", "bigint", "text"])).rejects.toThrow();
    await rpc("builder_staff_auth_fail", [row.id, otherWorker, reclaimed[0]!.fencing_token, "missing_receipts"], ["uuid", "uuid", "bigint", "text"]);
    const delay = (await db.query<{ seconds: number }>("select extract(epoch from available_at-clock_timestamp())::float as seconds from builder_staff_auth_accounting_jobs")).rows[0]!.seconds;
    expect(delay).toBeGreaterThan(115); expect(delay).toBeLessThanOrEqual(120);
    await db.exec("update builder_staff_auth_accounting_jobs set attempt_count=12,available_at=clock_timestamp()-interval '1 second'");
    expect(await rpc("builder_staff_auth_claim", [site, worker, 2], ["uuid", "uuid", "integer"])).toEqual([]);
    expect((await db.query<{ state: string }>("select state from builder_staff_auth_accounting_jobs")).rows[0]!.state).toBe("unresolved");
  });
  it("restricts all new tables and privileged operations to service-only access", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["builder_staff_auth_requests", "builder_staff_auth_delivery_evidence", "builder_staff_auth_accounting_jobs"]) {
        expect((await db.query<{ allowed: boolean }>("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as allowed", [role, `public.${table}`])).rows[0]!.allowed).toBe(false);
      }
      expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,'public.builder_staff_auth_reserve(text,text,uuid)','EXECUTE') as allowed", [role])).rows[0]!.allowed).toBe(false);
      const functions = await db.query<{ oid: number }>("select oid from pg_proc where proname like 'builder_staff_%'");
      for (const fn of functions.rows) expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2::oid,'EXECUTE') as allowed", [role, fn.oid])).rows[0]!.allowed).toBe(false);
    }
    expect((await db.query<{ count: number }>("select count(*)::int as count from pg_class where relname like 'builder_staff_auth_%' and relrowsecurity")).rows[0]!.count).toBe(3);
    expect((await db.query<{ allowed: boolean }>("select has_table_privilege('service_role','public.builder_staff_auth_delivery_evidence','UPDATE,DELETE') as allowed")).rows[0]!.allowed).toBe(false);
  });
  it("records fenced evidence and audit atomically, rejecting unsafe receipts, overlap and updates", async () => {
    const row = (await reserve())!; await finalize(row.id);
    const claim = (await rpc<{ fencing_token: number }[]>("builder_staff_auth_claim", [site, worker, 2], ["uuid", "uuid", "integer"]))[0]!;
    const message = crypto.randomUUID(), sent = crypto.randomUUID(), delivered = crypto.randomUUID();
    const createdAt = new Date(row.reserved_at).toISOString();
    for (const [id, event] of [[sent, "email.sent"], [delivered, "email.delivered"]])
      await db.query("insert into builder_newsletter_webhook_receipts values ($1,$2,$3,'resend-team-production','matched',null,$4)", [id, site, message, event]);
    const record: StaffDeliveryEvidence = { siteId: site, providerScopeId: "resend-team-production", policyVersion: STAFF_DELIVERY_POLICY,
      providerMessageId: message, targetUserId: damon, recipientDigest: digestRecipient("damonyoung@dtvprods.com"), purpose: "staff_sign_in", provenance: "tracked_request",
      requestId: row.id, providerCreatedAt: createdAt, sender: "no-reply@updates.assemblywomanmorales.com", subject: "Your sign-in link",
      sentReceiptId: sent, deliveredReceiptId: delivered, metadataDigest: "", auditCorrelation: row.id };
    record.metadataDigest = deliveryDigest(record);
    const args = [row.id, worker, claim.fencing_token, JSON.stringify(record)], casts = ["uuid", "uuid", "bigint", "jsonb"];
    const bad = crypto.randomUUID();
    await db.query("insert into builder_newsletter_webhook_receipts values ($1,$2,$3,'resend-team-production','incident',null,'email.bounced')", [bad, site, message]);
    await expect(rpc("builder_staff_auth_record", args, casts)).rejects.toThrow();
    expect(await count("builder_staff_auth_delivery_evidence")).toBe(0); expect(await count("builder_audit_events")).toBe(0);
    await db.query("delete from builder_newsletter_webhook_receipts where id=$1", [bad]);
    await db.query("insert into builder_staff_auth_requests(id,site_id,target_user_id,membership_generation,recipient_digest,state) values($1,$2,$3,2,$4,'uncertain')", [bad, site, damon, record.recipientDigest]);
    await expect(rpc("builder_staff_auth_record", args, casts)).rejects.toThrow();
    await db.query("delete from builder_staff_auth_requests where id=$1", [bad]);
    expect(await rpc("builder_staff_auth_record", args, casts)).toBe("recorded");
    expect(await count("builder_staff_auth_delivery_evidence")).toBe(1); expect(await count("builder_audit_events")).toBe(1);
    await expect(db.exec("update builder_staff_auth_delivery_evidence set metadata_digest=repeat('a',64)")).rejects.toThrow();
    await expect(rpc("builder_staff_auth_record", args, casts)).rejects.toThrow(); // Completed claim cannot be reused.
  });
  it("owner recovery is audited, idempotent, fenced, and cannot resend uncertain/expired requests", async () => {
    const row = (await reserve())!; await finalize(row.id);
    const command = crypto.randomUUID();
    const args = [site, owner, row.id, command], casts = ["uuid", "uuid", "uuid", "uuid"];
    await db.exec("update builder_staff_auth_accounting_jobs set state='unresolved',attempt_count=12");
    expect(await rpc("builder_staff_auth_recover", args, casts)).toBe("queued");
    expect(await rpc("builder_staff_auth_recover", args, casts)).toBe("already_recorded");
    expect(await count("builder_audit_events")).toBe(1);
    await db.exec("update builder_staff_auth_accounting_jobs set deadline_at=clock_timestamp()-interval '1 second'");
    await expect(rpc("builder_staff_auth_recover", [site, owner, row.id, crypto.randomUUID()], casts)).rejects.toThrow();
    await db.exec("truncate builder_staff_auth_requests cascade");
    const uncertain = (await reserve())!; await finalize(uncertain.id, "uncertain");
    await expect(rpc("builder_staff_auth_recover", [site, owner, uncertain.id, crypto.randomUUID()], casts)).rejects.toThrow();
  });
  it("applies exactly-five history and audits atomically, idempotently and digest-bound", async () => {
    const emails = STAFF_HISTORY_MANIFEST.map((m, i) => ({ id: m.id, subject: m.subject, to: [m.email], from: "no-reply@updates.assemblywomanmorales.com", status: "delivered", createdAt: `2026-10-02T12:00:0${i}.000Z` }));
    const receipts = emails.flatMap((m) => ["email.sent", "email.delivered"].map((eventType) => ({ id: crypto.randomUUID(), siteId: site, providerMessageId: m.id, providerScopeId: "resend-team-production", disposition: "matched", providerBroadcastId: null, eventType })));
    for (const r of receipts) await db.query("insert into builder_newsletter_webhook_receipts values ($1,$2,$3,$4,$5,$6,$7)", [r.id, site, r.providerMessageId, r.providerScopeId, r.disposition, null, r.eventType]);
    const plan = planStaffHistory({ siteId: site, ownerId: owner, emails, receipts, accounts: new Map([["damonyoung@dtvprods.com", damon], ["anotherstory713@gmail.com", owner]]) });
    const args = [site, owner, JSON.stringify(plan.entries), plan.digest, "owner_approved_management_operation"];
    const casts = ["uuid", "uuid", "jsonb", "text", "text"];
    await expect(rpc("builder_staff_auth_history_apply", [...args.slice(0, 4), null], casts)).rejects.toThrow();
    await expect(rpc("builder_staff_auth_history_apply", [site, owner, JSON.stringify(plan.entries), "wrong", args[4]], casts)).rejects.toThrow();
    expect(await count("builder_staff_auth_delivery_evidence")).toBe(0);
    const badReceipt = crypto.randomUUID();
    await db.query("insert into builder_newsletter_webhook_receipts values ($1,$2,$3,'resend-team-production','unmatched',null,'email.sent')", [badReceipt, site, emails[4]!.id]);
    await expect(rpc("builder_staff_auth_history_apply", args, casts)).rejects.toThrow();
    expect(await count("builder_staff_auth_delivery_evidence")).toBe(0); expect(await count("builder_audit_events")).toBe(0);
    await db.query("delete from builder_newsletter_webhook_receipts where id=$1", [badReceipt]);
    expect(await rpc("builder_staff_auth_history_apply", args, casts)).toBe("recorded");
    expect(await count("builder_staff_auth_delivery_evidence")).toBe(5); expect(await count("builder_audit_events")).toBe(1);
    expect(await rpc("builder_staff_auth_history_apply", args, casts)).toBe("already_recorded");
    expect(await count("builder_audit_events")).toBe(1);
    await db.exec(`update builder_site_members set role='editor' where user_id='${owner}'`);
    await expect(rpc("builder_staff_auth_history_apply", args, casts)).rejects.toThrow();
    await db.exec(`update builder_site_members set role='owner' where user_id='${owner}'`);
  });
});
