// @vitest-environment jsdom

import type { PublicAlertProjectionV1 } from "@reuben-williams/content";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublicAlertController } from "../app/ui/PublicAlertController";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

type ScrollableAlert = PublicAlertProjectionV1["activeAlerts"][number];

function projection(overrides: Partial<PublicAlertProjectionV1> = {}): PublicAlertProjectionV1 {
  return {
    schemaVersion: 1,
    revisionId: "11111111-1111-4111-8111-111111111111",
    activeAlerts: [
      { id: "first", category: "general", message: "First district update", link: "/news" },
      { id: "second", category: "office", message: "Second district update" },
    ],
    evaluatedAt: "2026-08-08T12:00:00.000Z",
    nextTransitionAt: null,
    ...overrides,
  };
}

function matchMedia(reducedMotion: boolean) {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: reducedMotion,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label);
}

function scrollingAlert(overrides: Partial<ScrollableAlert> = {}): ScrollableAlert {
  return {
    id: "moving",
    category: "general",
    message: "A moving district update",
    scroll: true,
    ...overrides,
  };
}

function animationEvent(name: string) {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: name });
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-08T12:00:00.000Z"));
  matchMedia(false);
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.hasAttribute("data-alert-viewport")
      ? 600
      : this.hasAttribute("data-alert-track")
        ? 320
        : 100;
    return { x: 0, y: 0, width, height: 40, top: 0, right: width, bottom: 40, left: 0, toJSON() {} };
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("public alert controller", () => {
  it("renders no space for zero alerts and a static notice without controls for one", async () => {
    await act(async () => root.render(<PublicAlertController initialProjection={null} />));
    expect(container.innerHTML).toBe("");

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<PublicAlertController initialProjection={projection({
      activeAlerts: [{ id: "only", category: "general", message: "One current update" }],
    })} />));
    expect(container.textContent).toContain("One current update");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("rotates only while allowed and keeps Pause sticky", async () => {
    await act(async () => root.render(<PublicAlertController initialProjection={projection()} rotationMs={5_000} />));
    expect(container.querySelector("[data-alert-current]")?.textContent).toContain("First district update");
    expect(container.querySelector('[aria-live="off"]')).not.toBeNull();

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.querySelector("[data-alert-current]")?.textContent).toContain("Second district update");
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("");

    await act(async () => button("Pause alerts")?.click());
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(container.querySelector("[data-alert-current]")?.textContent).toContain("Second district update");
    expect(button("Resume alerts")).toBeTruthy();
  });

  it("disables autoplay for reduced motion while leaving manual navigation accessible", async () => {
    matchMedia(true);
    await act(async () => root.render(<PublicAlertController initialProjection={projection()} rotationMs={1_000} />));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.querySelector("[data-alert-current]")?.textContent).toContain("First district update");

    await act(async () => button("Next alert")?.click());
    expect(container.querySelector("[data-alert-current]")?.textContent).toContain("Second district update");
    expect(container.querySelector('[aria-live="polite"]')?.textContent)
      .toBe("Alert 2 of 2: Second district update");
  });

  it("runs one finite scrolling pass for a single opted-in alert and repeats after the gap", async () => {
    await act(async () => root.render(<PublicAlertController initialProjection={projection({
      activeAlerts: [scrollingAlert()],
    })} />));

    const bar = container.querySelector("[data-public-alert-controller]");
    expect(bar?.getAttribute("data-alert-mode")).toBe("scrolling");
    expect(button("Pause alerts")).toBeTruthy();
    const firstTrack = container.querySelector<HTMLElement>("[data-alert-track]")!;
    expect(firstTrack.style.getPropertyValue("--alert-scroll-duration")).toBe("19.167s");

    await act(async () => firstTrack.dispatchEvent(animationEvent("alert-scroll")));
    expect(bar?.getAttribute("data-alert-mode")).toBe("gap");
    await act(async () => vi.advanceTimersByTimeAsync(1_200));
    expect(bar?.getAttribute("data-alert-mode")).toBe("scrolling");
    expect(container.querySelector("[data-alert-track]")).not.toBe(firstTrack);
  });

  it("uses a timeout for stationary alerts and animation completion for scrolling alerts", async () => {
    await act(async () => root.render(<PublicAlertController initialProjection={projection({
      activeAlerts: [
        { id: "still", category: "general", message: "Stationary update" },
        scrollingAlert({ id: "moving-next" }),
      ],
    })} rotationMs={5_000} />));

    const bar = container.querySelector("[data-public-alert-controller]");
    expect(bar?.getAttribute("data-alert-mode")).toBe("stationary");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.querySelector("[data-alert-current]")?.textContent).toContain("A moving district update");
    expect(bar?.getAttribute("data-alert-mode")).toBe("scrolling");
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(container.querySelector("[data-alert-current]")?.textContent).toContain("A moving district update");

    await act(async () => container.querySelector("[data-alert-track]")?.dispatchEvent(animationEvent("alert-scroll")));
    expect(container.querySelector("[data-alert-current]")?.textContent).toContain("Stationary update");
  });

  it("holds a newly selected scrolling alert visibly until every pause condition clears", async () => {
    await act(async () => root.render(<PublicAlertController initialProjection={projection({
      activeAlerts: [
        { id: "still", category: "general", message: "Stationary update" },
        scrollingAlert({ id: "moving-next" }),
      ],
    })} />));

    await act(async () => button("Pause alerts")?.click());
    const next = button("Next alert")!;
    next.focus();
    await act(async () => next.click());
    const bar = container.querySelector("[data-public-alert-controller]");
    expect(bar?.getAttribute("data-alert-mode")).toBe("held");
    expect(container.textContent).toContain("A moving district update");
    expect(container.querySelector("[data-alert-track]")).toBeNull();

    await act(async () => button("Resume alerts")?.click());
    expect(bar?.getAttribute("data-alert-mode")).toBe("held");
    await act(async () => (document.activeElement as HTMLElement | null)?.blur());
    expect(bar?.getAttribute("data-alert-mode")).toBe("scrolling");
  });

  it("centers a linked scrolling message while it has keyboard focus", async () => {
    await act(async () => root.render(<PublicAlertController initialProjection={projection({
      activeAlerts: [scrollingAlert({ link: "/newsletter" })],
    })} />));
    const bar = container.querySelector("[data-public-alert-controller]");
    const link = container.querySelector<HTMLAnchorElement>('a[href="/newsletter"]')!;

    await act(async () => link.focus());
    expect(bar?.getAttribute("data-alert-mode")).toBe("message-focused");
    expect(container.querySelector("[data-alert-track]")).toBeNull();
    expect(link.textContent).toContain("A moving district update");
    await act(async () => link.blur());
    await vi.waitFor(() => expect(bar?.getAttribute("data-alert-mode")).toBe("scrolling"));
  });

  it("renders scrolling alerts as stationary without autoplay for reduced motion", async () => {
    matchMedia(true);
    await act(async () => root.render(<PublicAlertController initialProjection={projection({
      activeAlerts: [scrollingAlert(), { id: "second", category: "office", message: "Second update" }],
    })} rotationMs={1_000} />));
    const bar = container.querySelector("[data-public-alert-controller]");
    expect(bar?.getAttribute("data-reduced-motion")).toBe("true");
    await vi.waitFor(() => expect(bar?.getAttribute("data-alert-mode")).toBe("stationary"));
    expect(container.querySelector("[data-alert-track]")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.textContent).toContain("A moving district update");
  });

  it("rejects a refreshed projection with a non-boolean scroll value", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      ...projection(),
      revisionId: "22222222-2222-4222-8222-222222222222",
      activeAlerts: [{ id: "invalid", category: "general", message: "Invalid update", scroll: "true" }],
      evaluatedAt: "2026-08-08T12:00:01.000Z",
      nextTransitionAt: null,
    }));
    await act(async () => root.render(<PublicAlertController initialProjection={projection({
      activeAlerts: [{ id: "current", category: "general", message: "Current update" }],
      nextTransitionAt: "2026-08-08T12:00:01.000Z",
    })} transitionDelayMs={10} />));

    await act(async () => vi.advanceTimersByTimeAsync(1_020));
    expect(container.textContent).toContain("Current update");
    expect(container.textContent).not.toContain("Invalid update");
    expect(container.textContent).toContain("Latest alerts could not be refreshed.");
  });

  it("drops expired alerts locally and preserves still-valid content after a safe refresh failure", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("private provider detail"));
    await act(async () => root.render(<PublicAlertController initialProjection={projection({
      activeAlerts: [
        { id: "ending", category: "urgent", message: "Ending update", endsAt: "2026-08-08T12:00:01.000Z" },
        { id: "lasting", category: "general", message: "Still current", endsAt: "2026-08-08T13:00:00.000Z" },
      ],
      nextTransitionAt: "2026-08-08T12:00:01.000Z",
    })} transitionDelayMs={10} />));

    await act(async () => vi.advanceTimersByTimeAsync(1_020));
    expect(container.textContent).not.toContain("Ending update");
    expect(container.textContent).toContain("Still current");
    expect(container.textContent).toContain("Latest alerts could not be refreshed.");
    expect(container.textContent).not.toContain("private provider detail");
  });

  it("adds future content only after a successful no-store refresh and retries on focus", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("first failure"))
      .mockResolvedValueOnce(Response.json(projection({
        revisionId: "22222222-2222-4222-8222-222222222222",
        activeAlerts: [{ id: "new", category: "general", message: "Newly active update" }],
        evaluatedAt: "2026-08-08T12:00:02.000Z",
      })));
    await act(async () => root.render(<PublicAlertController initialProjection={projection({
      activeAlerts: [{ id: "current", category: "general", message: "Current update" }],
      nextTransitionAt: "2026-08-08T12:00:01.000Z",
    })} transitionDelayMs={10} />));

    await act(async () => vi.advanceTimersByTimeAsync(1_020));
    expect(container.textContent).toContain("Current update");
    expect(container.textContent).not.toContain("Newly active update");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toContain("Newly active update");
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith("/api/public/alerts", expect.objectContaining({
      cache: "no-store",
      credentials: "same-origin",
    }));
  });
});
