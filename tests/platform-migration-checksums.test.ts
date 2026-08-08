import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The executable ESM verifier intentionally has no emitted declaration.
import { EXPECTED_PLATFORM_MIGRATIONS, verifyPlatformMigrationChecksums } from "../scripts/verify-platform-migration-checksums.mjs";

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

async function platformFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "morales-platform-migrations-"));
  temporaryDirectories.push(directory);
  for (const [relativePath] of EXPECTED_PLATFORM_MIGRATIONS) {
    const target = path.join(directory, "supabase", relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(repositoryRoot, "supabase", relativePath), target);
  }
  return directory;
}

describe("vendored platform migration history", () => {
  it("contains every approved migration with its immutable checksum", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["scripts/verify-platform-migration-checksums.mjs"],
      { cwd: repositoryRoot }
    );

    expect(stderr).toBe("");
    expect(stdout).toBe("Verified 29 approved platform migrations.\n");
  });

  it("adopts the exact alert migration and rejects any byte difference", async () => {
    const directory = await platformFixture();
    const relativePath = "migrations/20260808092616_versioned_site_alerts.sql";
    const migrationPath = path.join(directory, "supabase", relativePath);

    await expect(verifyPlatformMigrationChecksums(directory)).resolves.toMatchObject({
      checked: 29,
      valid: true,
    });

    const canonical = await readFile(migrationPath, "utf8");
    await writeFile(migrationPath, `${canonical}-- changed\n`, "utf8");
    await expect(verifyPlatformMigrationChecksums(directory)).rejects.toThrow(
      `Approved platform migration checksum mismatch: ${relativePath}`
    );
  });
});
