import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditorShell } from "@reuben-williams/editor";
import { OfficialProfileSection } from "../app/ui/OfficialProfileSection";
import config from "../builder.config";
import { formattedEditorText } from "../lib/builder/formatted-text";

describe("visual representative-card editing", () => {
  it("retains safe toolbar colors and rules without accepting arbitrary styles", () => {
    const html = renderToStaticMarkup(<div>{formattedEditorText('<p><span style="color: #123456; position: fixed; background-image: url(evil)">Text</span><mark style="background-color: #ffff00">Highlighted</mark></p><hr>')}</div>);
    expect(html).toContain('style="color:#123456"');
    expect(html).toContain('style="background-color:#ffff00"');
    expect(html).toContain('<hr/>');
    expect(html).not.toContain('position');
    expect(html).not.toContain('evil');
  });
  it("provides visual formatting in both the inspector and Quick edit", () => {
    const html = renderToStaticMarkup(<EditorShell siteId="test" currentPath="/" pages={[]}
      previewBaseUrl="https://example.test/" selectedRegion={{ id: "home.official.education.details",
        kind: "richText", value: "<ul><li><strong>B.A.</strong> Montclair</li></ul>" }} />);
    expect(html.match(/data-builder-rich-text-editor="block"/g)).toHaveLength(2);
    expect(html).not.toContain('&lt;ul&gt;');
    expect(html.match(/aria-label="Bullet list"/g)).toHaveLength(2);
  });
  it("registers all four cards for block formatting", () => {
    for (const card of ["office", "biography", "education", "committees"]) {
      expect(config.globalRegions.find(region => region.id === `home.official.${card}.details`)?.kind).toBe("richText");
    }
  });
  it.each(["text", "richText"] as const)("preserves formatting from %s saved content on first render", type => {
    const html = renderToStaticMarkup(<OfficialProfileSection content={{ regions: {
      "home.official.education.details": { type, value: "<ol><li><strong>B.A.</strong> Montclair</li><li><em>M.A.S.</em> Fairleigh</li></ol>" },
    } }} />);
    expect(html).toContain('<ol><li><strong>B.A.</strong> Montclair</li><li><em>M.A.S.</em> Fairleigh</li></ol>');
    expect(html).toContain('data-builder-region="home.official.education.details" data-builder-kind="richText"');
  });
  it("does not execute or render unsafe saved markup", () => {
    const html = renderToStaticMarkup(<OfficialProfileSection content={{ regions: {
      "home.official.education.details": { type: "richText", value: '<p onclick="evil()">Safe &amp; sound</p><script>evil()</script><img src=x onerror="evil()"><a href="javascript:evil()">Link</a>' },
    } }} />);
    expect(html).toContain('Safe &amp; sound');
    expect(html).not.toContain('evil()');
  });
});
