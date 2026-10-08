// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { applyDraftPageText } from "../lib/builder/page-text-preview";

beforeEach(() => {
  document.body.innerHTML = '<h3 data-builder-kind="text" data-builder-region="heading">Published heading</h3><div data-builder-kind="richText" data-builder-region="home.official.education.details"><ul><li>Published qualification</li></ul></div>';
});

it("restores saved formatted text into the editor preview after reload", () => {
  applyDraftPageText(document, {
    "home.official.education.details": { type: "richText", value: "<ul><li><strong>Saved qualification</strong></li></ul>" },
  });
  expect(document.querySelector("li strong")?.textContent).toBe("Saved qualification");
});

it("shows saved heading formatting and intentionally empty text", () => {
  applyDraftPageText(document, { heading: { type: "text", value: "<p><strong>Draft heading</strong></p>" } });
  expect(document.querySelector("h3")?.innerHTML).toBe("<strong>Draft heading</strong>");
  applyDraftPageText(document, { heading: { type: "text", value: "" } });
  expect(document.querySelector("h3")?.textContent).toBe("");
});

it("preserves unsaved regions and strips executable markup from saved text", () => {
  applyDraftPageText(document, { "home.official.education.details": { type: "richText", value: '<ul><li onclick="evil()">Safe</li></ul><script>evil()</script><img src="x" onerror="evil()"><a href="javascript:evil()">Link</a>' } });
  expect(document.querySelector("h3")?.textContent).toBe("Published heading");
  expect(document.querySelector("script, img, [onclick], [onerror], a")).toBeNull();
  expect(document.querySelector("li")?.textContent).toBe("Safe");
});

it("does not erase nested independently editable regions or apply mismatched values", () => {
  document.body.innerHTML = '<div data-builder-region="parent" data-builder-kind="text"><span data-builder-region="child" data-builder-kind="text">Keep</span></div>';
  applyDraftPageText(document, { parent: { type: "text", value: "Erase" }, child: { type: "image", src: "/photo.jpg", alt: "Photo" } });
  expect(document.querySelector("span")?.textContent).toBe("Keep");
});
