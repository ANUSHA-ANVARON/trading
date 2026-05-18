export type NewsHeadline = {
  source: string;
  title: string;
  url: string;
  publishedAt: string | null; // ISO
};

export type NewsRiskLevel = "low" | "medium" | "high";

export type NewsContext = {
  asof: string; // ISO
  level: NewsRiskLevel;
  score: number; // 0..1
  signals: {
    gdelt: { query: string; timespan: string; count: number };
    official: { feeds: string[]; recentCount: number };
  };
  headlines: NewsHeadline[];
};
