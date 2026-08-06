import type { Metadata } from "next";

import { NewsletterConfirmationClient } from "./confirmation-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Confirm District Newsletter",
  referrer: "no-referrer",
  robots: { index: false, follow: false }
};

export default function NewsletterConfirmationPage() {
  return (
    <section className="page-shell section-block" aria-labelledby="newsletter-confirmation-title">
      <div className="content-card">
        <p className="eyebrow">District Newsletter</p>
        <h1 id="newsletter-confirmation-title">Confirm your subscription</h1>
        <NewsletterConfirmationClient />
      </div>
    </section>
  );
}
