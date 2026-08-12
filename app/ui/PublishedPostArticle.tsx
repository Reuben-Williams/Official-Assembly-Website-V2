import type { PublishedPost } from "@reuben-williams/content";
import Link from "next/link";

import { publicCopy } from "../i18n/catalog.public";
import type { PublicLocale } from "../i18n/locale";
import { PostBody } from "./PostBody";

function postDate(value: string, locale: PublicLocale) {
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export function PublishedPostArticle({ locale, post }: {
  locale: PublicLocale;
  post: PublishedPost & { snapshot: NonNullable<PublishedPost["snapshot"]> };
}) {
  return (
    <article className="published-post">
      <header className="published-post-header">
        <div className="container published-post-heading">
          <Link className="secondary-link" href="/news">
            {publicCopy(locale, "post.back-to-news", "Back to News")}
          </Link>
          <p className="eyebrow">{publicCopy(locale, "post.district-update", "District Update")}</p>
          <h1>{post.title}</h1>
          {post.excerpt ? <p className="lead">{post.excerpt}</p> : null}
          <p className="published-post-byline">
            {post.snapshot.data.author.name} <span aria-hidden="true">·</span> {postDate(post.displayDate, locale)}
          </p>
        </div>
      </header>
      <div className="container published-post-content">
        <PostBody document={post.snapshot.data.body} />
      </div>
    </article>
  );
}
