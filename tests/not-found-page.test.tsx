import { existsSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("editable not-found page", () => {
  it("renders the canonical 404 marker and every editable region", async () => {
    const pagePath = resolve("app/not-found.tsx");
    if (!existsSync(pagePath)) {
      expect(existsSync(pagePath), "app/not-found.tsx must exist").toBe(true);
      return;
    }

    const { default: NotFoundPage } = await import("../app/not-found");
    const html = renderToStaticMarkup(<NotFoundPage />);

    expect(html).toContain('data-builder-content-path="/404"');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('data-builder-region="404.hero.eyebrow"');
    expect(html).toContain('data-builder-region="404.hero.title"');
    expect(html).toContain('data-builder-region="404.hero.body"');
    expect(html).toContain('data-builder-region="404.hero.image"');
    expect(html).toContain('data-builder-region="404.hero.primary-cta"');
    expect(html).toContain('data-builder-region="404.hero.secondary-cta"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/resources"');
    expect(html).toContain('alt="Assemblywoman Carmen Morales with legislative colleagues at the State House"');
  });
});
