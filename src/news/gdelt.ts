import { fetchJson } from "./fetch";
import type { NewsHeadline } from "./types";

type GdeltDocResponse = {
  articles?: Array<{
    title?: string;
    url?: string;
    sourceCountry?: string;
    sourceCollectionIdentifier?: string;
    sourceCommonName?: string;
    seendate?: string;
    datetime?: string;
    sourceLanguage?: string;
  }>;
};

export function buildGdeltQuery(params: { terms: string[] }): string {
  // Keep it simple: OR-joined tokens/phrases.
  // GDELT uses Lucene-ish syntax.
  return params.terms
    .map((t) => {
      const trimmed = t.trim();
      if (!trimmed) return "";
      // quote phrases
      return trimmed.includes(" ") ? `\"${trimmed}\"` : trimmed;
    })
    .filter(Boolean)
    .join(" OR ");
}

export async function fetchGdeltHeadlines(params: {
  query: string;
  timespan: string; // e.g. '2h', '60m'
  maxRecords: number;
}): Promise<{ count: number; headlines: NewsHeadline[] }> {
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc" +
    `?query=${encodeURIComponent(params.query)}` +
    `&mode=artlist&format=json` +
    `&maxrecords=${encodeURIComponent(String(params.maxRecords))}` +
    `&sort=hybrid` +
    `&timespan=${encodeURIComponent(params.timespan)}`;

  const json = await fetchJson<GdeltDocResponse>(url);
  const articles = json.articles ?? [];

  const headlines: NewsHeadline[] = articles
    .map((a) => {
      const title = (a.title ?? "").trim();
      const url = (a.url ?? "").trim();
      if (!title || !url) return null;

      const publishedRaw = (a.seendate ?? a.datetime ?? "").trim();
      const publishedAt = publishedRaw ? new Date(publishedRaw).toISOString() : null;

      const source = (a.sourceCommonName ?? a.sourceCollectionIdentifier ?? a.sourceCountry ?? "GDELT").trim() || "GDELT";
      return { source, title, url, publishedAt } satisfies NewsHeadline;
    })
    .filter((x): x is NewsHeadline => Boolean(x));

  return { count: headlines.length, headlines };
}
