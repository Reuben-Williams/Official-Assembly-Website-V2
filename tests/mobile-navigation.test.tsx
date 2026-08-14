// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppHeader } from "../app/ui/AppHeader";
import type { BuilderServerContent } from "../lib/builder/server-content";

let pathname = "/news/district-update";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let desktopListeners: Set<(event: MediaQueryListEvent) => void>;

function installMatchMedia() {
  desktopListeners = new Set();
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (query === "(min-width: 921px)") desktopListeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      desktopListeners.delete(listener);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

async function renderHeader(content?: BuilderServerContent, locale: "en" | "es" = "en") {
  await act(async () => root.render(<AppHeader content={content} locale={locale} />));
}

function menuTrigger() {
  return document.querySelector<HTMLButtonElement>('[data-mobile-menu-trigger]');
}

function dialog() {
  return document.querySelector<HTMLElement>('[data-mobile-menu-dialog]');
}

async function click(element: HTMLElement | null) {
  expect(element).not.toBeNull();
  await act(async () => element?.click());
}

async function keydown(key: string, options: KeyboardEventInit = {}) {
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  })));
}

beforeEach(() => {
  pathname = "/news/district-update";
  installMatchMedia();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.removeAttribute("style");
  vi.unstubAllGlobals();
});

describe("mobile off-canvas navigation", () => {
  it("opens a fixed modal dialog without using normal-flow details content", async () => {
    await renderHeader();

    const trigger = menuTrigger();
    expect(trigger?.getAttribute("aria-label")).toBe("Open menu");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("details.mobile-menu")).toBeNull();

    await click(trigger);

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger?.getAttribute("aria-label")).toBe("Close menu");
    expect(trigger?.getAttribute("aria-controls")).toBe("mobile-navigation-dialog");
    expect(dialog()?.getAttribute("role")).toBe("dialog");
    expect(dialog()?.id).toBe("mobile-navigation-dialog");
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    expect(dialog()?.getAttribute("aria-labelledby")).toBe("mobile-navigation-title");
    expect(dialog()?.querySelector("nav")?.getAttribute("aria-label")).toBe("Mobile navigation");
    expect(document.activeElement).toBe(dialog()?.querySelector('[data-mobile-menu-close]'));
  });

  it("closes from Escape, backdrop, and close button while restoring trigger focus", async () => {
    await renderHeader();
    const trigger = menuTrigger()!;

    await click(trigger);
    await keydown("Escape");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    await click(trigger);
    await click(document.querySelector('[data-mobile-menu-backdrop]'));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    await click(trigger);
    await click(dialog()?.querySelector<HTMLElement>('[data-mobile-menu-close]') ?? null);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps inside clicks open and traps forward and reverse keyboard focus", async () => {
    await renderHeader();
    await click(menuTrigger());
    const panel = dialog()!;
    await click(panel.querySelector("h2"));
    expect(menuTrigger()?.getAttribute("aria-expanded")).toBe("true");

    const focusable = [...panel.querySelectorAll<HTMLElement>('button, a[href]')];
    const first = focusable[0];
    const last = focusable.at(-1)!;
    last.focus();
    await keydown("Tab");
    expect(document.activeElement).toBe(first);

    first.focus();
    await keydown("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("locks body scrolling without losing existing styles and restores them exactly", async () => {
    document.body.style.overflow = "clip";
    document.body.style.paddingRight = "3px";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1180 });
    await renderHeader();

    await click(menuTrigger());
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.paddingRight).toBe("23px");

    await click(dialog()?.querySelector<HTMLElement>('[data-mobile-menu-close]') ?? null);
    expect(document.body.style.overflow).toBe("clip");
    expect(document.body.style.paddingRight).toBe("3px");
  });

  it("closes on a desktop breakpoint without restoring focus and removes its listener", async () => {
    await renderHeader();
    await click(menuTrigger());
    dialog()?.querySelector<HTMLElement>("a")?.focus();
    expect(desktopListeners.size).toBe(1);

    await act(async () => {
      for (const listener of desktopListeners) listener({ matches: true } as MediaQueryListEvent);
    });
    expect(menuTrigger()?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).not.toBe(menuTrigger());

    await act(async () => root.unmount());
    expect(desktopListeners.size).toBe(0);
    root = createRoot(container);
  });

  it("identifies the current route and handles same-route and modified link activation", async () => {
    pathname = "/news";
    await renderHeader();
    const trigger = menuTrigger()!;
    await click(trigger);
    const news = dialog()?.querySelector<HTMLAnchorElement>('a[href="/news"]')!;
    expect(news.getAttribute("aria-current")).toBe("page");

    await click(news);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    await click(trigger);
    const contact = dialog()?.querySelector<HTMLAnchorElement>('a[href="/contact"]')!;
    contact.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await act(async () => contact.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    })));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("preserves builder order, overrides, metadata, and one emphasized Contact destination", async () => {
    const origin = window.location.origin;
    pathname = "/news/announcement";
    const content: BuilderServerContent = { regions: {
      "global.navigation": { type: "sections", value: ["news", "contact", "about"] },
      "global.navigation.news.link": { type: "link", href: `${origin}/news?source=menu#latest`, label: "Office dispatches" },
      "global.navigation.news.label": { type: "text", value: "Latest dispatches" },
      "global.navigation.contact.link": { type: "link", href: "/contact", label: "Contact the team" },
      "global.navigation.about.link": { type: "link", href: "https://example.org/about", label: "External profile" },
    } };
    await renderHeader(content);
    expect([...container.querySelectorAll<HTMLAnchorElement>('.nav-links a')]
      .map((link) => link.getAttribute("data-builder-item-id"))).toEqual(["news", "contact", "about"]);
    await click(menuTrigger());

    const links = [...dialog()!.querySelectorAll<HTMLAnchorElement>('nav a')];
    expect(links.map((link) => link.getAttribute("data-builder-item-id"))).toEqual(["news", "contact", "about"]);
    expect(links.map((link) => link.textContent?.trim())).toEqual(["Latest dispatches", "Contact the team", "External profile"]);
    expect(links[0].getAttribute("data-builder-instance")).toBe("mobile");
    expect(links[0].getAttribute("data-builder-region")).toBe("global.navigation.news.link");
    expect(links[0].getAttribute("aria-current")).toBe("page");
    expect(links[2].getAttribute("aria-current")).toBeNull();
    expect(links.filter((link) => link.getAttribute("data-mobile-contact") === "true")).toHaveLength(1);
  });

  it("uses exact Spanish menu labels", async () => {
    await renderHeader(undefined, "es");
    const trigger = menuTrigger();
    expect(trigger?.getAttribute("aria-label")).toBe("Abrir menú");
    await click(trigger);
    expect(trigger?.getAttribute("aria-label")).toBe("Cerrar menú");
    expect(dialog()?.querySelector("h2")?.textContent).toBe("Navegación móvil");
  });

  it("defines viewport-fixed, overflow-safe, reduced-motion drawer styles", () => {
    const css = readFileSync(resolve("app/globals.css"), "utf8");
    expect(css).toMatch(/\.mobile-navigation-overlay\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/);
    expect(css).toMatch(/\.mobile-navigation-drawer\s*\{[^}]*position:\s*absolute;[^}]*overflow-y:\s*auto;/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.mobile-navigation-(?:overlay|drawer)/);
    expect(css).toMatch(/@media\s*\(min-width:\s*921px\)[\s\S]*\.mobile-menu/);
  });
});
