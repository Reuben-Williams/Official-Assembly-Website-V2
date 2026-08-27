import type { Metadata } from "next";

import { NewsletterConfirmationClient } from "./confirmation-client";
import { readPublicLocale } from "../../i18n/server";
import { approvedBrandAssets } from "../../../lib/brand/approved-assets";
import { withBrandSocialMetadata } from "../../../lib/brand/metadata";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await readPublicLocale();
  const title = locale === "es" ? "Confirmar el Boletín del distrito" : "Confirm District Newsletter";
  const description = locale === "es"
    ? "Complete el paso de confirmación seguro para el Boletín del distrito."
    : "Complete the secure confirmation step for the District Newsletter.";
  return withBrandSocialMetadata({
    title,
    description,
    referrer: "no-referrer",
    robots: { index: false, follow: false }
  }, { title, description, locale }, approvedBrandAssets);
}

export default async function NewsletterConfirmationPage() {
  const locale = await readPublicLocale();
  return (
    <section className="page-shell section-block" aria-labelledby="newsletter-confirmation-title">
      <div className="content-card">
        <p className="eyebrow">{locale === "es" ? "Bolet\u00edn del distrito" : "District Newsletter"}</p>
        <h1 id="newsletter-confirmation-title">{locale === "es" ? "Confirme su suscripci\u00f3n" : "Confirm your subscription"}</h1>
        <NewsletterConfirmationClient locale={locale} />
      </div>
    </section>
  );
}
