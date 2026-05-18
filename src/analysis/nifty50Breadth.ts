import { promises as fs } from "fs";
import type { KiteQuote } from "../kite/marketData";
import { getQuote } from "../kite/marketData";

export type WeightRow = {
  key: string; // e.g. "NSE:RELIANCE"
  weight: number; // % weight, e.g. 10.2
};

export type BreadthOutput = {
  asof: string;
  total_weight: number;
  weighted_move_pct: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  buy_sell_imbalance: number | null;
  top_contributors: Array<{ key: string; weight: number; change_pct: number; contribution: number; buy_qty?: number; sell_qty?: number }>;
  laggards: Array<{ key: string; weight: number; change_pct: number; contribution: number; buy_qty?: number; sell_qty?: number }>;
};

function pctChange(prev: number, last: number): number {
  if (!Number.isFinite(prev) || prev === 0) return 0;
  return ((last - prev) / prev) * 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export async function loadWeights(filePath: string): Promise<WeightRow[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("Weights file must be a JSON array");

  const rows: WeightRow[] = data.map((r) => {
    if (!r || typeof r !== "object") throw new Error("Invalid weight row");
    const key = String((r as any).key ?? "").trim();
    const weight = Number((r as any).weight);
    if (!key.includes(":")) throw new Error(`Invalid key: ${key}. Use NSE:SYMBOL`);
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`Invalid weight for ${key}`);
    return { key, weight };
  });

  if (rows.length === 0) throw new Error("Weights file is empty.");

  const sum = rows.reduce((s, r) => s + r.weight, 0);
  if (sum === 0) {
    // Fallback: equal weights so breadth/imbalance still works even if you don't maintain weights.
    const equal = 100 / rows.length;
    return rows.map((r) => ({ ...r, weight: equal }));
  }

  return rows;
}

export async function analyzeBreadth(weights: WeightRow[]): Promise<BreadthOutput> {
  const keys = weights.map((w) => w.key);
  const quotes = (await getQuote(keys)) as Record<string, KiteQuote>;

  const rows = weights
    .map((w) => {
      const q = quotes[w.key];
      const last = Number(q?.last_price);
      const prevClose = Number(q?.ohlc?.close);
      const chg = pctChange(prevClose, last);
      const contribution = (w.weight / 100) * chg;

      return {
        key: w.key,
        weight: w.weight,
        change_pct: chg,
        contribution,
        buy_qty: q?.buy_quantity,
        sell_qty: q?.sell_quantity,
      };
    })
    .filter((r) => Number.isFinite(r.change_pct));

  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);

  const weightedMove = rows.reduce((s, r) => s + r.contribution, 0);

  let adv = 0;
  let dec = 0;
  let unch = 0;
  for (const r of rows) {
    if (r.change_pct > 0.02) adv++;
    else if (r.change_pct < -0.02) dec++;
    else unch++;
  }

  const buySum = rows.reduce((s, r) => s + (r.buy_qty ?? 0), 0);
  const sellSum = rows.reduce((s, r) => s + (r.sell_qty ?? 0), 0);
  const denom = buySum + sellSum;
  const imbalance = denom > 0 ? clamp((buySum - sellSum) / denom, -1, 1) : null;

  const sorted = [...rows].sort((a, b) => b.contribution - a.contribution);

  return {
    asof: new Date().toISOString(),
    total_weight: totalWeight,
    weighted_move_pct: weightedMove,
    advancers: adv,
    decliners: dec,
    unchanged: unch,
    buy_sell_imbalance: imbalance,
    top_contributors: sorted.slice(0, 10),
    laggards: sorted.slice(-10).reverse(),
  };
}
