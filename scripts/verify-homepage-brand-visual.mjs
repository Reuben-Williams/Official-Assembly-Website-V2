import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.argv[2] || "http://127.0.0.1:3110";
const evidenceDir = resolve(process.cwd(), "artifacts/brand-banner-verification");
await mkdir(evidenceDir, { recursive: true });
const requiredImagePaths = [
  "/brand/morales-ld34-banner-desktop.avif",
  "/brand/morales-ld34-banner-desktop.webp",
  "/brand/morales-ld34-banner-mobile.avif",
  "/brand/morales-ld34-banner-mobile.webp",
  "/images/professional/home-official-portrait-desktop.webp",
  "/images/professional/home-official-portrait-mobile.webp",
];
const assetChecks = await Promise.all(requiredImagePaths.map(async (path) => {
  const response = await fetch(new URL(path, baseUrl));
  await response.body?.cancel();
  return {
    path,
    status: response.status,
    contentType: response.headers.get("content-type"),
    ok: response.ok && response.headers.get("content-type")?.startsWith("image/") === true,
  };
}));

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
    const ignoredTurnstileMessages = [];
    const failedFirstPartyRequests = [];
    const ignoredRoutePrefetchAborts = [];
    const ignoredResponsiveImageAborts = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        const entry = {
          text: message.text(),
          location: message.location(),
        };
        if (
          entry.text === "%c%d font-size:0;color:transparent NaN"
          && entry.location.url.startsWith("https://challenges.cloudflare.com/")
        ) {
          ignoredTurnstileMessages.push(entry);
        } else {
          consoleErrors.push(entry);
        }
      }
    });
    page.on("requestfailed", (request) => {
      if (request.url().startsWith(baseUrl)) {
        const entry = {
          url: request.url(),
          error: request.failure()?.errorText,
          resourceType: request.resourceType(),
        };
        const requestUrl = new URL(entry.url);
        if (
          entry.error === "net::ERR_ABORTED"
          && entry.resourceType === "fetch"
          && requestUrl.searchParams.has("_rsc")
        ) {
          ignoredRoutePrefetchAborts.push(entry);
        } else if (
          entry.error === "net::ERR_ABORTED"
          && entry.resourceType === "image"
          && requestUrl.pathname.startsWith("/brand/morales-ld34-banner-")
        ) {
          ignoredResponsiveImageAborts.push(entry);
        } else {
          failedFirstPartyRequests.push(entry);
        }
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
      const actionRect = actions?.getBoundingClientRect();
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
        actionDockFullyVisible: Boolean(
          heroRect
            && actionRect
            && actionRect.top >= heroRect.top
            && actionRect.bottom <= heroRect.bottom + 0.5,
        ),
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
        portraitSource: portrait instanceof HTMLImageElement ? portrait.currentSrc : undefined,
        portraitAlt: portrait?.getAttribute("alt"),
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
      ignoredTurnstileMessages,
      failedFirstPartyRequests,
      ignoredRoutePrefetchAborts,
      ignoredResponsiveImageAborts,
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
  const decodedPortraitSource = decodeURIComponent(result.portraitSource ?? "");
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
    || !result.actionDockFullyVisible
    || !result.heroBeforeOfficial
    || !result.officialBeforeStats
    || !result.heroHasReadableBackground
    || result.actionCount !== 4
    || !result.volunteerDestination?.startsWith("https://docs.google.com/forms/")
    || !result.imageLoaded
    || result.imageNaturalWidth < (result.viewport.width <= 620 ? 1920 : 2580)
    || !result.imageSource?.includes("?v=")
    || !result.portraitLoaded
    || !decodedPortraitSource.includes("/images/professional/home-official-portrait-")
    || result.portraitAlt !== "Official portrait of Assemblywoman Carmen Theresa Morales"
    || result.horizontalOverflow
    || result.consoleErrors.length > 0
    || result.failedFirstPartyRequests.length > 0
    || !result.ogImage?.endsWith("/brand/morales-ld34-social-1200x630.png")
    || result.twitterCard !== "summary_large_image"
  ) {
    throw new TypeError(`Homepage brand verification failed: ${JSON.stringify(result)}`);
  }
}

if (assetChecks.some((asset) => !asset.ok)) {
  throw new TypeError(`Homepage asset verification failed: ${JSON.stringify(assetChecks)}`);
}

process.stdout.write(`${JSON.stringify({ assets: assetChecks, verified: results }, null, 2)}\n`);
