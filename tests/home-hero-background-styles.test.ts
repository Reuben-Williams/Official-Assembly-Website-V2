import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function hex(name: string) {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"));
  expect(match?.[1], `${name} must be an opaque six-digit color`).toBeDefined();
  return match![1];
}

function luminance(value: string) {
  const channels = value.slice(1).match(/.{2}/g)!.map((channel) => {
    const normalized = Number.parseInt(channel, 16) / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("homepage hero centerpiece styles", () => {
  it("keeps the banner centered in document flow with a distinct action dock", () => {
    expect(css).toMatch(/\.home-hero\s*\{/);
    expect(css).toMatch(/\.home-brand-banner\s*\{[^}]*position:\s*relative/);
    expect(css).toMatch(/\.home-hero::after\s*\{/);
    expect(css).toMatch(/\.home-hero-shell\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.home-brand-banner-picture\s*\{[^}]*aspect-ratio:\s*var\(--brand-banner-desktop-aspect\)/);
    expect(css).toMatch(/\.home-hero-actions\s*\{[^}]*background:\s*rgb\(0 23 51 \/ 92%\)/);
    expect(css).toMatch(/\.home-hero\s+\.secondary-link:(?:hover|focus-visible)/);
    expect(css).not.toMatch(/--home-brand-zone:\s*clamp\(/);
    expect(css).not.toMatch(/\.home-hero\s+\.hero-image\s*\{/);

    const actionRules = [...css.matchAll(/\.home-hero-actions\s*\{([^}]*)\}/g)];
    expect(actionRules.length).toBeGreaterThan(0);
    for (const [, declarations] of actionRules) {
      expect(declarations).not.toMatch(/margin-bottom:\s*-/);
    }
    expect(css).toMatch(/\.home-hero-actions\s*\{[^}]*margin:\s*-?[\d.]+rem\s+auto\s+0/);
  });

  it("preserves the generic light hero as a separate style contract", () => {
    expect(css).toMatch(/(?:^|\n)\.hero\s*\{/);
    expect(css).toMatch(/\.hero\s*\{[^}]*background:\s*linear-gradient/);
    expect(css).not.toMatch(/(?:^|\n)\.hero\s+h1\s*\{[^}]*color:\s*(?:#fff|white)/);
  });

  it("meets WCAG AA for homepage copy and every opaque action state", () => {
    const backdrop = hex("--home-hero-readable-background");
    expect(contrast(hex("--home-hero-copy"), backdrop)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex("--home-hero-body"), backdrop)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex("--home-hero-eyebrow"), backdrop)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex("--home-hero-primary-foreground"), hex("--home-hero-primary-background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex("--home-hero-primary-foreground"), hex("--home-hero-primary-hover-background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex("--home-hero-secondary-foreground"), hex("--home-hero-secondary-background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex("--home-hero-secondary-foreground"), hex("--home-hero-secondary-hover-background"))).toBeGreaterThanOrEqual(4.5);
  });
});
