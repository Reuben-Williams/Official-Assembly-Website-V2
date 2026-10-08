import type { EditableValue } from "@reuben-williams/core";
import { renderToStaticMarkup } from "react-dom/server";
import { formattedEditorText } from "./formatted-text";

/** Loaded only inside an authenticated editor preview, never on public pages. */
export function applyDraftPageText(root: Document, regions: Readonly<Record<string, EditableValue>>) {
  for (const element of root.querySelectorAll<HTMLElement>('[data-builder-region][data-builder-kind="text"], [data-builder-region][data-builder-kind="richText"]')) {
    const value = regions[element.dataset.builderRegion ?? ""];
    if (value?.type !== "text" && value?.type !== "richText") continue;
    // Parent containers must not erase separately registered child controls.
    if (element.querySelector("[data-builder-region]")) continue;
    // Use the public renderer's allowlist so preview formatting and safety match
    // publication. Never inject the stored HTML directly into the document.
    element.innerHTML = renderToStaticMarkup(<>{formattedEditorText(value.value, element.dataset.builderKind === "text")}</>);
  }
}
