import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppFooter } from "../app/ui/AppFooter";

describe("Staff Portal footer entry", () => {
  it("links staff to the protected editor login in the same tab", () => {
    const html = renderToStaticMarkup(<AppFooter />);

    expect(html).toContain('data-staff-portal="true"');
    expect(html).toContain('href="/admin/login?returnTo=%2Fadmin%2Feditor"');
    expect(html).toContain("Staff Portal");
    expect(html).not.toContain('target="_blank"');
  });
});
