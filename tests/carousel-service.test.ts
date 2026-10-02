import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCarouselBaseline } from "../lib/carousel/contract";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  advance: vi.fn(),
  load: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../lib/builder/recovery/runtime", () => ({
  readRecoveryConfiguration: () => ({
    blobToken: "private-test-token",
    environment: "production",
    grantSecret: "local-test-secret-not-for-production-0123456789",
  }),
}));
vi.mock("../lib/builder/recovery/blob-store", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../lib/builder/recovery/blob-store")
  >()),
  createVercelBlobObjectStore: () => ({}),
  createRecoveryArtifactStore: () => ({ advanceLatest: mocks.advance }),
}));
vi.mock("../lib/builder/recovery/worker", () => ({
  prepareRecoveryGeneration: mocks.prepare,
}));
vi.mock("../lib/builder/recovery/repository", () => ({
  createSupabaseRecoveryWorkerRepository: () => ({
    loadGeneration: mocks.load,
  }),
}));
import { createCarouselService } from "../lib/carousel/service";

const id = (i: number) =>
  `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const identity = {
  siteId: id(1),
  siteKey: "official-assembly-website-v2",
  userId: id(2),
  role: "editor" as const,
  sessionGeneration: 1,
  tokenGeneration: 1,
  csrfToken: "csrf",
};
const baseline = createCarouselBaseline(
  Array.from({ length: 8 }, () => ({ mediaId: id(3), revisionId: id(4) })),
);
const draft = structuredClone(baseline);
draft.defaults.transition = "fade";
function setup() {
  let published = id(5),
    version = 2;
  let receipt: unknown = null;
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    const data = () => ({
      data:
        table === "builder_carousels"
          ? {
              enabled: true,
              version,
              draft_revision_id: id(6),
              published_revision_id: published,
            }
          : table === "builder_carousel_revisions"
            ? {
                id: filters.id,
                document: filters.id === id(5) ? baseline : draft,
                created_at: "2026-10-01T00:00:00.000Z",
              }
            : table === "builder_media_revisions"
              ? [
                  {
                    id: id(4),
                    media_id: id(3),
                    object_key: "photo.jpg",
                    width: 1600,
                    height: 900,
                  },
                ]
              : table === "builder_media_recovery_replicas"
                ? [{ revision_id: id(4), status: "ready" }]
                : table === "builder_site_generations"
                  ? { generation_id: 7 }
                  : table === "builder_carousel_commands"
                    ? receipt
                    : [],
      error: null,
    });
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => {
        filters[key] = value;
        return builder;
      },
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      single: async () => data(),
      maybeSingle: async () => data(),
      then: (resolve: (value: ReturnType<typeof data>) => unknown) =>
        Promise.resolve(data()).then(resolve),
    };
    return builder;
  });
  const rpc = vi.fn(async () => {
    published = id(6);
    version = 3;
    return {
      data: { prepared: { pointer: { generationId: 8 } } },
      error: null,
    };
  });
  const client = {
    from,
    rpc,
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: "https://example.test/photo.jpg" },
          error: null,
        }),
      }),
    },
  } as unknown as SupabaseClient;
  return {
    service: createCarouselService(client),
    rpc,
    from,
    setReceipt: (value: unknown) => {
      receipt = value;
    },
  };
}
const reviewCommand = {
  action: "review" as const,
  expectedVersion: 2,
  expectedPublishedId: id(5),
  revisionId: id(6),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({
    generationId: 8,
    manifestPath: "verified/manifest.json",
    manifestDigest: "b".repeat(64),
  });
  mocks.advance.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue({
    global: { versionId: id(9), values: {} },
    pages: [{ path: "/", versionId: id(10), values: {} }],
    media: [],
    carousel: { revisionId: id(6), document: draft },
  });
});
describe("carousel publication service", () => {
  it("does not activate a candidate when complete recovery preparation fails", async () => {
    const { service, rpc } = setup();
    const { review } = (await service.execute(identity, reviewCommand)) as {
      review: { token: string };
    };
    mocks.prepare.mockRejectedValueOnce(new Error("backup unavailable"));
    await expect(
      service.execute(identity, {
        ...reviewCommand,
        action: "publish",
        commandId: id(11),
        reviewToken: review.token,
      }),
    ).rejects.toThrow("backup unavailable");
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("prepares the full generation before activation and advances the verified pointer afterward", async () => {
    const { service, rpc } = setup();
    const { review } = (await service.execute(identity, reviewCommand)) as {
      review: { token: string };
    };
    await service.execute(identity, {
      ...reviewCommand,
      action: "publish",
      commandId: id(11),
      reviewToken: review.token,
    });
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[0],
    );
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.advance.mock.invocationCallOrder[0],
    );
    expect(rpc).toHaveBeenCalledWith(
      "builder_carousel_command_v1",
      expect.objectContaining({
        p_generation: 1,
        p_command: expect.objectContaining({
          prepared: expect.objectContaining({
            baseGeneration: 7,
            pageVersions: { "/": id(10) },
            globalVersionId: id(9),
          }),
        }),
      }),
    );
  });
  it("rejects a token belonging to a different verified actor before preparing or writing", async () => {
    const { service, rpc } = setup();
    const { review } = (await service.execute(identity, reviewCommand)) as {
      review: { token: string };
    };
    await expect(
      service.execute(
        { ...identity, userId: id(20) },
        {
          ...reviewCommand,
          action: "publish",
          commandId: id(11),
          reviewToken: review.token,
        },
      ),
    ).rejects.toThrow("review expired");
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("rejects stale publication versions before writing", async () => {
    const { service, rpc } = setup();
    await expect(
      service.execute(identity, { ...reviewCommand, expectedVersion: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not accept modified captions or effects as the initial approved baseline", async () => {
    const { service, rpc } = setup();
    await expect(
      service.execute(
        { ...identity, role: "owner" },
        {
          action: "bootstrap",
          commandId: id(11),
          expectedVersion: 0,
          expectedPublishedId: null,
          document: draft,
        },
      ),
    ).rejects.toThrow("approved eight-photo baseline");
    expect(rpc).not.toHaveBeenCalled();
  });
});
