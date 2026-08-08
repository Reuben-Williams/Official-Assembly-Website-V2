// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  submit: vi.fn()
}));

vi.mock("@reuben-williams/next/forms", () => ({
  BuilderForm: () => (
    <form onSubmit={(event) => {
      event.preventDefault();
      mocks.submit();
    }}>
      <input type="hidden" name="cf-turnstile-response" defaultValue="" />
      <button type="submit">Submit</button>
    </form>
  )
}));

import { TurnstileAwareBuilderForm } from "../app/ui/TurnstileAwareBuilderForm";

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mocks.submit.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(
    <TurnstileAwareBuilderForm
      endpoint="/api/forms/newsletter-signup"
      projection={{} as never}
    />
  ));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("TurnstileAwareBuilderForm", () => {
  it("blocks submission until Turnstile has produced a token", async () => {
    await act(async () => host.querySelector("button")?.click());

    expect(mocks.submit).not.toHaveBeenCalled();
    expect(host.querySelector("[data-turnstile-status]")?.textContent)
      .toContain("Verification is still loading");
  });

  it("passes submission to the managed form after verification", async () => {
    const token = host.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
    expect(token).not.toBeNull();
    token!.value = "verified-token";

    await act(async () => host.querySelector("button")?.click());

    expect(mocks.submit).toHaveBeenCalledOnce();
  });
});
