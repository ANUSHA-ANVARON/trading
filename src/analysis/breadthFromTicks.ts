export type WeightRow = { key: string; weight: number; token: number };

export type BreadthTick = {
  last_price?: number;
  ohlc?: { close?: number };
  buy_quantity?: number;
  sell_quantity?: number;
  depth?: {
    buy?: Array<{ price?: number; quantity?: number; orders?: number }>;
    sell?: Array<{ price?: number; quantity?: number; orders?: number }>;
  };
};

export type BreadthOutput = {
  asof: string;
  weighted_move_pct: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  buy_sell_imbalance: number | null;
  top_contributors: Array<{ key: string; weight: number; change_pct: number; contribution: number; buy_qty: number | null; sell_qty: number | null }>;
  laggards: Array<{ key: string; weight: number; change_pct: number; contribution: number; buy_qty: number | null; sell_qty: number | null }>;
  flow_heatmap: Array<{
    key: string;
    side: "BUY" | "SELL" | "FLAT" | "NA";
    contribution_pct: number | null;
    net_qty: number | null;
    buy_qty: number | null;
    sell_qty: number | null;
    source: "BUY_SELL_QTY" | "DEPTH_PROXY" | "NONE";
  }>;
};

function pctChange(prev: number, last: number): number {
  if (!Number.isFinite(prev) || prev === 0) return 0;
  return ((last - prev) / prev) * 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function analyzeBreadthFromTicks(
  weights: WeightRow[],
  latest: Map<number, BreadthTick>,
): BreadthOutput {
  const rows = weights
    .map((w) => {
      const t = latest.get(w.token);
      const last = Number(t?.last_price);
      const prev = Number(t?.ohlc?.close);
      const chg = pctChange(prev, last);
      const contribution = (w.weight / 100) * chg;

      const buyQtyRaw = typeof t?.buy_quantity === "number" && Number.isFinite(t.buy_quantity) ? t.buy_quantity : null;
      const sellQtyRaw = typeof t?.sell_quantity === "number" && Number.isFinite(t.sell_quantity) ? t.sell_quantity : null;

      // Fallback when buy/sell quantity isn't present in ticks: use depth proxy (requires `full` mode).
      const buyDepth = Array.isArray(t?.depth?.buy) ? t!.depth!.buy! : null;
      const sellDepth = Array.isArray(t?.depth?.sell) ? t!.depth!.sell! : null;
      const buyDepthSum = buyDepth ? buyDepth.reduce((s, lv) => s + (Number.isFinite(Number(lv.quantity)) ? Number(lv.quantity) : 0), 0) : null;
      const sellDepthSum = sellDepth ? sellDepth.reduce((s, lv) => s + (Number.isFinite(Number(lv.quantity)) ? Number(lv.quantity) : 0), 0) : null;

      const buyQty = buyQtyRaw ?? (buyDepthSum !== null ? buyDepthSum : null);
      const sellQty = sellQtyRaw ?? (sellDepthSum !== null ? sellDepthSum : null);
      const source: BreadthOutput["flow_heatmap"][number]["source"] =
        buyQtyRaw !== null && sellQtyRaw !== null ? "BUY_SELL_QTY" : buyDepthSum !== null && sellDepthSum !== null ? "DEPTH_PROXY" : "NONE";

      const netQty = buyQty !== null && sellQty !== null ? buyQty - sellQty : null;

      return {
        key: w.key,
        weight: w.weight,
        change_pct: chg,
        contribution,
        buy_qty: buyQty,
        sell_qty: sellQty,
        net_qty: netQty,
        flow_source: source,
      };
    })
    .filter((r) => Number.isFinite(r.change_pct));

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

  const weightedMove = rows.reduce((s, r) => s + r.contribution, 0);
  const sorted = [...rows].sort((a, b) => b.contribution - a.contribution);

  const flowDenom = rows.reduce((s, r) => s + (r.net_qty === null ? 0 : Math.abs(r.net_qty)), 0);
  const flowHeatmap: BreadthOutput["flow_heatmap"] = rows.map((r) => {
    const net = r.net_qty;
    const side: BreadthOutput["flow_heatmap"][number]["side"] = net === null ? "NA" : net > 0 ? "BUY" : net < 0 ? "SELL" : "FLAT";
    const pct = net === null || flowDenom <= 0 ? null : (Math.abs(net) / flowDenom) * 100;
    return {
      key: r.key,
      side,
      contribution_pct: pct === null ? null : Number(pct.toFixed(2)),
      net_qty: net === null ? null : Math.round(net),
      buy_qty: r.buy_qty === null ? null : Math.round(r.buy_qty),
      sell_qty: r.sell_qty === null ? null : Math.round(r.sell_qty),
      source: r.flow_source,
    };
  });

  return {
    asof: new Date().toISOString(),
    weighted_move_pct: weightedMove,
    advancers: adv,
    decliners: dec,
    unchanged: unch,
    buy_sell_imbalance: imbalance,
    top_contributors: sorted.slice(0, 10),
    laggards: sorted.slice(-10).reverse(),
    flow_heatmap: flowHeatmap,
  };
}
