import type { Metadata } from "next";
import { siteConfig } from "../data/site";
import { readPublicLocale } from "../i18n/server";
import { PrivacyPageContent } from "./PrivacyPageContent";
import { approvedBrandAssets } from "../../lib/brand/approved-assets";
import { withBrandSocialMetadata } from "../../lib/brand/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await readPublicLocale();
  const title = locale === "es" ? "Privacidad" : "Privacy";
  const description = locale === "es"
    ? `Aviso de privacidad del sitio web y del Boletín del distrito de ${siteConfig.officeName}.`
    : `Website and District Newsletter privacy notice for ${siteConfig.officeName}.`;
  return withBrandSocialMetadata({ title, description }, {
    title,
    description,
    locale,
    canonicalUrl: new URL("/privacy", process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").toString(),
  }, approvedBrandAssets);
}

export default async function PrivacyPage() {
  return <PrivacyPageContent locale={await readPublicLocale()} />;
}
