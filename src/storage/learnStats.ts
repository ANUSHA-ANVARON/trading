/**
 * Auto learning — analyses the full prediction log across all dates,
 * segments win rates into signal buckets, and surfaces threshold suggestions.
 *
 * Results are cached for 5 minutes so the endpoint is cheap to call.
 */

import { fetchAvailableDates, fetchPredictionsByDate, type PredictionLogEntry } from "./predictionLog";

export type BucketStat = {
  key: string;
  direction: "LONG" | "SHORT" | "ALL";
  n: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
};

export type Suggestion = {
  gateId: string;
  paramKey: string | null;
  message: string;
  severity: "warn" | "info" | "good";
  currentValue: number | null;
  suggestedValue: number | null;
  sampleSize: number;
  winRate: number | null;
  baselineWinRate: number | null;
};

export type LearnStats = {
  asof: string;
  totalPredictions: number;
  resolvedPredictions: number;
  overallWinRate: number | null;
  bySetupLabel: BucketStat[];
  byRsi5m: BucketStat[];
  byTfAgree: BucketStat[];
  byBreadth: BucketStat[];
  byBbPctB: BucketStat[];
  byLotSize: BucketStat[];
  suggestions: Suggestion[];
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeStat(
  key: string,
  direction: "LONG" | "SHORT" | "ALL",
  entries: PredictionLogEntry[],
): BucketStat {
  const resolved = entries.filter((e) => e.outcome === "TARGET_HIT" || e.outcome === "STOP_HIT");
  const wins = resolved.filter((e) => e.outcome === "TARGET_HIT").length;
  const losses = resolved.filter((e) => e.outcome === "STOP_HIT").length;
  return {
    key,
    direction,
    n: entries.length,
    wins,
    losses,
    winRate: resolved.length > 0 ? +(wins / resolved.length).toFixed(3) : null,
    netPnl: +entries.reduce((s, e) => s + (e.pnlPoints ?? 0), 0).toFixed(2),
  };
}

function bucketIdx(value: number | null | undefined, breaks: number[]): number {
  if (value == null) return -1;
  for (let i = 0; i < breaks.length; i++) {
    if (value < breaks[i]) return i;
  }
  return breaks.length;
}

function bucketStats(
  entries: PredictionLogEntry[],
  getValue: (e: PredictionLogEntry) => number | null | undefined,
  breaks: number[],
  labels: string[],
  direction: "LONG" | "SHORT" | "ALL",
  prefix: string,
): BucketStat[] {
  const buckets: PredictionLogEntry[][] = Array.from({ length: labels.length }, () => []);
  for (const e of entries) {
    const bi = bucketIdx(getValue(e), breaks);
    if (bi >= 0 && bi < buckets.length) buckets[bi].push(e);
  }
  return labels
    .map((lbl, i) => makeStat(`${prefix} ${lbl}`, direction, buckets[i]))
    .filter((s) => s.n > 0);
}

// ── Cache ────────────────────────────────────────────────────────────────────

let _cache: LearnStats | null = null;
let _cacheAt = 0;
const CACHE_TTL = 5 * 60_000; // 5 minutes

export function invalidateLearnCache(): void {
  _cache = null;
  _cacheAt = 0;
}

// ── Main analysis ─────────────────────────────────────────────────────────────

export async function computeLearnStats(predictionsDir: string, force = false): Promise<LearnStats> {
  const now = Date.now();
  if (!force && _cache && now - _cacheAt < CACHE_TTL) return _cache;

  const dates = await fetchAvailableDates(predictionsDir);
  const all: PredictionLogEntry[] = [];
  for (const date of dates) {
    const rows = await fetchPredictionsByDate(date, predictionsDir);
    all.push(...rows);
  }

  const resolved = all.filter((e) => e.outcome === "TARGET_HIT" || e.outcome === "STOP_HIT");
  const totalWins = resolved.filter((e) => e.outcome === "TARGET_HIT").length;
  const overallWinRate = resolved.length > 0 ? totalWins / resolved.length : null;

  const longs = all.filter((e) => e.direction === "LONG");
  const shorts = all.filter((e) => e.direction === "SHORT");

  // ── Setup label segments ───────────────────────────────────────────────────
  const labelMap = new Map<string, PredictionLogEntry[]>();
  for (const e of all) {
    const parts = e.setupLabel ? e.setupLabel.split(" · ") : [];
    // Use everything from part index 2 onward (skip session+lifecycle prefix)
    const key = parts.length > 2 ? parts.slice(2).join(" · ") : (e.setupLabel ?? "UNLABELED");
    (labelMap.get(key) ?? (labelMap.set(key, []), labelMap.get(key)!)).push(e);
  }
  const bySetupLabel = [...labelMap.entries()]
    .map(([k, v]) => makeStat(k, "ALL", v))
    .sort((a, b) => b.n - a.n)
    .slice(0, 15);

  // ── RSI 5m buckets ─────────────────────────────────────────────────────────
  const byRsi5m: BucketStat[] = [
    ...bucketStats(
      longs,
      (e) => e.signals.rsi5m,
      [50, 53, 56, 59, 63],
      ["<50", "50-53", "53-56", "56-59", "59-63", "63+"],
      "LONG",
      "LONG RSI5m",
    ),
    ...bucketStats(
      shorts,
      (e) => e.signals.rsi5m,
      [37, 41, 44, 47, 50],
      ["<37", "37-41", "41-44", "44-47", "47-50", "50+"],
      "SHORT",
      "SHORT RSI5m",
    ),
  ];

  // ── TF agree ──────────────────────────────────────────────────────────────
  const tfMap = new Map<string, PredictionLogEntry[]>();
  for (const e of all) {
    const key = `${e.direction} TFAgree=${e.signals.tfAgree ?? "?"}`;
    (tfMap.get(key) ?? (tfMap.set(key, []), tfMap.get(key)!)).push(e);
  }
  const byTfAgree = [...tfMap.entries()]
    .map(([k, v]) => {
      const dir = v[0]?.direction === "LONG" ? "LONG" : v[0]?.direction === "SHORT" ? "SHORT" : "ALL";
      return makeStat(k, dir, v);
    })
    .filter((s) => s.n > 0)
    .sort((a, b) => a.key.localeCompare(b.key));

  // ── Breadth move buckets ───────────────────────────────────────────────────
  const byBreadth: BucketStat[] = [
    ...bucketStats(
      longs,
      (e) => e.signals.breadthMove,
      [0.05, 0.10, 0.15, 0.25],
      ["0-0.05%", "0.05-0.10%", "0.10-0.15%", "0.15-0.25%", ">0.25%"],
      "LONG",
      "LONG Breadth",
    ),
    ...bucketStats(
      shorts,
      (e) => e.signals.breadthMove,
      [-0.25, -0.15, -0.10, -0.05],
      ["<-0.25%", "-0.25 to -0.15%", "-0.15 to -0.10%", "-0.10 to -0.05%", ">-0.05%"],
      "SHORT",
      "SHORT Breadth",
    ),
  ];

  // ── BB%B 5m buckets ───────────────────────────────────────────────────────
  const byBbPctB: BucketStat[] = [
    ...bucketStats(
      longs,
      (e) => e.signals.bbPctB5m,
      [0.3, 0.5, 0.7, 0.85],
      ["<0.30", "0.30-0.50", "0.50-0.70", "0.70-0.85", ">0.85"],
      "LONG",
      "LONG BB%B",
    ),
    ...bucketStats(
      shorts,
      (e) => e.signals.bbPctB5m,
      [0.15, 0.30, 0.50, 0.70],
      ["<0.15", "0.15-0.30", "0.30-0.50", "0.50-0.70", ">0.70"],
      "SHORT",
      "SHORT BB%B",
    ),
  ];

  // ── Lot size ──────────────────────────────────────────────────────────────
  const lotMap = new Map<string, PredictionLogEntry[]>();
  for (const e of all) {
    const key = e.lotSizeRec ?? "UNKNOWN";
    (lotMap.get(key) ?? (lotMap.set(key, []), lotMap.get(key)!)).push(e);
  }
  const byLotSize = [...lotMap.entries()]
    .map(([k, v]) => makeStat(k, "ALL", v))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n);

  // ── Suggestions ───────────────────────────────────────────────────────────
  const MIN_N = 5;
  const WARN_DELTA = 0.15;
  const suggestions: Suggestion[] = [];

  if (overallWinRate !== null) {
    const base = overallWinRate;

    // RSI 5m LONG floor suggestions
    const rsi5mLongBreaks = [50, 53, 56, 59, 63];
    const rsi5mLongLabels = ["<50", "50-53", "53-56", "56-59", "59-63", "63+"];
    const rsi5mLongBuckets = rsi5mLongLabels.map((_, i) =>
      longs.filter((e) => {
        const v = e.signals.rsi5m;
        if (v == null) return false;
        const lo = rsi5mLongBreaks[i - 1] ?? -Infinity;
        const hi = rsi5mLongBreaks[i] ?? Infinity;
        return v >= lo && v < hi;
      }),
    );
    rsi5mLongLabels.forEach((lbl, i) => {
      const stat = makeStat(lbl, "LONG", rsi5mLongBuckets[i]);
      if (stat.n < MIN_N || stat.winRate === null) return;
      const delta = stat.winRate - base;
      const hi = rsi5mLongBreaks[i] ?? 63;
      if (delta < -WARN_DELTA) {
        suggestions.push({
          gateId: "G3_RSI",
          paramKey: "longMin5m",
          message: `LONG RSI 5m ${lbl}: ${Math.round(stat.winRate * 100)}% win (${stat.n} trades) vs ${Math.round(base * 100)}% overall — underperforming; consider raising longMin5m to ${hi}`,
          severity: "warn",
          currentValue: rsi5mLongBreaks[i - 1] ?? 50,
          suggestedValue: hi <= 62 ? hi : null,
          sampleSize: stat.n,
          winRate: stat.winRate,
          baselineWinRate: base,
        });
      } else if (delta > WARN_DELTA) {
        suggestions.push({
          gateId: "G3_RSI",
          paramKey: "longMin5m",
          message: `LONG RSI 5m ${lbl}: ${Math.round(stat.winRate * 100)}% win (${stat.n} trades) — strong zone, keep current floor`,
          severity: "good",
          currentValue: rsi5mLongBreaks[i - 1] ?? 50,
          suggestedValue: null,
          sampleSize: stat.n,
          winRate: stat.winRate,
          baselineWinRate: base,
        });
      }
    });

    // TF agree 2 vs 3
    const tfLong2 = longs.filter((e) => (e.signals.tfAgree ?? 0) === 2);
    const tfLong3 = longs.filter((e) => (e.signals.tfAgree ?? 0) === 3);
    const tfShort2 = shorts.filter((e) => (e.signals.tfAgree ?? 0) === 2);
    const tfShort3 = shorts.filter((e) => (e.signals.tfAgree ?? 0) === 3);

    const checkTf = (dir: "LONG" | "SHORT", s2: PredictionLogEntry[], s3: PredictionLogEntry[]) => {
      const stat2 = makeStat("TFAgree=2", dir, s2);
      const stat3 = makeStat("TFAgree=3", dir, s3);
      if (stat2.n < MIN_N || stat2.winRate === null) return;
      if (stat2.winRate < base - WARN_DELTA) {
        const s3note = stat3.n >= 3 && stat3.winRate !== null
          ? ` (vs ${Math.round(stat3.winRate * 100)}% at 3/3)`
          : "";
        suggestions.push({
          gateId: "G2_TF_AGREE",
          paramKey: "minAgree",
          message: `${dir} 2/3 TF agree: ${Math.round(stat2.winRate * 100)}% win rate (${stat2.n} trades)${s3note} — below threshold; consider raising minAgree to 3`,
          severity: "warn",
          currentValue: 2,
          suggestedValue: 3,
          sampleSize: stat2.n,
          winRate: stat2.winRate,
          baselineWinRate: base,
        });
      }
    };
    checkTf("LONG", tfLong2, tfLong3);
    checkTf("SHORT", tfShort2, tfShort3);

    // Setup label underperformers
    for (const stat of bySetupLabel) {
      if (stat.n < MIN_N || stat.winRate === null) continue;
      if (stat.winRate < base - WARN_DELTA) {
        suggestions.push({
          gateId: "G1_LIFECYCLE",
          paramKey: null,
          message: `Setup "${stat.key}": ${Math.round(stat.winRate * 100)}% win (${stat.n} trades) vs ${Math.round(base * 100)}% overall — pattern underperforms; consider tightening gates`,
          severity: "warn",
          currentValue: null,
          suggestedValue: null,
          sampleSize: stat.n,
          winRate: stat.winRate,
          baselineWinRate: base,
        });
      }
    }

    // Lot size mismatch: SMALL outperforms PERFECT
    const perfStat = byLotSize.find((s) => s.key === "PERFECT");
    const smallStat = byLotSize.find((s) => s.key === "SMALL");
    if (
      perfStat && smallStat &&
      perfStat.n >= MIN_N && smallStat.n >= MIN_N &&
      perfStat.winRate !== null && smallStat.winRate !== null &&
      smallStat.winRate > perfStat.winRate + 0.10
    ) {
      suggestions.push({
        gateId: "G8_RSI_EXTEND",
        paramKey: null,
        message: `Lot size mismatch: SMALL entries win ${Math.round(smallStat.winRate * 100)}% vs PERFECT ${Math.round(perfStat.winRate * 100)}% — confidence model may be mis-calibrated`,
        severity: "warn",
        currentValue: null,
        suggestedValue: null,
        sampleSize: perfStat.n + smallStat.n,
        winRate: perfStat.winRate,
        baselineWinRate: smallStat.winRate,
      });
    }

    // If no suggestions generated, surface a positive
    if (suggestions.length === 0 && resolved.length >= MIN_N) {
      suggestions.push({
        gateId: "ALL",
        paramKey: null,
        message: `No underperforming buckets detected — overall win rate ${Math.round(base * 100)}% across ${resolved.length} resolved trades looks consistent`,
        severity: "good",
        currentValue: null,
        suggestedValue: null,
        sampleSize: resolved.length,
        winRate: base,
        baselineWinRate: base,
      });
    }
  }

  const result: LearnStats = {
    asof: new Date().toISOString(),
    totalPredictions: all.length,
    resolvedPredictions: resolved.length,
    overallWinRate: overallWinRate !== null ? +overallWinRate.toFixed(3) : null,
    bySetupLabel,
    byRsi5m,
    byTfAgree,
    byBreadth,
    byBbPctB,
    byLotSize,
    suggestions,
  };

  _cache = result;
  _cacheAt = now;
  return result;
}
