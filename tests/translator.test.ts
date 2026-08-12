import { describe, expect, it } from "vitest";

import { imageAssets, pages, siteConfig, stats } from "../app/data/site";
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
  ,"Page Resources",
  "Verified paths for District 34 residents",
  `Use these links for current public information or contact the district office at ${siteConfig.phoneDisplay}.`,
  "Official sources first",
  "State services, voting details, and legislative records link to current government sources.",
  "District office access",
  `Residents can call ${siteConfig.phoneDisplay} when online intake is unavailable.`,
  "District office media",
  "Additional district media",
  "Community and small business engagement"
];

function collectVisibleSiteStrings() {
  return [
    siteConfig.officeName,
    siteConfig.representativeName,
    siteConfig.tagline,
    ...stats.flatMap((stat) => [stat.value, stat.label]),
    ...imageAssets.map((asset) => asset.alt),
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

  it("does not count identity placeholders as completed translations", () => {
    const protectedNeutralValues = new Set([
      siteConfig.representativeName,
      siteConfig.officeName,
      siteConfig.officeAddress,
      siteConfig.phoneDisplay,
    ]);
    const untranslated = collectVisibleSiteStrings().filter((text) =>
      spanishTranslations[text] === text && !protectedNeutralValues.has(text));

    expect(untranslated).toEqual([]);
  });

  it("translates exact text while preserving surrounding whitespace", () => {
    expect(translateText("  Contact Office  ", "es")).toBe(
      "  Contactar Oficina  "
    );
    expect(translateText("Contact Office", "en")).toBe("Contact Office");
  });

  it("translates the News hub and embedded signup labels", () => {
    expect(translateText("News & Updates", "es")).toBe("Noticias y novedades");
    expect(translateText("Email Updates", "es")).toBe("Actualizaciones por correo electrónico");
    expect(translateText("Get News & Updates by email", "es")).toBe(
      "Reciba noticias y novedades por correo electrónico"
    );
    expect(translateText(
      "Request the District Newsletter and confirm through the email sent to your inbox before the subscription becomes active.",
      "es"
    )).toBe(
      "Solicite el boletín del distrito y confirme mediante el correo enviado a su bandeja de entrada antes de que se active la suscripción."
    );
    expect(translateText("Review newsletter signup details", "es")).toBe(
      "Consulte los detalles de suscripción al boletín"
    );
  });
});
