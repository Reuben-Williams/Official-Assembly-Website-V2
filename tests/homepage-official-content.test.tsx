import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/ui/ResidentForms", () => ({
  ResidentForm: async () => (
    <form action="/api/forms/newsletter-signup"><button type="submit">Request updates</button></form>
  ),
}));

import { DistrictConnectionsSection } from "../app/ui/DistrictConnectionsSection";
import { OfficialProfileSection } from "../app/ui/OfficialProfileSection";

describe("source-governed homepage content", () => {
  it("renders verified Legislature facts and canonical official actions", () => {
    const html = renderToStaticMarkup(<OfficialProfileSection content={{ regions: {} }} />);

    for (const fact of [
      "Carmen Theresa Morales",
      "Deputy Whip",
      "District 34",
      "152 Franklin Street, Belleville, NJ 07109",
      "B.A. Montclair State University (Speech Communications)",
      "EDS / EDD",
      "General Assembly 2024-present, Deputy Majority Whip 2026-present",
      "Higher Education",
      "Appropriations",
      "Science, Innovation and Technology",
      "Joint Committee on the Public Schools",
      "Verified August 8, 2026",
    ]) expect(html).toContain(fact);
    expect(html).toContain("Official NJ Legislature profile");
    expect(html).toContain("Sponsored bills");
    expect(html).toContain("Votes by bill");
    expect(html).toContain("Votes by subject");
    expect(html).toContain("Official Legislative Contact Form");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("Born:");
    expect(html).not.toContain("October 13, 1977");
    expect(html).not.toContain("Completed Doctoral Studies");
    expect(html).not.toContain("l.instagram.com");
  });

  it("keeps newsletter, bilingual volunteer, and legislative contact paths distinct", async () => {
    const html = renderToStaticMarkup(await DistrictConnectionsSection({ content: { regions: {} } }));

    expect(html.match(/action="\/api\/forms\/newsletter-signup"/g)).toHaveLength(1);
    expect(html).toContain("Community Volunteers");
    expect(html).toContain("Are you passionate about giving back to your community?");
    expect(html).toContain("¿Te apasiona retribuir a tu comunidad?");
    expect(html).toContain("Open volunteer form");
    expect(html).toContain("opens in a new tab");
    expect(html).toContain("Official Legislative Contact Form");
    expect(html).not.toContain("l.instagram.com");
    expect(html).not.toMatch(/name="(fullName|phone|address|availability)"/i);
  });
});
