import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("public localization encoding", () => {
  it("contains no mojibake or replacement characters in application source", () => {
    const invalid = /\u00c3|\u00c2|\u00e2|\ufffd/;
    const failures = [...sourceFiles("app"), ...sourceFiles("lib")]
      .filter((path) => invalid.test(readFileSync(path, "utf8")));

    expect(failures).toEqual([]);
  });
});
