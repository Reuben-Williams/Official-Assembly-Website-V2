import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/ui/ResidentForms", () => ({
  ResidentForm: async ({ type }: { type: string }) => (
    <form action={type === "newsletter" ? "/api/forms/newsletter-signup" : `/api/forms/${type}`}>
      <label>Email address<input name="email" type="email" /></label>
      <button type="submit">Request updates</button>
    </form>
  ),
}));

import { HomePageView } from "../app/ui/HomePageView";

describe("District 34 homepage", () => {
  it("renders the approved section order and three distinct hero actions", async () => {
    const html = renderToStaticMarkup(await HomePageView({ content: { regions: {} }, posts: [] }));
    const orderedSections = ["hero", "access", "official", "connections", "latest", "guidance"];
    const positions = orderedSections.map((section) => html.indexOf(`data-home-section="${section}"`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/news"');
    expect(html).toContain('href="/newsletter"');
  });

  it("renders exactly one first-party newsletter form and no fabricated latest posts", async () => {
    const html = renderToStaticMarkup(await HomePageView({ content: { regions: {} }, posts: [] }));

    expect(html.match(/action="\/api\/forms\/newsletter-signup"/g)).toHaveLength(1);
    expect(html).toContain("No district posts have been published yet");
    expect(html).toContain("Official NJ Legislature profile");
    expect(html).toContain("Contact the District Office");
    expect(html).not.toMatch(/sample post|placeholder post|lorem ipsum/i);
  });
});
