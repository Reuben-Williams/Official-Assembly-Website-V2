import { describe, expect, it, vi } from "vitest";

import { editorPageNavigation } from "../app/admin/editor/editor-client";
import { mapNormalizedMediaAssets } from "../lib/builder/repositories";
import {
  editablePostToSnapshot,
  postRecordToEditableDraft
} from "../lib/builder/posts";

describe("editor recovery contracts", () => {
  it("wires page selections back to the controlled preview path", () => {
    const setCurrentPath = vi.fn();
    const navigation = editorPageNavigation("/about", setCurrentPath);

    expect(navigation.currentPath).toBe("/about");
    navigation.onPageChange("/news");
    expect(setCurrentPath).toHaveBeenCalledWith("/news");
  });

  it("rejects page selections that are not registered editor routes", () => {
    const setCurrentPath = vi.fn();
    const navigation = editorPageNavigation("/", setCurrentPath);

    navigation.onPageChange("https://malicious.example/redirect");

    expect(setCurrentPath).not.toHaveBeenCalled();
  });

  it("normalizes a registered page before changing the controlled preview", () => {
    const setCurrentPath = vi.fn();
    const navigation = editorPageNavigation("/", setCurrentPath);

    navigation.onPageChange("/about/");

    expect(setCurrentPath).toHaveBeenCalledWith("/about");
  });

  it("maps the provisioned normalized media schema without legacy columns", () => {
    const assets = mapNormalizedMediaAssets(
      [{
        id: "media-1",
        site_id: "site-1",
        label: "Community event",
        created_by: "user-1",
        created_at: "2026-08-05T20:00:00.000Z"
      }],
      [{
        media_id: "media-1",
        id: "revision-1",
        object_key: "site-1/media-1/photo.webp",
        mime_type: "image/webp",
        width: 1200,
        height: 800,
        created_at: "2026-08-05T20:01:00.000Z"
      }],
      new Map([["site-1/media-1/photo.webp", "https://storage.example/signed-photo"]])
    );

    expect(assets).toEqual([expect.objectContaining({
      id: "media-1",
      path: "site-1/media-1/photo.webp",
      url: "https://storage.example/signed-photo",
      alt: "Community event",
      mimeType: "image/webp",
      source: "upload"
    })]);
  });

  it("round-trips a live post draft through the database snapshot contract", () => {
    const draft = postRecordToEditableDraft({
      entry: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "draft",
        active_draft_version_id: "22222222-2222-4222-8222-222222222222",
        active_published_version_id: null
      },
      version: {
        snapshot: {
          slug: "district-update",
          data: {
            title: "District update",
            excerpt: "A live update.",
            body: { version: 1, type: "doc", content: [] },
            featuredImage: null,
            author: { key: null, name: "Office staff" },
            featured: false,
            pinned: false,
            seo: {
              title: "District update",
              description: "A live update.",
              canonicalUrl: null,
              socialImage: null,
              noIndex: false
            }
          },
          taxonomyKeys: { categories: [], tags: [] },
          taxonomySnapshot: {},
          displayDate: "2026-08-05T20:00:00.000Z",
          expiresAt: null
        }
      }
    });

    expect(draft).toMatchObject({
      entryId: "11111111-1111-4111-8111-111111111111",
      draftVersionId: "22222222-2222-4222-8222-222222222222",
      title: "District update",
      slug: "district-update",
      status: "draft"
    });
    expect(editablePostToSnapshot(draft)).toMatchObject({
      slug: "district-update",
      data: { title: "District update", author: { name: "Office staff" } },
      taxonomyKeys: { categories: [], tags: [] }
    });
  });
});
