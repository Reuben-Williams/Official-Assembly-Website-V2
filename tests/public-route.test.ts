import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  INTERNAL_PATHNAME_HEADER,
  isPublicAlertPathname,
} from "../lib/public-route";
import { proxy } from "../proxy";

describe("public alert route boundary", () => {
  it.each([
    "/",
    "/news",
    "/news/district-update",
    "/404",
    "/not-a-real-page",
    "/administrator",
    "/authentication",
    "/apiary",
  ])("accepts public pathname %s", (pathname) => {
    expect(isPublicAlertPathname(pathname)).toBe(true);
  });

  it.each([
    "/admin",
    "/admin/editor",
    "/auth",
    "/auth/callback",
    "/api",
    "/api/public/alerts",
    "/_next",
    "/_next/static/chunk.js",
  ])("rejects non-public pathname %s", (pathname) => {
    expect(isPublicAlertPathname(pathname)).toBe(false);
  });

  it.each([
    null,
    "",
    "news",
    "//news",
    "/news?admin=1",
    "/news#fragment",
    "/news\\admin",
    "/admin%2Feditor",
    "/%zz",
    "/news\n/admin",
  ])("fails closed for malformed pathname header %j", (pathname) => {
    expect(isPublicAlertPathname(pathname)).toBe(false);
  });

  it("overwrites a caller-forged internal pathname header", async () => {
    const response = await proxy(new NextRequest("https://www.assemblywomanmorales.com/news", {
      headers: { [INTERNAL_PATHNAME_HEADER]: "/admin/editor" },
    }));

    expect(response.headers.get("x-middleware-override-headers"))
      .toContain(INTERNAL_PATHNAME_HEADER);
    expect(response.headers.get(`x-middleware-request-${INTERNAL_PATHNAME_HEADER}`)).toBe("/news");
  });
});
