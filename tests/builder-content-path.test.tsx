// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/missing-page" }));

vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("@reuben-williams/next", () => ({
  BuilderDomContentBridge: ({ pathname }: { pathname?: string }) => (
    <div data-testid="dom-content-bridge" data-pathname={pathname ?? ""} />
  ),
  BuilderPreviewBridge: () => <div data-testid="preview-bridge" />
}));

import { BuilderContentBridge } from "../app/builder-content-bridge";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  navigation.pathname = "/missing-page";
});

describe("builder content path resolution", () => {
  it("loads the canonical /404 record for a rendered not-found view", async () => {
    await act(async () => root?.render(
      <>
        <main data-builder-content-path="/404" />
        <BuilderContentBridge />
      </>
    ));

    expect(container?.querySelector('[data-testid="dom-content-bridge"]')?.getAttribute("data-pathname"))
      .toBe("/404");
  });

  it("loads the actual pathname for a normal page", async () => {
    navigation.pathname = "/about";

    await act(async () => root?.render(
      <>
        <main />
        <BuilderContentBridge />
      </>
    ));

    expect(container?.querySelector('[data-testid="dom-content-bridge"]')?.getAttribute("data-pathname"))
      .toBe("/about");
  });
});
