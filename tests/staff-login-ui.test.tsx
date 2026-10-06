// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LoginForm } from "../app/admin/login/login-form";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("requests a server-tracked link and makes retry available after sixty seconds", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json({ status: "requested" })); vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  await act(async () => root.render(<LoginForm returnTo="/admin/editor" />));
  host.querySelector("input")!.value = "staff@example.com";
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(fetcher).toHaveBeenCalledWith("/api/builder/sign-in", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }));
  expect(host.textContent).toContain("If this address has staff access");
  expect(host.querySelector("button")!.disabled).toBe(true);
  await act(async () => vi.advanceTimersByTime(60000));
  expect(host.querySelector("button")!.disabled).toBe(false);
  await act(async () => root.unmount());
});
