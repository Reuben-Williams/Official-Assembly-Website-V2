import "server-only";

import { cookies, headers } from "next/headers";

import {
  LANGUAGE_COOKIE_NAME,
  resolvePublicLocale,
  type PublicLocale,
} from "./locale";

export async function readPublicLocale(): Promise<PublicLocale> {
  const [store, incoming] = await Promise.all([cookies(), headers()]);
  const requestUrl = incoming.get("x-builder-preview-url");
  let previewLocale: string | null = null;
  let builderPreview = false;
  if (requestUrl) {
    try {
      const url = new URL(requestUrl, "http://builder-preview.local");
      previewLocale = url.searchParams.get("builderLocale");
      builderPreview = url.searchParams.get("builderPreview") === "1";
    } catch {
      // Invalid request URLs fall back to the public locale cookie.
    }
  }
  return resolvePublicLocale({
    previewLocale,
    cookieLocale: store.get(LANGUAGE_COOKIE_NAME)?.value,
    builderPreview,
  });
}
