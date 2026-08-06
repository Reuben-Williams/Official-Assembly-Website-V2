import type { Metadata } from "next";
import Link from "next/link";

import { privacyNotice } from "../data/privacy";
import { siteConfig } from "../data/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: `Website and District Newsletter privacy notice for ${siteConfig.officeName}.`
};

export default function PrivacyPage() {
  return (
    <article className="privacy-page">
      <header className="privacy-hero">
        <div className="container privacy-container">
          <p className="eyebrow">Website and District Newsletter</p>
          <h1>{privacyNotice.title}</h1>
          <p className="lead">{privacyNotice.introduction}</p>
          <p className="privacy-updated">Last updated {privacyNotice.updated}</p>
        </div>
      </header>
      <div className="container privacy-container privacy-sections">
        {privacyNotice.sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
        <aside className="privacy-contact" aria-label="Privacy contact options">
          <h2>Contact the district office</h2>
          <p>Questions and requests can be submitted through the public contact page or by phone.</p>
          <div>
            <Link className="cta-link" href="/contact">Open contact page</Link>
            <a className="secondary-link" href={`tel:${siteConfig.phoneE164}`}>Call {siteConfig.phoneDisplay}</a>
          </div>
        </aside>
      </div>
    </article>
  );
}
