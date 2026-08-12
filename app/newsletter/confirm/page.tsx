import type { Metadata } from "next";

import { NewsletterConfirmationClient } from "./confirmation-client";
import { readPublicLocale } from "../../i18n/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Confirm District Newsletter",
  referrer: "no-referrer",
  robots: { index: false, follow: false }
};

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
