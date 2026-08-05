import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { installationManifestSha256, parseInstallationManifest } from "@reuben-williams/entitlements/trust";
import {
  parseSiteRuntimeMarker,
  siteCommandHandlerRegistrySha256
} from "@reuben-williams/next/control-plane";
import { describe, expect, it } from "vitest";

import { createOfficialAssemblyGrowthHandlers } from "../lib/control-plane/growth-command-handlers";

const root = process.cwd();

describe("production installation contract", () => {
  it("reports the published package identities, schemas, routes, and worker", () => {
    const manifest = parseInstallationManifest(JSON.parse(
      readFileSync(join(root, ".builder", "installation-manifest.json"), "utf8")
    ));

    expect(manifest.packages).toMatchObject({
      "@reuben-williams/core": "0.2.1",
      "@reuben-williams/editor": "0.2.1",
      "@reuben-williams/forms": "0.2.1",
      "@reuben-williams/growth-core": "0.2.1",
      "@reuben-williams/growth-customers": "0.2.1",
      "@reuben-williams/growth-dashboard": "0.2.1",
      "@reuben-williams/growth-leads": "0.2.1",
      "@reuben-williams/next": "0.2.1"
    });
    expect(Object.keys(manifest.packages)).not.toContainEqual(expect.stringMatching(/^@your-builder\//));
    expect(manifest.schemas).toMatchObject({ forms: 2, growth: 1 });
    expect(manifest.routes).toEqual(expect.arrayContaining([
      "/admin/editor",
      "/admin/editor/customers",
      "/admin/editor/dashboard",
      "/admin/editor/leads",
      "/api/platform/installations/run"
    ]));
    expect(manifest.workerVersion).toBe("1.0.1");
  });

  it("binds the runtime marker to the exact manifest and production data plane", () => {
    const manifest = parseInstallationManifest(JSON.parse(
      readFileSync(join(root, ".builder", "installation-manifest.json"), "utf8")
    ));
    const marker = parseSiteRuntimeMarker(JSON.parse(
      readFileSync(join(root, ".builder", "site-runtime.json"), "utf8")
    ));

    expect(marker.siteDataPlaneSiteId).toBe("a3f57b25-df25-4d98-9ff6-a4a3f3a00a68");
    expect(marker.expectedSiteKey).toBe("official-assembly-website-v2");
    expect(marker.installationManifestSha256).toBe(installationManifestSha256(manifest));
    expect(marker.handlerRegistrySha256).toBe(siteCommandHandlerRegistrySha256(
      createOfficialAssemblyGrowthHandlers({ applyConfiguration: async (input) => input })
    ));
    expect(marker.workerVersion).toBe(manifest.workerVersion);
    expect(marker.scheduledInvocationContract).toBe("direct-in-process-v1");
  });

  it("declares a protected Vercel schedule and real growth workspace routes", () => {
    const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
      crons?: { path: string; schedule: string }[];
    };

    expect(vercel.crons).toContainEqual({
      path: "/api/platform/installations/run",
      schedule: "*/5 * * * *"
    });
    for (const workspace of ["customers", "dashboard", "leads"]) {
      expect(existsSync(join(root, "app", "admin", "editor", workspace, "page.tsx"))).toBe(true);
    }
  });

  it("keeps the site-specific database command fail-closed and provider-free", () => {
    const migrations = join(root, "supabase", "migrations");
    const filename = existsSync(migrations)
      ? readdirSync(migrations).find((entry) => entry.endsWith("_official_assembly_live_growth_configuration.sql"))
      : undefined;
    const migration = filename ? readFileSync(join(migrations, filename), "utf8") : "";

    expect(migration).toContain("builder_apply_official_assembly_live_growth_configuration");
    expect(migration).toContain("from public, anon, authenticated, service_role");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("official-assembly-live-v1");
    expect(migration).not.toMatch(/email|sms|ai_provider|synthetic|placeholder/i);
  });
});
