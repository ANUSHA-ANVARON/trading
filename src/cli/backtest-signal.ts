/**
 * Historic backtest: replays the gate-based prediction engine on Kite historical
 * 1m candles and simulates outcomes against TP/SL targets.
 *
 * Gates evaluated (candle-computable): G0 G1 G2 G3 G4 G8 G9 G10 G11 G12
 * Gates skipped (require live data):  G5 breadth  G6 PCR  G7 IV  G13 global  G14 domestic
 *
 * Usage:
 *   npm run backtest:signal -- --from 2026-07-01 --to 2026-07-31
 *   npm run backtest:signal -- --from 2026-07-28 --to 2026-07-28 --tp 0.35 --sl 0.20
 *   npm run backtest:signal -- --from yesterday  --to today      --out data/bt-results.json
 */

import { getArgValue, hasFlag } from "./_args";
import { promises as fs } from "fs";
import * as path from "path";
import { rsi, bollingerBands, ema, trendStructure } from "../analysis/indicators";
import { computeLifecycle } from "../analysis/lifecycle";
import { niftySessionRangeForIstDay } from "../time/ist";
import { getHistorical, type HistoricalCandle } from "../kite/marketData";
import { getInstruments } from "../instruments/instrumentsCache";
import { pickNearExpiryNiftyFutureKey } from "../analysis/defaults";
import type { Candle } from "../core/types";

// ── Types ────────────────────────────────────────────────────────────────────

type SimTrade = {
  date: string;
  time: string;         // IST HH:MM
  direction: "LONG" | "SHORT";
  session: string;
  lifecycle: string;
  tfAgree: number;
  rsi5m: number | null;
  rsi15m: number | null;
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  outcome: "TARGET_HIT" | "STOP_HIT" | "EXPIRED";
  pnlPoints: number;
  mfePoints: number;    // best favorable excursion in points
  barsToOutcome: number;
  gatesSkipped: string[];
};

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseIstYmd(s: string): Date {
  // Parses YYYY-MM-DD as an IST date (midnight IST → returns the UTC Date)
  return new Date(`${s}T00:00:00+05:30`);
}

function toIstYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function toIstHHMM(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cur = parseIstYmd(from);
  const end = parseIstYmd(to);
  while (cur <= end) {
    dates.push(toIstYmd(cur));
    cur = new Date(cur.getTime() + 24 * 60 * 60_000);
  }
  return dates;
}

// ── Candle aggregation ────────────────────────────────────────────────────────

function agg(bars: HistoricalCandle[]): Candle | null {
  if (!bars.length) return null;
  return {
    time: (bars[0].date instanceof Date ? bars[0].date : new Date(bars[0].date)).toISOString(),
    open: bars[0].open,
    high: Math.max(...bars.map((b) => b.high)),
    low: Math.min(...bars.map((b) => b.low)),
    close: bars[bars.length - 1].close,
    volume: bars.reduce((s, b) => s + b.volume, 0),
  };
}

// ── Session VWAP (cumulative from session open) ───────────────────────────────

function sessionVwap(candles1m: HistoricalCandle[], uptoIdx: number): number | null {
  let sumPV = 0, sumV = 0;
  for (let i = 0; i <= uptoIdx; i++) {
    const c = candles1m[i];
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.volume ?? 1;
    sumPV += typical * vol;
    sumV += vol;
  }
  return sumV > 0 ? sumPV / sumV : null;
}

// ── Simplified per-TF recommendation ─────────────────────────────────────────

function tfRec(closes: number[], fast: number, slow: number): "LONG" | "SHORT" | "NO_TRADE" {
  if (closes.length < slow + 1) return "NO_TRADE";
  const fastSma = closes.slice(-fast).reduce((a, b) => a + b, 0) / fast;
  const slowSma = closes.slice(-slow).reduce((a, b) => a + b, 0) / slow;
  const rsi14 = rsi(closes, 14);
  if (rsi14 === null) return "NO_TRADE";
  const wantLong  = fastSma > slowSma && rsi14 >= 50;
  const wantShort = fastSma < slowSma && rsi14 <= 50;
  return wantLong ? "LONG" : wantShort ? "SHORT" : "NO_TRADE";
}

// ── Session name from IST minute ──────────────────────────────────────────────

function sessionFromMinute(istMin: number): string {
  if (istMin < 555 || istMin >= 930) return "CLOSED";
  if (istMin < 570) return "OPENING_RANGE";
  if (istMin < 660) return "MORNING_MOMENTUM";
  if (istMin < 780) return "MIDDAY_GRIND";
  if (istMin < 870) return "AFTERNOON_TRANSITION";
  if (istMin < 900) return "LATE_TRANSITION_CAUTION";
  return "POST_3PM_REDUCED_RISK";
}

function istMinuteFromCandle(c: HistoricalCandle): number {
  const d = c.date instanceof Date ? c.date : new Date(c.date);
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

// ── Simulate one TP/SL outcome ────────────────────────────────────────────────

function simulateOutcome(
  candles1m: HistoricalCandle[],
  entryIdx: number,          // index of the entry candle (signal+1, to avoid look-ahead)
  direction: "LONG" | "SHORT",
  entryPrice: number,
  targetPrice: number,
  stopPrice: number,
): { outcome: "TARGET_HIT" | "STOP_HIT" | "EXPIRED"; outcomePrice: number; pnlPoints: number; mfePoints: number; bars: number } {
  let mfePoints = 0;

  for (let j = entryIdx; j < candles1m.length; j++) {
    const c = candles1m[j];
    const bars = j - entryIdx + 1;

    // MFE tracking
    if (direction === "LONG") {
      mfePoints = Math.max(mfePoints, c.high - entryPrice);
    } else {
      mfePoints = Math.max(mfePoints, entryPrice - c.low);
    }

    // Check session end
    const istMin = istMinuteFromCandle(c);
    const endOfSession = istMin >= 915; // 15:15 IST — force exit before close

    if (direction === "LONG") {
      if (c.high >= targetPrice) {
        return { outcome: "TARGET_HIT", outcomePrice: targetPrice, pnlPoints: targetPrice - entryPrice, mfePoints, bars };
      }
      if (c.low <= stopPrice || endOfSession) {
        const exitPx = endOfSession && c.low > stopPrice ? c.close : stopPrice;
        return { outcome: endOfSession ? "EXPIRED" : "STOP_HIT", outcomePrice: exitPx, pnlPoints: exitPx - entryPrice, mfePoints, bars };
      }
    } else {
      if (c.low <= targetPrice) {
        return { outcome: "TARGET_HIT", outcomePrice: targetPrice, pnlPoints: entryPrice - targetPrice, mfePoints, bars };
      }
      if (c.high >= stopPrice || endOfSession) {
        const exitPx = endOfSession && c.high < stopPrice ? c.close : stopPrice;
        return { outcome: endOfSession ? "EXPIRED" : "STOP_HIT", outcomePrice: exitPx, pnlPoints: entryPrice - exitPx, mfePoints, bars };
      }
    }
  }

  const lastC = candles1m[candles1m.length - 1];
  const exitPx = lastC.close;
  const pnl = direction === "LONG" ? exitPx - entryPrice : entryPrice - exitPx;
  return { outcome: "EXPIRED", outcomePrice: exitPx, pnlPoints: pnl, mfePoints, bars: candles1m.length - entryIdx };
}

// ── Replay a single trading day ───────────────────────────────────────────────

function replayDay(
  date: string,
  candles1m: HistoricalCandle[],
  params: { tpPct: number; slPct: number; fast: number; slow: number; debounceMin: number },
): SimTrade[] {
  const { tpPct, slPct, fast, slow, debounceMin } = params;
  const results: SimTrade[] = [];

  // Opening range (9:15–9:30): first 15 minutes of 1m candles
  const orBars = candles1m.filter((c) => {
    const m = istMinuteFromCandle(c);
    return m >= 555 && m < 570;
  });
  const orHigh = orBars.length ? Math.max(...orBars.map((b) => b.high)) : null;
  const orLow  = orBars.length ? Math.min(...orBars.map((b) => b.low))  : null;

  // Running close arrays per TF (built as we walk 1m bars)
  const closes1m: number[] = [];
  const candles5m: Candle[]  = [];
  const candles15m: Candle[] = [];
  const closes5m: number[]   = [];
  const closes15m: number[]  = [];
  const bars5mBuf: HistoricalCandle[]  = [];
  const bars15mBuf: HistoricalCandle[] = [];

  const GSKIPPED = ["G5_BREADTH", "G6_PCR", "G7_IV_SKEW", "G13_GLOBAL", "G14_DOMESTIC"];

  let lastLong  = -Infinity;
  let lastShort = -Infinity;
  const debounceMs = debounceMin * 60_000;

  for (let i = 0; i < candles1m.length; i++) {
    const c1m = candles1m[i];
    const candleTs = (c1m.date instanceof Date ? c1m.date : new Date(c1m.date)).getTime();
    closes1m.push(c1m.close);
    bars5mBuf.push(c1m);
    bars15mBuf.push(c1m);

    // Aggregate 5m candle every 5 bars
    if (bars5mBuf.length === 5) {
      const c5 = agg(bars5mBuf)!;
      candles5m.push(c5);
      closes5m.push(c5.close);
      bars5mBuf.length = 0;
    }

    // Aggregate 15m candle every 15 bars
    if (bars15mBuf.length === 15) {
      const c15 = agg(bars15mBuf)!;
      candles15m.push(c15);
      closes15m.push(c15.close);
      bars15mBuf.length = 0;
    }

    // Only evaluate at each 5m boundary (or when 5m candle was just closed)
    if ((i + 1) % 5 !== 0) continue;
    if (closes5m.length < 2) continue;   // need at least 2 complete 5m bars

    const istMin  = istMinuteFromCandle(c1m);
    const session = sessionFromMinute(istMin);

    // Compute indicators
    const rsi1m  = rsi(closes1m, 14);
    const rsi5   = rsi(closes5m, 14);
    const rsi15  = rsi(closes15m, 14);
    const bb5    = bollingerBands(closes5m, 20, 2);
    const bb15   = bollingerBands(closes15m, 20, 2);
    const ema9_5 = ema(closes5m, 9);
    const vwapNow = sessionVwap(candles1m, i);
    const ts15   = candles15m.length >= 10 ? trendStructure(candles15m, 5) : null;

    const refPx = c1m.close;

    // TF recommendations
    const rec1 = tfRec(closes1m, fast, slow);
    const rec5 = tfRec(closes5m, fast, slow);
    const rec15= closes15m.length >= slow ? tfRec(closes15m, fast, slow) : "NO_TRADE";

    // Lifecycle (zeroed breadth — approximation for backtest)
    const lc = computeLifecycle({
      s1rec: rec1, s1conf: 0.6, s1rsi: rsi1m,
      s5rec: rec5, s5conf: 0.6, s5rsi: rsi5,
      s15rec: rec15, s15conf: 0.6, s15rsi: rsi15,
      weightedMovePct: 0, advancers: 25, decliners: 25,
      buySellImbalance: 0, spartanUp: 0, spartanDn: 0,
      surfingUp: 0, surfingDn: 0,
      pcr: null, vix: null, impliedMovePct: null,
      cePremium: null, pePremium: null, tpPct, slPct,
    });

    for (const dir of ["LONG", "SHORT"] as const) {
      const lastFired = dir === "LONG" ? lastLong : lastShort;
      if (candleTs - lastFired < debounceMs) continue;

      // ── Gate 0: session window ───────────────────────────────────────────
      const blockedSessions = ["CLOSED", "OPENING_RANGE", "LATE_TRANSITION_CAUTION", "POST_3PM_REDUCED_RISK"];
      if (blockedSessions.includes(session)) continue;

      // ── Gate 1: lifecycle state ──────────────────────────────────────────
      const validStates = dir === "LONG"
        ? ["CLEAN_BULLISH_FLOW", "CE_EDGE"]
        : ["CLEAN_BEARISH_FLOW", "PE_EDGE"];
      if (!validStates.includes(lc.state)) continue;

      // ── Gate 2: TF agreement (≥2 of 3) ──────────────────────────────────
      const tfRecs = [rec1, rec5, rec15];
      const tfAgree = tfRecs.filter((r) => r === dir).length;
      if (tfAgree < 2) continue;

      // ── Gate 3: RSI 5m and 15m ───────────────────────────────────────────
      const rsiOk = dir === "LONG"
        ? (rsi5 !== null && rsi5 >= 50 && (rsi15 === null || rsi15 >= 48))
        : (rsi5 !== null && rsi5 <= 50 && (rsi15 === null || rsi15 <= 52));
      if (!rsiOk) continue;

      // ── Gate 4: BB %B ────────────────────────────────────────────────────
      const bbOk = dir === "LONG"
        ? ((bb5 && bb5.pctB > 0.45 && bb5.pctB < 0.88) || (bb15 && bb15.pctB > 0.45 && bb15.pctB < 0.88))
        : ((bb5 && bb5.pctB < 0.55 && bb5.pctB > 0.12) || (bb15 && bb15.pctB < 0.55 && bb15.pctB > 0.12));
      if (!bbOk) continue;

      // G5 / G6 / G7 — SKIPPED (live data only)

      // ── Gate 8: RSI not overextended ─────────────────────────────────────
      const rsiExtOk = dir === "LONG"
        ? (rsi5 === null || rsi5 <= 68) && (rsi15 === null || rsi15 <= 65)
        : (rsi5 === null || rsi5 >= 32) && (rsi15 === null || rsi15 >= 35);
      if (!rsiExtOk) continue;

      // ── Gate 9: VWAP side ────────────────────────────────────────────────
      if (vwapNow !== null) {
        const vwapOk = dir === "LONG" ? refPx > vwapNow : refPx < vwapNow;
        if (!vwapOk) continue;
      }

      // ── Gate 10: 15m trend structure ─────────────────────────────────────
      if (ts15 !== null && ts15 !== "NA") {
        if (ts15 === "RANGING") continue;
        const trendOk = dir === "LONG" ? ts15 === "UPTREND" : ts15 === "DOWNTREND";
        if (!trendOk) continue;
      }

      // ── Gate 11: Opening Range bias ──────────────────────────────────────
      if (orHigh !== null && orLow !== null) {
        const orOk = dir === "LONG" ? refPx > orHigh : refPx < orLow;
        if (!orOk) continue;
      }

      // ── Gate 12: No chase ─────────────────────────────────────────────────
      if (ema9_5 !== null && ema9_5 > 0) {
        const distPct = ((refPx - ema9_5) / ema9_5) * 100;
        const chaseOk = dir === "LONG" ? distPct <= 0.30 : distPct >= -0.30;
        if (!chaseOk) continue;
      }

      // G13 / G14 — SKIPPED

      // ── All checked gates passed — simulate trade ─────────────────────────
      const entryBar = i + 1; // enter on next 1m bar open
      if (entryBar >= candles1m.length) continue;

      const entryPrice = candles1m[entryBar].open;
      const targetPrice = dir === "LONG"
        ? entryPrice * (1 + tpPct / 100)
        : entryPrice * (1 - tpPct / 100);
      const stopPrice = dir === "LONG"
        ? entryPrice * (1 - slPct / 100)
        : entryPrice * (1 + slPct / 100);

      const sim = simulateOutcome(candles1m, entryBar, dir, entryPrice, targetPrice, stopPrice);

      const tradeTs = candles1m[entryBar].date instanceof Date
        ? candles1m[entryBar].date
        : new Date(candles1m[entryBar].date);

      results.push({
        date,
        time: toIstHHMM(tradeTs),
        direction: dir,
        session,
        lifecycle: lc.state,
        tfAgree,
        rsi5m: rsi5 !== null ? +rsi5.toFixed(1) : null,
        rsi15m: rsi15 !== null ? +rsi15.toFixed(1) : null,
        entryPrice: +entryPrice.toFixed(2),
        targetPrice: +targetPrice.toFixed(2),
        stopPrice: +stopPrice.toFixed(2),
        outcome: sim.outcome,
        pnlPoints: +sim.pnlPoints.toFixed(2),
        mfePoints: +sim.mfePoints.toFixed(2),
        barsToOutcome: sim.bars,
        gatesSkipped: GSKIPPED,
      });

      if (dir === "LONG") lastLong = candleTs;
      else lastShort = candleTs;

      break; // one prediction per 5m bar (first direction that passes)
    }
  }

  return results;
}

// ── P&L summary ───────────────────────────────────────────────────────────────

function summarize(trades: SimTrade[]) {
  const resolved  = trades.filter((t) => t.outcome !== "EXPIRED" || t.pnlPoints !== 0);
  const hits   = trades.filter((t) => t.outcome === "TARGET_HIT").length;
  const stops  = trades.filter((t) => t.outcome === "STOP_HIT").length;
  const expired= trades.filter((t) => t.outcome === "EXPIRED").length;
  const resolved2 = hits + stops;
  const winRate = resolved2 > 0 ? hits / resolved2 : null;
  const netPnl  = trades.reduce((s, t) => s + t.pnlPoints, 0);
  const avgPnlPerTrade = trades.length ? netPnl / trades.length : 0;

  let peakPnl = 0, runningPnl = 0, maxDd = 0;
  for (const t of trades) {
    runningPnl += t.pnlPoints;
    peakPnl = Math.max(peakPnl, runningPnl);
    maxDd = Math.max(maxDd, peakPnl - runningPnl);
  }

  const longTrades  = trades.filter((t) => t.direction === "LONG");
  const shortTrades = trades.filter((t) => t.direction === "SHORT");
  const longHits    = longTrades.filter((t) => t.outcome === "TARGET_HIT").length;
  const shortHits   = shortTrades.filter((t) => t.outcome === "TARGET_HIT").length;
  const longRes     = longTrades.filter((t) => t.outcome !== "EXPIRED").length;
  const shortRes    = shortTrades.filter((t) => t.outcome !== "EXPIRED").length;

  return {
    total: trades.length,
    hits, stops, expired,
    winRate: winRate !== null ? +(winRate * 100).toFixed(1) : null,
    netPnlPts: +netPnl.toFixed(2),
    avgPnlPts: +avgPnlPerTrade.toFixed(2),
    maxDrawdownPts: +maxDd.toFixed(2),
    long:  { trades: longTrades.length,  wins: longHits,  winRate: longRes  > 0 ? +(longHits /longRes  * 100).toFixed(1) : null },
    short: { trades: shortTrades.length, wins: shortHits, winRate: shortRes > 0 ? +(shortHits/shortRes * 100).toFixed(1) : null },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Parse args
  const fromArg = getArgValue("--from") ?? getArgValue("--date");
  const toArg   = getArgValue("--to")   ?? fromArg;

  if (!fromArg) {
    console.error(
      "Usage: npm run backtest:signal -- --from YYYY-MM-DD [--to YYYY-MM-DD] [--tp 0.35] [--sl 0.20] [--fast 9] [--slow 21] [--out results.json]"
    );
    process.exit(1);
  }

  const istTodayStr = toIstYmd(new Date());
  const fromStr = fromArg === "today" ? istTodayStr
    : fromArg === "yesterday" ? toIstYmd(new Date(Date.now() - 86_400_000)) : fromArg;
  const toStr   = (toArg === "today" || toArg === fromArg && fromArg === "today") ? istTodayStr
    : toArg === "yesterday" ? toIstYmd(new Date(Date.now() - 86_400_000)) : (toArg ?? fromStr);

  const tpPct       = Number(getArgValue("--tp")          ?? "0.35");
  const slPct       = Number(getArgValue("--sl")          ?? "0.20");
  const fast        = Number(getArgValue("--fast")        ?? "9");
  const slow        = Number(getArgValue("--slow")        ?? "21");
  const debounceMin = Number(getArgValue("--debounce")    ?? "20");
  const underlying  = getArgValue("--underlying")         ?? "NIFTY";
  const outFile     = getArgValue("--out");
  const verbose     = hasFlag("--verbose") || hasFlag("-v");

  console.error(`[backtest-signal] ${fromStr} → ${toStr} | TP ${tpPct}% SL ${slPct}% | Fast ${fast} Slow ${slow}`);
  console.error(`[backtest-signal] Note: G5 (breadth), G6 (PCR), G7 (IV), G13, G14 skipped — candle data only`);

  // Resolve NIFTY FUT instrument token
  const futKey = await pickNearExpiryNiftyFutureKey(underlying);
  const [, tradingsymbol] = futKey.split(":");
  const nfo = await getInstruments("NFO");
  const inst = nfo.find(
    (i) => (i.exchange ?? "").toUpperCase() === "NFO" && i.tradingsymbol === tradingsymbol,
  );
  if (!inst?.instrument_token) {
    throw new Error(`Could not resolve instrument_token for ${futKey}. Run sync:instruments first.`);
  }
  const token = Number(inst.instrument_token);
  console.error(`[backtest-signal] Instrument: ${futKey} (token ${token})`);

  const dates = dateRange(fromStr, toStr);
  const allTrades: SimTrade[] = [];

  for (const date of dates) {
    const dayDate = parseIstYmd(date);
    const { from, to } = niftySessionRangeForIstDay(dayDate);

    let candles1m: HistoricalCandle[];
    try {
      candles1m = await getHistorical(token, from, to, "minute");
    } catch (e) {
      console.error(`[backtest-signal] ${date}: fetch error — ${e}`);
      continue;
    }

    if (candles1m.length < 30) {
      console.error(`[backtest-signal] ${date}: skipped (${candles1m.length} candles — likely holiday)`);
      continue;
    }

    const dayTrades = replayDay(date, candles1m, { tpPct, slPct, fast, slow, debounceMin });
    allTrades.push(...dayTrades);

    const dayHits  = dayTrades.filter((t) => t.outcome === "TARGET_HIT").length;
    const dayStops = dayTrades.filter((t) => t.outcome === "STOP_HIT").length;
    const dayPnl   = dayTrades.reduce((s, t) => s + t.pnlPoints, 0);
    console.error(
      `[backtest-signal] ${date}: ${dayTrades.length} trades | ${dayHits}W ${dayStops}L | P&L ${dayPnl >= 0 ? "+" : ""}${dayPnl.toFixed(1)} pts`,
    );
  }

  const summary = summarize(allTrades);

  // ── Console output ────────────────────────────────────────────────────────

  console.log("\n═══════════════════════════ BACKTEST RESULTS ════════════════════════════");
  console.log(`Period:           ${fromStr} → ${toStr}`);
  console.log(`Instrument:       ${futKey}`);
  console.log(`Gates evaluated:  G0 G1 G2 G3 G4 G8 G9 G10 G11 G12`);
  console.log(`Gates skipped:    G5 G6 G7 G13 G14 (require live data)`);
  console.log(`TP/SL:            ${tpPct}% / ${slPct}%   Debounce: ${debounceMin} min`);
  console.log("─────────────────────────────────────────────────────────────────────────");
  console.log(`Total trades:     ${summary.total}  (${summary.hits} wins · ${summary.stops} stops · ${summary.expired} expired)`);
  console.log(`Win rate:         ${summary.winRate !== null ? summary.winRate + "%" : "–"}`);
  console.log(`Net P&L:          ${summary.netPnlPts >= 0 ? "+" : ""}${summary.netPnlPts} pts`);
  console.log(`Avg P&L/trade:    ${summary.avgPnlPts >= 0 ? "+" : ""}${summary.avgPnlPts} pts`);
  console.log(`Max drawdown:     ${summary.maxDrawdownPts} pts`);
  console.log(`LONG:             ${summary.long.trades} trades · ${summary.long.winRate ?? "–"}% win rate`);
  console.log(`SHORT:            ${summary.short.trades} trades · ${summary.short.winRate ?? "–"}% win rate`);
  console.log("─────────────────────────────────────────────────────────────────────────");

  if (verbose && allTrades.length > 0) {
    console.log("\nTrade log:");
    console.table(
      allTrades.map((t) => ({
        date: t.date,
        time: t.time,
        dir: t.direction,
        session: t.session.replace(/_/g, " "),
        lc: t.lifecycle.replace(/_/g, " "),
        tf: t.tfAgree,
        rsi5: t.rsi5m ?? "–",
        entry: t.entryPrice,
        tp: t.targetPrice,
        sl: t.stopPrice,
        outcome: t.outcome,
        pnl: t.pnlPoints,
        mfe: t.mfePoints,
        bars: t.barsToOutcome,
      })),
    );
  }

  if (outFile) {
    const payload = {
      meta: { from: fromStr, to: toStr, futKey, tpPct, slPct, fast, slow, debounceMin, generatedAt: new Date().toISOString() },
      summary,
      trades: allTrades,
    };
    await fs.mkdir(path.dirname(outFile), { recursive: true }).catch(() => {});
    await fs.writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");
    console.log(`\nResults saved to: ${outFile}`);
  }
}

main().catch((err) => {
  console.error("[backtest-signal] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
