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
import { getImage } from "../data/site";
import { builderLink, builderText, type BuilderServerContent } from "../../lib/builder/server-content";
import { ImagePanel } from "./ImagePanel";
import styles from "./official-profile-section.module.css";
import { localizedBuilderText } from "../i18n/catalog.server";
import type { PublicLocale } from "../i18n/locale";
import { editorPlainText } from "../../lib/builder/editor-text";
import { formattedEditorText } from "../../lib/builder/formatted-text";

function ExternalAction({ href, children, locale, region, content }: { href: string; children: string; locale: PublicLocale; region: string; content: BuilderServerContent }) {
  const link = builderLink(content, region, { href, label: children });
  if (link.disabled) return null;
  return (
    <a className={styles.action} href={link.href} target="_blank" rel="noopener noreferrer" data-builder-region={region} data-builder-kind="link">
      <span data-builder-link-label>{link.label}</span>
      <ArrowUpRight aria-hidden="true" />
      <span className={styles.srOnly}> ({localizedBuilderText(locale, "global.external.new-tab", "opens in a new tab")})</span>
    </a>
  );
}

function CardDetails({ content, region, children, list = false }: { content: BuilderServerContent; region: string; children: React.ReactNode; list?: boolean }) {
  const value = content.regions[region];
  const saved = value?.type === "text" || value?.type === "richText" ? value.value : null;
  const formatted = saved !== null && /<[a-z][\s\S]*>/i.test(saved);
  const lines = saved !== null ? editorPlainText(saved).split(/\r?\n/).filter(line => line.trim()) : null;
  return <div data-builder-region={region} data-builder-kind="richText">{formatted ? formattedEditorText(saved!) : lines
    ? list ? <ul>{lines.map((line, i) => <li key={i}>{line}</li>)}</ul> : lines.map((line, i) => <p key={i}>{line}</p>)
    : children}</div>;
}

export function OfficialProfileSection({ content, locale = "en" }: { content: BuilderServerContent; locale?: PublicLocale }) {
  const verified = new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${profile.provenance.checkedAt}T00:00:00.000Z`));
  const portraitAsset = getImage("professional-home-official");
  const text = (key: string, fallback: string) => formattedEditorText(builderText(content, key, localizedBuilderText(locale, key, fallback)), true);
  const phone = builderLink(content, "home.official.identity.phone", { href: profile.office.phoneHref, label: profile.office.phoneDisplay });

  return (
    <section id="representative" className={styles.section} data-home-section="official" data-builder-item-id="official-profile">
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

        <div className={styles.identityBand} data-profile-identity="true">
          <div className={styles.seal}><Landmark aria-hidden="true" /></div>
          <div>
            <p data-builder-region="home.official.identity.role" data-builder-kind="text">{text("home.official.identity.role", `${localizedBuilderText(locale, "home.official.identity.title", profile.identity.title)} · ${profile.identity.party}`)}</p>
            <h3 data-builder-region="home.official.identity.name" data-builder-kind="text">{text("home.official.identity.name", profile.identity.name)}</h3>
            <strong data-builder-region="home.official.identity.position" data-builder-kind="text">{text("home.official.identity.position", `${profile.identity.position} · ${locale === "es" ? "Distrito" : "District"} ${profile.identity.district}`)}</strong>
          </div>
          <a className={styles.phone} href={phone.href} data-builder-region="home.official.identity.phone" data-builder-kind="link">
            <Phone aria-hidden="true" />
            <span data-builder-link-label>{phone.label}</span>
          </a>
        </div>

        <div className={styles.portrait} data-profile-portrait="true">
          <ImagePanel
            asset={portraitAsset}
            caption={portraitAsset.caption ?? "Official portrait of Assemblywoman Carmen Theresa Morales"}
            content={content}
            instance="home-official-portrait"
            locale={locale}
          />
        </div>

        <div className={styles.factGrid} data-profile-facts="true">
          <article className={styles.factCard}>
            <Building2 aria-hidden="true" />
            <div>
              <h3 data-builder-region="home.official.office.heading" data-builder-kind="text">{text("home.official.office.heading", localizedBuilderText(locale, "home.official.office.title", "District office"))}</h3>
              <CardDetails content={content} region="home.official.office.details">
              <p>{profile.office.address}</p>
              <p>{localizedBuilderText(locale, "home.official.phone", `Phone ${profile.office.phoneDisplay}`)}<br />{localizedBuilderText(locale, "home.official.fax", `Fax ${profile.office.fax}`)}</p>
              </CardDetails>
              <ExternalAction content={content} region="home.official.actions.contact" href={profile.actions.legislativeContact} locale={locale}>{localizedBuilderText(locale, "home.official.contact-form", "Official Legislative Contact Form")}</ExternalAction>
            </div>
          </article>
          <article className={styles.factCard}>
            <BookOpenCheck aria-hidden="true" />
            <div>
              <h3 data-builder-region="home.official.biography.heading" data-builder-kind="text">{text("home.official.biography.heading", localizedBuilderText(locale, "home.official.biography.title", "Biography and service"))}</h3>
              <CardDetails content={content} region="home.official.biography.details">
              <p><strong>{localizedBuilderText(locale, "home.official.occupation", "Occupation:")}</strong> {localizedBuilderText(locale, "home.official.occupation.value", profile.occupation)}</p>
              {profile.publicService.map((item, index) => <p key={item}>{localizedBuilderText(locale, `home.official.public-service.${index}`, item)}</p>)}
              {profile.legislativeService.map((item, index) => <p key={item}>{localizedBuilderText(locale, `home.official.legislative-service.${index}`, item)}</p>)}
              </CardDetails>
              <ExternalAction content={content} region="home.official.actions.biography" href={profile.actions.profile} locale={locale}>{localizedBuilderText(locale, "home.official.profile", "Official NJ Legislature profile")}</ExternalAction>
            </div>
          </article>
          <article className={styles.factCard}>
            <GraduationCap aria-hidden="true" />
            <div>
              <h3 data-builder-region="home.official.education.heading" data-builder-kind="text">{text("home.official.education.heading", localizedBuilderText(locale, "home.official.education", "Education"))}</h3>
              <CardDetails content={content} region="home.official.education.details" list>
              <ul>
                {profile.education.map((item, index) => <li key={item}>{localizedBuilderText(locale, `home.official.education.${index}`, item)}</li>)}
              </ul>
              </CardDetails>
              <ExternalAction content={content} region="home.official.actions.education" href={profile.actions.profile} locale={locale}>{localizedBuilderText(locale, "home.official.profile", "Official NJ Legislature profile")}</ExternalAction>
            </div>
          </article>
          <article className={styles.factCard}>
            <Scale aria-hidden="true" />
            <div>
              <h3 data-builder-region="home.official.committees.heading" data-builder-kind="text">{text("home.official.committees.heading", localizedBuilderText(locale, "home.official.committees", "Committees"))}</h3>
              <CardDetails content={content} region="home.official.committees.details" list>
              <ul>
                {profile.committees.map((committee) => (
                  <li key={committee.code}>
                    {localizedBuilderText(locale, `home.official.committee.${committee.code}`, committee.name)}{committee.position ? `, ${localizedBuilderText(locale, `home.official.committee.${committee.code}.position`, committee.position)}` : ""}
                  </li>
                ))}
              </ul>
              </CardDetails>
              <ExternalAction content={content} region="home.official.actions.sponsored" href={profile.actions.sponsoredBills} locale={locale}>{localizedBuilderText(locale, "home.official.sponsored", "Sponsored bills")}</ExternalAction>
              <ExternalAction content={content} region="home.official.actions.votes-bill" href={profile.actions.votesByBill} locale={locale}>{localizedBuilderText(locale, "home.official.votes-bill", "Votes by bill")}</ExternalAction>
              <ExternalAction content={content} region="home.official.actions.votes-subject" href={profile.actions.votesBySubject} locale={locale}>{localizedBuilderText(locale, "home.official.votes-subject", "Votes by subject")}</ExternalAction>
            </div>
          </article>
        </div>

        <footer className={styles.source}>
          <FileText aria-hidden="true" />
          <span>{localizedBuilderText(locale, "home.official.source", `Source: New Jersey Legislature · Verified ${verified}`)}</span>
        </footer>
      </div>
    </section>
  );
}
