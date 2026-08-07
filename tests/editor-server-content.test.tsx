import { describe, expect, it, vi } from "vitest";

import type { BuilderContentAdapter, PageContent } from "@reuben-williams/core";

import {
  BuilderPublishedContentUnavailableError,
  loadBuilderGlobalContent,
  loadBuilderServerContent,
} from "../lib/builder/server-content";

function adapter(getPublishedContent: BuilderContentAdapter["getPublishedContent"]): BuilderContentAdapter {
  const unsupported = async () => { throw new Error("unsupported"); };
  return {
    getPublishedContent,
    getDraftContent: unsupported,
    saveDraft: unsupported,
    publishVersion: unsupported,
    rollbackToVersion: unsupported,
    undoRollback: unsupported,
    listAuditLog: unsupported,
    createMediaAsset: unsupported,
    listMediaAssets: unsupported,
  } as BuilderContentAdapter;
}

describe("server-rendered builder content", () => {
  it("loads the global scope without coupling shared layout content to one page", async () => {
    const getPublishedContent = vi.fn<BuilderContentAdapter["getPublishedContent"]>(async (_siteId, path) => ({
      path,
      regions: {
        "global.header.brand": { type: "text", value: "Published office" },
        "home.hero.title": { type: "text", value: "Do not leak a page value" },
      },
    }));

    const content = await loadBuilderGlobalContent({ adapter: adapter(getPublishedContent) });

    expect(getPublishedContent).toHaveBeenCalledOnce();
    expect(getPublishedContent).toHaveBeenCalledWith("official-assembly-website-v2", "/__builder/global");
    expect(content.regions).toEqual({
      "global.header.brand": { type: "text", value: "Published office" },
    });
  });

  it("loads only registered published global and page regions", async () => {
    const getPublishedContent = vi.fn<BuilderContentAdapter["getPublishedContent"]>(async (_siteId, path) => {
      const content: PageContent = {
        path,
        regions: path === "/__builder/global"
          ? {
              "global.header.brand": { type: "text", value: "Published office" },
              "unknown.region": { type: "text", value: "Never render" },
            }
          : {
              "home.hero.title": { type: "text", value: "Published home title" },
              "home.hero.body": { type: "link", href: "/wrong", label: "Wrong kind" },
            },
      };
      return content;
    });

    const content = await loadBuilderServerContent("/", { adapter: adapter(getPublishedContent) });

    expect(getPublishedContent).toHaveBeenCalledTimes(2);
    expect(content.regions).toEqual({
      "global.header.brand": { type: "text", value: "Published office" },
      "home.hero.title": { type: "text", value: "Published home title" },
    });
  });

  it("fails truthfully when authoritative published content cannot be read", async () => {
    const operation = loadBuilderServerContent("/", {
      adapter: adapter(vi.fn(async () => { throw new Error("database unavailable"); })),
    });

    await expect(operation).rejects.toBeInstanceOf(BuilderPublishedContentUnavailableError);
  });
});
