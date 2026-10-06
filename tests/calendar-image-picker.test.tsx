// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CalendarWorkspace } from "../app/admin/editor/calendar-workspace";
import { normalizeCalendarDraft } from "../lib/calendar/contract";
import type { CalendarClient } from "../lib/calendar/client";
import type { CalendarManagementEvent } from "../lib/calendar/repository";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = "00000000-0000-4000-8000-000000000001";
const media = [
  { mediaId: "11111111-1111-4111-8111-111111111111", label: "Community meeting flyer", url: "/test/flyer.jpg", alt: "A meeting invitation", width: 2400, height: 3000 },
  { mediaId: "22222222-2222-4222-8222-222222222222", label: "Health fair photograph", url: "/test/health.jpg", alt: "Residents at the health fair", width: 2560, height: 1707 },
];
function eventRecord(mediaId: string | null = null, archived = false): CalendarManagementEvent {
  const revision = { ...normalizeCalendarDraft({ titleEn: "Office event", mediaAssetId: mediaId }),
    id, eventId: id, siteId: id, parentRevisionId: null, authorMemberId: id, createdAt: "2026-10-06T10:00:00Z" };
  return { entity: { id, siteId: id, lifecycleState: archived ? "archived" : "active", draftRevisionId: id,
    publishedRevisionId: null, createdByMemberId: id, updatedByMemberId: id, createdAt: revision.createdAt,
    updatedAt: revision.createdAt, publishedAt: null, archivedAt: archived ? revision.createdAt : null, commandVersion: 1 },
    draftRevision: revision, publishedRevision: null };
}
let host: HTMLDivElement, root: Root;
let requests: Parameters<CalendarClient["command"]>[0][];
let operations: { -readonly [Key in keyof CalendarClient]: CalendarClient[Key] };
beforeEach(() => {
  requests = [];
  operations = { list: async () => ({ schemaVersion: 1, events: [eventRecord()] }), command: async request => {
    requests.push(request);
    const event = eventRecord(request.draft?.mediaAssetId ?? null);
    if (request.draft) Object.assign(event.draftRevision!, request.draft);
    return { schemaVersion: 1, command: request.command, event };
  } };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
type Props = React.ComponentProps<typeof CalendarWorkspace> & {
  mediaLoading?: boolean; mediaError?: string; onRefreshMedia?: () => Promise<void>;
};
async function render(props: Partial<Props> = {}) {
  await act(async () => root.render(<CalendarWorkspace client={operations} role="owner" mediaAssets={media} {...props} />));
}
async function chooseEvent() {
  await act(async () => (host.querySelector("[data-calendar-event-id] button") as HTMLButtonElement).click());
}
function picker() { return host.querySelector("[data-calendar-image-picker]")!; }
function button(label: string) {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(item => item.getAttribute("aria-label") === label || item.textContent?.trim() === label)!;
}
async function click(label: string) { const target = button(label); expect(target, label).toBeDefined(); await act(async () => target.click()); }
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(input).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("visual event image selection", () => {
  it("keeps full-library rows at their content height rather than squeezing them into the scroll window", () => {
    const css = readFileSync("app/admin/editor/calendar-image-picker.module.css", "utf8");
    expect(css).toMatch(/\.grid \{[^}]*grid-auto-rows:\s*max-content/);
    expect(css).toMatch(/\.grid \{[^}]*align-content:\s*start/);
    expect(css).toMatch(/\.tile \{[^}]*min-height:\s*190px/);
  });
  it("constrains image grid tracks so portrait flyers cannot overflow their preview frames", () => {
    const css = readFileSync("app/admin/editor/calendar-image-picker.module.css", "utf8");
    for (const selector of ["preview", "thumbnail"]) {
      expect(css).toMatch(new RegExp(`\\.${selector} \\{[^}]*grid-template-rows:\\s*minmax\\(0,\\s*1fr\\)`));
    }
  });
  it("shows actual named image tiles instead of a filename dropdown", async () => {
    await render(); await chooseEvent();
    expect(host.querySelector('select[name="mediaAssetId"]')).toBeNull();
    expect(picker()).not.toBeNull();
    for (const image of media) {
      const tile = button(`Select image: ${image.label}`);
      expect(tile?.querySelector("img")?.getAttribute("src")).toBe(image.url);
      expect(tile?.getAttribute("type")).toBe("button");
    }
  });
  it("previews the choice and saves only its identifier through the normal draft command", async () => {
    await render(); await chooseEvent(); await click(`Select image: ${media[0].label}`);
    expect(button(`Select image: ${media[0].label}`).getAttribute("aria-pressed")).toBe("true");
    expect(picker().querySelector('[data-selected-image-preview] img')?.getAttribute("src")).toBe(media[0].url);
    expect(requests).toHaveLength(0);
    await click("Save draft");
    expect(requests[0].draft?.mediaAssetId).toBe(media[0].mediaId);
    expect(JSON.stringify(requests[0])).not.toContain(media[0].url);
  });
  it("removes the image as an unsaved change, then saves null", async () => {
    operations.list = async () => ({ schemaVersion: 1, events: [eventRecord(media[0].mediaId)] });
    await render(); await chooseEvent(); await click("Remove image");
    expect(picker().textContent).toContain("No image selected"); expect(requests).toHaveLength(0);
    await click("Save draft"); expect(requests[0].draft?.mediaAssetId).toBeNull();
  });
  it("searches names while preserving the selected preview when its tile is filtered out", async () => {
    await render(); await chooseEvent(); await click(`Select image: ${media[0].label}`); await search("health");
    expect(button(`Select image: ${media[0].label}`)).toBeUndefined();
    expect(button(`Select image: ${media[1].label}`)).toBeDefined();
    expect(picker().querySelector('[data-selected-image-preview] img')?.getAttribute("src")).toBe(media[0].url);
    await search("unmatched"); expect(picker().textContent).toContain("No images match");
  });
  it.each(["viewer", "archived"])("keeps %s image choices read-only", async mode => {
    operations.list = async () => ({ schemaVersion: 1, events: [eventRecord(media[0].mediaId, mode === "archived")] });
    await render({ role: mode === "viewer" ? "viewer" : "owner" }); await chooseEvent();
    expect(button(`Select image: ${media[1].label}`).disabled).toBe(true);
    expect(button("Remove image").disabled).toBe(true);
    await click(`Select image: ${media[1].label}`); expect(requests).toHaveLength(0);
  });
  it("retains a saved identifier when its preview is absent from the media library", async () => {
    operations.list = async () => ({ schemaVersion: 1, events: [eventRecord(media[0].mediaId)] });
    await render({ mediaAssets: [] }); await chooseEvent();
    expect(picker()?.textContent).toContain("Image preview unavailable");
    await click("Save draft"); expect(requests[0].draft?.mediaAssetId).toBe(media[0].mediaId);
  });
  it("distinguishes loading, a gallery error, and a genuinely empty library", async () => {
    await render({ mediaAssets: [], mediaLoading: true }); await chooseEvent();
    expect(picker()?.textContent).toContain("Loading images");
    await render({ mediaAssets: [], mediaError: "Gallery failed" });
    expect(picker()?.querySelector('[role="alert"]')?.textContent).toContain("Gallery failed");
    await render({ mediaAssets: [] }); expect(picker()?.textContent).toContain("No images in the media library");
  });
  it("refreshes without clearing the chosen image or unrelated draft fields", async () => {
    const refresh = vi.fn(async () => {});
    await render({ onRefreshMedia: refresh }); await chooseEvent(); await click(`Select image: ${media[0].label}`);
    await click("Refresh images"); expect(refresh).toHaveBeenCalledOnce();
    await render({ onRefreshMedia: refresh, mediaError: "Read failed" });
    await click("Save draft"); expect(requests[0].draft).toMatchObject({ mediaAssetId: media[0].mediaId, titleEn: "Office event" });
  });
  it("keeps a broken thumbnail unavailable and retries when its URL is renewed", async () => {
    await render(); await chooseEvent();
    const tile = button(`Select image: ${media[1].label}`); expect(tile).toBeDefined();
    await act(async () => tile.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(button(`Select image: ${media[1].label}`).disabled).toBe(true);
    expect(button(`Select image: ${media[1].label}`).textContent).toContain("Preview unavailable");
    await render({ mediaAssets: media.map(image => ({ ...image, url: `${image.url}?renewed` })) });
    expect(button(`Select image: ${media[1].label}`).disabled).toBe(false);
    expect(button(`Select image: ${media[1].label}`).querySelector("img")?.getAttribute("src")).toContain("renewed");
  });
  it("retains a selected identifier after the larger preview fails", async () => {
    await render(); await chooseEvent(); await click(`Select image: ${media[0].label}`);
    const preview = picker().querySelector('[data-selected-image-preview] img')!;
    await act(async () => preview.dispatchEvent(new Event("error")));
    expect(picker().textContent).toContain("Image preview unavailable");
    expect(button("Remove image").disabled).toBe(false);
    await click("Save draft"); expect(requests[0].draft?.mediaAssetId).toBe(media[0].mediaId);
  });
  it("disables image mutations during a draft command", async () => {
    let finish!: (value: Awaited<ReturnType<CalendarClient["command"]>>) => void;
    operations.command = async () => new Promise(resolve => { finish = resolve; });
    await render(); await chooseEvent(); await click(`Select image: ${media[0].label}`); await click("Save draft");
    expect(button(`Select image: ${media[1].label}`).disabled).toBe(true);
    expect(button("Remove image").disabled).toBe(true);
    await act(async () => finish({ schemaVersion: 1, command: "save_draft", event: eventRecord(media[0].mediaId) }));
    expect(button(`Select image: ${media[1].label}`).disabled).toBe(false);
  });
});
