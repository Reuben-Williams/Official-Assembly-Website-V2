import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("recovery bootstrap command", () => {
  it("loads server-only modules under the react-server Node condition", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["builder:recovery:bootstrap"]).toContain("--conditions=react-server");
  });
});
