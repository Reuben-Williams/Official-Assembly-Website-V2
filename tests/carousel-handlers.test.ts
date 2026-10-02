import { describe, it, expect, vi } from "vitest";
import { createCarouselHandlers } from "../lib/carousel/handlers";
import { createCarouselBaseline } from "../lib/carousel/contract";
const identity = {
  userId: "actor",
  siteId: "site",
  siteKey: "official-assembly-website-v2",
  role: "editor" as const,
  sessionGeneration: 1,
  tokenGeneration: 1,
  csrfToken: "csrf",
};
const command = {
  action: "review",
  expectedVersion: 1,
  expectedPublishedId: "10000000-0000-4000-8000-000000000001",
  revisionId: "20000000-0000-4000-8000-000000000001",
};
describe("carousel request boundary", () => {
  const setup = (auth = identity) => {
    const service = {
      read: vi.fn(async () => ({})),
      execute: vi.fn(async () => ({})),
    };
    return {
      service,
      handlers: createCarouselHandlers({
        authenticate: async () => auth,
        service,
        origins: ["https://example.com"],
      }),
    };
  };
  const request = (
    body: unknown = command,
    headers: Record<string, string> = {},
  ) =>
    new Request("https://example.com/api/builder/carousel", {
      method: "POST",
      headers: {
        origin: "https://example.com",
        "content-type": "application/json",
        "x-builder-csrf": "csrf",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  it("requires matching CSRF and origin before service calls", async () => {
    const { service, handlers } = setup();
    expect(
      (await handlers.POST(request(command, { "x-builder-csrf": "wrong" })))
        .status,
    ).toBe(403);
    expect(
      (
        await handlers.POST(
          request(command, { origin: "https://elsewhere.com" }),
        )
      ).status,
    ).toBe(403);
    expect(service.execute).not.toHaveBeenCalled();
  });
  it("rejects revoked generations and cross-site identities", async () => {
    const { handlers } = setup({ ...identity, tokenGeneration: 0 });
    expect((await handlers.POST(request())).status).toBe(401);
    const other = setup({ ...identity, siteKey: "other" });
    expect((await other.handlers.POST(request())).status).toBe(403);
  });
  it("rejects unknown command fields", async () => {
    const { handlers, service } = setup();
    expect(
      (await handlers.POST(request({ ...command, siteId: "other" }))).status,
    ).toBe(400);
    expect(service.execute).not.toHaveBeenCalled();
  });
  it("returns private no-store responses and verified context", async () => {
    const { handlers, service } = setup();
    const result = await handlers.POST(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(service.execute).toHaveBeenCalledWith(identity, command);
  });
  it("logs a bounded storage diagnostic without leaking provider details", async () => {
    const { handlers, service } = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    service.execute.mockRejectedValueOnce(new Error("Vercel Blob: This blob already exists. private/path?token=secret"));
    const result = await handlers.POST(request());
    expect(result.status).toBe(503);
    expect(log).toHaveBeenCalledWith("carousel_operation_failed", { code: "BLOB_EXISTS" });
    expect(await result.text()).not.toContain("secret");
    log.mockRestore();
  });
  it("does not let an Editor initialize the site baseline", async () => {
    const { handlers, service } = setup();
    const document = createCarouselBaseline(
      Array.from({ length: 8 }, () => ({
        mediaId: command.revisionId,
        revisionId: command.revisionId,
      })),
    );
    expect(
      (
        await handlers.POST(
          request({
            action: "bootstrap",
            commandId: command.revisionId,
            expectedVersion: 0,
            expectedPublishedId: null,
            document,
          }),
        )
      ).status,
    ).toBe(403);
    expect(service.execute).not.toHaveBeenCalled();
  });
});
