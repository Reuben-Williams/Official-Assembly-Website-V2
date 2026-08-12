import { ArrowUpRight, MessageSquareText, Phone, Users } from "lucide-react";

import { districtConnections } from "../data/district-connections";
import { officialLegislatureProfile } from "../data/official-legislature-profile";
import { builderText, type BuilderServerContent } from "../../lib/builder/server-content";
import { NewsletterSignupSection } from "./NewsletterSignupSection";
import styles from "./district-connections-section.module.css";
import { localizedBuilderText } from "../i18n/catalog.server";
import type { PublicLocale } from "../i18n/locale";

function NewTabLabel({ locale }: { locale: PublicLocale }) {
  return <span className={styles.newTab}>
    {localizedBuilderText(locale, "global.external.new-tab", "opens in a new tab")}
  </span>;
}

export async function DistrictConnectionsSection({
  content,
  locale = "en",
}: {
  content: BuilderServerContent;
  locale?: PublicLocale;
}) {
  const newsletter = await NewsletterSignupSection({
    content,
    regions: {
      eyebrow: "home.connections.newsletter.eyebrow",
      title: "home.connections.newsletter.title",
      body: "home.connections.newsletter.body",
      form: "home.connections.newsletter.form",
    },
    fallback: {
      eyebrow: "Email updates",
      title: "Get the District Newsletter",
      body: "Request updates here, then confirm through the email sent to your inbox before the subscription becomes active.",
    },
    showDedicatedPageLink: true,
    embedded: true,
    locale,
  });

  return (
    <section className={styles.section} data-home-section="connections" data-builder-item-id="connections">
      <div className="container">
        <header className={styles.heading}>
          <div>
            <p className="eyebrow" data-builder-region="home.connections.eyebrow" data-builder-kind="text">
              {localizedBuilderText(locale, "home.connections.eyebrow", builderText(content, "home.connections.eyebrow", "Connect with District 34"))}
            </p>
            <h2 data-builder-region="home.connections.title" data-builder-kind="text">
              {localizedBuilderText(locale, "home.connections.title", builderText(content, "home.connections.title", "Choose the right way to take part"))}
            </h2>
          </div>
          <p data-builder-region="home.connections.body" data-builder-kind="text">
            {localizedBuilderText(locale, "home.connections.body", builderText(
              content,
              "home.connections.body",
              "Newsletter signup stays on this website. Volunteer responses and legislative messages open their official external forms.",
            ))}
          </p>
        </header>

        <div className={styles.grid}>
          <article className={styles.newsletterCard}>{newsletter}</article>
          <div className={styles.actionColumn}>
            <article className={styles.connectionCard}>
              <div className={styles.cardIcon}><Users aria-hidden="true" /></div>
              <p className={styles.kicker}>{locale === "es" ? "Español · English" : "English · Español"}</p>
              <h3>{localizedBuilderText(locale, "home.connections.volunteer.title", districtConnections.volunteer.title)}</h3>
              <p>{locale === "es" ? districtConnections.volunteer.spanish : districtConnections.volunteer.english}</p>
              <details className={styles.translation}>
                <summary>{locale === "es" ? "Read in English" : "Leer en español"}</summary>
                <p lang={locale === "es" ? "en" : "es"}>
                  {locale === "es" ? districtConnections.volunteer.english : districtConnections.volunteer.spanish}
                </p>
              </details>
              <a
                className={styles.primaryAction}
                href={districtConnections.volunteer.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{localizedBuilderText(locale, "home.connections.volunteer.open", "Open volunteer form")}</span>
                <ArrowUpRight aria-hidden="true" />
              </a>
              <NewTabLabel locale={locale} />
            </article>

            <article className={styles.connectionCard}>
              <div className={styles.cardIcon}><MessageSquareText aria-hidden="true" /></div>
              <p className={styles.kicker}>{localizedBuilderText(locale, "home.connections.legislature.kicker", "State Legislature")}</p>
              <h3>{localizedBuilderText(locale, "home.connections.legislature.title", "Contact your legislator")}</h3>
              <p>{localizedBuilderText(locale, "home.connections.legislature.body", "Send a legislative message through the contact form linked from the official New Jersey Legislature roster.")}</p>
              <a
                className={styles.primaryAction}
                href={officialLegislatureProfile.actions.legislativeContact}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{localizedBuilderText(locale, "home.connections.legislature.action", "Official Legislative Contact Form")}</span>
                <ArrowUpRight aria-hidden="true" />
              </a>
              <NewTabLabel locale={locale} />
              <a className={styles.phoneFallback} href={officialLegislatureProfile.office.phoneHref}>
                <Phone aria-hidden="true" />
                {localizedBuilderText(locale, "home.connections.legislature.call", `Call ${officialLegislatureProfile.office.phoneDisplay}`)}
              </a>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
