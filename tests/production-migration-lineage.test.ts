import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const execFileAsync = promisify(execFile);

describe("production migration lineage", () => {
  it("keeps the production baseline exact and only approved release migrations pending", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["scripts/verify-production-migration-lineage.mjs"],
      { cwd: repositoryRoot }
    );

    expect(stderr).toBe("");
    expect(stdout).toBe(
      "Verified 20 production migrations and 9 approved pending migrations.\n"
    );
  });
});
