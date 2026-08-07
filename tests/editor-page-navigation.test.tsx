// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorClient } from "../app/admin/editor/editor-client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function installMatchMedia() {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(min-width: 768px)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })));
}

beforeEach(() => {
  window.history.replaceState({}, "", "/admin/editor?workspace=website.pages");
  installMatchMedia();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

describe("editor page navigation", () => {
  it("returns the main view to the page editor when a page is selected from Posts", async () => {
    window.history.replaceState({}, "", "/admin/editor?workspace=website.posts");

    await act(async () => root?.render(
      <EditorClient
        initialLinkablePosts={[]}
        initialPath="/"
        memberId="member-1"
        previewBaseUrl="https://assembly.example"
        role="owner"
      />
    ));

    const resources = container?.querySelector<HTMLAnchorElement>('a[href="?path=%2Fresources"]');
    expect(resources).toBeTruthy();

    await act(async () => resources?.click());

    const frame = container?.querySelector<HTMLIFrameElement>("iframe[data-builder-preview-frame]");
    expect(frame?.src).toContain("https://assembly.example/resources?builderPreview=1");
    expect(container?.querySelector('[data-builder-preview-visible="true"]')).not.toBeNull();
    expect(new URL(window.location.href).searchParams.get("workspace")).toBe("website.pages");
    expect(new URL(window.location.href).searchParams.get("path")).toBe("/resources");
  });

  it("updates the editable preview and durable editor URL when a page is selected", async () => {
    await act(async () => root?.render(
      <EditorClient
        initialLinkablePosts={[]}
        initialPath="/"
        memberId="member-1"
        previewBaseUrl="https://assembly.example"
        role="owner"
      />
    ));

    const about = container?.querySelector<HTMLAnchorElement>('a[href="?path=%2Fabout"]');
    expect(about).toBeTruthy();

    await act(async () => about?.click());

    const frame = container?.querySelector<HTMLIFrameElement>("iframe[data-builder-preview-frame]");
    expect(frame?.src).toContain("https://assembly.example/about?builderPreview=1");
    expect(container?.textContent).toContain("Editing /about");
    expect(new URL(window.location.href).searchParams.get("workspace")).toBe("website.pages");
    expect(new URL(window.location.href).searchParams.get("path")).toBe("/about");
  });

  it("uses the server-validated bookmarked page for the first editable preview", async () => {
    window.history.replaceState({}, "", "/admin/editor?workspace=website.pages&path=%2F404");

    await act(async () => root?.render(
      <EditorClient
        initialLinkablePosts={[]}
        initialPath="/404"
        memberId="member-1"
        previewBaseUrl="https://assembly.example"
        role="owner"
      />
    ));

    const frame = container?.querySelector<HTMLIFrameElement>("iframe[data-builder-preview-frame]");
    expect(frame?.src).toContain("https://assembly.example/404?builderPreview=1");
    expect(container?.textContent).toContain("Editing /404");
    expect(vi.mocked(fetch).mock.calls.some(([input]) =>
      String(input).includes("resource=audit&path=%2F404"))).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([input]) =>
      String(input).includes("resource=audit&path=%2F&"))).toBe(false);
  });

  it("never mounts an iframe or requests content for an invalid initial path", async () => {
    window.history.replaceState({}, "", "/admin/editor?workspace=website.pages&path=https%3A%2F%2Fmalicious.example");

    await act(async () => root?.render(
      <EditorClient
        initialLinkablePosts={[]}
        initialPath="https://malicious.example"
        memberId="member-1"
        previewBaseUrl="https://assembly.example"
        role="owner"
      />
    ));

    const frame = container?.querySelector<HTMLIFrameElement>("iframe[data-builder-preview-frame]");
    expect(frame?.src).toContain("https://assembly.example/?builderPreview=1");
    expect(frame?.src).not.toContain("malicious.example");
    expect(vi.mocked(fetch).mock.calls.some(([input]) =>
      String(input).includes("malicious.example"))).toBe(false);
    expect(new URL(window.location.href).searchParams.get("path")).toBe("/");
  });

  it("restores a validated page from browser history without pushing a new entry", async () => {
    await act(async () => root?.render(
      <EditorClient
        initialLinkablePosts={[]}
        initialPath="/"
        memberId="member-1"
        previewBaseUrl="https://assembly.example"
        role="owner"
      />
    ));
    const pushState = vi.spyOn(window.history, "pushState");

    window.history.replaceState({}, "", "/admin/editor?workspace=website.pages&path=%2Fabout");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));

    const frame = container?.querySelector<HTMLIFrameElement>("iframe[data-builder-preview-frame]");
    expect(frame?.src).toContain("https://assembly.example/about?builderPreview=1");
    expect(container?.textContent).toContain("Editing /about");
    expect(pushState).not.toHaveBeenCalled();
  });
});
