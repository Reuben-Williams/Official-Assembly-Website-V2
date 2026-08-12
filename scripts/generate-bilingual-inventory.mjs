import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";

const DOMAINS = new Set(["site", "post", "alerts", "form", "media", "email"]);

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  throw new TypeError("Inventory digest input is not canonical JSON.");
}

function sourceDigest(fieldId, english) {
  return createHash("sha256").update(canonical({
    schemaVersion: 1,
    fieldId,
    en: english.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
  })).digest("hex");
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function routeKey(route) {
  if (route === "/") return "home";
  return route.replace(/^\/+|\/+$/g, "").replaceAll("/", ".") || "home";
}

function normalizePublishedStableId(route, stableId) {
  const legacyFormField = {
    "global.template.form-eyebrow": "eyebrow",
    "global.template.form-title": "title",
    "global.template.form-body": "body",
  }[stableId];
  const owner = routeKey(route);
  if (legacyFormField && ["contact", "newsletter", "survey"].includes(owner)) {
    return `${owner}.form.${legacyFormField}`;
  }
  return stableId;
}

export function buildClientBilingualInventory(candidates) {
  const seen = new Set();
  const items = candidates.map((candidate) => {
    if (!DOMAINS.has(candidate.domain)) throw new TypeError("Inventory domain is invalid.");
    const english = text(candidate.english);
    const spanish = candidate.spanish === null ? null : text(candidate.spanish);
    if (!candidate.stableId || !candidate.fieldId || !english) {
      throw new TypeError("Inventory item identity and English source are required.");
    }
    const identity = `${candidate.domain}:${candidate.stableId}:${candidate.fieldId}`;
    if (seen.has(identity)) throw new TypeError(`Duplicate inventory field: ${identity}.`);
    seen.add(identity);
    return Object.freeze({
      domain: candidate.domain,
      stableId: candidate.stableId,
      fieldId: candidate.fieldId,
      english,
      spanish,
      status: spanish ? "needs_review" : "missing",
      sourceDigest: sourceDigest(candidate.fieldId, english),
      exemptionEligible: candidate.exemptionEligible === true,
      source: candidate.source,
    });
  }).sort((left, right) =>
    left.domain.localeCompare(right.domain) ||
    left.stableId.localeCompare(right.stableId) ||
    left.fieldId.localeCompare(right.fieldId));
  const inventoryDigest = createHash("sha256").update(canonical(items.map((item) => ({
    domain: item.domain,
    stableId: item.stableId,
    fieldId: item.fieldId,
    english: item.english,
    spanish: item.spanish,
    status: item.status,
    sourceDigest: item.sourceDigest,
    exemptionEligible: item.exemptionEligible,
  })))).digest("hex");
  return Object.freeze({
    schemaVersion: 1,
    readOnly: true,
    itemCount: items.length,
    blockerCount: items.length,
    inventoryDigest,
    items: Object.freeze(items),
  });
}

export function mergeBilingualInventoryCandidates(candidates) {
  const merged = new Map();
  for (const candidate of candidates) {
    const identity = `${candidate.domain}:${candidate.stableId}:${candidate.fieldId}`;
    const current = merged.get(identity);
    if (!current) {
      merged.set(identity, { ...candidate });
      continue;
    }
    if (text(current.english) !== text(candidate.english) ||
        text(current.spanish) !== text(candidate.spanish)) {
      throw new TypeError(`Inventory field conflict: ${identity}.`);
    }
    current.source = [...new Set(`${current.source},${candidate.source}`.split(","))]
      .sort()
      .join(",");
  }
  return [...merged.values()].sort((left, right) =>
    left.domain.localeCompare(right.domain) ||
    left.stableId.localeCompare(right.stableId) ||
    left.fieldId.localeCompare(right.fieldId));
}

function labelText(element) {
  if (!element) return "";
  const clone = element.cloneNode(true);
  clone.querySelectorAll("input,select,textarea,button,script,style").forEach((node) => node.remove());
  return text(clone.textContent);
}

export function extractPublicHtmlInventoryItems({ route, html }) {
  const document = new JSDOM(html).window.document;
  const items = [];
  const push = (candidate) => {
    if (candidate.english) items.push({
      domain: "site",
      spanish: null,
      source: `public_html:${route}`,
      ...candidate,
    });
  };
  for (const element of document.querySelectorAll("[data-builder-region][data-builder-kind='text']")) {
    push({
      stableId: normalizePublishedStableId(route, element.getAttribute("data-builder-region")),
      fieldId: "value",
      english: text(element.textContent),
    });
  }
  for (const element of document.querySelectorAll("[data-builder-region][data-builder-kind='link']")) {
    const stableId = element.getAttribute("data-builder-region");
    const label = element.querySelector("[data-builder-link-label]");
    push({ stableId, fieldId: "label", english: text(label?.textContent ?? element.textContent) });
  }
  for (const element of document.querySelectorAll("[data-builder-region][data-builder-kind='image']")) {
    const stableId = element.getAttribute("data-builder-region");
    const instance = element.getAttribute("data-builder-instance") || routeKey(route);
    const image = element.matches("img") ? element : element.querySelector("img");
    const caption = element.querySelector(".image-caption");
    push({ domain: "media", stableId, fieldId: "alt", english: text(image?.getAttribute("alt")) });
    push({ domain: "site", stableId: `${stableId}.${instance}`, fieldId: "caption", english: text(caption?.textContent) });
  }
  push({ stableId: `route.${routeKey(route)}.metadata`, fieldId: "title", english: text(document.title) });
  push({
    stableId: `route.${routeKey(route)}.metadata`,
    fieldId: "description",
    english: text(document.querySelector("meta[name='description']")?.getAttribute("content")),
  });
  for (const form of document.querySelectorAll("[data-public-form-type]")) {
    const formType = form.getAttribute("data-public-form-type");
    for (const control of form.querySelectorAll("input[name],select[name],textarea[name]")) {
      const name = control.getAttribute("name");
      const label = control.closest("label") ?? form.querySelector(`label[for='${control.id}']`);
      push({
        domain: "form",
        stableId: `form.${formType}.${name}`,
        fieldId: "label",
        english: labelText(label),
      });
    }
  }
  for (const post of document.querySelectorAll(".news-card")) {
    const link = post.querySelector("a[href^='/news/']");
    const slug = link?.getAttribute("href")?.replace(/^\/news\//, "");
    if (!slug) continue;
    push({ domain: "post", stableId: `post.${slug}`, fieldId: "title", english: text(post.querySelector("h2")?.textContent) });
    push({ domain: "post", stableId: `post.${slug}`, fieldId: "excerpt", english: text(post.querySelector("h2 + p")?.textContent) });
  }
  return items;
}

export function pairCatalogCandidates(values, sourceName, domain = "site") {
  return Object.entries(values).map(([stableId, value]) => ({
    domain,
    stableId,
    fieldId: value.en.includes("{") ? "template" : "value",
    english: value.en,
    spanish: value.es,
    exemptionEligible: value.en === value.es,
    source: sourceName,
  }));
}

export function filterStaleStableCandidates(candidates, observed) {
  const currentEnglish = new Map(observed.map((item) => [
    `${item.domain}:${item.stableId}:${item.fieldId}`,
    text(item.english),
  ]));
  return candidates.filter((candidate) => {
    const identity = `${candidate.domain}:${candidate.stableId}:${candidate.fieldId}`;
    return !currentEnglish.has(identity) || currentEnglish.get(identity) === text(candidate.english);
  });
}

export function applyCandidateSpanish(items, input) {
  return items.map((item) => {
    const stable = input.stable[item.stableId];
    const exact = stable?.en === item.english ? stable.es : input.byEnglish[item.english];
    return {
      ...item,
      spanish: exact && exact !== item.english ? exact : exact ?? null,
      exemptionEligible: Boolean(exact && exact === item.english),
    };
  });
}

function csvCell(value) {
  const textValue = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue;
}

export function inventoryReviewCsv(inventory) {
  const headings = [
    "domain", "stableId", "fieldId", "english", "candidateSpanish", "status",
    "sourceDigest", "exemptionEligible", "source", "reviewDecision", "reviewNotes",
  ];
  return `${[
    headings.join(","),
    ...inventory.items.map((item) => [
      item.domain, item.stableId, item.fieldId, item.english, item.spanish, item.status,
      item.sourceDigest, item.exemptionEligible, item.source, "", "",
    ].map(csvCell).join(",")),
  ].join("\n")}\n`;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  const inputPath = argument("--input");
  const outputPath = argument("--output");
  const siteUrl = argument("--site-url");
  const reviewPath = argument("--review");
  const exemptionsPath = argument("--exemptions");
  if (!outputPath || (!inputPath && !siteUrl)) {
    throw new TypeError("Usage: generate-bilingual-inventory (--input <candidates.json> | --site-url <url>) --output <inventory.json> [--review <review.csv>] [--exemptions <exemptions.json>]");
  }
  let candidates;
  if (inputPath) {
    candidates = JSON.parse(await readFile(inputPath, "utf8"));
  } else {
    const [{ pages }, catalog, translations, privacy, newsletter, email] = await Promise.all([
      import("../app/data/site.ts"),
      import("../app/i18n/catalog.public.ts"),
      import("../app/i18n/translations.ts"),
      import("../app/data/privacy.ts"),
      import("../lib/newsletter/managed-form-revision.ts"),
      import("../lib/newsletter/email/render-confirmation.ts"),
    ]);
    const stable = {
      ...Object.fromEntries(Object.entries(translations.spanishTranslationsByKey).map(([key, value]) => [key, value])),
      ...catalog.publicCatalogValues,
    };
    const byEnglish = translations.spanishTranslations;
    const routes = [...new Set([
      ...pages.map((page) => page.href),
      "/privacy",
      "/newsletter/confirm",
      "/__bilingual-inventory-404__",
    ])].sort();
    const observed = [];
    for (const route of routes) {
      const response = await fetch(new URL(route, siteUrl), { headers: { accept: "text/html" } });
      if (!response.ok && response.status !== 404) throw new Error(`Public inventory route unavailable: ${route}.`);
      observed.push(...extractPublicHtmlInventoryItems({ route, html: await response.text() }));
    }
    const alertResponse = await fetch(new URL("/api/public/alerts", siteUrl), { headers: { accept: "application/json" } });
    if (!alertResponse.ok) throw new Error("Public alert inventory is unavailable.");
    const alertProjection = await alertResponse.json();
    for (const alert of alertProjection.activeAlerts ?? []) {
      observed.push({
        domain: "alerts",
        stableId: String(alert.id),
        fieldId: "message",
        english: text(alert.message),
        spanish: null,
        exemptionEligible: false,
        source: "live_alert",
      });
    }
    const englishPrivacy = privacy.privacyNoticeFor("en");
    const spanishPrivacy = privacy.privacyNoticeFor("es");
    const privacyPairs = [
      ["privacy.title", englishPrivacy.title, spanishPrivacy.title],
      ["privacy.introduction", englishPrivacy.introduction, spanishPrivacy.introduction],
      ...englishPrivacy.sections.flatMap((section, index) => [
        [`privacy.sections.${index}.title`, section.title, spanishPrivacy.sections[index].title],
        ...section.paragraphs.map((paragraph, paragraphIndex) => [
          `privacy.sections.${index}.paragraphs.${paragraphIndex}`,
          paragraph,
          spanishPrivacy.sections[index].paragraphs[paragraphIndex],
        ]),
      ]),
    ].map(([stableId, en, es]) => ({ stableId, en, es }));
    const explicitPairs = [
      ...privacyPairs,
      { stableId: "form.newsletter.consent", en: newsletter.APPROVED_NEWSLETTER_CONSENT_LABEL, es: newsletter.APPROVED_NEWSLETTER_CONSENT_LABEL_ES },
      { stableId: "form.newsletter.success", en: newsletter.APPROVED_NEWSLETTER_SUCCESS_COPY, es: newsletter.APPROVED_NEWSLETTER_SUCCESS_COPY_ES },
      { stableId: "email.newsletter-confirmation.subject", en: email.NEWSLETTER_CONFIRMATION_SUBJECT, es: email.NEWSLETTER_CONFIRMATION_SUBJECT_ES },
      { stableId: "email.newsletter-confirmation.heading", en: "Confirm your subscription", es: "Confirme su suscripci\u00f3n" },
      { stableId: "email.newsletter-confirmation.action", en: "Confirm subscription", es: "Confirmar suscripci\u00f3n" },
      { stableId: "email.newsletter-confirmation.expiry", en: "This confirmation link expires in 48 hours.", es: "Este enlace de confirmaci\u00f3n vence en 48 horas." },
      { stableId: "email.newsletter-confirmation.no-action", en: "If you did not request this subscription, no action is required.", es: "Si no solicit\u00f3 esta suscripci\u00f3n, no se requiere ninguna acci\u00f3n." },
    ];
    const legacyCatalog = Object.fromEntries(Object.entries(byEnglish).map(([en, es]) => [
      `catalog.legacy.${createHash("sha256").update(en).digest("hex").slice(0, 16)}`,
      { en, es },
    ]));
    candidates = mergeBilingualInventoryCandidates([
      ...applyCandidateSpanish(observed, { stable, byEnglish }),
      ...pairCatalogCandidates(catalog.publicCatalogValues, "checked_in_public_catalog"),
      ...filterStaleStableCandidates(
        pairCatalogCandidates(translations.spanishTranslationsByKey, "checked_in_stable_catalog"),
        observed,
      ),
      ...pairCatalogCandidates(legacyCatalog, "checked_in_legacy_catalog"),
      ...explicitPairs.map((value) => ({
        domain: value.stableId.startsWith("email.") ? "email" : value.stableId.startsWith("form.") ? "form" : "site",
        stableId: value.stableId,
        fieldId: "value",
        english: value.en,
        spanish: value.es,
        exemptionEligible: value.en === value.es,
        source: "checked_in_explicit_content",
      })),
    ]);
  }
  const inventory = buildClientBilingualInventory(candidates);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  if (reviewPath) {
    await mkdir(path.dirname(reviewPath), { recursive: true });
    await writeFile(reviewPath, inventoryReviewCsv(inventory), "utf8");
  }
  if (exemptionsPath) {
    await mkdir(path.dirname(exemptionsPath), { recursive: true });
    await writeFile(exemptionsPath, `${JSON.stringify({ schemaVersion: 1, exemptions: [] }, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`Wrote read-only inventory with ${inventory.itemCount} items and ${inventory.blockerCount} blockers.\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Inventory generation failed."}\n`);
    process.exitCode = 1;
  });
}
