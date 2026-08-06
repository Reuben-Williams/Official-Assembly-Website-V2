import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "../proxy";

describe("production security headers", () => {
  it("allows the site editor to frame same-origin page previews", async () => {
    const response = await proxy(new NextRequest("https://assemblywomanmorales.vercel.app/admin/editor"));
    const policy = response.headers.get("content-security-policy");

    expect(policy).toContain("frame-src 'self' https://challenges.cloudflare.com");
  });

  it("allows signed project media from the configured Supabase origin", async () => {
    const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    try {
      const response = await proxy(new NextRequest("https://assemblywomanmorales.vercel.app/admin/editor"));
      expect(response.headers.get("content-security-policy"))
        .toContain("img-src 'self' data: blob: https://project.supabase.co");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
    }
  });
});
