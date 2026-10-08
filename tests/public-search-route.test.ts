import { describe, expect, it, vi } from "vitest";
const load = vi.hoisted(() => vi.fn());
vi.mock("../lib/public-search-server", () => ({ loadPublicSearchEntries: load }));
import { GET } from "../app/api/public/search/route";
describe("public search endpoint", () => {
  it("returns only the published index and does not cache stale results", async () => {
    load.mockResolvedValueOnce({ entries: [{ title: "Volunteer" }], partial: false });
    const response = await GET(new Request("https://example.test/api/public/search?locale=es"));
    expect(load).toHaveBeenLastCalledWith("es");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ entries: [{ title: "Volunteer" }], partial: false });
  });
  it("reports outages without exposing internal errors", async () => {
    load.mockRejectedValueOnce(new Error("private infrastructure details"));
    const response = await GET(new Request("https://example.test/api/public/search?locale=invalid"));
    expect(load).toHaveBeenLastCalledWith("en");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private infrastructure");
  });
});
