import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.argv[2] || "http://127.0.0.1:3110";
const evidenceDir = resolve(process.cwd(), "artifacts/brand-banner-verification");
await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const profile of [
    { name: "desktop", viewport: { width: 1280, height: 800 } },
    { name: "tablet", viewport: { width: 768, height: 1024 } },
    { name: "mobile", viewport: { width: 390, height: 844 } },
    { name: "constrained-mobile", viewport: { width: 320, height: 700 } },
  ]) {
    const context = await browser.newContext({ viewport: profile.viewport });
    const page = await context.newPage();
    const consoleErrors = [];
    const failedFirstPartyRequests = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      if (request.url().startsWith(baseUrl)) {
        failedFirstPartyRequests.push({
          url: request.url(),
          error: request.failure()?.errorText,
        });
      }
    });

    const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.locator('[data-home-brand-banner="true"] img').waitFor({ state: "visible" });
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => {
      const banner = document.querySelector('[data-home-brand-banner="true"]');
      const hero = document.querySelector('[data-home-section="hero"]');
      const copy = document.querySelector(".home-hero-copy");
      const actions = document.querySelector('[data-home-hero-actions="true"]');
      const official = document.querySelector('[data-home-section="official"]');
      const portrait = document.querySelector('[data-profile-portrait="true"] img');
      const stats = document.querySelector('[data-home-section="access"]');
      const image = banner?.querySelector("img");
      const bannerRect = banner?.getBoundingClientRect();
      const heroRect = hero?.getBoundingClientRect();
      const heroStyle = hero ? getComputedStyle(hero) : null;
      const bannerPosition = banner ? getComputedStyle(banner).position : null;
      const follows = (before, after) => Boolean(
        before
          && after
          && (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING),
      );

      return {
        hasContent: document.body.innerText.trim().length > 0,
        hasErrorOverlay: Boolean(
          document.querySelector(
            "[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay",
          ),
        ),
        bannerExists: Boolean(banner),
        bannerInsideHero: Boolean(banner && hero && hero.contains(banner)),
        bannerCenteredInHero: Boolean(
          bannerRect
            && heroRect
            && Math.abs(
              (bannerRect.left + bannerRect.width / 2) - (heroRect.left + heroRect.width / 2),
            ) <= 3
            && bannerRect.left >= heroRect.left
            && bannerRect.right <= heroRect.right
            && bannerRect.width < heroRect.width,
        ),
        bannerInDocumentFlow: bannerPosition !== "absolute" && bannerPosition !== "fixed",
        copyBeforeBanner: follows(copy, banner),
        bannerBeforeActions: follows(banner, actions),
        heroBeforeOfficial: follows(hero, official),
        officialBeforeStats: follows(official, stats),
        heroHasReadableBackground: Boolean(
          heroStyle?.backgroundImage && heroStyle.backgroundImage !== "none",
        ),
        actionCount: actions?.querySelectorAll("a").length || 0,
        volunteerDestination: actions
          ?.querySelector('[data-builder-region="home.hero.volunteer-cta"]')
          ?.getAttribute("href"),
        bannerWidth: bannerRect?.width,
        imageLoaded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        imageNaturalWidth: image instanceof HTMLImageElement ? image.naturalWidth : 0,
        imageSource: image instanceof HTMLImageElement ? image.currentSrc : undefined,
        imageAlt: image?.getAttribute("alt"),
        portraitLoaded: portrait instanceof HTMLImageElement && portrait.complete && portrait.naturalWidth > 0,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content"),
        twitterCard: document.querySelector('meta[name="twitter:card"]')?.getAttribute("content"),
        title: document.title,
      };
    });

    const result = {
      profile: profile.name,
      viewport: profile.viewport,
      status: response?.status(),
      consoleErrors,
      failedFirstPartyRequests,
      ...state,
    };
    results.push(result);
    await page.screenshot({
      path: resolve(evidenceDir, `${profile.name}.png`),
      fullPage: true,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

for (const result of results) {
  if (
    result.status !== 200
    || !result.hasContent
    || result.hasErrorOverlay
    || !result.bannerExists
    || !result.bannerInsideHero
    || !result.bannerCenteredInHero
    || !result.bannerInDocumentFlow
    || !result.copyBeforeBanner
    || !result.bannerBeforeActions
    || !result.heroBeforeOfficial
    || !result.officialBeforeStats
    || !result.heroHasReadableBackground
    || result.actionCount !== 4
    || !result.volunteerDestination?.startsWith("https://docs.google.com/forms/")
    || !result.imageLoaded
    || result.imageNaturalWidth < (result.viewport.width <= 620 ? 1920 : 2580)
    || !result.imageSource?.includes("?v=")
    || !result.portraitLoaded
    || result.horizontalOverflow
    || result.consoleErrors.length > 0
    || result.failedFirstPartyRequests.length > 0
    || !result.ogImage?.endsWith("/brand/morales-ld34-social-1200x630.png")
    || result.twitterCard !== "summary_large_image"
  ) {
    throw new TypeError(`Homepage brand verification failed: ${JSON.stringify(result)}`);
  }
}

process.stdout.write(`${JSON.stringify({ verified: results }, null, 2)}\n`);
