import type { PublishedPost } from "@reuben-williams/content";
import { ArrowRight, Landmark, Newspaper } from "lucide-react";
import Link from "next/link";

import { officialLegislatureProfile } from "../data/official-legislature-profile";
import { publicPostHref } from "../../lib/builder/published-posts";
import { builderText, type BuilderServerContent } from "../../lib/builder/server-content";
import styles from "./latest-updates-section.module.css";

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export function LatestUpdatesSection({
  content,
  posts,
}: {
  content: BuilderServerContent;
  posts: readonly PublishedPost[];
}) {
  return (
    <section className={styles.section} data-home-section="latest" data-builder-item-id="latest-updates">
      <div className="container">
        <header className={styles.heading}>
          <div>
            <p className="eyebrow" data-builder-region="home.latest.eyebrow" data-builder-kind="text">
              {builderText(content, "home.latest.eyebrow", "News & Updates")}
            </p>
            <h2 data-builder-region="home.latest.title" data-builder-kind="text">
              {builderText(content, "home.latest.title", "Latest from the district office")}
            </h2>
          </div>
          <Link className="secondary-link" href="/news">View all updates <ArrowRight aria-hidden="true" size={17} /></Link>
        </header>

        {posts.length ? (
          <div className={styles.posts}>
            {posts.map((post) => (
              <article className={styles.post} key={post.entryId}>
                <p className={styles.date}>{displayDate(post.displayDate)}</p>
                <h3><Link href={publicPostHref(post.slug)}>{post.title}</Link></h3>
                {post.excerpt ? <p>{post.excerpt}</p> : null}
                <Link className={styles.postLink} href={publicPostHref(post.slug)}>
                  Read update <ArrowRight aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}><Newspaper aria-hidden="true" /></div>
            <div>
              <h3>No district posts have been published yet</h3>
              <p>For current public records or direct help, use the official Legislature profile or contact the District Office.</p>
            </div>
            <div className={styles.emptyActions}>
              <a href={officialLegislatureProfile.actions.profile} target="_blank" rel="noopener noreferrer">
                <Landmark aria-hidden="true" /> Official NJ Legislature profile
              </a>
              <Link href="/contact">Contact the District Office</Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
