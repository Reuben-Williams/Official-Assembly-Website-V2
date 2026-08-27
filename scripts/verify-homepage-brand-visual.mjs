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
    { name: "mobile", viewport: { width: 390, height: 844 } },
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

    const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
    const state = await page.evaluate(() => {
      const banner = document.querySelector('[data-home-brand-banner="true"]');
      const hero = document.querySelector('[data-home-section="hero"]');
      const image = banner?.querySelector("img");
      const bannerRect = banner?.getBoundingClientRect();
      const heroRect = hero?.getBoundingClientRect();
      return {
        hasContent: document.body.innerText.trim().length > 0,
        hasErrorOverlay: Boolean(
          document.querySelector(
            "[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay",
          ),
        ),
        bannerExists: Boolean(banner),
        bannerBeforeHero: Boolean(
          banner &&
            hero &&
            banner.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        bannerWidth: bannerRect?.width,
        heroTop: heroRect?.top,
        bannerBottom: bannerRect?.bottom,
        imageLoaded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        imageSource: image instanceof HTMLImageElement ? image.currentSrc : undefined,
        imageAlt: image?.getAttribute("alt"),
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
    result.status !== 200 ||
    !result.hasContent ||
    result.hasErrorOverlay ||
    !result.bannerExists ||
    !result.bannerBeforeHero ||
    result.bannerBottom !== result.heroTop ||
    !result.imageLoaded ||
    result.horizontalOverflow ||
    result.consoleErrors.length > 0 ||
    result.failedFirstPartyRequests.length > 0 ||
    !result.ogImage?.endsWith("/brand/morales-ld34-social-1200x630.png") ||
    result.twitterCard !== "summary_large_image"
  ) {
    throw new TypeError(`Homepage brand verification failed: ${JSON.stringify(result)}`);
  }
}

process.stdout.write(`${JSON.stringify({ verified: results }, null, 2)}\n`);
