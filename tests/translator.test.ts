import { describe, expect, it } from "vitest";

import { pages, siteConfig, stats } from "../app/data/site";
import { spanishTranslations, translateText } from "../app/i18n/translations";

const fixedUiStrings = [
  "Skip to content",
  "Contact Office",
  "Request Assistance",
  "View Services",
  "Open",
  "Office Workflow",
  "Public Information",
  "Service Requests",
  "Community Updates",
  "Contact the Office",
  "Get Updates",
  "Page Features",
  "Resident Form",
  "Site Sections",
  "Full name",
  "Email address",
  "Phone number",
  "Topic",
  "Message",
  "Submit Message",
  "Join Newsletter",
  "Submit Feedback"
];

function collectVisibleSiteStrings() {
  return [
    siteConfig.officeName,
    siteConfig.representativeName,
    siteConfig.tagline,
    ...stats.flatMap((stat) => [stat.value, stat.label]),
    ...pages.flatMap((page) => [
      page.navLabel,
      page.title,
      page.eyebrow,
      page.description,
      ...page.cards.flatMap((card) => [card.title, card.text, card.tag]),
      ...(page.secondaryCards ?? []).flatMap((card) => [
        card.title,
        card.text,
        card.tag
      ])
    ]),
    ...fixedUiStrings
  ].filter((text): text is string => Boolean(text));
}

describe("Spanish translator", () => {
  it("translates all public site data strings", () => {
    const strings = collectVisibleSiteStrings();
    const missing = strings.filter((text) => spanishTranslations[text] === undefined);

    expect(missing).toEqual([]);
  });

  it("translates exact text while preserving surrounding whitespace", () => {
    expect(translateText("  Contact Office  ", "es")).toBe(
      "  Contactar Oficina  "
    );
    expect(translateText("Contact Office", "en")).toBe("Contact Office");
  });
});
