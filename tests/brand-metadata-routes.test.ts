import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const metadataRoutes = [
  "app/layout.tsx",
  "app/[slug]/page.tsx",
  "app/news/page.tsx",
  "app/news/[slug]/page.tsx",
  "app/newsletter/confirm/page.tsx",
  "app/privacy/page.tsx",
  "app/not-found.tsx",
] as const;

describe("controlled social metadata route coverage", () => {
  it.each(metadataRoutes)("composes %s through the approved social metadata helper", (path) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    expect(source).toContain("withBrandSocialMetadata(");
    expect(source).toContain("approvedBrandAssets");
  });

  it("keeps newsletter confirmation noindex and no-referrer directives", () => {
    const source = readFileSync(resolve(process.cwd(), "app/newsletter/confirm/page.tsx"), "utf8");
    expect(source).toContain('referrer: "no-referrer"');
    expect(source).toContain("robots: { index: false, follow: false }");
  });
});
