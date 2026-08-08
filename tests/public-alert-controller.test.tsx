// @vitest-environment jsdom

import type { PublicAlertProjectionV1 } from "@reuben-williams/content";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublicAlertController } from "../app/ui/PublicAlertController";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-08T12:00:00.000Z"));
  matchMedia(false);
  vi.stubGlobal("fetch", vi.fn());
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
