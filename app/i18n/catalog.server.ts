import "server-only";

import type { PublicLocale } from "./locale";
import { translateStableText, translateText } from "./translations";

export function localizedBuilderText(
  locale: PublicLocale,
  stableKey: string,
  source: string,
) {
  if (locale === "en") return source;
  const stable = translateStableText(stableKey, source, locale);
  return stable === source ? translateText(source, locale) : stable;
}
