import { promises as fs } from "fs";
import * as path from "path";
import { env } from "../config/env";

// Lazy Convex client — created once when CONVEX_URL is available.
let _convex: any = null;
async function getConvexClient(): Promise<any | null> {
  if (!env.CONVEX_URL) return null;
  if (_convex) return _convex;
  const { ConvexHttpClient } = await import("convex/browser");
  _convex = new ConvexHttpClient(env.CONVEX_URL);
  return _convex;
}

export type PredictionLogEntry = {
  id: string;
  asof: string;
  timeframe: "1m" | "5m" | "15m";
  direction: "LONG" | "SHORT";
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  confidence: number;
  lifecycle: string;
  session: string;
  signals: {
    rsi1m: number | null; rsi5m: number | null; rsi15m: number | null;
    bbPctB5m: number | null; bbPctB15m: number | null;
    spartanNet: number; surfNet: number; breadthMove: number;
    tfAgree: number;
  };
  outcome: "PENDING" | "TARGET_HIT" | "STOP_HIT" | "EXPIRED";
  outcomePrice: number | null;
  outcomeAt: string | null;
  pnlPoints: number | null;
};

export function toIstDate(iso: string): string {
  const d = new Date(iso);
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return ist.toISOString().slice(0, 10);
}

function toIstTime(iso: string): string {
  const d = new Date(iso);
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return ist.toISOString().slice(11, 16) + " IST";
}

function jsonPath(predictionsDir: string, date: string): string {
  return path.join(predictionsDir, `${date}.json`);
}

function mdPath(predictionsDir: string, date: string): string {
  return path.join(predictionsDir, `${date}.md`);
}

async function readLog(file: string): Promise<PredictionLogEntry[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as PredictionLogEntry[];
  } catch {
    return [];
  }
}

async function writeLog(file: string, entries: PredictionLogEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(entries, null, 2), "utf8");
}

// Upsert a prediction. Writes to Convex when CONVEX_URL is set, always also
// writes to the local JSON file as a backup.
export async function persistPrediction(entry: PredictionLogEntry, predictionsDir: string): Promise<void> {
  const date = toIstDate(entry.asof);

  // Convex (primary when configured)
  const convex = await getConvexClient();
  if (convex) {
    try {
      const { api } = await import("../convex/_generated/api");
      await convex.mutation(api.predictions.upsertPrediction, {
        predId:      entry.id,
        date,
        asof:        entry.asof,
        timeframe:   entry.timeframe,
        direction:   entry.direction,
        entryPrice:  entry.entryPrice,
        targetPrice: entry.targetPrice,
        stopPrice:   entry.stopPrice,
        confidence:  entry.confidence,
        lifecycle:   entry.lifecycle,
        session:     entry.session,
        signals:     entry.signals,
        outcome:     entry.outcome,
        outcomePrice: entry.outcomePrice,
        outcomeAt:   entry.outcomeAt,
        pnlPoints:   entry.pnlPoints,
      });
    } catch {
      // fall through to file backup
    }
  }

  // File backup (always)
  const file = jsonPath(predictionsDir, date);
  const entries = await readLog(file);
  const idx = entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) entries[idx] = entry; else entries.unshift(entry);
  await writeLog(file, entries).catch(() => {});
}

// Fetch predictions for a given date from Convex (or local file as fallback).
export async function fetchPredictionsByDate(date: string, predictionsDir: string): Promise<PredictionLogEntry[]> {
  const convex = await getConvexClient();
  if (convex) {
    try {
      const { api } = await import("../convex/_generated/api");
      const rows: any[] = await convex.query(api.predictions.getByDate, { date });
      return rows.map((r: any) => ({
        id: r.predId, asof: r.asof, timeframe: r.timeframe, direction: r.direction,
        entryPrice: r.entryPrice, targetPrice: r.targetPrice, stopPrice: r.stopPrice,
        confidence: r.confidence, lifecycle: r.lifecycle, session: r.session,
        signals: r.signals, outcome: r.outcome, outcomePrice: r.outcomePrice ?? null,
        outcomeAt: r.outcomeAt ?? null, pnlPoints: r.pnlPoints ?? null,
      })) as PredictionLogEntry[];
    } catch { /* fall through */ }
  }
  // File fallback
  const entries = await readLog(jsonPath(predictionsDir, date));
  return entries.sort((a, b) => a.asof.localeCompare(b.asof));
}

// Return dates for which predictions exist (Convex or local files).
export async function fetchAvailableDates(predictionsDir: string): Promise<string[]> {
  const convex = await getConvexClient();
  if (convex) {
    try {
      const { api } = await import("../convex/_generated/api");
      return await convex.query(api.predictions.getAvailableDates, {});
    } catch { /* fall through */ }
  }
  // File fallback: scan directory for YYYY-MM-DD.json files
  try {
    const files = await fs.readdir(predictionsDir);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace(".json", ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Generate a Markdown report from the daily JSON log. Returns the path to the .md file.
export async function generateDailyReport(date: string, predictionsDir: string): Promise<string> {
  const file = jsonPath(predictionsDir, date);
  const entries = await readLog(file);
  const out = mdPath(predictionsDir, date);

  if (!entries.length) {
    const noData = `# NIFTY Prediction Report — ${date}\n\nNo predictions fired today.\n`;
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, noData, "utf8");
    return out;
  }

  const sorted = [...entries].sort((a, b) => new Date(a.asof).getTime() - new Date(b.asof).getTime());

  const hits    = sorted.filter((e) => e.outcome === "TARGET_HIT");
  const stops   = sorted.filter((e) => e.outcome === "STOP_HIT");
  const expired = sorted.filter((e) => e.outcome === "EXPIRED");
  const pending = sorted.filter((e) => e.outcome === "PENDING");
  const resolved = sorted.filter((e) => e.outcome !== "PENDING");
  const totalPnl = resolved.reduce((s, e) => s + (e.pnlPoints ?? 0), 0);

  const oc  = (o: string) => o === "TARGET_HIT" ? "✅ TARGET" : o === "STOP_HIT" ? "❌ STOP" : o === "EXPIRED" ? "⏰ EXPIRED" : "⏳ PENDING";
  const dir = (d: string) => d === "LONG" ? "▲ LONG" : "▼ SHORT";
  const fmt = (n: number | null, dp = 2) => n == null ? "–" : Number(n).toFixed(dp);
  const pnlStr = (n: number | null) => n == null ? "–" : (n >= 0 ? "+" : "") + fmt(n);

  let md = `# NIFTY Prediction Report — ${date} (IST)\n\n`;
  md += `> Generated by AlgoBot · ${new Date().toISOString()}\n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Total predictions | ${sorted.length} |\n`;
  md += `| ✅ Target hit | ${hits.length} |\n`;
  md += `| ❌ Stop hit | ${stops.length} |\n`;
  md += `| ⏰ Expired | ${expired.length} |\n`;
  md += `| ⏳ Pending | ${pending.length} |\n`;
  if (resolved.length > 0) {
    md += `| Win rate | ${Math.round((hits.length / resolved.length) * 100)}% (${hits.length}/${resolved.length} resolved) |\n`;
  }
  md += `| **Net P&L** | **${pnlStr(totalPnl)} pts** |\n\n`;

  md += `## Predictions\n\n`;
  md += `| Time | Dir | TF | Entry | Target | Stop | Conf | Session | Outcome | Exit Price | P&L (pts) | Resolved At |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const e of sorted) {
    md += `| ${toIstTime(e.asof)} | ${dir(e.direction)} | ${e.timeframe} | ${fmt(e.entryPrice)} | ${fmt(e.targetPrice)} | ${fmt(e.stopPrice)} | ${(e.confidence * 100).toFixed(0)}% | ${e.session.replace(/_/g, " ")} | ${oc(e.outcome)} | ${fmt(e.outcomePrice)} | ${pnlStr(e.pnlPoints)} | ${e.outcomeAt ? toIstTime(e.outcomeAt) : "–"} |\n`;
  }

  md += `\n## Signal Context\n\n`;
  md += `| Time | Dir | RSI 5m | RSI 15m | BB%B 5m | Breadth Move | TF Agree | Spartan Net | Surf Net | Lifecycle |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const e of sorted) {
    const s = e.signals;
    md += `| ${toIstTime(e.asof)} | ${dir(e.direction)} | ${fmt(s.rsi5m, 1)} | ${fmt(s.rsi15m, 1)} | ${s.bbPctB5m != null ? (s.bbPctB5m * 100).toFixed(0) + "%" : "–"} | ${fmt(s.breadthMove, 3)}% | ${s.tfAgree}/3 | ${s.spartanNet >= 0 ? "+" : ""}${s.spartanNet} | ${s.surfNet >= 0 ? "+" : ""}${s.surfNet} | ${e.lifecycle.replace(/_/g, " ")} |\n`;
  }

  md += `\n---\n*AlgoBot Trading Intelligence*\n`;

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, md, "utf8");
  return out;
}
