import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("site favicon", () => {
  it("ships a local SVG icon for browser requests", () => {
    const icon = readFileSync(new URL("../app/icon.svg", import.meta.url), "utf8");

    expect(icon).toContain("<svg");
    expect(icon).toContain("aria-hidden=\"true\"");
    expect(icon).not.toContain("<image");
    expect(icon).not.toContain("href=");
  });
});
