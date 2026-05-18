import type { NewsContext, NewsHeadline, NewsRiskLevel } from "./types";
import { buildGdeltQuery, fetchGdeltHeadlines } from "./gdelt";
import { DEFAULT_OFFICIAL_FEEDS, fetchOfficialHeadlines, type OfficialFeed } from "./officialFeeds";

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function scoreToLevel(score: number): NewsRiskLevel {
  if (score >= 0.72) return "high";
  if (score >= 0.38) return "medium";
  return "low";
}

export type NewsContextParams = {
  // GDELT
  gdeltTimespan: string; // e.g. 2h
  gdeltMaxRecords: number;
  gdeltTerms: string[];

  // Official feeds
  officialFeeds?: OfficialFeed[];
  officialWithinHours: number;
  officialMaxItemsPerFeed: number;

  // Output
  maxHeadlines: number;
};

export async function computeNewsContext(params: NewsContextParams): Promise<NewsContext> {
  const query = buildGdeltQuery({ terms: params.gdeltTerms });
  const [gdelt, official] = await Promise.allSettled([
    fetchGdeltHeadlines({ query, timespan: params.gdeltTimespan, maxRecords: params.gdeltMaxRecords }),
    fetchOfficialHeadlines({
      feeds: params.officialFeeds ?? DEFAULT_OFFICIAL_FEEDS,
      maxItemsPerFeed: params.officialMaxItemsPerFeed,
      withinHours: params.officialWithinHours,
    }),
  ]);

  let gdeltCount = 0;
  let gdeltHeadlines: NewsHeadline[] = [];
  if (gdelt.status === "fulfilled") {
    gdeltCount = gdelt.value.count;
    gdeltHeadlines = gdelt.value.headlines;
  }

  let officialHeadlines: NewsHeadline[] = [];
  if (official.status === "fulfilled") officialHeadlines = official.value;

  // Simple risk score:
  // - gdeltCount drives spike detection
  // - official items add a small bump (policy/structural risk)
  const gdeltScore = clamp01(gdeltCount / 35);
  const officialScore = clamp01(officialHeadlines.length / 8);
  const score = clamp01(gdeltScore * 0.75 + officialScore * 0.25);

  const headlines = [...gdeltHeadlines, ...officialHeadlines]
    .filter((h) => h.title && h.url)
    .slice(0, params.maxHeadlines);

  return {
    asof: new Date().toISOString(),
    level: scoreToLevel(score),
    score: Number(score.toFixed(3)),
    signals: {
      gdelt: { query, timespan: params.gdeltTimespan, count: gdeltCount },
      official: { feeds: (params.officialFeeds ?? DEFAULT_OFFICIAL_FEEDS).map((f) => f.name), recentCount: officialHeadlines.length },
    },
    headlines,
  };
}
