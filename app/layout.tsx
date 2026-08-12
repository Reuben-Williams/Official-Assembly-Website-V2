import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import { headers } from "next/headers";
import { Suspense } from "react";

import "./globals.css";
import { AppFooter } from "./ui/AppFooter";
import { AppHeader } from "./ui/AppHeader";
import { PublicAlertController } from "./ui/PublicAlertController";
import { siteConfig } from "./data/site";
import { BuilderContentBridge } from "./builder-content-bridge";
import { builderText, loadBuilderGlobalContent } from "../lib/builder/server-content";
import {
  loadOfficialAssemblyPublicAlerts,
  resolveLayoutAlertBoundary,
} from "../lib/builder/alerts";
import { INTERNAL_PATHNAME_HEADER } from "../lib/public-route";
import { publicCopy } from "./i18n/catalog.public";
import { readPublicLocale } from "./i18n/server";

const publicSans = Public_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-public-sans"
});

export async function generateMetadata(): Promise<Metadata> {
  const [content, locale] = await Promise.all([loadBuilderGlobalContent(), readPublicLocale()]);
  const officeName = builderText(content, "global.office.name", siteConfig.officeName);
  return {
    title: {
      default: builderText(content, "metadata.home.title", officeName),
      template: `%s | ${officeName}`,
    },
    description: publicCopy(
      locale,
      "metadata.home.description",
      builderText(content, "metadata.home.description", siteConfig.tagline),
    ),
    metadataBase: new URL(
      process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    ),
  };
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const incoming = await headers();
  const [content, alerts, locale] = await Promise.all([
    loadBuilderGlobalContent(),
    resolveLayoutAlertBoundary({
      pathnameHeader: incoming.get(INTERNAL_PATHNAME_HEADER),
      load: () => loadOfficialAssemblyPublicAlerts(),
    }),
    readPublicLocale(),
  ]);
  return (
    <html lang={locale}>
      <body className={publicSans.className}>
        <a
          className="skip-link"
          data-builder-region="global.accessibility.skip"
          data-builder-kind="text"
          data-i18n-key="global.skip"
          href="#main"
        >
          {publicCopy(
            locale,
            "global.skip",
            builderText(content, "global.accessibility.skip", "Skip to content"),
          )}
        </a>
        <AppHeader content={content} locale={locale} />
        {alerts.eligible ? <PublicAlertController initialProjection={alerts.projection} /> : null}
        <main id="main">{children}</main>
        <AppFooter content={content} locale={locale} />
        <Suspense fallback={null}>
          <BuilderContentBridge />
        </Suspense>
      </body>
    </html>
  );
}
