import "server-only";

import { cookies } from "next/headers";

import {
  LANGUAGE_COOKIE_NAME,
  normalizePublicLocale,
  type PublicLocale,
} from "./locale";

export async function readPublicLocale(): Promise<PublicLocale> {
  const store = await cookies();
  return normalizePublicLocale(store.get(LANGUAGE_COOKIE_NAME)?.value);
}
