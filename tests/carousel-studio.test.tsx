// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CarouselStudio } from "../app/admin/editor/carousel-studio";
import { createCarouselBaseline } from "../lib/carousel/contract";
vi.mock("../app/ui/CommunityCarousel", () => ({
  CommunityCarousel: ({
    projection,
  }: {
    projection: { document: { entries: unknown[] } };
  }) => (
    <div aria-label="Live carousel preview">
      {projection.document.entries.length} photos
    </div>
  ),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const id = "10000000-0000-4000-8000-000000000001";
const doc = createCarouselBaseline(
  Array.from({ length: 8 }, () => ({ mediaId: id, revisionId: id })),
);
const revision = { id, document: doc, createdAt: "2026-10-01" };
const state = {
  version: 1,
  published: revision,
  draft: revision,
  projection: {
    revisionId: id,
    document: doc,
    images: [
      {
        mediaId: id,
        revisionId: id,
        url: "/photo.webp",
        width: 1600,
        height: 900,
        ready: true,
      },
    ],
  },
  history: [],
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
});
describe("Carousel Studio A", () => {
  it("shows eight slots, true preview, and a separate review-before-publish action", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <CarouselStudio
          role="editor"
          client={{ read: async () => state, command: vi.fn() }}
          mediaAssets={[]}
          onRefreshMedia={async () => {}}
        />,
      );
    });
    expect(host.querySelectorAll("[data-carousel-slot]")).toHaveLength(8);
    expect(host.textContent).toContain("This photo");
    expect(host.textContent).toContain("Whole carousel");
    expect(host.textContent).toContain("Review saved draft");
    expect(host.textContent).toContain("Preview only");
    expect(host.textContent).not.toContain("Not yet published");
    expect(
      host.querySelector('[aria-label="Live carousel preview"]'),
    ).not.toBeNull();
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent === "Publish reviewed draft",
      ),
    ).toBe(false);
    const scope = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    await act(async () => scope[1].click());
    expect(scope[1].getAttribute('aria-selected')).toBe('true');
    expect(host.textContent).toContain('DEFAULTS FOR ALL PHOTOS');
    const captions = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.closest('label')?.textContent?.includes('Show photo titles and captions'));
    expect(captions).toBeDefined();
    expect(captions?.checked).toBe(false);
    await act(async () => captions!.click());
    expect(captions?.checked).toBe(true);
    await act(async () => host.querySelectorAll<HTMLButtonElement>('[data-carousel-slot] button')[1].click());
    expect(scope[0].getAttribute('aria-selected')).toBe('true');
  });
});
