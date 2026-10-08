import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), resolve: vi.fn(), authenticate: vi.fn(), revision: vi.fn(),
  pagePublished: vi.fn(), publicEvents: vi.fn(), media: vi.fn(), download: vi.fn(),
}));
vi.mock("../lib/supabase/admin", () => ({ getBuilderAdminClient: mocks.admin, resolveBuilderSiteId: mocks.resolve }));
vi.mock("../lib/builder/request-auth", () => ({ authenticateBuilderRequest: mocks.authenticate }));
vi.mock("../lib/builder/page-media-repository", () => ({
  createPageMediaRepository: () => ({ byRevision: mocks.revision }), pageMediaIsPublished: mocks.pagePublished,
}));
vi.mock("../lib/builder/repositories", () => ({ listNormalizedMediaAssets: mocks.media }));
vi.mock("../lib/calendar/supabase-repository", () => ({ createSupabaseCalendarRepository: () => ({ readPublic: mocks.publicEvents }) }));
import { GET } from "../app/api/builder/media/[[...segments]]/route";

const id = "0abfcaec-9001-4c40-901b-12af392a0795";
function request(query = "") {
  return GET(new Request(`https://example.com/api/builder/media/${id}${query}`), { params: Promise.resolve({ segments: [id] }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockReturnValue({ storage: { from: () => ({ download: mocks.download }) } });
  mocks.resolve.mockResolvedValue("site-id");
  mocks.authenticate.mockResolvedValue(null);
  mocks.revision.mockResolvedValue({ mediaId: "asset-id", revisionId: id, objectKey: "image.jpg", mimeType: "image/jpeg", byteSize: 3, ready: true, archived: false });
  mocks.pagePublished.mockResolvedValue(false);
  mocks.publicEvents.mockResolvedValue([{ id: "event-id", mediaAssetId: "asset-id", startAt: "2098-12-01T00:00:00Z", effectiveEndAt: "2099-01-01T00:00:00Z" }]);
  mocks.media.mockResolvedValue([{ id: "asset-id", revisionId: id, replicaStatus: "ready", url: `/api/builder/media/${id}?preview=1` }]);
  mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
});
it("delivers an anonymous public event image even when no page region references it", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
});
it("denies the same image once its event is no longer public", async () => {
  mocks.publicEvents.mockResolvedValue([]);
  expect((await request()).status).toBe(404);
  expect(mocks.download).not.toHaveBeenCalled();
});
it("still requires staff authentication for preview URLs", async () => {
  expect((await request("?preview=1")).status).toBe(404);
  expect(mocks.download).not.toHaveBeenCalled();
});
