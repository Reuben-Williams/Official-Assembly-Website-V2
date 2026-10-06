import { describe, expect, it, vi } from "vitest";
import type { ActiveBuilderIdentity } from "../lib/builder/authorization";

// Resolve dynamically so a missing feature is an assertion failure, not an import crash.
const feature = await import("../lib/calendar/translation").catch(() => null);
const identity: ActiveBuilderIdentity = { siteKey: "official-assembly-website-v2", siteId: "site", userId: "owner", role: "owner", sessionGeneration: 3, tokenGeneration: 3, csrfToken: "csrf-token" };
const source = { titleEn: "Office meeting", descriptionEn: "Meet the district office.", actionLabelEn: "" };
function request(body = { ...source, confirmed: true }, csrf = "csrf-token") {
  return new Request("https://www.assemblywomanmorales.com/api/builder/calendar/translation", { method: "POST", headers: { origin: "https://www.assemblywomanmorales.com", "content-type": "application/json", "x-builder-csrf": csrf }, body: JSON.stringify(body) });
}
describe("optional reviewed calendar translation", () => {
  it("is unavailable without a configured provider and makes no external call", async () => {
    expect(feature?.createCalendarTranslationHandlers).toBeTypeOf("function");
    if (!feature) return;
    const handlers = feature.createCalendarTranslationHandlers({ provider: null, authenticate: async () => identity, allowedOrigins: ["https://www.assemblywomanmorales.com"] });
    expect(await (await handlers.GET(new Request("https://www.assemblywomanmorales.com/api/builder/calendar/translation"))).json()).toEqual({ available: false });
    expect((await handlers.POST(request())).status).toBe(503);
  });
  it("requires edit access, CSRF, origin, explicit consent, and bounded fields", async () => {
    expect(feature).not.toBeNull(); if (!feature) return;
    const suggest = vi.fn(async () => ({ titleEs: "Reunión", descriptionEs: "Información", actionLabelEs: "" }));
    const handlers = feature.createCalendarTranslationHandlers({ provider: { suggest }, authenticate: async () => identity, allowedOrigins: ["https://www.assemblywomanmorales.com"] });
    expect((await handlers.POST(request({ ...source, confirmed: false }))).status).toBe(400);
    expect((await handlers.POST(request(undefined, "bad"))).status).toBe(403);
    expect((await handlers.POST(request({ ...source, titleEn: "x".repeat(161), confirmed: true }))).status).toBe(400);
    expect((await feature.createCalendarTranslationHandlers({ provider: { suggest }, authenticate: async () => ({ ...identity, role: "viewer" }) }).POST(request())).status).toBe(403);
    expect(suggest).not.toHaveBeenCalled();
    const response = await handlers.POST(request());
    expect(response.status).toBe(200);
    expect(suggest).toHaveBeenCalledExactlyOnceWith(source);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("sends only the three English fields to Google as plain text and bounds output", async () => {
    expect(feature?.createGoogleCalendarTranslationProvider).toBeTypeOf("function"); if (!feature) return;
    const fetcher = vi.fn(async () => Response.json({ data: { translations: [{ translatedText: "Reunión" }, { translatedText: "Conozca la oficina." }] } }));
    const provider = feature.createGoogleCalendarTranslationProvider("test-key", fetcher);
    expect(await provider.suggest(source)).toEqual({ titleEs: "Reunión", descriptionEs: "Conozca la oficina.", actionLabelEs: "" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://translation.googleapis.com/language/translate/v2");
    expect(JSON.parse(init.body as string)).toEqual({ q: [source.titleEn, source.descriptionEn], source: "en", target: "es", format: "text" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const bad = feature.createGoogleCalendarTranslationProvider("test-key", async () => Response.json({ data: { translations: [{ translatedText: "x".repeat(161) }, { translatedText: "Texto" }] } }));
    await expect(bad.suggest(source)).rejects.toThrow();
  });
});
