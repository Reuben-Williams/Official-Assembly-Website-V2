// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NewsletterConfirmationClient } from "../app/newsletter/confirm/confirmation-client";

describe("NewsletterConfirmationClient", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("removes the fragment before network work and requires a separate confirm click", async () => {
    history.replaceState(null, "", "/newsletter/confirm#token=fragment-secret");
    const order: string[] = [];
    const replace = vi.spyOn(history, "replaceState").mockImplementation((...args) => {
      order.push("fragment-removed");
      return History.prototype.replaceState.apply(history, args);
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (input, init) => {
        order.push("session-request");
        expect(String(input)).toBe("/api/newsletter/confirmation-session");
        expect(init).toMatchObject({ method: "POST", cache: "no-store", referrerPolicy: "no-referrer" });
        expect(String(init?.body)).toContain("fragment-secret");
        expect(String(input)).not.toContain("fragment-secret");
        return Response.json({ status: "ready" });
      })
      .mockImplementationOnce(async (input, init) => {
        expect(String(input)).toBe("/api/newsletter/confirm");
        expect(init).toMatchObject({ method: "POST", cache: "no-store", referrerPolicy: "no-referrer" });
        return Response.json({ status: "activation_pending" }, { status: 202 });
      });

    await act(async () => root.render(<NewsletterConfirmationClient />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(replace).toHaveBeenCalled();
    expect(order).toEqual(["fragment-removed", "session-request"]);
    expect(location.hash).toBe("");
    expect(host.textContent).toContain("Confirm subscription");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("activation is being completed");
  });
});
