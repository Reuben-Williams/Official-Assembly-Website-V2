import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  new URL("../app/admin/editor/calendar-workspace.module.css", import.meta.url),
  "utf8",
);

describe("calendar workspace heading contrast", () => {
  it("explicitly sets the navy hero heading to white instead of inheriting global heading color", () => {
    const headingRules = stylesheet.match(/\.hero\s+h1\s*\{([^}]+)\}/)?.[1];
    expect(headingRules).toBeDefined();
    expect(headingRules).toMatch(/color:\s*(?:#fff(?:fff)?|white)\s*;/);
  });
});
