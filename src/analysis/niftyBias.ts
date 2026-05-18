import type { KiteInstrument } from "../instruments/instrumentsCache";
import { getInstruments } from "../instruments/instrumentsCache";
import { searchNfoFo } from "../instruments/foSearch";
import { getHistorical, getQuote } from "../kite/marketData";
import { env } from "../config/env";
import { readSnapshots, upsertSnapshot, writeSnapshots } from "../storage/snapshots";

export type MarketBias = "BULLISH" | "BEARISH" | "SIDEWAYS";
export type TrendType = "TRENDING" | "REVERSAL" | "RANGE";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type BiasOutput = {
  market_bias: MarketBias;
  confidence_score: number;
  trend_type: TrendType;
  key_signals: string[];
  risk_level: RiskLevel;
  suggested_strategy: "BUY CALL" | "BUY PUT" | "WAIT" | "SELL OPTION (advanced)";
  reasoning: string;
};

export type AnalyzeInput = {
  spotKey: string; // e.g. "NSE:NIFTY 50"
  futKey: string; // e.g. "NFO:NIFTY26MARFUT"
  underlying: string; // e.g. "NIFTY"
  expiry: string; // YYYY-MM-DD
  strikesAroundAtm: number; // e.g. 10
  snapshotPath?: string;
  vixKey?: string; // optional, e.g. "NSE:INDIA VIX"
  newsSentiment?: "bullish" | "bearish" | "neutral";
  globalCue?: "risk-on" | "risk-off" | "mixed";
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function pctChange(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return 0;
  return ((b - a) / a) * 100;
}

function pickNearestStrike(spot: number, step = 50): number {
  return Math.round(spot / step) * step;
}

function computeImbalance(depth?: { buy: Array<{ quantity: number }>; sell: Array<{ quantity: number }> }): number | null {
  if (!depth) return null;
  const bidQty = depth.buy?.reduce((s, l) => s + (l.quantity ?? 0), 0) ?? 0;
  const askQty = depth.sell?.reduce((s, l) => s + (l.quantity ?? 0), 0) ?? 0;
  const denom = bidQty + askQty;
  if (denom === 0) return null;
  return (bidQty - askQty) / denom;
}

function levelsFromRecent(candles: Array<{ high: number; low: number; close: number }>): { support: number; resistance: number } | null {
  if (candles.length < 10) return null;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  return { support, resistance };
}

async function instrumentTokenFromKey(key: string): Promise<number | null> {
  // Use cached instruments to resolve instrument_token.
  const [exchange, symbol] = key.split(":");
  if (!exchange || !symbol) return null;

  // NFO token from NFO cache; NSE token from NSE cache.
  const ex = exchange.toUpperCase();
  const instruments = await getInstruments(ex === "NFO" ? "NFO" : "NSE");
  const match = instruments.find((i) => (i.exchange ?? "").toUpperCase() === ex && i.tradingsymbol === symbol);
  return match?.instrument_token ?? null;
}

export async function analyzeNiftyBias(input: AnalyzeInput): Promise<BiasOutput> {
  const snapshotPath = input.snapshotPath ?? env.KITE_SNAPSHOTS_PATH;
  const snapshots = await readSnapshots(snapshotPath);

  const selectedInfoSignals: string[] = [`Using futures: ${input.futKey}`, `Using option expiry: ${input.expiry}`];

  const keys: string[] = [input.spotKey, input.futKey];
  if (input.vixKey) keys.push(input.vixKey);

  // Quotes: spot, futures, optional VIX
  const quotes = await getQuote(keys);
  const spotQ = quotes[input.spotKey];
  const futQ = quotes[input.futKey];
  const vixQ = input.vixKey ? quotes[input.vixKey] : undefined;

  if (!spotQ?.last_price || !futQ?.last_price) {
    throw new Error("Missing spot/futures quote. Check keys like NSE:NIFTY 50 and NFO:<FUT>.");
  }

  const spot = Number(spotQ.last_price);
  const fut = Number(futQ.last_price);
  const futVwap = futQ.average_price;

  // Derivatives: build a small option chain around ATM.
  const atmStrike = pickNearestStrike(spot, 50);
  const strikes: number[] = [];
  for (let k = -input.strikesAroundAtm; k <= input.strikesAroundAtm; k++) {
    strikes.push(atmStrike + k * 50);
  }

  const nfo = await getInstruments("NFO");
  const chain = nfo
    .filter((i) => (i.exchange ?? "").toUpperCase() === "NFO")
    .filter((i) => (i.name ?? "").toUpperCase() === input.underlying.toUpperCase())
    .filter((i) => {
      const exp = typeof i.expiry === "string" ? i.expiry.slice(0, 10) : i.expiry instanceof Date ? i.expiry.toISOString().slice(0, 10) : "";
      return exp === input.expiry;
    })
    .filter((i) => (i.instrument_type === "CE" || i.instrument_type === "PE") && strikes.includes(Number(i.strike)));

  const optionKeys = chain.map((i) => `NFO:${i.tradingsymbol}`);
  const optionQuotes = optionKeys.length ? await getQuote(optionKeys) : {};

  const callOi = chain
    .filter((i) => i.instrument_type === "CE")
    .reduce((s, i) => s + (optionQuotes[`NFO:${i.tradingsymbol}`]?.oi ?? 0), 0);

  const putOi = chain
    .filter((i) => i.instrument_type === "PE")
    .reduce((s, i) => s + (optionQuotes[`NFO:${i.tradingsymbol}`]?.oi ?? 0), 0);

  const pcr = callOi > 0 ? putOi / callOi : null;

  const atmCe = chain.find((i) => i.instrument_type === "CE" && Number(i.strike) === atmStrike);
  const atmPe = chain.find((i) => i.instrument_type === "PE" && Number(i.strike) === atmStrike);
  const atmCeLtp = atmCe ? optionQuotes[`NFO:${atmCe.tradingsymbol}`]?.last_price : null;
  const atmPeLtp = atmPe ? optionQuotes[`NFO:${atmPe.tradingsymbol}`]?.last_price : null;
  const atmStraddle = atmCeLtp && atmPeLtp ? Number(atmCeLtp) + Number(atmPeLtp) : null;

  // Microstructure
  const futImb = computeImbalance(futQ.depth);

  // Trends (1m/5m/15m) via futures token to avoid index data limitations.
  const futToken = await instrumentTokenFromKey(input.futKey);
  const trendSignals: string[] = [];
  let trendVote: number = 0;

  async function trendFor(interval: "minute" | "5minute" | "15minute", lookbackMinutes: number) {
    if (!futToken) return;
    const to = new Date();
    const from = new Date(to.getTime() - lookbackMinutes * 60_000);
    const candles = await getHistorical(futToken, from, to, interval);
    if (!candles || candles.length < 5) return;
    const first = candles[0].close;
    const last = candles[candles.length - 1].close;
    const chg = pctChange(first, last);
    if (chg > 0.15) {
      trendSignals.push(`${interval} trend up (${chg.toFixed(2)}%)`);
      trendVote += 1;
    } else if (chg < -0.15) {
      trendSignals.push(`${interval} trend down (${chg.toFixed(2)}%)`);
      trendVote -= 1;
    } else {
      trendSignals.push(`${interval} trend flat (${chg.toFixed(2)}%)`);
    }

    if (interval === "15minute") {
      const lv = levelsFromRecent(candles.slice(-20));
      if (lv) {
        trendSignals.push(`Recent support ~ ${lv.support.toFixed(0)}, resistance ~ ${lv.resistance.toFixed(0)}`);
      }
    }
  }

  await trendFor("minute", 45);
  await trendFor("5minute", 240);
  await trendFor("15minute", 3 * 24 * 60);

  // OI change inference using snapshots
  const prevFut = snapshots[input.futKey];
  const futOi = futQ.oi ?? null;
  const futOiChg = prevFut?.oi !== undefined && futOi !== null ? futOi - prevFut.oi! : null;
  const futPxChg = prevFut?.last_price !== undefined ? fut - prevFut.last_price! : null;

  const buildupSignals: string[] = [];
  if (futOiChg !== null && futPxChg !== null) {
    if (futPxChg > 0 && futOiChg > 0) buildupSignals.push("Long build-up indicated (Fut price up + OI up)");
    else if (futPxChg < 0 && futOiChg > 0) buildupSignals.push("Short build-up indicated (Fut price down + OI up)");
    else if (futPxChg > 0 && futOiChg < 0) buildupSignals.push("Short covering indicated (Fut price up + OI down)");
    else if (futPxChg < 0 && futOiChg < 0) buildupSignals.push("Long unwinding indicated (Fut price down + OI down)");
  }

  // Key signals & conservative bias logic (need >=3 aligned factors)
  const keySignals: string[] = [];
  keySignals.push(...selectedInfoSignals);

  // VWAP position
  if (Number.isFinite(futVwap ?? NaN)) {
    if (fut > (futVwap as number)) keySignals.push("Futures trading above VWAP");
    else keySignals.push("Futures trading below VWAP");
  }

  if (pcr !== null) keySignals.push(`PCR (selected strikes) = ${pcr.toFixed(2)}`);
  if (atmStraddle !== null) keySignals.push(`ATM straddle premium ~ ${atmStraddle.toFixed(1)}`);
  if (futImb !== null) keySignals.push(`Bid/ask imbalance (futures depth) = ${futImb.toFixed(2)}`);
  keySignals.push(...trendSignals);
  keySignals.push(...buildupSignals);

  // Optional sentiment inputs
  if (input.newsSentiment) keySignals.push(`News sentiment input: ${input.newsSentiment}`);
  if (input.globalCue) keySignals.push(`Global cue input: ${input.globalCue}`);
  if (vixQ?.last_price) keySignals.push(`VIX LTP = ${Number(vixQ.last_price).toFixed(2)}`);

  // Votes
  let bull = 0;
  let bear = 0;

  // Trend vote
  if (trendVote >= 2) bull += 1;
  if (trendVote <= -2) bear += 1;

  // VWAP
  if (Number.isFinite(futVwap ?? NaN)) {
    if (fut > (futVwap as number)) bull += 1;
    else bear += 1;
  }

  // OI build-up
  for (const s of buildupSignals) {
    if (s.startsWith("Long build-up") || s.startsWith("Short covering")) bull += 1;
    if (s.startsWith("Short build-up") || s.startsWith("Long unwinding")) bear += 1;
  }

  // PCR heuristic (very rough)
  if (pcr !== null) {
    if (pcr > 1.1) bull += 1;
    else if (pcr < 0.9) bear += 1;
  }

  // Microstructure
  if (futImb !== null) {
    if (futImb > 0.15) bull += 1;
    else if (futImb < -0.15) bear += 1;
  }

  // Optional cues
  if (input.newsSentiment === "bullish") bull += 1;
  if (input.newsSentiment === "bearish") bear += 1;
  if (input.globalCue === "risk-on") bull += 1;
  if (input.globalCue === "risk-off") bear += 1;

  const aligned = Math.max(bull, bear);
  const conflicting = Math.min(bull, bear);

  let market_bias: MarketBias = "SIDEWAYS";
  if (aligned >= 3 && conflicting <= 1) {
    market_bias = bull > bear ? "BULLISH" : "BEARISH";
  }

  let confidence = 40 + aligned * 10 - conflicting * 12;

  // Penalize missing key derivatives fields
  if (optionKeys.length === 0) confidence -= 15;
  if (futQ.oi === undefined) confidence -= 15;

  confidence = clamp(confidence, 0, 100);

  let trend_type: TrendType = "RANGE";
  if (market_bias !== "SIDEWAYS" && Math.abs(trendVote) >= 2) trend_type = "TRENDING";
  if (market_bias === "SIDEWAYS" && conflicting >= 2) trend_type = "REVERSAL";

  let risk_level: RiskLevel = confidence >= 70 ? "LOW" : confidence >= 45 ? "MEDIUM" : "HIGH";
  if (input.vixKey && vixQ?.last_price && Number(vixQ.last_price) > 20) risk_level = "HIGH";

  const suggested_strategy =
    market_bias === "SIDEWAYS" || confidence < 55
      ? "WAIT"
      : market_bias === "BULLISH"
        ? "BUY CALL"
        : "BUY PUT";

  const reasoningParts: string[] = [];
  reasoningParts.push(`Spot ${spot.toFixed(1)}, Futures ${fut.toFixed(1)}.`);
  if (futVwap) reasoningParts.push(`Futures vs VWAP: ${fut > futVwap ? "above" : "below"}.`);
  if (pcr !== null) reasoningParts.push(`PCR computed from selected strikes around ATM ${atmStrike}.`);
  if (buildupSignals.length) reasoningParts.push(`OI/price delta inference: ${buildupSignals.join("; ")}.`);
  if (futImb !== null) reasoningParts.push(`Depth imbalance included as microstructure signal.`);
  reasoningParts.push(`Bias requires >=3 aligned factors; otherwise returns SIDEWAYS conservatively.`);

  // Update snapshots for next run
  const nextDb = upsertSnapshot(snapshots, input.futKey, {
    time: new Date().toISOString(),
    last_price: fut,
    oi: futQ.oi,
    average_price: futQ.average_price,
  });
  await writeSnapshots(nextDb, snapshotPath);

  return {
    market_bias,
    confidence_score: Math.round(confidence),
    trend_type,
    key_signals: keySignals.slice(0, 12),
    risk_level,
    suggested_strategy,
    reasoning: reasoningParts.join(" "),
  };
}
