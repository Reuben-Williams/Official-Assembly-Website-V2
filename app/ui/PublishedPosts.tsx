import type { PublishedPost } from "@reuben-williams/content";
import Link from "next/link";

import { publicPostHref } from "../../lib/builder/published-posts";
import { publicCopy } from "../i18n/catalog.public";
import type { PublicLocale } from "../i18n/locale";

function displayDate(value: string, locale: PublicLocale) {
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York"
  }).format(new Date(value));
}

export function PublishedPostList({
  posts,
  locale = "en",
}: {
  posts: readonly PublishedPost[];
  locale?: PublicLocale;
}) {
  if (posts.length === 0) {
    return (
      <div className="news-empty">
        <h2>{publicCopy(locale, "news.empty-title", "No district posts have been published yet")}</h2>
        <p>{publicCopy(locale, "news.empty-body", "Published district office updates will appear here.")}</p>
      </div>
    );
  }

  return (
    <div className="news-grid">
      {posts.map((post) => (
        <article className="news-card" key={post.entryId}>
          <p className="news-date">{displayDate(post.displayDate, locale)}</p>
          <h2><Link href={publicPostHref(post.slug)}>{post.title}</Link></h2>
          {post.excerpt ? <p>{post.excerpt}</p> : null}
          <Link className="secondary-link" href={publicPostHref(post.slug)}>
            {publicCopy(locale, "news.read-update", "Read update")}
          </Link>
        </article>
      ))}
    </div>
  );
}
