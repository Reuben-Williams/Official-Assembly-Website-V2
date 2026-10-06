import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("scaled carousel preview framing", () => {
  it("clips without creating a scrollable viewport when photo controls receive focus", () => {
    const css = readFileSync(
      new URL("../app/admin/editor/carousel-studio.module.css", import.meta.url),
      "utf8",
    );
    const canvas = css.match(/\.previewCanvas\s*\{([^}]+)\}/)?.[1];
    expect(canvas).toBeDefined();
    // A transformed frame retains its unscaled layout height. overflow:hidden
    // lets focus scroll that hidden overflow, clipping heads and leaving a gap.
    expect(canvas).toMatch(/overflow:\s*clip\s*;/);
    expect(canvas).not.toMatch(/overflow:\s*(?:hidden|auto|scroll)\s*;/);
  });
});
