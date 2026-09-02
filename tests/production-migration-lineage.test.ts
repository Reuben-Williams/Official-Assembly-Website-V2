import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The executable ESM verifier intentionally has no emitted declaration.
import { EXPECTED_PENDING_MIGRATIONS, EXPECTED_PRODUCTION_BASELINE, verifyProductionMigrationLineage } from "../scripts/verify-production-migration-lineage.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function productionFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "morales-production-migrations-"));
  temporaryDirectories.push(directory);
  const migrationsDirectory = path.join(directory, "supabase", "migrations");
  await mkdir(migrationsDirectory, { recursive: true });
  for (const [filename] of [...EXPECTED_PRODUCTION_BASELINE, ...EXPECTED_PENDING_MIGRATIONS]) {
    await copyFile(
      path.join(repositoryRoot, "supabase", "migrations", filename),
      path.join(migrationsDirectory, filename)
    );
  }
  return directory;
}

describe("production migration lineage", () => {
  it("includes the canonical bilingual publishing migration as approved pending lineage", () => {
    expect(EXPECTED_PENDING_MIGRATIONS).toContainEqual([
      "20260812035711_complete_bilingual_publishing.sql",
      "073b44f0a19f6d4370aece008a2c189c40c076e3b2b50f9a6b63441aaf58a01a",
    ]);
    expect(EXPECTED_PENDING_MIGRATIONS).toContainEqual([
      "20260812221730_editor_login_completion_proofs.sql",
      "fabfd42184c9651fcff9dd9efe8e21f74072ebeed085ea1906942dbfb86731f3",
    ]);
    expect(EXPECTED_PENDING_MIGRATIONS).toContainEqual([
      "20260902033000_site_calendar_publishing.sql",
      "ea3f81bd4f43e6240d9cb9dad79fe5c27a366d2a4835b81d4b33d0d74b461b02",
    ]);
  });
  it("keeps the production baseline exact and only approved release migrations pending", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["scripts/verify-production-migration-lineage.mjs"],
      { cwd: repositoryRoot }
    );

    expect(stderr).toBe("");
    expect(stdout).toBe(
      "Verified 20 production migrations and 18 approved pending migrations.\n"
    );
  });

  it("fails closed when the canonical alert migration is missing or changed", async () => {
    const alertFilename = "20260811222019_alert_scroll_mode.sql";
    const missingDirectory = await productionFixture();
    await unlink(path.join(missingDirectory, "supabase", "migrations", alertFilename));
    await expect(verifyProductionMigrationLineage(missingDirectory)).rejects.toThrow(
      "Deployable migration lineage mismatch"
    );

    const changedDirectory = await productionFixture();
    const changedPath = path.join(changedDirectory, "supabase", "migrations", alertFilename);
    const canonical = await readFile(changedPath, "utf8");
    await writeFile(changedPath, `${canonical}-- partial replacement\n`, "utf8");
    await expect(verifyProductionMigrationLineage(changedDirectory)).rejects.toThrow(
      `Production migration checksum mismatch: ${alertFilename}`
    );
  });
});
