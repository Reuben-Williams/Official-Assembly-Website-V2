import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EditorClient } from "../app/admin/editor/editor-client";

describe("production editor workspace registration", () => {
  it("hosts the live workspaces without demo or setup placeholder data", () => {
    const html = renderToStaticMarkup(
      <EditorClient
        initialLinkablePosts={[]}
        initialPath="/"
        memberId="11111111-1111-4111-8111-111111111111"
        previewBaseUrl="https://assemblywomanmorales.vercel.app"
        role="owner"
      />
    );

    expect(html).toContain("Overview");
    expect(html).toContain("Submissions");
    expect(html).toContain("Forms");
    expect(html).toContain("Leads");
    expect(html).toContain("Customers");
    expect(html).toContain("data-growth-live-workspace");
    expect(html).toContain("Live production data");
    expect(html).not.toContain("Production data is not active");
    expect(html).not.toContain("Production setup required");
    expect(html).not.toContain("Demo");
    expect(html).not.toContain("sample data");
    expect(html).toContain("Posts use the provisioned live content store");
    expect(html).not.toContain("site-managed posts remain unavailable");
    expect(html).toContain("Newsletter email uses Resend");
    expect(html).toContain("SMS and AI actions remain unavailable");
    expect(html).toContain("Resend newsletter");
    expect(html).toContain("authentic-live-form-checklist");
    expect(html).toContain("When every total is zero, there is no live form or growth activity");
    expect(html).toContain("Survey unavailable");
    expect(html).toContain("<details");
    expect(html).toContain("Sign out and revoke editor session");
    expect(html).not.toContain("editor-attachment-note");
  });

  it("scopes pointer and disabled cursors to client-owned editor controls", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8").replace(/\s+/g, " ");

    expect(css).toMatch(/\.editor-operational-header :where\(button:not\(:disabled\), a\[href\], summary\)[^{]*\{[^}]*cursor: pointer/);
    expect(css).toMatch(/\.newsletter-operations :where\(button:not\(:disabled\), a\[href\], summary\)[^{]*\{[^}]*cursor: pointer/);
    expect(css).toMatch(/\.forms-guidance :where\(button:not\(:disabled\), a\[href\], summary\)[^{]*\{[^}]*cursor: pointer/);
    expect(css).toMatch(/\.editor-operational-header button:disabled[^{]*\{[^}]*cursor: not-allowed/);
    expect(css).not.toMatch(/\.editor-operational-header\s+(?:span|p|label)\s*\{[^}]*cursor: pointer/);
  });
});
