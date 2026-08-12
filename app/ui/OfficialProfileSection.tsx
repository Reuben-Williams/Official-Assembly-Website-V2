import {
  ArrowUpRight,
  BookOpenCheck,
  Building2,
  FileText,
  GraduationCap,
  Landmark,
  Phone,
  Scale,
} from "lucide-react";

import { officialLegislatureProfile as profile } from "../data/official-legislature-profile";
import { builderText, type BuilderServerContent } from "../../lib/builder/server-content";
import styles from "./official-profile-section.module.css";
import { localizedBuilderText } from "../i18n/catalog.server";
import type { PublicLocale } from "../i18n/locale";

function ExternalAction({ href, children, locale }: { href: string; children: React.ReactNode; locale: PublicLocale }) {
  return (
    <a className={styles.action} href={href} target="_blank" rel="noopener noreferrer">
      <span>{children}</span>
      <ArrowUpRight aria-hidden="true" />
      <span className={styles.srOnly}> ({localizedBuilderText(locale, "global.external.new-tab", "opens in a new tab")})</span>
    </a>
  );
}

export function OfficialProfileSection({ content, locale = "en" }: { content: BuilderServerContent; locale?: PublicLocale }) {
  const verified = new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${profile.provenance.checkedAt}T00:00:00.000Z`));

  return (
    <section className={styles.section} data-home-section="official" data-builder-item-id="official-profile">
      <div className={`container ${styles.shell}`}>
        <header className={styles.heading}>
          <div>
            <p className="eyebrow" data-builder-region="home.official.eyebrow" data-builder-kind="text">
              {localizedBuilderText(locale, "home.official.eyebrow", builderText(content, "home.official.eyebrow", "Official New Jersey Legislature record"))}
            </p>
            <h2 data-builder-region="home.official.title" data-builder-kind="text">
              {localizedBuilderText(locale, "home.official.title", builderText(content, "home.official.title", "Your District 34 representative"))}
            </h2>
          </div>
          <p data-builder-region="home.official.body" data-builder-kind="text">
            {localizedBuilderText(locale, "home.official.body", builderText(
              content,
              "home.official.body",
              "A concise snapshot of the current public roster, with direct links back to the official state record.",
            ))}
          </p>
        </header>

        <div className={styles.identityBand}>
          <div className={styles.seal}><Landmark aria-hidden="true" /></div>
          <div>
            <p>{profile.identity.title} · {profile.identity.party}</p>
            <h3>{profile.identity.name}</h3>
            <strong>{profile.identity.position} · District {profile.identity.district}</strong>
          </div>
          <a className={styles.phone} href={profile.office.phoneHref}>
            <Phone aria-hidden="true" />
            <span>{profile.office.phoneDisplay}</span>
          </a>
        </div>

        <div className={styles.factGrid}>
          <article className={styles.factCard}>
            <Building2 aria-hidden="true" />
            <div>
              <h3>{localizedBuilderText(locale, "home.official.office.title", "District office")}</h3>
              <p>{profile.office.address}</p>
              <p>{localizedBuilderText(locale, "home.official.phone", `Phone ${profile.office.phoneDisplay}`)}<br />{localizedBuilderText(locale, "home.official.fax", `Fax ${profile.office.fax}`)}</p>
            </div>
          </article>
          <article className={styles.factCard}>
            <BookOpenCheck aria-hidden="true" />
            <div>
              <h3>{localizedBuilderText(locale, "home.official.biography.title", "Biography and service")}</h3>
              <p><strong>{localizedBuilderText(locale, "home.official.born", "Born:")}</strong> {profile.born}</p>
              <p><strong>{localizedBuilderText(locale, "home.official.occupation", "Occupation:")}</strong> {profile.occupation}</p>
              {profile.publicService.map((item) => <p key={item}>{item}</p>)}
              {profile.legislativeService.map((item) => <p key={item}>{item}</p>)}
            </div>
          </article>
          <article className={styles.factCard}>
            <GraduationCap aria-hidden="true" />
            <div>
              <h3>{localizedBuilderText(locale, "home.official.education", "Education")}</h3>
              <ul>
                {profile.education.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </article>
          <article className={styles.factCard}>
            <Scale aria-hidden="true" />
            <div>
              <h3>{localizedBuilderText(locale, "home.official.committees", "Committees")}</h3>
              <ul>
                {profile.committees.map((committee) => (
                  <li key={committee.code}>
                    {committee.name}{committee.position ? `, ${committee.position}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </article>
        </div>

        <div className={styles.actions} aria-label={localizedBuilderText(locale, "home.official.actions", "Official Legislature actions")}>
          <ExternalAction href={profile.actions.profile} locale={locale}>{localizedBuilderText(locale, "home.official.profile", "Official NJ Legislature profile")}</ExternalAction>
          <ExternalAction href={profile.actions.sponsoredBills} locale={locale}>{localizedBuilderText(locale, "home.official.sponsored", "Sponsored bills")}</ExternalAction>
          <ExternalAction href={profile.actions.votesByBill} locale={locale}>{localizedBuilderText(locale, "home.official.votes-bill", "Votes by bill")}</ExternalAction>
          <ExternalAction href={profile.actions.votesBySubject} locale={locale}>{localizedBuilderText(locale, "home.official.votes-subject", "Votes by subject")}</ExternalAction>
          <ExternalAction href={profile.actions.legislativeContact} locale={locale}>{localizedBuilderText(locale, "home.official.contact-form", "Official Legislative Contact Form")}</ExternalAction>
        </div>

        <footer className={styles.source}>
          <FileText aria-hidden="true" />
          <span>{localizedBuilderText(locale, "home.official.source", `Source: New Jersey Legislature · Verified ${verified}`)}</span>
        </footer>
      </div>
    </section>
  );
}
