import { describe, expect, it } from "vitest";

import {
  buildClientBilingualInventory,
  extractPublicHtmlInventoryItems,
  filterStaleStableCandidates,
  mergeBilingualInventoryCandidates,
  pairCatalogCandidates,
// @ts-expect-error The inventory generator is an executable ESM artifact without declarations.
} from "../scripts/generate-bilingual-inventory.mjs";

describe("bilingual public-content inventory", () => {
  it("sorts deterministic source-digested items and keeps candidates unapproved", () => {
    const inventory = buildClientBilingualInventory([
      {
        domain: "alerts",
        stableId: "alert-1",
        fieldId: "message",
        english: "District update",
        spanish: null,
        source: "live_alert",
      },
      {
        domain: "site",
        stableId: "home.hero.title",
        fieldId: "value",
        english: "District services",
        spanish: "Servicios del distrito",
        source: "published_region",
      },
    ]);

    expect(inventory).toMatchObject({
      schemaVersion: 1,
      readOnly: true,
      itemCount: 2,
      blockerCount: 2,
    });
    expect(inventory.items.map((item: { stableId: string }) => item.stableId)).toEqual([
      "alert-1",
      "home.hero.title",
    ]);
    expect(inventory.items[0]).toMatchObject({ status: "missing", spanish: null });
    expect(inventory.items[1]).toMatchObject({ status: "needs_review" });
    for (const item of inventory.items as Array<Record<string, unknown>>) {
      expect(item.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(item).not.toHaveProperty("approvedBy");
      expect(item).not.toHaveProperty("observedAt");
    }
  });

  it("rejects duplicate stable fields instead of guessing", () => {
    expect(() => buildClientBilingualInventory([
      {
        domain: "site",
        stableId: "home.hero.title",
        fieldId: "value",
        english: "First",
        spanish: null,
        source: "published_region",
      },
      {
        domain: "site",
        stableId: "home.hero.title",
        fieldId: "value",
        english: "Second",
        spanish: null,
        source: "published_region",
      },
    ])).toThrow(/duplicate/i);
  });

  it("merges identical repeated route fields but rejects cross-route drift", () => {
    const shared = {
      domain: "site",
      stableId: "global.header.brand",
      fieldId: "value",
      english: "Office of Assemblywoman Carmen Morales",
      spanish: null,
      source: "public_html:/",
    };
    expect(mergeBilingualInventoryCandidates([
      shared,
      { ...shared, source: "public_html:/news" },
    ])).toEqual([{ ...shared, source: "public_html:/,public_html:/news" }]);
    expect(() => mergeBilingualInventoryCandidates([
      shared,
      { ...shared, english: "Different office", source: "public_html:/news" },
    ])).toThrow(/conflict/i);
  });

  it("extracts stable text, link, image, metadata, and form fields from public HTML", () => {
    const html = `<!doctype html><html lang="en"><head>
      <title>News &amp; Updates</title>
      <meta name="description" content="Current district updates">
    </head><body>
      <h1 data-builder-region="news.hero.title" data-builder-kind="text">News &amp; Updates</h1>
      <a data-builder-region="news.hero.primary-cta" data-builder-kind="link" href="/contact">
        <span data-builder-link-label>Contact the Office</span>
      </a>
      <div data-builder-region="media.hero" data-builder-kind="image" data-builder-instance="news-hero">
        <img alt="Assemblywoman Morales at the State House" src="/hero.jpg">
        <div class="image-caption"><span>District office media</span></div>
      </div>
      <div data-public-form-type="newsletter">
        <label>Email address <input name="email"></label>
        <label><input name="marketingConsent" type="checkbox">I agree to receive updates.</label>
      </div>
    </body></html>`;

    const items = extractPublicHtmlInventoryItems({ route: "/news", html });
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ stableId: "news.hero.title", fieldId: "value", english: "News & Updates" }),
      expect.objectContaining({ stableId: "news.hero.primary-cta", fieldId: "label", english: "Contact the Office" }),
      expect.objectContaining({ stableId: "media.hero", fieldId: "alt", english: "Assemblywoman Morales at the State House" }),
      expect.objectContaining({ stableId: "route.news.metadata", fieldId: "title", english: "News & Updates" }),
      expect.objectContaining({ stableId: "form.newsletter.email", fieldId: "label", english: "Email address" }),
      expect.objectContaining({ stableId: "form.newsletter.marketingConsent", fieldId: "label", english: "I agree to receive updates." }),
    ]));
  });

  it("normalizes the deployed legacy form-copy IDs to their owning route", () => {
    const contact = extractPublicHtmlInventoryItems({
      route: "/contact",
      html: '<p data-builder-region="global.template.form-eyebrow" data-builder-kind="text">Resident Form</p>',
    });
    const newsletter = extractPublicHtmlInventoryItems({
      route: "/newsletter",
      html: '<p data-builder-region="global.template.form-eyebrow" data-builder-kind="text">Email Updates</p>',
    });

    expect(contact).toEqual(expect.arrayContaining([
      expect.objectContaining({ stableId: "contact.form.eyebrow", english: "Resident Form" }),
    ]));
    expect(newsletter).toEqual(expect.arrayContaining([
      expect.objectContaining({ stableId: "newsletter.form.eyebrow", english: "Email Updates" }),
    ]));
  });

  it("audits placeholder templates separately from rendered field values", () => {
    expect(pairCatalogCandidates({
      "global.footer.communication-body": {
        en: "Call {phone} for district office assistance.",
        es: "Llame al {phone} para recibir asistencia de la oficina del distrito.",
      },
    }, "checked_in_public_catalog")).toEqual([
      expect.objectContaining({
        stableId: "global.footer.communication-body",
        fieldId: "template",
      }),
    ]);
  });

  it("does not merge a stale stable translation into the current source inventory", () => {
    const observed = [{
      domain: "site",
      stableId: "home.workflow.eyebrow",
      fieldId: "value",
      english: "Constituent guidance",
      spanish: null,
      source: "public_html:/",
    }];
    const checkedIn = [{
      domain: "site",
      stableId: "home.workflow.eyebrow",
      fieldId: "value",
      english: "Office Workflow",
      spanish: "Proceso de la oficina",
      source: "checked_in_stable_catalog",
    }];

    expect(filterStaleStableCandidates(checkedIn, observed)).toEqual([]);
  });
});
