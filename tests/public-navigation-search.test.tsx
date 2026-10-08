import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { navigationChildren } from "../app/data/navigation";
import { searchPublicEntries } from "../lib/public-search";
import { OfficialProfileSection } from "../app/ui/OfficialProfileSection";
import config from "../builder.config";
import { pages } from "../app/data/site";
import { SiteSearchForm } from "../app/ui/SiteSearchForm";
describe("public navigation and staff editing", () => {
  it("server-renders contextual search results for direct links and no-JavaScript use", () => {
    const html = renderToStaticMarkup(<SiteSearchForm query="volunteer" fullResults initialIndex={{ partial: false, entries: [
      { title: "Community volunteers", page: "Home", section: "Get involved", href: "/#volunteer", text: "Volunteer with the district." },
    ] }} />);
    expect(html).toContain('href="/#volunteer"');
    expect(html).toContain("Home › Get involved");
    expect(html).toContain("1 results for");
    expect(html).toContain('aria-live="polite"');
  });
  it("keeps the search action named when its visible text is hidden on mobile", () => {
    expect(renderToStaticMarkup(<SiteSearchForm />)).toContain('aria-label="Search"');
    expect(renderToStaticMarkup(<SiteSearchForm locale="es" />)).toContain('aria-label="Buscar"');
  });
  it("provides all primary menu groups and makes orphan public pages reachable", () => {
    const groups = ["home", "about", "resources", "events", "news", "voting"].flatMap(slug => {
      const children = navigationChildren(slug, "en"); expect(children?.length).toBeGreaterThan(1); return children!;
    });
    for (const href of ["/community", "/newsletter", "/social", "/contact", "/privacy", "/news/press-releases"]) expect(groups.some(item => item.href === href)).toBe(true);
    expect(groups.some(item => /admin|survey|confirm/.test(item.href))).toBe(false);
  });
  it("removes Survey from both public pages and editor registration", () => {
    expect(pages.some(page => page.href === "/survey")).toBe(false);
    expect(config.pages.some(page => page.path === "/survey")).toBe(false);
  });
  it("renders staff-authored fact lists and action destinations with editing controls", () => {
    const html = renderToStaticMarkup(<OfficialProfileSection content={{ regions: {
      "home.official.education.details": { type: "text", value: "First approved qualification\nAdditional qualification" },
      "home.official.actions.education": { type: "link", href: "/about", label: "Learn more" },
    } }} />);
    expect(html).toContain("<li>Additional qualification</li>"); expect(html).toContain('href="/about"');
    for (const card of ["office", "biography", "education", "committees"]) {
      expect(html).toContain(`data-builder-region="home.official.${card}.details"`);
      expect(config.globalRegions.some(region => region.id === `home.official.${card}.details`)).toBe(true);
    }
  });
  it("renders the actual formatted-editor payload as readable card text", () => {
    const html = renderToStaticMarkup(<OfficialProfileSection content={{ regions: {
      "home.official.education.details": { type: "text", value: "<ul><li>First &amp; second</li><li>Additional qualification</li></ul>" },
      "home.official.education.heading": { type: "text", value: "<p>Education &amp; service</p>" },
    } }} />);
    expect(html).toContain('<li>First &amp; second</li><li>Additional qualification</li>');
    expect(html).not.toContain('&lt;ul&gt;');
    expect(html).not.toContain('&lt;p&gt;');
  });
  it("returns matching text with page and section context, including accent-insensitive Spanish", () => {
    const entries = [{ title: "Voter registration", page: "Voting", section: "County resources", href: "/voting#features", text: "Find registration forms and orientación." }];
    expect(searchPublicEntries(entries, "orientacion")[0]).toMatchObject({ page: "Voting", section: "County resources", href: "/voting#features" });
    expect(searchPublicEntries(entries, "registration forms")).toHaveLength(1);
    expect(searchPublicEntries(entries, "unmatched")).toHaveLength(0); expect(searchPublicEntries(entries, " ")).toHaveLength(0);
  });
});
