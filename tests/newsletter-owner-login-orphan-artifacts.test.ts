import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const dryRunUrl = new URL(
  "../scripts/sql/newsletter-owner-login-orphan-dry-run-v1.sql",
  import.meta.url
);
const applyUrl = new URL(
  "../scripts/sql/newsletter-owner-login-orphan-apply-v1.sql",
  import.meta.url
);

describe("newsletter owner-login orphan operator artifacts", () => {
  it("keeps the dry run read-only and exact-target", async () => {
    const sql = await readFile(dryRunUrl, "utf8");
    expect(sql).toContain("db73a773-8609-462c-ac57-3545a535e9d5");
    expect(sql).toContain("2026-08-11T21:24:29.356981Z");
    expect(sql).not.toMatch(/\b(insert|update|delete|call)\b/i);
  });

  it("applies only through the reviewed occurrence and evidence RPCs", async () => {
    const sql = await readFile(applyUrl, "utf8");
    expect(sql).toContain("c50635af-9590-5de5-8e9b-b31a313f453c");
    expect(sql).toContain("db73a773-8609-462c-ac57-3545a535e9d5");
    expect(sql).toContain("builder_record_newsletter_auth_login_occurrence_v1");
    expect(sql).toContain("builder_record_newsletter_auth_login_evidence_v1");
    expect(sql).not.toMatch(/insert into public\./i);
    expect(sql).not.toMatch(/update public\./i);
    expect(sql).not.toMatch(/delete from public\./i);
  });
});
