import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/ui/CommunityHero.module.css", import.meta.url), "utf8");
const mobileCss = css.split("@media (max-width: 600px) {")[1].split("@media (max-width: 360px) {")[0];
const portrait = '.carousel:has(.stage[data-format="portrait"])';

function declarations(selector: string) {
  return [...mobileCss.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(",").some((value) => value.trim() === selector))
    .map(([, , body]) => body).join("\n");
}

describe("mobile portrait carousel caption readability", () => {
  it("reserves caption space only for the new landscape photographs on narrow screens", () => {
    expect(declarations('.stage[data-mobile-framing="caption-safe"] .photo')).toContain("height: calc(100% - 125px);");
    expect(declarations('.stage[data-mobile-framing="caption-safe"] .photo')).toContain("object-position: center 33%;");
    expect(declarations('.stage[data-mobile-framing="caption-safe"] .photo')).toContain("mask-image: linear-gradient(to bottom, #000 65%, transparent 100%);");
  });
  it("backs wrapped portrait captions with navy without changing their dimensions", () => {
    expect(declarations(`${portrait} .description`)).toContain("background: rgb(30 51 83 / 95%);");
    expect(declarations(`${portrait} .description`)).toContain("box-shadow: 0 0 0 6px rgb(30 51 83 / 95%);");
    expect(declarations(`${portrait} .description`)).not.toMatch(/(?:padding|margin|height):/);
  });

  it("retains the approved viewport, portrait containment and navy fades without shrinking photos", () => {
    expect(declarations(portrait)).toBe("");
    expect(declarations(`${portrait} .stage`)).toBe("");
    expect(declarations(`${portrait} .photo`)).toBe("");
    expect(declarations(`${portrait} .footer`)).toBe("");
    expect(declarations('.stage[data-format="portrait"]')).toContain("padding: 14px 16px 90px;");
    expect(css).toContain('.stage[data-format="portrait"] .photo { object-fit: contain; mask-image: linear-gradient');
    expect(css).toContain("height: calc(100svh - var(--hero-chrome-height));");
  });
});
