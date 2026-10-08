// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { HtmlRichTextEditor } from "@reuben-williams/editor";
import { expect, it } from "vitest";

it("mounts block formatting with existing HTML as visible list items", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  try {
    await act(async () => root.render(<HtmlRichTextEditor profile="block"
      value="<ul><li><strong>B.A.</strong> Montclair</li><li>M.A.S.</li></ul>" onChange={() => {}} />));
    expect(host.querySelectorAll('[contenteditable="true"] li').length).toBe(2);
    expect(host.querySelector('[contenteditable="true"] strong')?.textContent).toBe("B.A.");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
