import { existsSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/builder/server-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/builder/server-content")>();
  return { ...actual, loadBuilderServerContent: vi.fn(async () => ({ regions: {} })) };
});
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("../app/i18n/server", () => ({ readPublicLocale: vi.fn(async () => "es") }));

describe("editable not-found page", () => {
  it("renders the canonical 404 marker and every editable region", async () => {
    const pagePath = resolve("app/not-found.tsx");
    if (!existsSync(pagePath)) {
      expect(existsSync(pagePath), "app/not-found.tsx must exist").toBe(true);
      return;
    }

    const { default: NotFoundPage, generateMetadata } = await import("../app/not-found");
    const html = renderToStaticMarkup(await NotFoundPage());

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
    expect(html).toContain('alt="La asamble\u00edsta Carmen Morales con colegas legisladores en la Casa de Gobierno"');
    expect(html).toContain("No pudimos encontrar esa p\u00e1gina.");
    expect(html).toContain("Volver al inicio");
    await expect(generateMetadata()).resolves.toEqual({ title: "P\u00e1gina no encontrada" });
  }, 15_000);
});
