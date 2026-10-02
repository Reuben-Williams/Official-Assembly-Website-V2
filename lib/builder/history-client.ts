"use client";
import type { HistoryQueryV1, HistoryPageV1 } from "@reuben-williams/core";
// The site adds a carousel source while the published editor package remains unchanged.
// Server-side query validation and authorization remain authoritative.
export async function readSiteHistory(
  query: Partial<HistoryQueryV1> = {},
  carouselOnly = false,
): Promise<HistoryPageV1> {
  const search = new URLSearchParams({
    resource: "history",
    limit: String(query.limit ?? 100),
  });
  if (carouselOnly) search.append("source", "carousel");
  else query.sources?.forEach((source) => search.append("source", source));
  query.categories?.forEach((category) => search.append("category", category));
  for (const key of [
    "cursor",
    "search",
    "pagePath",
    "actorId",
    "action",
  ] as const)
    if (query[key]) search.set(key, query[key]!);
  const response = await fetch(`/api/builder?${search}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "History could not be loaded. Your saved work has not changed.",
    );
  return response.json();
}
