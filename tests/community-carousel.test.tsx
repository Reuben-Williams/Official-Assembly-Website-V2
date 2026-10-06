// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityCarousel } from "../app/ui/CommunityCarousel";
import { communityPhotos } from "../app/data/community-photos";
import { createCarouselBaseline } from '../lib/carousel/contract';

vi.mock("next/image", () => ({ default: ({ preload: _preload, unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { preload?: boolean; unoptimized?: boolean }) => React.createElement("img", props) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let motion: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
const click = async (label: string) => {
  const scope = container.querySelector('dialog[open]') ?? container;
  const button = scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  await act(async () => button!.click());
};
beforeEach(() => {
  vi.useFakeTimers();
  motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => motion);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("approved community carousel", () => {
  it("reserves unscaled control height inside the zoomed editor preview", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(86);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 420, 28));
    await act(async () => root.render(<CommunityCarousel locale="en" />));
    expect(container.querySelector<HTMLElement>('[data-community-carousel]')?.style.getPropertyValue('--carousel-footer-height')).toBe('94px');
  });
  it('hides slide titles and captions by default, retaining accessible descriptions and controls', async () => {
    await act(async () => root.render(<CommunityCarousel locale="en"/>));
    expect(container.textContent).not.toContain(communityPhotos[0].en.caption);
    expect(container.querySelector('img')?.alt).toBeTruthy();
    await click('Next photo');
    expect(container.querySelector('[data-carousel-caption]')).toBeNull();
  });
  it('uses an immutable supplied projection for captions, alt, framing and timing', async () => {
    const refs=communityPhotos.map((_,i)=>({mediaId:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,revisionId:`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`}));
    const document=createCarouselBaseline(refs); document.defaults.showCaptions = true; document.entries[0].en={title:'Published title',caption:'Published caption',alt:'Published accessible description'};
    document.entries[0].seconds=5; document.entries[0].desktop.x=25;
    const projection={revisionId:'published-revision',document,images:refs.map((ref,i)=>({...ref,url:communityPhotos[i].src,width:communityPhotos[i].width,height:communityPhotos[i].height,ready:true}))};
    await act(async()=>root.render(<CommunityCarousel locale="en" projection={projection}/>));
    expect(container.textContent).toContain('Published title');
    expect(container.querySelector('img')?.alt).toBe('Published accessible description');
    expect(container.querySelector('[data-community-carousel]')?.getAttribute('data-carousel-revision')).toBe('published-revision');
    await click('Play photo carousel'); await act(async()=>vi.advanceTimersByTime(5100));
    expect(container.textContent).toContain('Together at the stadium');
  });
  it("applies narrow-screen face protection only to the two new landscape slides", async () => {
    await act(async () => root.render(<CommunityCarousel locale="es" />));
    for (let index = 0; index < 8; index++) {
      expect(container.querySelector('[data-carousel-stage]')?.getAttribute('data-mobile-framing'))
        .toBe([0, 6].includes(index) ? 'caption-safe' : null);
      await click('Foto siguiente');
    }
  });
  it("starts still with one photograph and meaningful copy", async () => {
    await act(async () => root.render(<CommunityCarousel locale="en" />));
    expect(container.querySelector('[data-community-carousel]')?.getAttribute("data-playing")).toBe("false");
    expect(container.querySelectorAll('[data-carousel-stage] img')).toHaveLength(1);
    expect(container.querySelector('img')?.alt).toBe(communityPhotos[0].en.caption);
    expect(container.textContent).not.toContain("Existing site collection");
    await act(async () => vi.advanceTimersByTime(15000));
    expect(container.querySelector('[data-carousel-stage] img')?.getAttribute("src")).toContain("parade-group-desktop.webp");
  });
  it("has eight unique bilingual slides from the approved mixed-scene collection", () => {
    expect(communityPhotos).toHaveLength(8);
    expect(communityPhotos.map((photo) => photo.id)).toEqual([
      "parade-group", "dsc09235", "dsc09857", "bill-signing-group", "community-greeting",
      "state-house-recognition", "parade-walk", "chamber-group",
    ]);
    expect(new Set(communityPhotos.map((photo) => photo.src)).size).toBe(8);
    for (const photo of communityPhotos) {
      expect(photo.en.title.length).toBeGreaterThan(5);
      expect(photo.es.caption.length).toBeGreaterThan(20);
      expect(photo.es.caption).not.toBe(photo.en.caption);
      expect(photo.src).toMatch(/^\/images\/community-(carousel|editorial)\//);
    }
  });
  it("moves manually and changes captions and controls with the locale", async () => {
    await act(async () => root.render(<CommunityCarousel locale="en" />));
    await click("Next photo");
    expect(container.querySelector('[data-carousel-stage]')?.getAttribute('aria-label')).toContain("Together at the stadium");
    await act(async () => root.render(<CommunityCarousel locale="es" />));
    expect(container.querySelector('[data-carousel-stage]')?.getAttribute('aria-label')).toContain("Juntos en el estadio");
    expect(container.querySelector('[aria-label="Foto anterior"]')).not.toBeNull();
    expect(container.querySelector('[data-carousel-stage] img')?.getAttribute("alt")).toBe(communityPhotos[1].es.caption);
  });
  it("advances only after Play, paints progress, and stops on manual selection", async () => {
    await act(async () => root.render(<CommunityCarousel locale="en" />));
    await click("Play photo carousel");
    await act(async () => vi.advanceTimersByTime(3500));
    expect(container.querySelector<HTMLElement>('[data-carousel-progress]')?.style.transform).not.toBe("scaleX(0)");
    await act(async () => vi.advanceTimersByTime(3600));
    expect(container.querySelector('[data-carousel-stage]')?.getAttribute('aria-label')).toContain("Together at the stadium");
    await click("Next photo");
    await act(async () => vi.advanceTimersByTime(15000));
    expect(container.querySelector('[data-carousel-stage]')?.getAttribute('aria-label')).toContain("Backpacks and big smiles");
    expect(container.querySelector('[data-community-carousel]')?.getAttribute("data-playing")).toBe("false");
  });
  it("opens a gallery, selects a portrait, closes and restores focus", async () => {
    await act(async () => root.render(<CommunityCarousel locale="en" />));
    await click("View all photos");
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(container.querySelectorAll("dialog img")).toHaveLength(8);
    await click("Show photo 6: A photograph in the chamber");
    expect(container.querySelector("dialog")?.open).toBe(false);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("View all photos");
    expect(container.querySelector('[data-carousel-stage]')?.getAttribute("data-format")).toBe("portrait");
    expect(container.querySelector('[data-carousel-stage] img')?.getAttribute("src")).toContain("state-house-recognition-desktop.webp");
  });
  it("disables automatic playback for reduced motion without disabling navigation", async () => {
    motion.matches = true;
    await act(async () => root.render(<CommunityCarousel locale="en" />));
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Play photo carousel"]')?.disabled).toBe(true);
    await click("Next photo");
    expect(container.querySelector('[data-carousel-stage]')?.getAttribute('aria-label')).toContain("Together at the stadium");
  });
  it("pauses when the page becomes hidden", async () => {
    await act(async () => root.render(<CommunityCarousel locale="en" />));
    await click("Play photo carousel");
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(container.querySelector('[data-community-carousel]')?.getAttribute("data-playing")).toBe("false");
  });
});
