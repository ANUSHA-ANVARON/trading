import type { NewsHeadline } from "./types";
import { fetchFeedHeadlines } from "./rss";

export type OfficialFeed = { name: string; url: string };

// Defaults are intentionally minimal and should be easy to override.
// Note: Some official sites change URLs; pass --officialFeed to add/replace.
export const DEFAULT_OFFICIAL_FEEDS: OfficialFeed[] = [
  // Press Information Bureau (Govt of India) – tends to have RSS for releases.
  // If this URL changes, users can pass their own via --officialFeed.
  { name: "PIB", url: "https://pib.gov.in/RSSFeed.aspx?catid=1" },
];

export async function fetchOfficialHeadlines(params: {
  feeds: OfficialFeed[];
  maxItemsPerFeed: number;
  withinHours: number;
}): Promise<NewsHeadline[]> {
  const results = await Promise.allSettled(
    params.feeds.map((f) =>
      fetchFeedHeadlines({ url: f.url, sourceName: f.name, maxItems: params.maxItemsPerFeed, withinHours: params.withinHours }),
    ),
  );

  const out: NewsHeadline[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value);
  }

  // newest first
  out.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return out;
}
