import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const APPROVED_VERSION = "0.3.0";
const APPROVED_PACKAGE_DIRECTORIES = [
  "canonical-json",
  "content",
  "core",
  "feature-registry",
  "forms",
  "growth-core",
  "growth-ai",
  "growth-bookings",
  "growth-automations",
  "growth-campaigns",
  "growth-messaging",
  "entitlements",
  "editor",
  "growth-customers",
  "growth-leads",
  "growth-dashboard",
  "next",
  "cli",
] as const;

const DIRECT_RUNTIME_PACKAGES = [
  "content",
  "core",
  "editor",
  "forms",
  "growth-customers",
  "growth-dashboard",
  "growth-leads",
  "next",
] as const;

type PackageLock = {
  packages: Record<string, {
    version?: string;
    resolved?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>;
};

describe("published bilingual package attachment", () => {
  it("pins the direct website packages and CLI to the exact approved version", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    for (const directory of DIRECT_RUNTIME_PACKAGES) {
      expect(manifest.dependencies[`@reuben-williams/${directory}`]).toBe(
        APPROVED_VERSION,
      );
    }
    expect(manifest.devDependencies["@reuben-williams/cli"]).toBe(
      APPROVED_VERSION,
    );
  });

  it("resolves the complete approved closure from GitHub Packages without mixed versions", () => {
    const lock = JSON.parse(
      readFileSync(join(process.cwd(), "package-lock.json"), "utf8"),
    ) as PackageLock;

    for (const directory of APPROVED_PACKAGE_DIRECTORIES) {
      const packageName = `@reuben-williams/${directory}`;
      const record = lock.packages[`node_modules/${packageName}`];
      expect(record, `${packageName} must be installed`).toBeDefined();
      expect(record.version, `${packageName} version`).toBe(APPROVED_VERSION);
      expect(record.resolved, `${packageName} registry`).toMatch(
        /^https:\/\/npm\.pkg\.github\.com\//,
      );
    }

    const serialized = JSON.stringify(lock);
    expect(serialized).not.toContain("@your-builder/");
    expect(serialized).not.toMatch(
      /"@reuben-williams\/[^"]+"\s*:\s*"(?:file:|link:|workspace:|\^|~)/,
    );
  });
});
