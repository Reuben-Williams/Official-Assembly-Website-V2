import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AppFooter } from "../app/ui/AppFooter";
import { AppHeader } from "../app/ui/AppHeader";
import {
  LANGUAGE_COOKIE_NAME,
  localeCookieOptions,
  normalizePublicLocale,
} from "../app/i18n/locale";

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

  it("renders Spanish navigation and footer copy in initial HTML", () => {
    const header = renderToStaticMarkup(<AppHeader locale="es" />);
    const footer = renderToStaticMarkup(<AppFooter locale="es" />);

    expect(header).toContain("Inicio");
    expect(header).toContain("Acerca de");
    expect(header).toContain("Contactar a la oficina");
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
