import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/ui/ResidentForms", () => ({
  ResidentForm: async ({ type }: { type: string }) => (
    <form action={`/api/forms/${type}-signup`} data-managed-form={type}>
      <button type="submit">Submit</button>
    </form>
  )
}));

import builderConfig from "../builder.config";
import { pages } from "../app/data/site";
import { PageTemplate } from "../app/ui/PageTemplate";

const volunteerUrl = "https://docs.google.com/forms/d/e/1FAIpQLSe5hM4Idlwm4bJC55AL-Q9xlyK59bm4yiTOmaG31YbeekYhyw/viewform";
const essexUrls = [
  "https://www.essexclerk.com/Election",
  "https://www.essexclerk.com/Forms",
  "https://www.essexclerk.com/Services/5",
  "https://www.essexclerk.com/Services/6",
  "https://www.essexclerk.com/Services/30"
];

function page(path: string) {
  const value = pages.find((candidate) => candidate.href === path);
  if (!value) throw new Error(`Missing page: ${path}`);
  return value;
}

describe("September constituent page updates", () => {
  it("removes the resource preview aspect ratio on narrow screens", () => {
    const css = readFileSync(resolve("app/ui/constituent-action-sections.module.css"), "utf8");
    const mobileRules = css.slice(css.indexOf("@media (max-width: 800px)"));

    expect(mobileRules).toMatch(/\.flyer,\s*\.emptyResource\s*\{[\s\S]*?aspect-ratio:\s*auto/);
    expect(mobileRules).toMatch(/\.flyer,\s*\.emptyResource\s*\{[\s\S]*?min-width:\s*0/);
    expect(mobileRules).toMatch(/\.flyer,\s*\.emptyResource\s*\{[\s\S]*?width:\s*100%/);
  });

  it("places an editor-managed current-resource block immediately after the Resources introduction", async () => {
    const registered = builderConfig.pages.find((candidate) => candidate.path === "/resources");
    expect(registered?.regions.map((region) => region.id)).toEqual(expect.arrayContaining([
      "media.current-resource-flyer",
      "resources.current-resource.eyebrow",
      "resources.current-resource.title",
      "resources.current-resource.body",
      "resources.current-resource.destination"
    ]));

    const emptyHtml = renderToStaticMarkup(await PageTemplate({ page: page("/resources") }));
    expect(emptyHtml).toContain('data-builder-item-id="current-resource"');
    expect(emptyHtml).toContain("No current district resource flyer is posted.");
    expect(emptyHtml.indexOf('data-builder-item-id="current-resource"'))
      .toBeLessThan(emptyHtml.indexOf('data-builder-item-id="features"'));

    const populatedHtml = renderToStaticMarkup(await PageTemplate({
      page: page("/resources"),
      content: {
        regions: {
          "media.current-resource-flyer": {
            type: "image",
            src: "/images/current-district-resource.webp",
            alt: "Current District 34 public resource flyer"
          },
          "resources.current-resource.title": { type: "text", value: "Current district resource" },
          "resources.current-resource.body": { type: "text", value: "Review the current office resource." },
          "resources.current-resource.destination": {
            type: "link",
            href: "https://www.nj.gov/nj/gov/deptserv/",
            label: "Open official resource"
          }
        }
      }
    }));
    expect(populatedHtml).toContain('data-builder-region="media.current-resource-flyer"');
    expect(populatedHtml).toContain("current-district-resource.webp");
    expect(populatedHtml).toContain("Current District 34 public resource flyer");
    expect(populatedHtml).toContain("Open official resource");
  });

  it("promotes the approved external volunteer portal on Community", async () => {
    const html = renderToStaticMarkup(await PageTemplate({
      page: page("/community"),
      content: {
        regions: {
          "community.volunteer.body": {
            type: "text",
            value: "Updated volunteer invitation."
          }
        }
      }
    }));

    expect(html).toContain('data-builder-item-id="volunteer-portal"');
    expect(html).toContain(volunteerUrl);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("This volunteer form is operated by Google Forms and opens in a new tab.");
    expect(html).toContain("Updated volunteer invitation.");
    expect(html.indexOf('data-builder-item-id="volunteer-portal"'))
      .toBeLessThan(html.indexOf('data-builder-item-id="features"'));
    expect(html).toContain('href="/events"');
  });

  it("links the News and Community pages to the onsite events agenda", async () => {
    const newsHtml = renderToStaticMarkup(await PageTemplate({ page: page("/news") }));
    const communityHtml = renderToStaticMarkup(await PageTemplate({ page: page("/community") }));

    expect(newsHtml).toContain('href="/events"');
    expect(newsHtml).toContain("Community Events");
    expect(communityHtml).toContain('href="/events"');
  });

  it("prioritizes all five Essex County Clerk paths and retains state resources secondarily", async () => {
    const voting = page("/voting");
    const primaryHrefs = voting.cards.map((card) => card.href);
    const secondaryHrefs = voting.secondaryCards?.map((card) => card.href) ?? [];

    expect(primaryHrefs).toEqual(essexUrls);
    expect(secondaryHrefs).toEqual([
      "https://www.nj.gov/state/elections/voter-registration.shtml",
      "https://www.nj.gov/state/elections/vote.shtml",
      "https://www.nj.gov/state/elections/index.shtml"
    ]);

    const html = renderToStaticMarkup(await PageTemplate({ page: voting }));
    for (const href of essexUrls) expect(html).toContain(`href="${href}"`);
    expect(html.indexOf("https://www.essexclerk.com/Election"))
      .toBeLessThan(html.indexOf("https://www.nj.gov/state/elections/voter-registration.shtml"));

    const editedHtml = renderToStaticMarkup(await PageTemplate({
      page: voting,
      content: {
        regions: {
          "voting.cards.essex-election-hub.link": {
            type: "link",
            href: "https://www.essexclerk.com/Services/30",
            label: "Open county ballot information"
          }
        }
      }
    }));
    expect(editedHtml).toContain("Open county ballot information");
    expect(editedHtml).toContain('href="https://www.essexclerk.com/Services/30"');

    const rejectedHtml = renderToStaticMarkup(await PageTemplate({
      page: voting,
      content: {
        regions: {
          "voting.cards.essex-election-hub.link": {
            type: "link",
            href: "https://example.com/not-approved",
            label: "Unsafe destination"
          }
        }
      }
    }));
    expect(rejectedHtml).not.toContain("Unsafe destination");
    expect(rejectedHtml).toContain('href="https://www.essexclerk.com/Election"');
  });

  it("keeps the onsite double-opt-in newsletter first and omits an external newsletter", async () => {
    const html = renderToStaticMarkup(await PageTemplate({ page: page("/newsletter") }));

    expect(html).toContain('data-managed-form="newsletter"');
    expect(html).toContain("after confirming your request");
    expect(html).toContain("remains pending until you use the confirmation link");
    expect(html.indexOf('data-managed-form="newsletter"'))
      .toBeLessThan(html.indexOf('data-builder-item-id="features"'));
    expect(html).not.toContain("fireside21.app");
    expect(html).not.toContain("l.instagram.com");
  });
});
