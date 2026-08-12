import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../supabase/migrations/20260811235246_newsletter_owner_login_evidence.sql",
  import.meta.url
);
const immutabilityMigrationUrl = new URL(
  "../supabase/migrations/20260812001718_newsletter_owner_login_immutability.sql",
  import.meta.url
);

describe("newsletter owner-login production migration", () => {
  it("defines RLS-protected occurrence and evidence tables with service-role-only RPCs", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("create table public.builder_newsletter_auth_login_occurrences");
    expect(sql).toContain("create table public.builder_newsletter_auth_login_evidence");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("builder_record_newsletter_auth_login_occurrence_v1");
    expect(sql).toContain("builder_record_newsletter_auth_login_evidence_v1");
    expect(sql).toMatch(/revoke all on function[\s\S]+from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function[\s\S]+to service_role/i);
  });

  it("extends the durable site-job contract without weakening send-disabled claims", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("newsletter.auth_login.reconcile");
    expect(sql).toContain("auth_login_occurrence_id");
    expect(sql).toContain("builder_claim_newsletter_auth_login_jobs_v1");
    expect(sql).toMatch(/newsletter\.auth_login\.reconcile[\s\S]+state in \('queued', 'retryable_failed'\)/i);
    expect(sql).toContain("job.state = 'leased' and job.lease_expires_at <= clock_timestamp()");
    expect(sql).toContain("lease_fencing_token");
  });

  it("requires immutable occurrence, receipt, and harmless-event evidence", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("resend-owner-login-v1");
    expect(sql).toContain("email.sent");
    expect(sql).toContain("email.delivered");
    expect(sql).toContain("email.opened");
    expect(sql).toContain("email.clicked");
    expect(sql).toContain("provider_broadcast_id is not null");
    expect(sql).toContain("pg_advisory_xact_lock");
  });

  it("removes Supabase default service-role mutation privileges from every immutable ledger", async () => {
    const sql = await readFile(immutabilityMigrationUrl, "utf8");
    expect(sql).toMatch(/revoke all on table[\s\S]+from service_role/i);
    expect(sql).toMatch(/grant select, insert on table[\s\S]+to service_role/i);
    expect(sql).toContain("builder_newsletter_auth_login_occurrences");
    expect(sql).toContain("builder_newsletter_auth_login_evidence");
    expect(sql).toContain("builder_newsletter_auth_login_recovery_commands");
  });
});
