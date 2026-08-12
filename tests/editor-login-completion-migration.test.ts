import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("editor login-completion proof migration", () => {
  it("adds a private single-use proof contract with service-role-only execution", () => {
    const directory = join(process.cwd(), "supabase", "migrations");
    const filename = readdirSync(directory).find((entry) => entry.endsWith("_editor_login_completion_proofs.sql"));
    expect(filename).toBeTruthy();
    const sql = readFileSync(join(directory, filename!), "utf8");

    expect(sql).toContain("builder_editor_login_completion_proofs");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("builder_issue_editor_login_completion_proof_v1");
    expect(sql).toContain("builder_consume_editor_login_completion_proof_v1");
    expect(sql).toContain("consumed_at is null");
    expect(sql).toContain("for update skip locked");
    expect(sql).toMatch(/revoke all on function public\.builder_issue_editor_login_completion_proof_v1\(jsonb\)[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.builder_consume_editor_login_completion_proof_v1\(jsonb\)[\s\S]*to service_role/i);
  });
});
