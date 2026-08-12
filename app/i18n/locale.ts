export const PUBLIC_LOCALES = Object.freeze(["en", "es"] as const);
export type PublicLocale = (typeof PUBLIC_LOCALES)[number];

export const DEFAULT_PUBLIC_LOCALE: PublicLocale = "en";
export const LANGUAGE_COOKIE_NAME = "assembly-language";

export function normalizePublicLocale(value: unknown): PublicLocale {
  return value === "es" ? "es" : DEFAULT_PUBLIC_LOCALE;
}

export function localeCookieOptions(production: boolean) {
  return Object.freeze({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
