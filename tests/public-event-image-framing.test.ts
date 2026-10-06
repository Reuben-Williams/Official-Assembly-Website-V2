import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  new URL("../app/ui/public-events-section.module.css", import.meta.url),
  "utf8",
);
const imageRules = stylesheet.match(/\.eventImage\s*\{([^}]+)\}/)?.[1];

describe("public event flyer framing", () => {
  it("uses the full card width and the image's intrinsic height and proportions", () => {
    expect(imageRules).toBeDefined();
    expect(imageRules).toMatch(/width:\s*100%\s*;/);
    expect(imageRules).toMatch(/height:\s*auto\s*;/);
    expect(imageRules).toMatch(/aspect-ratio:\s*auto\s*;/);
    expect(imageRules).not.toMatch(/(?:max-height|aspect-ratio:\s*\d)/);
  });

  it("contains the entire image rather than cropping any part of the flyer", () => {
    expect(imageRules).toMatch(/object-fit:\s*contain\s*;/);
    expect(imageRules).not.toMatch(/object-fit:\s*(?:cover|fill)\s*;/);
  });
});
