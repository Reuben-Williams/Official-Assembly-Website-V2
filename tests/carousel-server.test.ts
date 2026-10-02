import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  site: vi.fn(),
  recovery: vi.fn(),
  projection: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase/admin", () => ({
  getBuilderAdminClient: mocks.client,
  resolveBuilderSiteId: mocks.site,
}));
vi.mock("../lib/builder/recovery/runtime", () => ({
  createOfficialAssemblyRecoveryRuntime: () => ({
    readContent: mocks.recovery,
  }),
}));
vi.mock("../lib/carousel/service", () => ({
  carouselProjection: mocks.projection,
}));
import { loadPublishedCarousel } from "../lib/carousel/server";
function setup(aggregate: unknown, prior: unknown) {
  mocks.client.mockReturnValue({
    from: (table: string) => {
      const result = table === "builder_carousels" ? aggregate : prior;
      const query = {
        select: () => query,
        eq: () => query,
        not: () => query,
        limit: async () => result,
        maybeSingle: async () => result,
      };
      return query;
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.site.mockResolvedValue("site");
  mocks.recovery.mockResolvedValue(null);
});
it("retains the original public renderer only when authoritative reads prove no activation", async () => {
  setup({ data: null, error: null }, { data: [], error: null });
  expect(await loadPublishedCarousel()).toEqual({
    status: "legacy-uninitialized",
  });
});
it("does not restore checked-in photos when an activated aggregate disappears", async () => {
  setup(
    { data: null, error: null },
    { data: [{ generation_id: 9 }], error: null },
  );
  expect(await loadPublishedCarousel()).toEqual({ status: "unavailable" });
});
it.each(["aggregate", "generation"])(
  "does not infer uninitialized state from a %s read failure",
  async (failure) => {
    setup(
      { data: null, error: failure === "aggregate" ? {} : null },
      { data: null, error: {} },
    );
    expect(await loadPublishedCarousel()).toEqual({ status: "unavailable" });
  },
);
it("prefers a recovered publication even before the aggregate can be read", async () => {
  setup({ data: null, error: {} }, { data: [], error: null });
  const projection = { revisionId: "recovered", document: {}, images: [] };
  mocks.recovery.mockResolvedValue({ carousel: projection });
  expect(await loadPublishedCarousel()).toEqual({
    status: "ready",
    projection,
    source: "recovery",
  });
});
