import { NextResponse } from "next/server";

import {
  LANGUAGE_COOKIE_NAME,
  localeCookieOptions,
  normalizePublicLocale,
} from "../../i18n/locale";

export async function POST(request: Request) {
  let value: unknown;
  try {
    value = (await request.json() as { locale?: unknown }).locale;
  } catch {
    return NextResponse.json({ error: "INVALID_LOCALE_REQUEST" }, { status: 400 });
  }
  if (value !== "en" && value !== "es") {
    return NextResponse.json({ error: "INVALID_LOCALE" }, { status: 400 });
  }
  const response = NextResponse.json(
    { locale: normalizePublicLocale(value) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
  response.cookies.set(
    LANGUAGE_COOKIE_NAME,
    normalizePublicLocale(value),
    localeCookieOptions(process.env.NODE_ENV === "production"),
  );
  return response;
}
