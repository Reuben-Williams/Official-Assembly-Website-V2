import type { PublishedPost } from "@reuben-williams/content";
import { ArrowRight, Landmark, Newspaper } from "lucide-react";
import Link from "next/link";

import { officialLegislatureProfile } from "../data/official-legislature-profile";
import { publicPostHref } from "../../lib/builder/published-posts";
import { builderText, type BuilderServerContent } from "../../lib/builder/server-content";
import styles from "./latest-updates-section.module.css";
import { localizedBuilderText } from "../i18n/catalog.server";
import type { PublicLocale } from "../i18n/locale";

function displayDate(value: string, locale: PublicLocale) {
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export function LatestUpdatesSection({
  content,
  posts,
  locale = "en",
}: {
  content: BuilderServerContent;
  posts: readonly PublishedPost[];
  locale?: PublicLocale;
}) {
  return (
    <section className={styles.section} data-home-section="latest" data-builder-item-id="latest-updates">
      <div className="container">
        <header className={styles.heading}>
          <div>
            <p className="eyebrow" data-builder-region="home.latest.eyebrow" data-builder-kind="text">
              {localizedBuilderText(locale, "home.latest.eyebrow", builderText(content, "home.latest.eyebrow", "News & Updates"))}
            </p>
            <h2 data-builder-region="home.latest.title" data-builder-kind="text">
              {localizedBuilderText(locale, "home.latest.title", builderText(content, "home.latest.title", "Latest from the district office"))}
            </h2>
          </div>
          <Link className="secondary-link" href="/news">{localizedBuilderText(locale, "home.latest.view-all", "View all updates")} <ArrowRight aria-hidden="true" size={17} /></Link>
        </header>

        {posts.length ? (
          <div className={styles.posts}>
            {posts.map((post) => (
              <article className={styles.post} key={post.entryId}>
                <p className={styles.date}>{displayDate(post.displayDate, locale)}</p>
                <h3><Link href={publicPostHref(post.slug)}>{post.title}</Link></h3>
                {post.excerpt ? <p>{post.excerpt}</p> : null}
                <Link className={styles.postLink} href={publicPostHref(post.slug)}>
                  {localizedBuilderText(locale, "posts.read-update", "Read update")} <ArrowRight aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}><Newspaper aria-hidden="true" /></div>
            <div>
              <h3>{localizedBuilderText(locale, "posts.empty.title", "No district posts have been published yet")}</h3>
              <p>{localizedBuilderText(locale, "posts.empty.body", "For current public records or direct help, use the official Legislature profile or contact the District Office.")}</p>
            </div>
            <div className={styles.emptyActions}>
              <a href={officialLegislatureProfile.actions.profile} target="_blank" rel="noopener noreferrer">
                <Landmark aria-hidden="true" /> {localizedBuilderText(locale, "posts.official-profile", "Official NJ Legislature profile")}
              </a>
              <Link href="/contact">{localizedBuilderText(locale, "posts.contact-office", "Contact the District Office")}</Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
