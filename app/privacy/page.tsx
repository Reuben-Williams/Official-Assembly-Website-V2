import type { Metadata } from "next";
import { siteConfig } from "../data/site";
import { readPublicLocale } from "../i18n/server";
import { PrivacyPageContent } from "./PrivacyPageContent";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await readPublicLocale();
  return locale === "es"
    ? {
      title: "Privacidad",
      description: `Aviso de privacidad del sitio web y del Boletín del distrito de ${siteConfig.officeName}.`,
    }
    : {
      title: "Privacy",
      description: `Website and District Newsletter privacy notice for ${siteConfig.officeName}.`,
    };
}

export default async function PrivacyPage() {
  return <PrivacyPageContent locale={await readPublicLocale()} />;
}
