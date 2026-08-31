import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { basename, extname, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
register(new URL("./layout-review-css-loader.mjs", import.meta.url), import.meta.url);

const [
  { approvedBrandAssets },
  { AppFooter },
  { AppHeader },
  { HomePageView },
  { NewsletterPageView },
  { pages },
] = await Promise.all([
  import("../lib/brand/approved-assets.ts"),
  import("../app/ui/AppFooter.tsx"),
  import("../app/ui/AppHeader.tsx"),
  import("../app/ui/HomePageView.tsx"),
  import("../app/ui/NewsletterPageView.tsx"),
  import("../app/data/site.ts"),
]);

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUBLIC_ROOT = resolve(ROOT, "public");
const OUTPUT_ROOT = resolve(
  process.argv[2] || resolve(tmpdir(), `morales-layout-review-${Date.now()}`),
);
const EMPTY_CONTENT = { regions: {} };
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function shell(title, content) {
  function renderPart(label, node) {
    try {
      return renderToStaticMarkup(node);
    } catch (error) {
      throw new Error(`Unable to render ${label}.`, { cause: error });
    }
  }

  const header = renderPart(
    "the site header",
    React.createElement(AppHeader, { content: EMPTY_CONTENT, locale: "en" }),
  );
  const main = renderPart("the page content", React.createElement("main", null, content));
  const footer = renderPart(
    "the site footer",
    React.createElement(AppFooter, { content: EMPTY_CONTENT, locale: "en" }),
  );

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link href="/globals.css" rel="stylesheet"><style>html,body{margin:0}body{font-family:Arial,Helvetica,sans-serif}</style></head><body>${header}${main}${footer}</body></html>`;
}

async function renderPages() {
  const newsletter = pages.find((page) => page.href === "/newsletter");
  if (!newsletter) throw new Error("The newsletter page fixture is unavailable.");

  return new Map([
    [
      "/",
      shell(
        "Homepage layout review",
        await HomePageView({
          assets: approvedBrandAssets,
          content: EMPTY_CONTENT,
          posts: [],
          locale: "en",
        }),
      ),
    ],
    [
      "/newsletter",
      shell(
        "Newsletter layout review",
        await NewsletterPageView({
          page: newsletter,
          content: EMPTY_CONTENT,
          locale: "en",
        }),
      ),
    ],
  ]);
}

function publicFile(publicPath) {
  if (!publicPath?.startsWith("/") || publicPath.includes("\0")) return null;
  const candidate = resolve(PUBLIC_ROOT, `.${publicPath}`);
  const prefix = `${PUBLIC_ROOT}${sep}`;
  return candidate.startsWith(prefix) ? candidate : null;
}

async function sendFile(response, filePath) {
  const body = await readFile(filePath);
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": MIME_TYPES.get(extname(filePath).toLowerCase()) || "application/octet-stream",
  });
  response.end(body);
}

async function startServer(renderedPages) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname === "/globals.css") {
        await sendFile(response, resolve(ROOT, "app", "globals.css"));
        return;
      }

      const requestedAsset = url.pathname === "/_next/image"
        ? url.searchParams.get("url")
        : url.pathname;
      const asset = publicFile(requestedAsset);
      if (asset && !renderedPages.has(url.pathname)) {
        await sendFile(response, asset);
        return;
      }

      const html = renderedPages.get(url.pathname);
      if (html) {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        });
        response.end(html);
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Visual-review server did not bind.");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function assertLayout(route, viewport, state) {
  if (state.horizontalOverflow > 1) {
    throw new Error(`${route} ${viewport.name} has ${state.horizontalOverflow}px horizontal overflow.`);
  }
  if (!state.headingVisible) {
    throw new Error(`${route} ${viewport.name} does not show its primary heading.`);
  }

  if (route === "/") {
    if (!state.bannerInsideHero || !state.bannerFillsHero || !state.bannerImageLoaded) {
      throw new Error(`${route} ${viewport.name} failed the banner/hero relationship check.`);
    }
    return;
  }

  if (
    state.newsletterFirstItem !== "form"
    || state.newsletterHeadingCount !== 1
    || state.newsletterImageCount !== 0
    || !state.newsletterFormAreaVisible
  ) {
    throw new Error(`${route} ${viewport.name} failed the form-first newsletter contract.`);
  }
}

const renderedPages = await renderPages();
const { server, origin } = await startServer(renderedPages);
await mkdir(OUTPUT_ROOT, { recursive: true });
const results = [];
let browser;

try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) => failedRequests.push(request.url()));

    for (const route of ["/", "/newsletter"]) {
      await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
      const state = await page.evaluate(() => {
        const hero = document.querySelector('[data-home-section="hero"]');
        const banner = document.querySelector('[data-home-brand-banner="true"]');
        const bannerImage = banner?.querySelector("img");
        const heroRect = hero?.getBoundingClientRect();
        const bannerRect = banner?.getBoundingClientRect();
        const newsletter = document.querySelector('[data-newsletter-page-view="true"]');
        const firstNewsletterItem = newsletter?.querySelector(":scope > [data-builder-item-id]");
        const newsletterFormArea = newsletter?.querySelector('[data-builder-region="newsletter.form"]');
        const heading = document.querySelector("main h1");
        const headingRect = heading?.getBoundingClientRect();

        return {
          horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          headingVisible: Boolean(headingRect && headingRect.width > 0 && headingRect.height > 0),
          bannerInsideHero: Boolean(hero && banner && banner.parentElement === hero),
          bannerFillsHero: Boolean(
            heroRect
            && bannerRect
            && Math.abs(heroRect.left - bannerRect.left) <= 2
            && Math.abs(heroRect.right - bannerRect.right) <= 2
            && Math.abs(heroRect.top - bannerRect.top) <= 2
            && Math.abs(heroRect.bottom - bannerRect.bottom) <= 2
          ),
          bannerImageLoaded: Boolean(bannerImage && bannerImage.complete && bannerImage.naturalWidth > 0),
          newsletterFirstItem: firstNewsletterItem?.getAttribute("data-builder-item-id") || null,
          newsletterHeadingCount: newsletter?.querySelectorAll("h1").length || 0,
          newsletterImageCount: newsletter?.querySelectorAll("img").length || 0,
          newsletterFormAreaVisible: Boolean(
            newsletterFormArea
            && newsletterFormArea.getBoundingClientRect().height > 0
          ),
        };
      });

      assertLayout(route, viewport, state);
      const routeName = route === "/" ? "home" : basename(route);
      const screenshot = resolve(OUTPUT_ROOT, `${routeName}-${viewport.name}.png`);
      const detailScreenshot = resolve(OUTPUT_ROOT, `${routeName}-${viewport.name}-detail.png`);
      const reviewSelector = route === "/"
        ? '[data-home-section="hero"]'
        : '[data-newsletter-page-view="true"] > [data-builder-item-id="form"]';
      await page.screenshot({ path: screenshot, fullPage: true });
      await page.locator(reviewSelector).screenshot({ path: detailScreenshot });
      results.push({ route, viewport: viewport.name, screenshot, detailScreenshot, state });
    }

    if (consoleErrors.length || failedRequests.length) {
      throw new Error(JSON.stringify({ viewport: viewport.name, consoleErrors, failedRequests }, null, 2));
    }
    await context.close();
  }

  await writeFile(
    resolve(OUTPUT_ROOT, "layout-review.json"),
    `${JSON.stringify({ origin, results }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify({ outputDirectory: OUTPUT_ROOT, results }, null, 2)}\n`);
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
