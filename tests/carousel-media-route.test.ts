import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../lib/carousel/server", () => ({
  loadPublishedCarousel: mocks.load,
}));
import { GET } from "../app/api/carousel/media/[revisionId]/route";
const id = "10000000-0000-4000-8000-000000000001";
const request = (revisionId = id) =>
  GET(new Request(`https://example.com/api/carousel/media/${revisionId}`), {
    params: Promise.resolve({ revisionId }),
  });
beforeEach(() => vi.clearAllMocks());
it("rejects invalid identifiers without storage access", async () => {
  expect((await request("not-an-id")).status).toBe(404);
  expect(mocks.load).not.toHaveBeenCalled();
});
it("does not expose a private or superseded image absent from the published projection", async () => {
  mocks.load.mockResolvedValue({ status: "ready", projection: { images: [] } });
  expect((await request()).status).toBe(404);
});
it("resolves a fresh grant on each request, including long-open public pages", async () => {
  for (const grant of ["first", "refreshed"]) {
    mocks.load.mockResolvedValue({
      status: "ready",
      projection: {
        images: [{ revisionId: id, url: `/api/recovery/media?grant=${grant}` }],
      },
    });
    const response = await request();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://example.com/api/recovery/media?grant=${grant}`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(mocks.load).toHaveBeenCalledWith({ imageRevisionId: id });
});
it("returns a bounded error when publication is unavailable", async () => {
  mocks.load.mockResolvedValue({ status: "unavailable" });
  expect((await request()).status).toBe(503);
});
