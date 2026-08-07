import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/builder/server-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/builder/server-content")>();
  return { ...actual, loadBuilderServerContent: vi.fn(async () => ({ regions: {} })) };
});

import HomePage from "../app/page";
import {
  spanishTranslationsByKey,
  translateStableText
} from "../app/i18n/translations";

describe("stable-key translation bridge", () => {
  it("translates canonical copy by stable region key", () => {
    const english = "District 34 Constituent Services and Community Updates";
    expect(translateStableText("home.hero.title", english, "es")).toBe(
      spanishTranslationsByKey["home.hero.title"]?.es
    );
  });

  it("does not replace newly edited builder copy with an obsolete translation", () => {
    const edited = "A newly approved headline";
    expect(translateStableText("home.hero.title", edited, "es")).toBe(edited);
  });

  it("renders the same stable key for builder editing and translation", async () => {
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain(
      'data-builder-region="home.hero.title" data-builder-kind="text" data-i18n-key="home.hero.title"'
    );
  });

  it("keeps the translation catalog free of mojibake", () => {
    expect(JSON.stringify(spanishTranslationsByKey)).not.toMatch(/Ã|Â|â€™|â€œ|â€/);
  });
});
