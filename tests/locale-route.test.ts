import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json(body: unknown, init: ResponseInit = {}) {
      const cookies: Array<{ name: string; value: string; options: unknown }> = [];
      const response = new Response(JSON.stringify(body), init) as Response & {
        cookies: { set(name: string, value: string, options: unknown): void };
        recordedCookies: typeof cookies;
      };
      response.recordedCookies = cookies;
      response.cookies = { set: (name, value, options) => cookies.push({ name, value, options }) };
      return response;
    },
  },
}));

import { POST } from "../app/api/locale/route";

describe("locale cookie route", () => {
  it("sets a private, bounded Spanish locale cookie", async () => {
    const response = await POST(new Request("https://example.test/api/locale", {
      method: "POST",
      body: JSON.stringify({ locale: "es" }),
    })) as unknown as Response & { recordedCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> };
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.recordedCookies).toEqual([expect.objectContaining({
      name: "assembly-language",
      value: "es",
      options: expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    })]);
  });

  it.each(["fr", "", null, 1])("rejects unsupported locale %j", async (locale) => {
    const response = await POST(new Request("https://example.test/api/locale", {
      method: "POST",
      body: JSON.stringify({ locale }),
    }));
    expect(response.status).toBe(400);
  });
});
