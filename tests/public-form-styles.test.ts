import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

describe("public civic form styles", () => {
  it("scopes the civic card and managed field layout to public forms", () => {
    expect(css).toMatch(/\.public-form-card\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.public-form-card-header\s*\{[^}]*background:[^;}]*var\(--primary\)/);
    expect(css).toMatch(/\.public-form-card \.builder-public-form fieldset\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
    expect(css).toMatch(/\.public-form-card \[data-builder-form-field\]\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/data-builder-form-field="message"[^}]*grid-column:\s*1\s*\/\s*-1/);
    expect(css).toMatch(/data-builder-form-field="operationalConsent"[^}]*grid-column:\s*1\s*\/\s*-1/);
    expect(css).toMatch(/data-builder-form-field="marketingConsent"[^}]*grid-column:\s*1\s*\/\s*-1/);
  });

  it("styles controls, focus, disabled actions, and semantic result states", () => {
    expect(css).toMatch(/\.public-form-card \.builder-public-form :where\(input, textarea, select\)[^{]*\{[^}]*min-height:\s*48px/);
    expect(css).toMatch(/\.public-form-card \.builder-public-form :where\(input, textarea, select\):focus-visible/);
    expect(css).toMatch(/\.public-form-card \.builder-public-form button\[type="submit"\][^{]*\{[^}]*cursor:\s*pointer/);
    expect(css).toMatch(/\.public-form-card \.builder-public-form button\[type="submit"\]:disabled[^{]*\{[^}]*cursor:\s*not-allowed/);
    expect(css).toContain('[data-public-form-state="success"]');
    expect(css).toContain('[data-public-form-state="error"]');
    expect(css).toContain('[data-public-form-state="client-invalid"]');
    expect(css).toContain('[data-public-form-state="verification-needed"]');
  });

  it("contains the form at mobile widths and honors reduced motion", () => {
    expect(css).toMatch(/@media \(max-width:\s*620px\)[\s\S]*?\.public-form-card \.builder-public-form fieldset\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(css).toMatch(/\.public-form-card \.cf-turnstile[^{]*\{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.public-form-card/);
  });
});
