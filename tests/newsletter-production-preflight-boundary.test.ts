import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const preflightUrl = new URL(
  "../scripts/verify-newsletter-production-readiness.mjs",
  import.meta.url
);

describe("newsletter production preflight boundary", () => {
  it("remains a read-only inventory gate", async () => {
    const source = await readFile(preflightUrl, "utf8");
    expect(source).toContain("collectNewsletterProviderInventory");
    expect(source).toContain("NewsletterProviderInventoryReadError");
    expect(source).toContain("NewsletterProviderEvidenceReadError");
    expect(source).toContain("NewsletterProviderIdentityChangedError");
    expect(source).toContain('stop("provider_identity_changed"');
    expect(source).toContain("postgrestCode: error.postgrestCode");
    expect(source).toContain("stage: error.stage");
    expect(source).toContain("preflightStep");
    expect(source).toContain("step: preflightStep");
    expect(source).toContain("repository.read()");
    expect(source).toContain("repository.activeActivationDigest()");
    expect(source).not.toMatch(/\.rpc\s*\(/);
    expect(source).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
    expect(source).not.toMatch(/\.send\s*\(/);
  });
});
