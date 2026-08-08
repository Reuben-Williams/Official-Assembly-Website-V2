// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@reuben-williams/next", () => ({
  BuilderDomContentBridge: () => <div data-testid="dom-content-bridge" />,
  BuilderPreviewBridge: () => <div data-testid="preview-bridge" />,
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
});

describe("builder content browser boundary", () => {
  it("keeps authenticated preview messaging without mounting the public DOM replacement bridge", async () => {
    await act(async () => root?.render(<BuilderContentBridge />));

    expect(container?.querySelector('[data-testid="preview-bridge"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="dom-content-bridge"]')).toBeNull();
  });
});
