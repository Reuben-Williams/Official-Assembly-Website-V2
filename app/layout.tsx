import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import { headers } from "next/headers";
import { Suspense } from "react";

import "./globals.css";
import { AppFooter } from "./ui/AppFooter";
import { AppHeader } from "./ui/AppHeader";
import { siteConfig } from "./data/site";
import { BuilderContentBridge } from "./builder-content-bridge";

const publicSans = Public_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-public-sans"
});

export const metadata: Metadata = {
  title: {
    default: siteConfig.officeName,
    template: `%s | ${siteConfig.officeName}`
  },
  description: siteConfig.tagline,
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  )
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  await headers();
  return (
    <html lang="en">
      <body className={publicSans.className}>
        <a
          className="skip-link"
          data-builder-region="global.accessibility.skip"
          data-builder-kind="text"
          data-i18n-key="global.skip"
          href="#main"
        >
          Skip to content
        </a>
        <AppHeader />
        <main id="main">{children}</main>
        <AppFooter />
        <Suspense fallback={null}>
          <BuilderContentBridge />
        </Suspense>
      </body>
    </html>
  );
}
