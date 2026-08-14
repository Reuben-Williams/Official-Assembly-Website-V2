import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AppFooter } from "../app/ui/AppFooter";
import { AppHeader } from "../app/ui/AppHeader";
import {
  LANGUAGE_COOKIE_NAME,
  localeCookieOptions,
  normalizePublicLocale,
  resolvePublicLocale,
} from "../app/i18n/locale";
import { previewLocaleRequestHeaders } from "../app/i18n/preview-proxy";

describe("server-owned public locale", () => {
  it("accepts only English and Spanish and uses a bounded same-site cookie", () => {
    expect(normalizePublicLocale("es")).toBe("es");
    expect(normalizePublicLocale("en")).toBe("en");
    expect(normalizePublicLocale("fr")).toBe("en");
    expect(LANGUAGE_COOKIE_NAME).toBe("assembly-language");
    expect(localeCookieOptions(false)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 31_536_000,
    });
  });

  it("allows a bounded editor preview locale to override the public cookie", () => {
    expect(resolvePublicLocale({ previewLocale: "es", cookieLocale: "en" })).toBe("es");
    expect(resolvePublicLocale({ previewLocale: "fr", cookieLocale: "es" })).toBe("es");
    expect(resolvePublicLocale({ previewLocale: "es", cookieLocale: undefined, builderPreview: false })).toBe("en");
  });

  it("forwards only a bounded bilingual preview URL to server components", () => {
    const forwarded = previewLocaleRequestHeaders(
      new URL("https://example.test/news?builderPreview=1&builderLocale=es"),
      new Headers({ cookie: "session=value" }),
    );
    expect(forwarded.get("x-builder-preview-url")).toBe("/news?builderPreview=1&builderLocale=es");

    const publicRequest = previewLocaleRequestHeaders(
      new URL("https://example.test/news?builderLocale=es"),
      new Headers(),
    );
    expect(publicRequest.has("x-builder-preview-url")).toBe(false);
  });

  it("renders Spanish navigation and footer copy in initial HTML", () => {
    const header = renderToStaticMarkup(<AppHeader locale="es" />);
    const footer = renderToStaticMarkup(<AppFooter locale="es" />);

    expect(header).toContain("Inicio");
    expect(header).toContain("Acerca de");
    expect(header).toContain("Contactar a la oficina");
    expect(header).toContain("Abrir menú");
    expect(header).not.toContain("<details");
    expect(header).toContain('lang="es"');
    expect(footer).toContain("Secciones del sitio");
    expect(footer).toContain("Portal del personal");
    expect(footer).not.toContain(">Staff Portal<");
  });

  it("contains no DOM text mutation or local-storage locale source", () => {
    const source = readFileSync(resolve("app/ui/LanguageToggle.tsx"), "utf8");
    expect(source).not.toMatch(/MutationObserver|querySelectorAll|textContent|localStorage/);
  });
});
