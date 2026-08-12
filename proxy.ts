import { createBuilderServerClient } from "@reuben-williams/next/auth";
import { type NextRequest, NextResponse } from "next/server";

import { previewLocaleRequestHeaders } from "./app/i18n/preview-proxy";
import { INTERNAL_PATHNAME_HEADER } from "./lib/public-route";

function contentSecurityPolicy(nonce: string) {
  const supabaseOrigin = (() => {
    try {
      return process.env.NEXT_PUBLIC_SUPABASE_URL
        ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
        : "";
    } catch {
      return "";
    }
  })();
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabaseOrigin}`.trim(),
    `connect-src 'self' ${supabaseOrigin}`.trim(),
    "font-src 'self' data:",
    "frame-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const requestHeaders = previewLocaleRequestHeaders(request.nextUrl, request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", contentSecurityPolicy(nonce));
  requestHeaders.set(INTERNAL_PATHNAME_HEADER, request.nextUrl.pathname);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && publishableKey) {
    const client = createBuilderServerClient({
      url,
      publishableKey,
      cookies: {
        getAll: () => request.cookies.getAll().map(({ name, value }) => ({ name, value })),
        setAll: (values) => {
          for (const { name, value } of values) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of values) response.cookies.set(name, value, options);
        },
      },
    });
    await client.auth.getClaims();
  }

  response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  if (request.nextUrl.pathname === "/newsletter/confirm") {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images/).*)",
  ],
};
