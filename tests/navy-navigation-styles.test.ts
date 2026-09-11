import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const hero = readFileSync(new URL("../app/ui/CommunityHero.module.css", import.meta.url), "utf8");

function declarations(selector: string) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(",").some((value) => value.trim() === selector))
    .map(([, , body]) => body).join("\n");
}

function contrast(foreground: number[], background: number[]) {
  const luminance = (channels: number[]) => channels.map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const levels = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (levels[0] + 0.05) / (levels[1] + 0.05);
}

describe("navy navigation", () => {
  it("shares the exact opaque hero navy without changing the sticky header geometry", () => {
    expect(declarations(":root")).toContain("--brand-navy: #1e3353;");
    expect(declarations(".site-header")).toContain("background: var(--brand-navy);");
    expect(declarations(".site-header")).toContain("position: sticky;");
    expect(declarations(".nav-shell")).toContain("min-height: 74px;");
    expect(hero).toContain("--hero-navy: var(--brand-navy);");
    expect(declarations(".mobile-navigation-drawer")).toContain("background: var(--brand-navy);");
  });

  it("keeps brand, navigation, and hamburger foregrounds light with scoped hover states", () => {
    for (const selector of [".site-header .brand", ".site-header .nav-links a", ".site-header .mobile-summary", ".site-header .language-toggle"]) {
      expect(declarations(selector), selector).toContain("color: #fff;");
    }
    expect(declarations(".site-header .language-toggle")).toContain("border-color: #8b9aaf;");
    expect(declarations(".site-header .nav-links a:hover")).toContain("background: rgb(255 255 255 / 12%);");
    expect(declarations(".site-header .nav-links a:hover")).toContain("color: #fff;");
  });

  it("inverts only the header Contact action and preserves an offset focus ring", () => {
    expect(declarations(".site-header .nav-cta")).toContain("background: #fff;");
    expect(declarations(".site-header .nav-cta")).toContain("color: var(--brand-navy);");
    expect(declarations(".cta-link")).toContain("background: var(--primary);");
    expect(css).toMatch(/\.site-header :is\(a, button\):focus-visible\s*\{[^}]*outline: 3px solid #eac68c;[^}]*outline-offset: 3px;/);
  });

  it("meets text and focus contrast targets on the selected navy and hover surface", () => {
    const navyHex = declarations(":root").match(/--brand-navy:\s*#([a-f\d]{6})/i)?.[1];
    expect(navyHex).toBeDefined();
    const navy = navyHex!.match(/.{2}/g)!.map((value) => Number.parseInt(value, 16));
    const hover = navy.map((channel) => channel * 0.88 + 255 * 0.12);
    expect(contrast([255, 255, 255], navy)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([255, 255, 255], hover)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([139, 154, 175], navy)).toBeGreaterThanOrEqual(3);
    expect(contrast([234, 198, 140], navy)).toBeGreaterThanOrEqual(3);
  });
});
