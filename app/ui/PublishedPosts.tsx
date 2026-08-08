import type { PublishedPost } from "@reuben-williams/content";
import Link from "next/link";

import { publicPostHref } from "../../lib/builder/published-posts";

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York"
  }).format(new Date(value));
}

export function PublishedPostList({ posts }: { posts: readonly PublishedPost[] }) {
  if (posts.length === 0) {
    return (
      <div className="news-empty">
        <h2>No district posts have been published yet</h2>
        <p>Published district office updates will appear here.</p>
      </div>
    );
  }

  return (
    <div className="news-grid">
      {posts.map((post) => (
        <article className="news-card" key={post.entryId}>
          <p className="news-date">{displayDate(post.displayDate)}</p>
          <h2><Link href={publicPostHref(post.slug)}>{post.title}</Link></h2>
          {post.excerpt ? <p>{post.excerpt}</p> : null}
          <Link className="secondary-link" href={publicPostHref(post.slug)}>Read update</Link>
        </article>
      ))}
    </div>
  );
}
