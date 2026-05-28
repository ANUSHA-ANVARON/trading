import { getArgValue, hasFlag } from "./_args";
import type { WeightRow as WeightRowFile } from "../analysis/nifty50Breadth";
import { loadWeights } from "../analysis/nifty50Breadth";
import { analyzeBreadthFromTicks } from "../analysis/breadthFromTicks";
import { equalWeightsForNifty50 } from "../analysis/weightsFallback";
import { pickNearExpiryNiftyFutureKey } from "../analysis/defaults";
import { pickNearestWeeklyNiftyOptionExpiry } from "../analysis/defaults";
import { sma, rsi, atr, bollingerBands } from "../analysis/indicators";
import { CandleAggregator } from "../live/candleAggregator";
import { getInstruments } from "../instruments/instrumentsCache";
import { createKiteTicker } from "../kite/ticker";
import { getHistorical } from "../kite/marketData";
import { computeNewsContext } from "../news/newsContext";
import type { NewsContext, NewsRiskLevel } from "../news/types";
import { impliedVolAndGreeks } from "../analysis/greeks";
import { createSmaCrossStrategy } from "../strategies/smaCross";
import { runBacktest } from "../backtest/engine";
import { computeTradeStats } from "../backtest/tradeStats";
import type { Candle } from "../core/types";
import { TelegramNotifier } from "../notify/telegram";
import { computePivotLevels, type PivotLevelsOutput } from "../analysis/pivotLevels";
import { computeLifecycle, type LifecycleOutput } from "../analysis/lifecycle";

type WithToken = { key: string; weight: number; token: number };

type Tick = {
  instrument_token?: number;
  last_price?: number;
  ohlc?: { close?: number; open?: number };
  buy_quantity?: number;
  sell_quantity?: number;
  oi?: number;
  volume?: number;
  depth?: { buy?: Array<{ quantity?: number; price?: number }>; sell?: Array<{ quantity?: number; price?: number }> };
  exchange_timestamp?: Date;
  timestamp?: Date;
};

type StockSignal = {
  key: string; // e.g. NSE:RELIANCE
  symbol: string; // e.g. RELIANCE
  pctChange: number | null;
  dir: "UP" | "DOWN" | "FLAT";
  action: "BUY" | "SELL" | "HOLD";
  mode: "SPARTAN" | "SURF";
  label: "SPARTAN_UP" | "SPARTAN_DN" | "SPARTAN_FLAT" | "SURFINGUP" | "SURFINGDN" | "SURFINGFLAT";
  turnoverCr_1m: number | null;
};

type StockLogRow = {
  asof: string;
  key: string;
  symbol: string;
  label: StockSignal["label"];
  action: StockSignal["action"];
  pctChange: number | null;
  turnoverCr_1m: number | null;
};

type StockSignalHistoryEntry = {
  key: string;
  symbol: string;
  lastBuy: string | null;
  lastSell: string | null;
  lastSpartanUp: string | null;
  lastSpartanDn: string | null;
  lastSurfingUp: string | null;
  lastSurfingDn: string | null;
};

type OptionSelection = {
  expiry: string;
  atmStrike: number;
  ce: { key: string; token: number; tradingsymbol: string; lotSize: number };
  pe: { key: string; token: number; tradingsymbol: string; lotSize: number };
};

type ResolvedOption = { key: string; token: number; tradingsymbol: string; lotSize: number; strike: number; type: "CE" | "PE" };

type ChainStrike = {
  strike: number;
  ce: ResolvedOption;
  pe: ResolvedOption;
};

type CreditSpread = {
  kind: "PUT_CREDIT" | "CALL_CREDIT";
  width: number;
  legs: {
    sell: { instrument: string; strike: number; premium: number | null; quantity: number };
    buy: { instrument: string; strike: number; premium: number | null; quantity: number };
  };
  netCredit: number | null;
  maxProfit: number | null;
  maxLoss: number | null;
  breakeven: number | null;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function pctChange(prev: number, last: number): number {
  if (!Number.isFinite(prev) || prev === 0) return 0;
  return ((last - prev) / prev) * 100;
}

function nearestStrike(price: number, step = 50): number {
  if (!Number.isFinite(price) || step <= 0) return 0;
  return Math.round(price / step) * step;
}

function roundToStep(n: number, step: number): number {
  if (!Number.isFinite(n) || step <= 0) return 0;
  return Math.round(n / step) * step;
}

async function resolveNseUniverse(weightsPath: string | null): Promise<WithToken[]> {
  let weights: WeightRowFile[];
  if (!weightsPath) {
    weights = equalWeightsForNifty50();
  } else {
    try {
      weights = await loadWeights(weightsPath);
    } catch {
      weights = equalWeightsForNifty50();
    }

    if (weights.length < 30) {
      // eslint-disable-next-line no-console
      console.error(`Weights file has only ${weights.length} rows; falling back to equal-weight NIFTY50 universe.`);
      weights = equalWeightsForNifty50();
    }
  }

  function resolveTokens(nse: any[]) {
    const resolved: WithToken[] = [];
    const missing: string[] = [];
    for (const w of weights) {
      const [, symbol] = w.key.split(":");
      const inst = nse.find((i) => (i.exchange ?? "").toUpperCase() === "NSE" && i.tradingsymbol === symbol);
      if (!inst?.instrument_token) {
        missing.push(w.key);
        continue;
      }
      resolved.push({ key: w.key, weight: w.weight, token: Number(inst.instrument_token) });
    }
    return { resolved, missing };
  }

  let nse = await getInstruments("NSE");
  let { resolved, missing } = resolveTokens(nse as any);

  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(`Missing ${missing.length} tokens; refreshing NSE instruments cache.`);
    nse = await getInstruments("NSE", { refresh: true });
    const second = resolveTokens(nse as any);
    resolved = second.resolved;
    missing = second.missing;
  }

  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(`Skipping ${missing.length} unresolvable symbols. First few: ${missing.slice(0, 10).join(", ")}`);
  }

  if (resolved.length < 30) throw new Error(`Resolved only ${resolved.length} NSE symbols; cannot compute breadth reliably.`);
  return resolved;
}

async function resolveNiftyFutureToken(underlying: string): Promise<{ key: string; token: number; tradingsymbol: string }> {
  const futKey = await pickNearExpiryNiftyFutureKey(underlying);
  const [exchange, tradingsymbol] = futKey.split(":");
  const nfo = await getInstruments("NFO");

  let inst = nfo.find((i) => (i.exchange ?? "").toUpperCase() === exchange.toUpperCase() && i.tradingsymbol === tradingsymbol);
  if (!inst?.instrument_token) {
    const refreshed = await getInstruments("NFO", { refresh: true });
    inst = refreshed.find((i) => (i.exchange ?? "").toUpperCase() === exchange.toUpperCase() && i.tradingsymbol === tradingsymbol);
  }

  if (!inst?.instrument_token) throw new Error(`Could not resolve instrument_token for ${futKey}. Run: npm run instruments:sync:nfo`);

  return { key: futKey, token: Number(inst.instrument_token), tradingsymbol };
}

async function resolveAtmOptions(params: {
  underlying: string;
  expiry: string;
  atmStrike: number;
}): Promise<OptionSelection> {
  const nfo = await getInstruments("NFO");
  const exp = params.expiry;
  const strike = params.atmStrike;

  const ceInst = nfo.find(
    (i) =>
      (i.exchange ?? "").toUpperCase() === "NFO" &&
      (i.name ?? "").toUpperCase() === params.underlying.toUpperCase() &&
      (i.instrument_type ?? "").toUpperCase() === "CE" &&
      String(i.expiry ?? "").slice(0, 10) === exp &&
      Number(i.strike) === strike,
  );

  const peInst = nfo.find(
    (i) =>
      (i.exchange ?? "").toUpperCase() === "NFO" &&
      (i.name ?? "").toUpperCase() === params.underlying.toUpperCase() &&
      (i.instrument_type ?? "").toUpperCase() === "PE" &&
      String(i.expiry ?? "").slice(0, 10) === exp &&
      Number(i.strike) === strike,
  );

  // Retry once with refresh (expiries/strikes roll).
  if (!ceInst?.instrument_token || !peInst?.instrument_token) {
    const refreshed = await getInstruments("NFO", { refresh: true });
    const ce2 = refreshed.find(
      (i) =>
        (i.exchange ?? "").toUpperCase() === "NFO" &&
        (i.name ?? "").toUpperCase() === params.underlying.toUpperCase() &&
        (i.instrument_type ?? "").toUpperCase() === "CE" &&
        String(i.expiry ?? "").slice(0, 10) === exp &&
        Number(i.strike) === strike,
    );
    const pe2 = refreshed.find(
      (i) =>
        (i.exchange ?? "").toUpperCase() === "NFO" &&
        (i.name ?? "").toUpperCase() === params.underlying.toUpperCase() &&
        (i.instrument_type ?? "").toUpperCase() === "PE" &&
        String(i.expiry ?? "").slice(0, 10) === exp &&
        Number(i.strike) === strike,
    );

    if (ce2?.instrument_token && pe2?.instrument_token) {
      return {
        expiry: exp,
        atmStrike: strike,
        ce: {
          key: `NFO:${ce2.tradingsymbol}`,
          token: Number(ce2.instrument_token),
          tradingsymbol: ce2.tradingsymbol,
          lotSize: Number(ce2.lot_size ?? 0),
        },
        pe: {
          key: `NFO:${pe2.tradingsymbol}`,
          token: Number(pe2.instrument_token),
          tradingsymbol: pe2.tradingsymbol,
          lotSize: Number(pe2.lot_size ?? 0),
        },
      };
    }
  }

  if (!ceInst?.instrument_token || !peInst?.instrument_token) {
    throw new Error(`Could not resolve ATM options for ${params.underlying} exp=${exp} strike=${strike}. Run: npm run instruments:sync:nfo`);
  }

  return {
    expiry: exp,
    atmStrike: strike,
    ce: {
      key: `NFO:${ceInst.tradingsymbol}`,
      token: Number(ceInst.instrument_token),
      tradingsymbol: ceInst.tradingsymbol,
      lotSize: Number(ceInst.lot_size ?? 0),
    },
    pe: {
      key: `NFO:${peInst.tradingsymbol}`,
      token: Number(peInst.instrument_token),
      tradingsymbol: peInst.tradingsymbol,
      lotSize: Number(peInst.lot_size ?? 0),
    },
  };
}

async function resolveOptionInstrument(params: {
  underlying: string;
  expiry: string;
  strike: number;
  type: "CE" | "PE";
}): Promise<ResolvedOption> {
  const nfo = await getInstruments("NFO");
  const exp = params.expiry;
  const strike = params.strike;
  const type = params.type;

  const findIn = (arr: any[]) =>
    arr.find(
      (i) =>
        (i.exchange ?? "").toUpperCase() === "NFO" &&
        (i.name ?? "").toUpperCase() === params.underlying.toUpperCase() &&
        (i.instrument_type ?? "").toUpperCase() === type &&
        String(i.expiry ?? "").slice(0, 10) === exp &&
        Number(i.strike) === strike,
    );

  let inst = findIn(nfo as any);
  if (!inst?.instrument_token) {
    const refreshed = await getInstruments("NFO", { refresh: true });
    inst = findIn(refreshed as any);
  }

  if (!inst?.instrument_token) {
    throw new Error(`Could not resolve option ${params.underlying} ${exp} ${strike} ${type}`);
  }

  return {
    key: `NFO:${inst.tradingsymbol}`,
    token: Number(inst.instrument_token),
    tradingsymbol: inst.tradingsymbol,
    lotSize: Number(inst.lot_size ?? 0),
    strike,
    type,
  };
}

async function resolveIndiaVixToken(): Promise<{ key: string; token: number; tradingsymbol: string } | null> {
  const findIn = (arr: any[]) =>
    arr.find((i) => {
      const ex = String(i.exchange ?? "").toUpperCase();
      if (ex !== "NSE") return false;
      const ts = String(i.tradingsymbol ?? "").toUpperCase();
      const name = String(i.name ?? "").toUpperCase();
      return ts === "INDIA VIX" || ts === "INDIAVIX" || name === "INDIA VIX";
    });

  const nse = await getInstruments("NSE");
  let inst = findIn(nse as any);
  if (!inst?.instrument_token) {
    const refreshed = await getInstruments("NSE", { refresh: true });
    inst = findIn(refreshed as any);
  }
  if (!inst?.instrument_token) return null;
  return { key: `NSE:${inst.tradingsymbol}`, token: Number(inst.instrument_token), tradingsymbol: String(inst.tradingsymbol) };
}

async function resolveUnderlyingSpotIndexToken(
  underlying: string,
): Promise<{ key: string; token: number; tradingsymbol: string } | null> {
  const u = String(underlying ?? "").trim().toUpperCase();
  const candidates: string[] = (() => {
    if (u.includes("BANK")) return ["NIFTY BANK", "BANKNIFTY"];
    if (u.includes("FIN")) return ["NIFTY FIN SERVICE", "FINNIFTY"];
    if (u.includes("MID")) return ["NIFTY MID SELECT", "MIDCPNIFTY"];
    // Default
    return ["NIFTY 50", "NIFTY"];
  })();

  const findIn = (arr: any[]) =>
    arr.find((i) => {
      const ex = String(i.exchange ?? "").toUpperCase();
      if (ex !== "NSE") return false;
      const ts = String(i.tradingsymbol ?? "").toUpperCase();
      const name = String(i.name ?? "").toUpperCase();
      const it = String(i.instrument_type ?? "").toUpperCase();
      const isIndex = it === "INDEX" || ts.includes("NIFTY") || name.includes("NIFTY");
      if (!isIndex) return false;
      return candidates.some((c) => ts === c || name === c);
    });

  const nse = await getInstruments("NSE");
  let inst = findIn(nse as any);
  if (!inst?.instrument_token) {
    const refreshed = await getInstruments("NSE", { refresh: true });
    inst = findIn(refreshed as any);
  }
  if (!inst?.instrument_token) return null;
  return { key: `NSE:${inst.tradingsymbol}`, token: Number(inst.instrument_token), tradingsymbol: String(inst.tradingsymbol) };
}

async function estimateWinRate(params: {
  instrumentToken: number;
  interval: "minute" | "5minute" | "15minute";
  historyDays: number;
  fast: number;
  slow: number;
  lotSize: number;
  lots: number;
  fee: number;
  slippageBps: number;
}): Promise<{ winRate: number; trades: number }> {
  const to = new Date();
  const from = new Date(Date.now() - params.historyDays * 24 * 60 * 60_000);

  const candlesRaw = await getHistorical(params.instrumentToken, from, to, params.interval, { continuous: false, oi: false });
  const candles = (candlesRaw ?? []).map((c) => ({
    time: (c.date instanceof Date ? c.date : new Date(c.date)).toISOString(),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
  }));

  if (candles.length < Math.max(50, params.slow + 5)) return { winRate: 0, trades: 0 };

  const strategy = createSmaCrossStrategy({ fast: params.fast, slow: params.slow, lots: params.lots });
  const bt = runBacktest(candles, strategy, {
    initialCash: 100000,
    market: { exchange: "NFO", tradingsymbol: "NIFTYFUT" },
    lotSize: params.lotSize,
    brokeragePerOrder: params.fee,
    slippageBps: params.slippageBps,
    accounting: "futures",
  });

  const stats = computeTradeStats(bt).summary;
  return { winRate: stats.winRate, trades: stats.trades };
}

function scoreSuggestion(input: {
  tfLabel: "1m" | "5m" | "15m";
  candles: Candle[];
  fast: number;
  slow: number;
  breadth: { weighted_move_pct: number; advancers: number; decliners: number };
  futChangePct: number;
  winRateEstimate: number;
  aggressive: boolean;
}): any {
  const closes = input.candles.map((c) => c.close);

  const fastSma = sma(closes, input.fast);
  const slowSma = sma(closes, input.slow);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(input.candles, 14);
  const bb = bollingerBands(closes, 20, 2);

  const adv = input.breadth.advancers;
  const dec = input.breadth.decliners;
  const advDec = dec === 0 ? (adv > 0 ? 99 : 1) : adv / dec;

  const trend: "BULL" | "BEAR" | "NA" = fastSma === null || slowSma === null ? "NA" : fastSma > slowSma ? "BULL" : "BEAR";

  const atrPct = atr14 === null ? null : (atr14 / closes[closes.length - 1]) * 100;

  const reasons: string[] = [];
  if (trend === "NA") {
    return {
      timeframe: input.tfLabel,
      recommendation: "NO_TRADE",
      confidence: 0,
      probability: null,
      winning_percentage: null,
      signals: {
        trend,
        fastSma,
        slowSma,
        rsi14,
        atrPct,
        breadthWeightedMovePct: input.breadth.weighted_move_pct,
        advDec,
        futChangePct: input.futChangePct,
      },
      reasoning: ["warming_up: not enough candles for indicators"],
    };
  }

  const wantLong = trend === "BULL";
  const wantShort = trend === "BEAR";

  let aligned = 0;
  const total = 6;

  // 1) Trend (always counts once if present)
  aligned++;
  reasons.push(`trend=${trend}`);

  // 2) RSI filter
  const rsiLongMin = input.aggressive ? 52 : 55;
  const rsiShortMax = input.aggressive ? 48 : 45;
  const rsiOk = rsi14 !== null && ((wantLong && rsi14 >= rsiLongMin) || (wantShort && rsi14 <= rsiShortMax));
  if (rsiOk) {
    aligned++;
    reasons.push(`rsi14=${rsi14.toFixed(1)} ok`);
  } else {
    reasons.push(`rsi14=${rsi14 === null ? "NA" : rsi14.toFixed(1)} not ok`);
  }

  // 3) Breadth filter (price-change % across NIFTY50)
  const breadthMoveMin = input.aggressive ? 0.05 : 0.15;
  const advDecLongMin = input.aggressive ? 1.05 : 1.2;
  const advDecShortMax = input.aggressive ? 0.95 : 0.8;
  const breadthOk =
    (wantLong && input.breadth.weighted_move_pct >= breadthMoveMin && advDec >= advDecLongMin) ||
    (wantShort && input.breadth.weighted_move_pct <= -breadthMoveMin && advDec <= advDecShortMax);
  if (breadthOk) {
    aligned++;
    reasons.push(`breadth ok (move=${input.breadth.weighted_move_pct.toFixed(2)}%, adv/dec=${advDec.toFixed(2)})`);
  } else {
    reasons.push(`breadth weak (move=${input.breadth.weighted_move_pct.toFixed(2)}%, adv/dec=${advDec.toFixed(2)})`);
  }

  // 4) Futures day change direction
  const futOk = (wantLong && input.futChangePct >= 0) || (wantShort && input.futChangePct <= 0);
  if (futOk) {
    aligned++;
    reasons.push(`futChangePct=${input.futChangePct.toFixed(2)} ok`);
  } else {
    reasons.push(`futChangePct=${input.futChangePct.toFixed(2)} not ok`);
  }

  // 5) Volatility floor via ATR%
  const atrFloor = input.aggressive ? 0.03 : 0.05;
  const atrOk = atrPct !== null && atrPct >= atrFloor;
  if (atrOk) {
    aligned++;
    reasons.push(`atrPct=${atrPct!.toFixed(3)} ok`);
  } else {
    reasons.push(`atrPct=${atrPct === null ? "NA" : atrPct.toFixed(3)} low`);
  }

  // 6) Bollinger Bands: price above middle for longs, below for shorts; not overstretched
  const bbOk = bb !== null && (
    (wantLong && bb.pctB > 0.5 && bb.pctB < 0.95) ||
    (wantShort && bb.pctB < 0.5 && bb.pctB > 0.05)
  );
  if (bbOk && bb !== null) {
    aligned++;
    reasons.push(`bb pctB=${bb.pctB.toFixed(2)} ok (bw=${bb.bandwidth.toFixed(4)})`);
  } else {
    reasons.push(`bb pctB=${bb === null ? "NA" : bb.pctB.toFixed(2)} not ok`);
  }

  const requiredAligned = input.aggressive ? 3 : 4;
  const recommendation = aligned >= requiredAligned ? (wantLong ? "LONG" : "SHORT") : "NO_TRADE";

  const probability = input.winRateEstimate > 0 ? input.winRateEstimate : null;
  const winning_percentage = probability === null ? null : probability * 100;

  const confidence =
    recommendation === "NO_TRADE"
      ? clamp((aligned / total) * 0.4, 0, 0.45)
      : clamp(0.35 + (aligned / total) * 0.35 + (probability ?? 0.5) * 0.3, 0, 0.95);

  return {
    timeframe: input.tfLabel,
    recommendation,
    confidence: Number(confidence.toFixed(3)),
    probability: probability === null ? null : Number(probability.toFixed(3)),
    winning_percentage: winning_percentage === null ? null : Number(winning_percentage.toFixed(2)),
    signals: {
      trend,
      fastSma: fastSma === null ? null : Number(fastSma.toFixed(2)),
      slowSma: slowSma === null ? null : Number(slowSma.toFixed(2)),
      rsi14: rsi14 === null ? null : Number(rsi14.toFixed(2)),
      atrPct: atrPct === null ? null : Number(atrPct.toFixed(4)),
      bb: bb ?? null,
      breadthWeightedMovePct: Number(input.breadth.weighted_move_pct.toFixed(3)),
      advDec: Number(advDec.toFixed(3)),
      futChangePct: Number(input.futChangePct.toFixed(3)),
    },
    reasoning: reasons,
  };
}

async function main() {
  const weightsPath = getArgValue("--weights");
  const mode = (getArgValue("--mode") ?? "quote") as any;
  const intervalMs = Number(getArgValue("--intervalMs") ?? getArgValue("--interval-ms") ?? "2000");
  const once = process.argv.includes("--once");
  const optionsOnly = process.argv.includes("--optionsOnly") || process.argv.includes("--options-only");
  const aggressive = process.argv.includes("--aggressive");
  const optionsTop = process.argv.includes("--optionsTop") || process.argv.includes("--options-top");
  const telegramEnabled = hasFlag("--telegram");
  const telegram = telegramEnabled ? new TelegramNotifier() : null;

  // Default to "best" which prefers 5m/15m over 1m (1m is too noisy for options entry).
  const tradeTfRaw = (getArgValue("--tradeTf") ?? getArgValue("--trade-tf") ?? "best").toLowerCase();
  const tradeTf = tradeTfRaw === "best" || tradeTfRaw === "1m" || tradeTfRaw === "5m" || tradeTfRaw === "15m" ? tradeTfRaw : "best";

  const underlying = getArgValue("--underlying") ?? "NIFTY";
  const optionExpiry = getArgValue("--expiry") ?? (await pickNearestWeeklyNiftyOptionExpiry(underlying));

  const optStep = Number(getArgValue("--optStep") ?? getArgValue("--opt-step") ?? "50");
  const creditDistance = Number(getArgValue("--creditDistance") ?? getArgValue("--credit-distance") ?? "100");
  const creditWidth = Number(getArgValue("--creditWidth") ?? getArgValue("--credit-width") ?? "100");
  const chainSteps = Number(getArgValue("--chainSteps") ?? getArgValue("--chain-steps") ?? "3");
  const riskFreeRate = Number(getArgValue("--riskFreeRate") ?? getArgValue("--risk-free-rate") ?? "0.06");
  const manualNewsRiskRaw = getArgValue("--newsRisk") ?? getArgValue("--news-risk");
  const newsMode = (getArgValue("--newsMode") ?? getArgValue("--news-mode") ?? "auto").toLowerCase();
  const manualNewsRisk = manualNewsRiskRaw ? manualNewsRiskRaw.toLowerCase() : null;

  const newsTtlMs = Number(getArgValue("--newsTtlMs") ?? getArgValue("--news-ttl-ms") ?? "120000");
  const newsTimespan = getArgValue("--newsTimespan") ?? getArgValue("--news-timespan") ?? "2h";

  const fast = Number(getArgValue("--fast") ?? "9");
  const slow = Number(getArgValue("--slow") ?? "21");
  const historyDays = Number(getArgValue("--historyDays") ?? getArgValue("--history-days") ?? "7");

  const lotSize = Number(getArgValue("--lot") ?? "50");
  const lots = Number(getArgValue("--lots") ?? "1");
  const fee = Number(getArgValue("--fee") ?? "20");
  const slippageBps = Number(getArgValue("--slippage-bps") ?? "2");
  const maxDailyLoss = getArgValue("--maxDailyLoss") ?? getArgValue("--max-daily-loss");
  const maxRiskPerTrade = getArgValue("--maxRiskPerTrade") ?? getArgValue("--max-risk-per-trade");
  const maxDailyLossVal = maxDailyLoss ? Number(maxDailyLoss) : null;
  const maxRiskPerTradeVal = maxRiskPerTrade ? Number(maxRiskPerTrade) : null;

  // Simple trade-plan knobs (for UI guidance only; not guaranteed).
  const tpPct = Number(getArgValue("--tpPct") ?? getArgValue("--tp-pct") ?? "0.25");
  const slPct = Number(getArgValue("--slPct") ?? getArgValue("--sl-pct") ?? "0.15");
  const creditTakePct = Number(getArgValue("--creditTakePct") ?? getArgValue("--credit-take-pct") ?? "0.5");
  const creditStopMult = Number(getArgValue("--creditStopMult") ?? getArgValue("--credit-stop-mult") ?? "2");

  const nseUniverse = await resolveNseUniverse(weightsPath);
  const fut = await resolveNiftyFutureToken(underlying);
  const spot = await resolveUnderlyingSpotIndexToken(underlying);

  // Estimate baseline win-rate for each timeframe from recent candles.
  // (Used as an empirical probability proxy and for PnC display; not guaranteed.)
  const [wr1m, wr5m, wr15m] = await Promise.all([
    estimateWinRate({
      instrumentToken: fut.token,
      interval: "minute",
      historyDays,
      fast,
      slow,
      lotSize,
      lots,
      fee,
      slippageBps,
    }),
    estimateWinRate({
      instrumentToken: fut.token,
      interval: "5minute",
      historyDays,
      fast,
      slow,
      lotSize,
      lots,
      fee,
      slippageBps,
    }),
    estimateWinRate({
      instrumentToken: fut.token,
      interval: "15minute",
      historyDays,
      fast,
      slow,
      lotSize,
      lots,
      fee,
      slippageBps,
    }),
  ]);

  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      event: "boot",
      underlying,
      future: fut.key,
      optionExpiry,
      optionParams: { optStep, creditDistance, creditWidth, chainSteps, riskFreeRate },
      optionsOnly,
      aggressive,
      telegram: telegramEnabled,
      tradePlan: { tpPct, slPct, creditTakePct, creditStopMult },
      news: { mode: newsMode, manualRisk: manualNewsRisk, ttlMs: newsTtlMs, timespan: newsTimespan },
      nseSymbols: nseUniverse.length,
      historyDays,
      winRateEstimate: { "1m": wr1m, "5m": wr5m, "15m": wr15m },
    }),
  );

  const vix = await resolveIndiaVixToken();
  const tokens = [fut.token, ...nseUniverse.map((w) => w.token), ...(vix ? [vix.token] : []), ...(spot ? [spot.token] : [])];
  const latest = new Map<number, Tick>();

  const tokenToKey = new Map<number, string>(nseUniverse.map((w) => [w.token, w.key]));

  // Stock flow tracking for Spartan/Surfing labeling.
  // We bucket by 1 minute and compute traded value using volume deltas × last_price.
  // SPARTAN: >= 100cr INR per 1m bucket.
  // SURF_TRIGGER: >= 50cr needed to stamp lastBuy/lastSell/lastSurfingUp/lastSurfingDn.
  const CRORE_INR = 10_000_000;
  const SPARTAN_THRESHOLD_INR = 100 * CRORE_INR;
  const SURF_TRIGGER_THRESHOLD_CR = 50; // crores — min turnover to register a BUY/SELL/SURF signal stamp

  type StockFlowState = {
    bucketStartMs: number | null;
    lastVolume: number | null;
    currentTurnoverInr: number;
    lastClosedTurnoverInr: number;
  };

  const stockFlow = new Map<number, StockFlowState>();
  const lastStockState = new Map<number, string>();
  const stockLogs: StockLogRow[] = [];
  const MAX_STOCK_LOGS = 500;

  let options: OptionSelection | null = null;
  let subscribedOptionTokens: number[] = [];
  let chain: ChainStrike[] = [];
  let subscribedChainTokens: number[] = [];
  const lastOi = new Map<number, number>();
  const lastTop = new Map<number, { bidQty: number | null; askQty: number | null; last: number | null }>();
  const prevTop = new Map<number, { bidQty: number | null; askQty: number | null; last: number | null }>();

  const stockSignalHistory = new Map<string, Omit<StockSignalHistoryEntry, "key" | "symbol">>();
  let prevDayCandle: { h: number; l: number; c: number } | null = null;
  const lifecycleHistory: LifecycleOutput[] = [];
  const MAX_LIFECYCLE_HISTORY = 60;

  let spreadLegs:
    | null
    | {
        putCredit: { sell: ResolvedOption; buy: ResolvedOption };
        callCredit: { sell: ResolvedOption; buy: ResolvedOption };
      } = null;

  const agg1m = new CandleAggregator({ timeframeSec: 60, maxCandles: 600 });
  const agg5m = new CandleAggregator({ timeframeSec: 300, maxCandles: 600 });
  const agg15m = new CandleAggregator({ timeframeSec: 900, maxCandles: 600 });

  // Seed candles from Kite historical so indicators (SMA/RSI/ATR) are ready immediately.
  // Without this, 5m/15m can take a long time to become usable.
  try {
    const to = new Date();
    const from = new Date(Date.now() - historyDays * 24 * 60 * 60_000);
    const [h1, h5, h15] = await Promise.all([
      getHistorical(fut.token, from, to, "minute", { continuous: false, oi: false }),
      getHistorical(fut.token, from, to, "5minute", { continuous: false, oi: false }),
      getHistorical(fut.token, from, to, "15minute", { continuous: false, oi: false }),
    ]);

    const mapCandle = (c: any) => ({
      time: (c.date instanceof Date ? c.date : new Date(c.date)).toISOString(),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume),
    });

    const c1 = (h1 ?? []).map(mapCandle);
    const c5 = (h5 ?? []).map(mapCandle);
    const c15 = (h15 ?? []).map(mapCandle);
    agg1m.seedClosedCandles(c1);
    agg5m.seedClosedCandles(c5);
    agg15m.seedClosedCandles(c15);

    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "seed_candles", counts: { "1m": c1.length, "5m": c5.length, "15m": c15.length }, historyDays }));

    // Fetch previous day OHLC for pivot level calculation using 15m candles grouped by IST day.
    try {
      const fromPiv = new Date(Date.now() - 5 * 24 * 60 * 60_000);
      const pivCandles = await getHistorical(fut.token, fromPiv, new Date(), "15minute", { continuous: false, oi: false });
      if (pivCandles && pivCandles.length > 0) {
        // Group candles by IST date string (YYYY-MM-DD)
        const byDay = new Map<string, typeof pivCandles>();
        for (const c of pivCandles) {
          const d = c.date instanceof Date ? c.date : new Date(c.date);
          const istMs = d.getTime() + 5.5 * 60 * 60_000;
          const day = new Date(istMs).toISOString().slice(0, 10);
          if (!byDay.has(day)) byDay.set(day, []);
          byDay.get(day)!.push(c);
        }
        const days = [...byDay.keys()].sort();
        // Need at least one completed prior day (skip today)
        const todayIst = new Date(Date.now() + 5.5 * 60 * 60_000).toISOString().slice(0, 10);
        const priorDays = days.filter((d) => d < todayIst);
        if (priorDays.length > 0) {
          const pdDay = priorDays[priorDays.length - 1];
          const pdCandles = byDay.get(pdDay)!;
          const pdh = Math.max(...pdCandles.map((c) => Number(c.high)));
          const pdl = Math.min(...pdCandles.map((c) => Number(c.low)));
          const pdc = Number(pdCandles[pdCandles.length - 1].close);
          prevDayCandle = { h: pdh, l: pdl, c: pdc };
        }
      }
    } catch {
      // ignore; pivot levels will be unavailable
    }
  } catch {
    // ignore seeding failures; the engine will warm up from ticks.
  }

  const ticker = await createKiteTicker();
  let connected = false;
  let optionsResolveInFlight = false;

  let news: NewsContext | null = null;
  let newsLastFetchMs = 0;

  async function refreshNewsIfNeeded(): Promise<void> {
    if (newsMode === "off") return;
    if (manualNewsRisk && newsMode === "manual") return;
    const now = Date.now();
    if (news && now - newsLastFetchMs < newsTtlMs) return;

    newsLastFetchMs = now;
    try {
      news = await computeNewsContext({
        gdeltTimespan: newsTimespan,
        gdeltMaxRecords: 30,
        gdeltTerms: [
          "nifty",
          "sensex",
          "rbi",
          "sebi",
          "india",
          "rupee",
          "usd inr",
          "oil",
          "crude",
          "war",
          "sanctions",
          "iran",
          "israel",
          "ukraine",
          "fed",
          "inflation",
        ],
        officialWithinHours: 24,
        officialMaxItemsPerFeed: 6,
        maxHeadlines: 8,
      });
    } catch {
      // ignore news failures
    }
  }

  ticker.on("connect", () => {
    connected = true;
    ticker.subscribe(tokens);
    ticker.setMode(ticker.modeMap?.[mode] ?? mode, tokens);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "connect", subscribed: tokens.length, mode }));
  });

  ticker.on("ticks", (ticks: Tick[]) => {
    for (const t of ticks ?? []) {
      const token = t?.instrument_token;
      if (!token) continue;
      latest.set(token, t);

      // Stock volume/turnover tracking for NSE universe.
      if (tokenToKey.has(token)) {
        const px = Number(t.last_price);
        const vol = typeof t.volume === "number" && Number.isFinite(t.volume) ? Number(t.volume) : null;
        const ts = t.exchange_timestamp ?? t.timestamp ?? new Date();

        if (Number.isFinite(px) && vol !== null) {
          const tsMs = ts.getTime();
          const bucketStartMs = Math.floor(tsMs / 60_000) * 60_000;

          const prev = stockFlow.get(token) ?? { bucketStartMs: null, lastVolume: null, currentTurnoverInr: 0, lastClosedTurnoverInr: 0 };

          if (prev.bucketStartMs === null) {
            prev.bucketStartMs = bucketStartMs;
          } else if (bucketStartMs !== prev.bucketStartMs) {
            // finalize previous minute bucket
            prev.lastClosedTurnoverInr = prev.currentTurnoverInr;
            prev.currentTurnoverInr = 0;
            prev.bucketStartMs = bucketStartMs;
          }

          if (prev.lastVolume !== null && vol >= prev.lastVolume) {
            const dv = vol - prev.lastVolume;
            // Using last traded price as a proxy for trade value.
            prev.currentTurnoverInr += dv * px;
          }

          prev.lastVolume = vol;
          stockFlow.set(token, prev);
        }
      }

      const bestBidQty = t.depth?.buy?.length ? Number(t.depth.buy[0]?.quantity) : NaN;
      const bestAskQty = t.depth?.sell?.length ? Number(t.depth.sell[0]?.quantity) : NaN;
      if (Number.isFinite(bestBidQty) || Number.isFinite(bestAskQty)) {
        const last = Number(t.last_price);
        const prev = lastTop.get(token);
        if (prev) prevTop.set(token, prev);
        lastTop.set(token, {
          bidQty: Number.isFinite(bestBidQty) ? bestBidQty : null,
          askQty: Number.isFinite(bestAskQty) ? bestAskQty : null,
          last: Number.isFinite(last) ? last : null,
        });
      }

      if (token === fut.token) {
        const ts = t.exchange_timestamp ?? t.timestamp ?? new Date();
        const px = Number(t.last_price);
        if (Number.isFinite(px)) {
          agg1m.onTick(px, ts);
          agg5m.onTick(px, ts);
          agg15m.onTick(px, ts);
        }
      }
    }
  });

  ticker.on("error", (err: any) => {
    // eslint-disable-next-line no-console
    const msg = err instanceof Error ? err.message : typeof err === "string" ? err : undefined;
    console.error(JSON.stringify({ event: "error", err: msg ?? err }));
  });

  ticker.on("close", () => {
    connected = false;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "close" }));
  });

  ticker.connect();

  function buildOutputSnapshot(): {
    asof: string;
    optionsOnly: boolean;
    tradeTimeframeRequested: "1m" | "5m" | "15m" | "best";
    tradeTimeframe: "1m" | "5m" | "15m";
    future: string;
    futureLtp: number | null;
    quantity: number;
    suggestion: any;
    timeframes: any;
    breadth: any;
    stockSignals: StockSignal[];
    stockLogs: StockLogRow[];
    stockSignalHistory: StockSignalHistoryEntry[];
    pivotLevels: PivotLevelsOutput | null;
    lifecycle: LifecycleOutput | null;
    lifecycleHistory: LifecycleOutput[];
    rms: { maxDailyLoss: number | null; maxRiskPerTrade: number | null };
    options: any;
    news: any;
    notes: string[];
  } {
    const breadth = analyzeBreadthFromTicks(nseUniverse as any, latest as any);

    const effectiveNewsRisk: NewsRiskLevel = (() => {
      if (manualNewsRisk === "high" || manualNewsRisk === "medium" || manualNewsRisk === "low") return manualNewsRisk;
      if (newsMode === "off") return "medium";
      return (news?.level ?? "medium") as NewsRiskLevel;
    })();

    const futTick = latest.get(fut.token);
    const futLast = Number(futTick?.last_price);
    const futPrevClose = Number(futTick?.ohlc?.close);
    const futChangePct = pctChange(futPrevClose, futLast);
    const futLtp = Number.isFinite(futLast) ? futLast : null;

    const spotLast = spot ? Number(latest.get(spot.token)?.last_price) : NaN;
    const spotLtp = Number.isFinite(spotLast) ? spotLast : null;

    const vixLast = vix ? Number(latest.get(vix.token)?.last_price) : NaN;
    const vixValue = Number.isFinite(vixLast) ? vixLast : null;

    const c1 = agg1m.getClosedCandles();
    const c5 = agg5m.getClosedCandles();
    const c15 = agg15m.getClosedCandles();

    const s1Raw = scoreSuggestion({
      tfLabel: "1m",
      candles: c1,
      fast,
      slow,
      breadth,
      futChangePct,
      winRateEstimate: wr1m.winRate,
      aggressive,
    });

    const s5Raw = scoreSuggestion({
      tfLabel: "5m",
      candles: c5,
      fast,
      slow,
      breadth,
      futChangePct,
      winRateEstimate: wr5m.winRate,
      aggressive,
    });

    const s15Raw = scoreSuggestion({
      tfLabel: "15m",
      candles: c15,
      fast,
      slow,
      breadth,
      futChangePct,
      winRateEstimate: wr15m.winRate,
      aggressive,
    });

    // Confluence-based PnC: adjust 5m/15m using agreement from other timeframes.
    // PnC = probability × confidence × confluenceFactor.
    const withConfluence = (primary: any, others: any[]) => {
      const rec = String(primary?.recommendation ?? "NO_TRADE");
      const conf0 = typeof primary?.confidence === "number" ? primary.confidence : 0;
      const prob0 = typeof primary?.probability === "number" ? primary.probability : null;

      const considered = others.filter((o) => o && String(o.recommendation ?? "NO_TRADE") !== "NO_TRADE");
      const agree = considered.filter((o) => String(o.recommendation) === rec).length;
      const ratio = considered.length ? agree / considered.length : null;

      const confluenceFactor = ratio === null ? 1 : clamp(0.85 + ratio * 0.30, 0.75, 1.15);
      const conf = Number(clamp(conf0 * confluenceFactor, 0, 0.99).toFixed(3));
      const prob = prob0 === null ? null : Number(clamp(prob0 * (ratio === null ? 1 : (0.90 + ratio * 0.20)), 0, 1).toFixed(3));
      const winPct = prob === null ? null : Number((prob * 100).toFixed(2));
      const pnc = prob === null ? null : Number((prob * conf * confluenceFactor).toFixed(4));

      return {
        ...primary,
        confidence: conf,
        probability: prob,
        winning_percentage: winPct,
        pnc,
        confluence: { agree, considered: considered.length, ratio: ratio === null ? null : Number(ratio.toFixed(2)), factor: Number(confluenceFactor.toFixed(3)) },
      };
    };

    const s1 = withConfluence(s1Raw, [s5Raw, s15Raw]);
    const s5 = withConfluence(s5Raw, [s1Raw, s15Raw]);
    const s15 = withConfluence(s15Raw, [s5Raw, s1Raw]);

    // Top recommendation shown in the header driven by 5m for stability.
    let chosen = s5.recommendation !== "NO_TRADE" ? s5 : s15.recommendation !== "NO_TRADE" ? s15 : s1;

    // Best trade timeframe: prefer 15m then 5m; use 1m only as last resort.
    const bestTf = (() => {
      const pref = [s15, s5].filter((x) => x && x.recommendation !== "NO_TRADE");
      if (pref.length) {
        pref.sort((a, b) => {
          const pa = typeof a?.pnc === "number" ? a.pnc : -1;
          const pb = typeof b?.pnc === "number" ? b.pnc : -1;
          if (pa !== pb) return pb - pa;
          return (typeof b?.confidence === "number" ? b.confidence : 0) - (typeof a?.confidence === "number" ? a.confidence : 0);
        });
        return pref[0];
      }
      return s1; // fallback only when 5m+15m both say NO_TRADE
    })();

    const tradeChosen = (() => {
      if (tradeTf === "best") return bestTf;
      if (tradeTf === "5m") return s5;
      if (tradeTf === "15m") return s15;
      return s1;
    })();

    const resolvedTradeTf = ((): "1m" | "5m" | "15m" => {
      const tf = String(tradeChosen?.timeframe ?? "");
      return tf === "5m" || tf === "15m" ? tf : "1m";
    })();

    // Stock signals (Spartan/Surfing) for all NSE universe symbols.
    const stockSignals: StockSignal[] = nseUniverse
      .map((w) => {
        const key = w.key;
        const symbol = key.includes(":") ? key.split(":")[1] : key;
        const t = latest.get(w.token);
        const last = Number(t?.last_price);
        const prevClose = Number(t?.ohlc?.close);
        const pct = Number.isFinite(last) && Number.isFinite(prevClose) ? pctChange(prevClose, last) : null;

        const dir: StockSignal["dir"] = pct === null ? "FLAT" : pct > 0.02 ? "UP" : pct < -0.02 ? "DOWN" : "FLAT";
        const action: StockSignal["action"] = dir === "UP" ? "BUY" : dir === "DOWN" ? "SELL" : "HOLD";

        const st = stockFlow.get(w.token) ?? null;
        const turnoverInr = st ? (st.lastClosedTurnoverInr > 0 ? st.lastClosedTurnoverInr : st.currentTurnoverInr) : 0;
        const turnoverCr = Number.isFinite(turnoverInr) && turnoverInr > 0 ? turnoverInr / CRORE_INR : null;
        const mode: StockSignal["mode"] = turnoverInr >= SPARTAN_THRESHOLD_INR ? "SPARTAN" : "SURF";

        const label: StockSignal["label"] =
          mode === "SPARTAN"
            ? dir === "UP"
              ? "SPARTAN_UP"
              : dir === "DOWN"
                ? "SPARTAN_DN"
                : "SPARTAN_FLAT"
            : dir === "UP"
              ? "SURFINGUP"
              : dir === "DOWN"
                ? "SURFINGDN"
                : "SURFINGFLAT";

        return {
          key,
          symbol,
          pctChange: pct === null ? null : Number(pct.toFixed(2)),
          dir,
          action,
          mode,
          label,
          turnoverCr_1m: turnoverCr === null ? null : Number(turnoverCr.toFixed(1)),
        };
      })
      .filter((r) => r && r.symbol);

    // Append to stock logs only on meaningful state changes.
    for (const r of stockSignals) {
      const token = nseUniverse.find((w) => w.key === r.key)?.token;
      if (!token) continue;
      const state = `${r.mode}|${r.dir}|${r.action}`;
      const prev = lastStockState.get(token);
      if (prev === state) continue;

      // Log when mode changes, or when direction changes while in SPARTAN.
      const prevMode = prev ? prev.split("|")[0] : null;
      const modeChanged = prevMode !== null && prevMode !== r.mode;
      const isSpartanNow = r.mode === "SPARTAN";
      const wasSpartan = prevMode === "SPARTAN";

      // Stock event log: only record SPARTAN transitions (keeps the log clean).
      if (modeChanged || isSpartanNow || wasSpartan) {
        stockLogs.push({
          asof: new Date().toISOString(),
          key: r.key,
          symbol: r.symbol,
          label: r.label,
          action: r.action,
          pctChange: r.pctChange,
          turnoverCr_1m: r.turnoverCr_1m,
        });
        if (stockLogs.length > MAX_STOCK_LOGS) stockLogs.splice(0, stockLogs.length - MAX_STOCK_LOGS);
      }

      // Signal history: direction-flip based so SURFINGUP→SPARTAN_UP doesn't re-stamp lastBuy.
      // Derive previous direction and label from the saved state string.
      const prevDir = prev ? (prev.split("|")[1] as "UP" | "DOWN" | "FLAT") : null;
      const prevLabel = prev
        ? (() => {
            const [m, d] = prev.split("|");
            if (m === "SPARTAN") return d === "UP" ? "SPARTAN_UP" : d === "DOWN" ? "SPARTAN_DN" : "SPARTAN_FLAT";
            return d === "UP" ? "SURFINGUP" : d === "DOWN" ? "SURFINGDN" : "SURFINGFLAT";
          })()
        : null;

      const hist = stockSignalHistory.get(r.key) ?? {
        lastBuy: null,
        lastSell: null,
        lastSpartanUp: null,
        lastSpartanDn: null,
        lastSurfingUp: null,
        lastSurfingDn: null,
      };
      const tsNow = new Date().toISOString();
      const turnoverCrNow = r.turnoverCr_1m ?? 0;
      const meetsFlowMin = turnoverCrNow >= SURF_TRIGGER_THRESHOLD_CR;

      // lastBuy / lastSell: genuine direction flip AND turnover >= 50cr
      if (prevDir !== "UP" && r.dir === "UP" && meetsFlowMin) hist.lastBuy = tsNow;
      if (prevDir !== "DOWN" && r.dir === "DOWN" && meetsFlowMin) hist.lastSell = tsNow;
      // SPARTAN stamps: label newly entered (SPARTAN already implies >= 100cr, no extra check needed)
      if (prevLabel !== "SPARTAN_UP" && r.label === "SPARTAN_UP") hist.lastSpartanUp = tsNow;
      if (prevLabel !== "SPARTAN_DN" && r.label === "SPARTAN_DN") hist.lastSpartanDn = tsNow;
      // SURFING stamps: label newly entered AND turnover >= 50cr
      if (prevLabel !== "SURFINGUP" && r.label === "SURFINGUP" && meetsFlowMin) hist.lastSurfingUp = tsNow;
      if (prevLabel !== "SURFINGDN" && r.label === "SURFINGDN" && meetsFlowMin) hist.lastSurfingDn = tsNow;
      stockSignalHistory.set(r.key, hist);

      lastStockState.set(token, state);
    }

    function expiryTYears(expiry: string): number {
      // NIFTY weekly expiry is at market close (approx 15:30 IST = 10:00 UTC)
      const expiryUtcMs = new Date(`${expiry}T10:00:00.000Z`).getTime();
      const nowMs = Date.now();
      const ms = Math.max(60_000, expiryUtcMs - nowMs);
      return ms / (365 * 24 * 60 * 60_000);
    }

    function sweepFor(token: number): any {
      const prev = prevTop.get(token);
      const cur = lastTop.get(token);
      if (!prev || !cur) return null;
      if (prev.last === null || cur.last === null) return null;

      const askDrop =
        prev.askQty !== null && cur.askQty !== null && prev.askQty > 0 ? (prev.askQty - cur.askQty) / prev.askQty : null;
      const bidDrop =
        prev.bidQty !== null && cur.bidQty !== null && prev.bidQty > 0 ? (prev.bidQty - cur.bidQty) / prev.bidQty : null;
      const pxMove = prev.last > 0 ? (cur.last - prev.last) / prev.last : null;

      const buyScore = askDrop !== null && pxMove !== null && askDrop >= 0.6 && pxMove >= 0.0002 ? askDrop : 0;
      const sellScore = bidDrop !== null && pxMove !== null && bidDrop >= 0.6 && pxMove <= -0.0002 ? bidDrop : 0;

      if (buyScore === 0 && sellScore === 0) return { side: null, score: 0 };
      return buyScore >= sellScore ? { side: "BUY", score: Number((buyScore * 100).toFixed(2)) } : { side: "SELL", score: Number((sellScore * 100).toFixed(2)) };
    }

    // Options analytics (JSON output): ATM premiums, spreads, chain/OI, greeks, regime, and a take/no-take decision.
    let optionsSuggestion: any = null;

    if (options) {
      const ceTick = latest.get(options.ce.token);
      const peTick = latest.get(options.pe.token);
      const cePremiumRaw = Number(ceTick?.last_price);
      const pePremiumRaw = Number(peTick?.last_price);
      const cePremium = Number.isFinite(cePremiumRaw) ? cePremiumRaw : null;
      const pePremium = Number.isFinite(pePremiumRaw) ? pePremiumRaw : null;

      const futTick = latest.get(fut.token);
      const futLast = Number(futTick?.last_price);
      const straddle = cePremium !== null && pePremium !== null ? cePremium + pePremium : null;
      const impliedMovePct =
        straddle !== null && Number.isFinite(futLast) && futLast > 0 ? Number(((straddle / futLast) * 100).toFixed(3)) : null;

      const S = Number.isFinite(futLast) && futLast > 0 ? futLast : Number(futPrevClose);
      const T = expiryTYears(options.expiry);
      const r = Number.isFinite(riskFreeRate) ? riskFreeRate : 0.06;

      const greekFor = (strike: number, type: "CE" | "PE", premium: number | null) => {
        if (!Number.isFinite(S) || !(S > 0) || premium === null) return null;
        const g = impliedVolAndGreeks({ S, K: strike, r, T, type, marketPrice: premium });
        if (!g) return null;
        return {
          iv: Number(g.iv.toFixed(4)),
          delta: Number(g.delta.toFixed(4)),
          gamma: Number(g.gamma.toFixed(6)),
          thetaPerDay: Number(g.thetaPerDay.toFixed(4)),
          vega: Number(g.vega.toFixed(4)),
        };
      };

      const qty = (options.ce.lotSize || lotSize) * lots;
      const makeLeg = (inst: ResolvedOption, premium: number | null) => ({
        instrument: inst.key,
        strike: inst.strike,
        premium,
        quantity: qty,
      });

      const putSpread: CreditSpread | null = (() => {
        if (!spreadLegs?.putCredit) return null;
        const sellTick = latest.get(spreadLegs.putCredit.sell.token);
        const buyTick = latest.get(spreadLegs.putCredit.buy.token);
        const sellPrem = Number.isFinite(Number(sellTick?.last_price)) ? Number(sellTick?.last_price) : null;
        const buyPrem = Number.isFinite(Number(buyTick?.last_price)) ? Number(buyTick?.last_price) : null;
        const netCredit = sellPrem !== null && buyPrem !== null ? sellPrem - buyPrem : null;
        const width = creditWidth;
        const maxProfit = netCredit === null ? null : netCredit * qty;
        const maxLoss = netCredit === null ? null : (width - netCredit) * qty;
        const breakeven = netCredit === null ? null : spreadLegs.putCredit.sell.strike - netCredit;
        return {
          kind: "PUT_CREDIT",
          width,
          legs: {
            sell: makeLeg(spreadLegs.putCredit.sell, sellPrem),
            buy: makeLeg(spreadLegs.putCredit.buy, buyPrem),
          },
          netCredit,
          maxProfit,
          maxLoss,
          breakeven,
        };
      })();

      const callSpread: CreditSpread | null = (() => {
        if (!spreadLegs?.callCredit) return null;
        const sellTick = latest.get(spreadLegs.callCredit.sell.token);
        const buyTick = latest.get(spreadLegs.callCredit.buy.token);
        const sellPrem = Number.isFinite(Number(sellTick?.last_price)) ? Number(sellTick?.last_price) : null;
        const buyPrem = Number.isFinite(Number(buyTick?.last_price)) ? Number(buyTick?.last_price) : null;
        const netCredit = sellPrem !== null && buyPrem !== null ? sellPrem - buyPrem : null;
        const width = creditWidth;
        const maxProfit = netCredit === null ? null : netCredit * qty;
        const maxLoss = netCredit === null ? null : (width - netCredit) * qty;
        const breakeven = netCredit === null ? null : spreadLegs.callCredit.sell.strike + netCredit;
        return {
          kind: "CALL_CREDIT",
          width,
          legs: {
            sell: makeLeg(spreadLegs.callCredit.sell, sellPrem),
            buy: makeLeg(spreadLegs.callCredit.buy, buyPrem),
          },
          netCredit,
          maxProfit,
          maxLoss,
          breakeven,
        };
      })();

      // Option chain OI/PCR around ATM (best-effort, requires ticks with `oi`).
      const chainRows = chain
        .map((row) => {
          const ceT = latest.get(row.ce.token);
          const peT = latest.get(row.pe.token);
          const ceLtp = Number(ceT?.last_price);
          const peLtp = Number(peT?.last_price);
          const ceOi = Number((ceT as any)?.oi);
          const peOi = Number((peT as any)?.oi);

          const ceOiVal = Number.isFinite(ceOi) ? ceOi : null;
          const peOiVal = Number.isFinite(peOi) ? peOi : null;

          const cePrev = lastOi.get(row.ce.token);
          const pePrev = lastOi.get(row.pe.token);
          const ceChg = ceOiVal !== null && typeof cePrev === "number" ? ceOiVal - cePrev : null;
          const peChg = peOiVal !== null && typeof pePrev === "number" ? peOiVal - pePrev : null;

          if (ceOiVal !== null) lastOi.set(row.ce.token, ceOiVal);
          if (peOiVal !== null) lastOi.set(row.pe.token, peOiVal);

          return {
            strike: row.strike,
            ce: { instrument: row.ce.key, premium: Number.isFinite(ceLtp) ? ceLtp : null, oi: ceOiVal, oiChange: ceChg },
            pe: { instrument: row.pe.key, premium: Number.isFinite(peLtp) ? peLtp : null, oi: peOiVal, oiChange: peChg },
          };
        })
        .slice(0, 30);

      const callOi = chainRows.reduce((s, r) => s + (r.ce.oi ?? 0), 0);
      const putOi = chainRows.reduce((s, r) => s + (r.pe.oi ?? 0), 0);
      const callOiChg = chainRows.reduce((s, r) => s + (r.ce.oiChange ?? 0), 0);
      const putOiChg = chainRows.reduce((s, r) => s + (r.pe.oiChange ?? 0), 0);
      const pcr = callOi > 0 ? putOi / callOi : null;

      const atmGreeks = {
        ce: greekFor(options.atmStrike, "CE", cePremium),
        pe: greekFor(options.atmStrike, "PE", pePremium),
      };

      const regime = (() => {
        const vol = { vix: vixValue, impliedMovePct, atrPct: null };
        const highVol = (vixValue !== null && vixValue >= 18) || (impliedMovePct !== null && impliedMovePct >= 1.6);
        const lowVol = (vixValue !== null && vixValue <= 14) && (impliedMovePct !== null && impliedMovePct <= 1.0);
        const label = highVol ? "VOLATILE" : lowVol ? "CALM" : "NORMAL";
        return { label, ...vol };
      })();

      const sweeps = {
        fut: sweepFor(fut.token),
        atmCE: options.ce?.token ? sweepFor(options.ce.token) : null,
        atmPE: options.pe?.token ? sweepFor(options.pe.token) : null,
      };

      // Option-chain driven top recommendation is optional.
      // By default (including optionsOnly UI), we keep the top recommendation driven by 1m timeframe.
      if (optionsOnly && optionsTop) {
        const reasons: string[] = [];
        let bull = 0;
        let bear = 0;

        const imb = breadth.buy_sell_imbalance;
        if (imb !== null) {
          if (imb >= 0.1) {
            bull++;
            reasons.push(`buyers> sellers (imb=${imb.toFixed(3)})`);
          } else if (imb <= -0.1) {
            bear++;
            reasons.push(`sellers> buyers (imb=${imb.toFixed(3)})`);
          }
        }

        if (pcr !== null) {
          if (pcr >= 1.05) {
            bull++;
            reasons.push(`PCR bullish (pcr=${pcr.toFixed(3)})`);
          } else if (pcr <= 0.95) {
            bear++;
            reasons.push(`PCR bearish (pcr=${pcr.toFixed(3)})`);
          }
        }

        if (putOiChg !== 0 || callOiChg !== 0) {
          if (putOiChg > callOiChg) {
            bull++;
            reasons.push(`ΔOI put>call (P=${putOiChg}, C=${callOiChg})`);
          } else if (callOiChg > putOiChg) {
            bear++;
            reasons.push(`ΔOI call>put (P=${putOiChg}, C=${callOiChg})`);
          }
        }

        // Sweeps: interpret CE/PE differently (PE buy pressure is typically bearish).
        if (sweeps.atmCE?.side === "BUY") {
          bull++;
          reasons.push(`ATM CE sweep BUY (score=${sweeps.atmCE.score})`);
        } else if (sweeps.atmCE?.side === "SELL") {
          bear++;
          reasons.push(`ATM CE sweep SELL (score=${sweeps.atmCE.score})`);
        }

        if (sweeps.atmPE?.side === "BUY") {
          bear++;
          reasons.push(`ATM PE sweep BUY (score=${sweeps.atmPE.score})`);
        } else if (sweeps.atmPE?.side === "SELL") {
          bull++;
          reasons.push(`ATM PE sweep SELL (score=${sweeps.atmPE.score})`);
        }

        // Skew hint: if put IV much higher than call IV, treat as bearish risk-off.
        if (atmGreeks.ce?.iv != null && atmGreeks.pe?.iv != null) {
          const skew = atmGreeks.pe.iv - atmGreeks.ce.iv;
          if (skew >= 0.06) {
            bear++;
            reasons.push(`put IV>call IV (skew=${skew.toFixed(3)})`);
          }
        }

        const total = bull + bear;
        const rec = bull >= 3 && bull > bear ? "LONG" : bear >= 3 && bear > bull ? "SHORT" : "NO_TRADE";
        const conf = total === 0 ? 0 : Math.min(0.9, 0.35 + (Math.max(bull, bear) / 5) * 0.55);
        chosen = {
          timeframe: "options",
          recommendation: rec,
          confidence: Number(conf.toFixed(3)),
          probability: null,
          winning_percentage: null,
          signals: {
            trend: "NA",
            fastSma: null,
            slowSma: null,
            rsi14: null,
            atrPct: null,
            breadthWeightedMovePct: Number(breadth.weighted_move_pct.toFixed(3)),
            advDec: 0,
            futChangePct: Number(futChangePct.toFixed(3)),
          },
          reasoning: reasons.length ? reasons : ["insufficient options signals"],
        };
      }

      // Choose BUY vs CREDIT_SPREAD heuristics (very conservative):
      // - If newsRisk high => avoid selling.
      // - If IV proxy high / VIX high => prefer BUY (defined max loss).
      // - If confidence high + regime calm/normal => allow CREDIT_SPREAD.
      const canSellBase =
        effectiveNewsRisk !== "high" &&
        ((impliedMovePct !== null && impliedMovePct < 1.4) || (regime.vix !== null && regime.vix < 18));
      const canSell = canSellBase && (tradeChosen.confidence >= 0.65 || (impliedMovePct !== null && impliedMovePct >= 1.2));
      const preferBuy = (impliedMovePct !== null && impliedMovePct >= 1.8) || regime.label === "VOLATILE";

      let suggestion:
        | { style: "WAIT" }
        | {
            style: "BUY";
            action: "BUY CALL" | "BUY PUT";
            instrument: string;
            strike?: number;
            moneyness?: "ITM" | "ATM" | "OTM";
            delta?: number | null;
            premium: number | null;
            quantity: number;
            maxLoss: number | null;
          }
        | {
            style: "CREDIT_SPREAD";
            action: "SELL PUT SPREAD" | "SELL CALL SPREAD";
            spread: CreditSpread;
          } = { style: "WAIT" };

      const pickBuyStrike = (params: {
        side: "CE" | "PE";
        atmStrike: number;
        chainRows: Array<{ strike: number; ce: { instrument: string; premium: number | null; oi: number | null }; pe: { instrument: string; premium: number | null; oi: number | null } }>;
        moneynessPref: "ITM" | "ATM" | "OTM";
      }): { strike: number; instrument: string; premium: number | null; moneyness: "ITM" | "ATM" | "OTM"; delta: number | null } | null => {
        const targetDeltaAbs = params.moneynessPref === "ITM" ? 0.62 : params.moneynessPref === "OTM" ? 0.35 : 0.50;
        const moneynessFor = (strike: number): "ITM" | "ATM" | "OTM" => {
          if (strike === params.atmStrike) return "ATM";
          if (params.side === "CE") return strike < params.atmStrike ? "ITM" : "OTM";
          return strike > params.atmStrike ? "ITM" : "OTM";
        };

        const candidates = params.chainRows
          .map((r) => {
            const premium = params.side === "CE" ? r.ce.premium : r.pe.premium;
            const oi = params.side === "CE" ? r.ce.oi : r.pe.oi;
            const g = greekFor(r.strike, params.side, premium);
            const deltaAbs = g ? Math.abs(g.delta) : null;
            return {
              strike: r.strike,
              instrument: params.side === "CE" ? r.ce.instrument : r.pe.instrument,
              premium,
              oi: typeof oi === "number" ? oi : null,
              delta: g ? g.delta : null,
              deltaAbs,
              moneyness: moneynessFor(r.strike),
            };
          })
          .filter((c) => c.premium !== null && c.deltaAbs !== null);

        const filtered = candidates.filter((c) => c.moneyness === params.moneynessPref);
        const pool = filtered.length ? filtered : candidates;
        if (!pool.length) return null;

        pool.sort((a, b) => {
          const da = Math.abs((a.deltaAbs as number) - targetDeltaAbs);
          const db = Math.abs((b.deltaAbs as number) - targetDeltaAbs);
          if (da !== db) return da - db;
          const oiA = a.oi ?? 0;
          const oiB = b.oi ?? 0;
          return oiB - oiA;
        });

        const best = pool[0];
        return { strike: best.strike, instrument: best.instrument, premium: best.premium, moneyness: best.moneyness, delta: best.delta };
      };

      const moneynessPref: "ITM" | "ATM" | "OTM" = (() => {
        // Simple, explainable defaults:
        // - VOLATILE => prefer ITM (higher delta, less “lottery”).
        // - Aggressive testing => prefer OTM (more trades / cheaper).
        // - Otherwise => ATM.
        if (regime.label === "VOLATILE") return "ITM";
        if (aggressive) return "OTM";
        return "ATM";
      })();

      if (tradeChosen.recommendation === "LONG") {
        if (canSell && !preferBuy && putSpread) {
          suggestion = { style: "CREDIT_SPREAD", action: "SELL PUT SPREAD", spread: putSpread };
        } else {
          const pick = pickBuyStrike({ side: "CE", atmStrike: options.atmStrike, chainRows, moneynessPref });
          const prem = pick?.premium ?? cePremium;
          const inst = pick?.instrument ?? options.ce.key;
          const maxLoss = prem === null ? null : prem * qty;
          suggestion = {
            style: "BUY",
            action: "BUY CALL",
            instrument: inst,
            strike: pick?.strike ?? options.atmStrike,
            moneyness: pick?.moneyness ?? "ATM",
            delta: pick?.delta ?? null,
            premium: prem,
            quantity: qty,
            maxLoss,
          };
        }
      } else if (tradeChosen.recommendation === "SHORT") {
        if (canSell && !preferBuy && callSpread) {
          suggestion = { style: "CREDIT_SPREAD", action: "SELL CALL SPREAD", spread: callSpread };
        } else {
          const pick = pickBuyStrike({ side: "PE", atmStrike: options.atmStrike, chainRows, moneynessPref });
          const prem = pick?.premium ?? pePremium;
          const inst = pick?.instrument ?? options.pe.key;
          const maxLoss = prem === null ? null : prem * qty;
          suggestion = {
            style: "BUY",
            action: "BUY PUT",
            instrument: inst,
            strike: pick?.strike ?? options.atmStrike,
            moneyness: pick?.moneyness ?? "ATM",
            delta: pick?.delta ?? null,
            premium: prem,
            quantity: qty,
            maxLoss,
          };
        }
      }

      const putSpreadGreeks = putSpread
        ? {
            sell: greekFor(putSpread.legs.sell.strike, "PE", putSpread.legs.sell.premium),
            buy: greekFor(putSpread.legs.buy.strike, "PE", putSpread.legs.buy.premium),
          }
        : null;

      const callSpreadGreeks = callSpread
        ? {
            sell: greekFor(callSpread.legs.sell.strike, "CE", callSpread.legs.sell.premium),
            buy: greekFor(callSpread.legs.buy.strike, "CE", callSpread.legs.buy.premium),
          }
        : null;

      const positionalGreeks = (() => {
        const qtyContracts = qty;
        if (suggestion.style === "BUY") {
          const strike = typeof suggestion.strike === "number" ? suggestion.strike : options.atmStrike;
          const side: "CE" | "PE" = suggestion.action === "BUY CALL" ? "CE" : "PE";
          const g = greekFor(strike, side, suggestion.premium);
          if (!g) return null;
          return {
            delta: Number((g.delta * qtyContracts).toFixed(2)),
            gamma: Number((g.gamma * qtyContracts).toFixed(4)),
            thetaPerDay: Number((g.thetaPerDay * qtyContracts).toFixed(2)),
            vega: Number((g.vega * qtyContracts).toFixed(2)),
          };
        }
        if (suggestion.style === "CREDIT_SPREAD") {
          const pg = suggestion.action === "SELL PUT SPREAD" ? putSpreadGreeks : callSpreadGreeks;
          if (!pg?.sell || !pg?.buy) return null;
          // Short sell leg + long buy leg
          const delta = (-pg.sell.delta + pg.buy.delta) * qtyContracts;
          const gamma = (-pg.sell.gamma + pg.buy.gamma) * qtyContracts;
          const theta = (-pg.sell.thetaPerDay + pg.buy.thetaPerDay) * qtyContracts;
          const vega = (-pg.sell.vega + pg.buy.vega) * qtyContracts;
          return {
            delta: Number(delta.toFixed(2)),
            gamma: Number(gamma.toFixed(4)),
            thetaPerDay: Number(theta.toFixed(2)),
            vega: Number(vega.toFixed(2)),
          };
        }
        return null;
      })();

      const tradePlan = (() => {
        const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
        const tp = Number.isFinite(tpPct) ? clamp01(tpPct) : 0.25;
        const sl = Number.isFinite(slPct) ? clamp01(slPct) : 0.15;
        const take = Number.isFinite(creditTakePct) ? clamp01(creditTakePct) : 0.5;
        const stopMult = Number.isFinite(creditStopMult) && creditStopMult > 1 ? creditStopMult : 2;

        if (suggestion.style === "BUY") {
          const entry = suggestion.premium;
          if (entry === null || !Number.isFinite(entry)) return null;
          const target = entry * (1 + tp);
          const stop = entry * (1 - sl);
          return {
            kind: "BUY_PREMIUM" as const,
            entryPremium: Number(entry.toFixed(2)),
            targetPremium: Number(target.toFixed(2)),
            stopPremium: Number(stop.toFixed(2)),
            tpPct: Number(tp.toFixed(3)),
            slPct: Number(sl.toFixed(3)),
            note: "Targets/SL are heuristic on option premium; not guaranteed.",
          };
        }

        if (suggestion.style === "CREDIT_SPREAD") {
          const entry = suggestion.spread.netCredit;
          if (entry === null || !Number.isFinite(entry)) return null;
          // For short credit: profit as spread value decays. Target is buyback at (1-take)*credit.
          const targetBuyback = entry * (1 - take);
          const stopBuyback = entry * stopMult;
          return {
            kind: "CREDIT_SPREAD" as const,
            entryNetCredit: Number(entry.toFixed(2)),
            targetBuyback: Number(targetBuyback.toFixed(2)),
            stopBuyback: Number(stopBuyback.toFixed(2)),
            takePct: Number(take.toFixed(3)),
            stopMult: Number(stopMult.toFixed(2)),
            note: "Target/SL are based on spread buyback value; not guaranteed.",
          };
        }

        return null;
      })();

      const decision = (() => {
        const reasons: string[] = [];
        const take = suggestion.style !== "WAIT" && tradeChosen.recommendation !== "NO_TRADE";
        if (!take) reasons.push("engine=WAIT/NO_TRADE");
        if (effectiveNewsRisk === "high") reasons.push("newsRisk=high (avoid new risk)");
        if (regime.label === "VOLATILE" && suggestion.style === "CREDIT_SPREAD") reasons.push("regime=VOLATILE (selling risk higher)");
        if (positionalGreeks && Math.abs(positionalGreeks.thetaPerDay) > 500 && suggestion.style === "BUY") reasons.push("theta high vs move needed");
        return {
          takeTrade: take && effectiveNewsRisk !== "high",
          action: suggestion.style === "WAIT" ? "WAIT" : (suggestion as any).action,
          reasons,
        };
      })();

      optionsSuggestion = {
        expiry: options.expiry,
        atmStrike: options.atmStrike,
        atmBasis: {
          source: spotLtp !== null ? "spot" : "future",
          price: spotLtp !== null ? spotLtp : futLtp,
          spot: spot ? { instrument: spot.key, ltp: spotLtp } : null,
          future: { instrument: fut.key, ltp: futLtp },
        },
        atm: { ce: { instrument: options.ce.key, premium: cePremium }, pe: { instrument: options.pe.key, premium: pePremium } },
        creditSpreads: { put: putSpread, call: callSpread },
        suggestion,
        ivProxy: { straddle, impliedMovePct },
        tradePlan,
        greeks: {
          inputs: { underlyingPrice: Number.isFinite(S) ? Number(S.toFixed(2)) : null, r: Number(r.toFixed(4)), tYears: Number(T.toFixed(6)) },
          atm: atmGreeks,
          spreads: { put: putSpreadGreeks, call: callSpreadGreeks },
          position: positionalGreeks,
        },
        chain: {
          steps: Number.isFinite(chainSteps) ? chainSteps : null,
          strikes: chainRows,
          totals: {
            callOi: callOi || null,
            putOi: putOi || null,
            pcr: pcr === null ? null : Number(pcr.toFixed(4)),
            callOiChange: callOiChg || null,
            putOiChange: putOiChg || null,
          },
        },
        vix: vix ? { instrument: vix.key, value: vixValue } : null,
        regime,
        sweeps,
        decision,
      };
    }

    const pivotLevels = (() => {
      const refPx = spotLtp ?? futLtp;
      if (!refPx || !prevDayCandle) return null;
      return computePivotLevels(prevDayCandle.h, prevDayCandle.l, prevDayCandle.c, refPx);
    })();

    const stockSignalHistoryArr: StockSignalHistoryEntry[] = nseUniverse.map((w) => {
      const h = stockSignalHistory.get(w.key);
      return {
        key: w.key,
        symbol: w.key.includes(":") ? w.key.split(":")[1] : w.key,
        lastBuy: h?.lastBuy ?? null,
        lastSell: h?.lastSell ?? null,
        lastSpartanUp: h?.lastSpartanUp ?? null,
        lastSpartanDn: h?.lastSpartanDn ?? null,
        lastSurfingUp: h?.lastSurfingUp ?? null,
        lastSurfingDn: h?.lastSurfingDn ?? null,
      };
    });

    // Compute lifecycle state from current signals
    const spartanUp = stockSignals.filter((r) => r.label === "SPARTAN_UP").length;
    const spartanDn = stockSignals.filter((r) => r.label === "SPARTAN_DN").length;
    const surfingUp = stockSignals.filter((r) => r.label === "SURFINGUP").length;
    const surfingDn = stockSignals.filter((r) => r.label === "SURFINGDN").length;

    const lifecycle = computeLifecycle({
      s1rec: String(s1.recommendation ?? "NO_TRADE"),
      s1conf: typeof s1.confidence === "number" ? s1.confidence : null,
      s1rsi: typeof s1.signals?.rsi14 === "number" ? s1.signals.rsi14 : null,
      s5rec: String(s5.recommendation ?? "NO_TRADE"),
      s5conf: typeof s5.confidence === "number" ? s5.confidence : null,
      s5rsi: typeof s5.signals?.rsi14 === "number" ? s5.signals.rsi14 : null,
      s15rec: String(s15.recommendation ?? "NO_TRADE"),
      s15conf: typeof s15.confidence === "number" ? s15.confidence : null,
      weightedMovePct: breadth.weighted_move_pct ?? 0,
      advancers: breadth.advancers ?? 0,
      decliners: breadth.decliners ?? 0,
      buySellImbalance: breadth.buy_sell_imbalance ?? null,
      spartanUp,
      spartanDn,
      surfingUp,
      surfingDn,
      pcr: optionsSuggestion?.chain?.totals?.pcr ?? null,
      vix: vixValue,
      impliedMovePct: optionsSuggestion?.ivProxy?.impliedMovePct ?? null,
      cePremium: optionsSuggestion?.atm?.ce?.premium ?? null,
      pePremium: optionsSuggestion?.atm?.pe?.premium ?? null,
      tpPct,
      slPct,
    });

    // Keep a rolling history for the replay table
    lifecycleHistory.push(lifecycle);
    if (lifecycleHistory.length > MAX_LIFECYCLE_HISTORY) {
      lifecycleHistory.splice(0, lifecycleHistory.length - MAX_LIFECYCLE_HISTORY);
    }

    return {
      asof: new Date().toISOString(),
      optionsOnly,
      tradeTimeframeRequested: tradeTf as any,
      tradeTimeframe: resolvedTradeTf,
      future: fut.key,
      futureLtp: futLtp,
      quantity: lotSize * lots,
      suggestion: chosen,
      timeframes: { "1m": s1, "5m": s5, "15m": s15 },
      breadth,
      stockSignals,
      stockLogs: [...stockLogs],
      stockSignalHistory: stockSignalHistoryArr,
      pivotLevels,
      lifecycle,
      lifecycleHistory: [...lifecycleHistory],
      rms: { maxDailyLoss: maxDailyLossVal, maxRiskPerTrade: maxRiskPerTradeVal },
      options: optionsSuggestion,
      news: news
        ? {
            level: effectiveNewsRisk,
            score: news.score,
            headlines: news.headlines,
            signals: news.signals,
          }
        : { level: effectiveNewsRisk, score: null, headlines: [], signals: null },
      notes: [
        "probability/win% are empirical estimates from recent candles; not guaranteed",
        "options suggestion supports BUY (max loss=premium) and defined-risk CREDIT SPREADS (max loss bounded)",
        "news risk is derived from GDELT + official feeds (or can be forced with --newsRisk)",
        "engine is analysis-only; paper trade before live",
      ],
    };
  }

  async function waitFor(predicate: () => boolean, timeoutMs: number, pollMs = 50): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return predicate();
  }

  async function runOnce(): Promise<void> {
    const ok = await waitFor(() => connected, 10_000, 50);
    if (!ok) throw new Error("Ticker did not connect in time");

    const gotFut = await waitFor(() => {
      const t = latest.get(fut.token);
      return Number.isFinite(Number(t?.last_price)) || Number.isFinite(Number(t?.ohlc?.close));
    }, 10_000);
    if (!gotFut) throw new Error("Did not receive future tick in time");

    const futTick = latest.get(fut.token);
    const futLast = Number(futTick?.last_price);
    const futPrevClose = Number(futTick?.ohlc?.close);
    const spotLast = spot ? Number(latest.get(spot.token)?.last_price) : NaN;
    const spotPx = Number.isFinite(spotLast) ? spotLast : NaN;
    const refPx = Number.isFinite(spotPx) ? spotPx : (futLast || futPrevClose || 0);
    const atmStrike = nearestStrike(refPx, optStep);

    if (atmStrike > 0) {
      try {
        options = await resolveAtmOptions({ underlying, expiry: optionExpiry, atmStrike });
        const dist = creditDistance;
        const width = creditWidth;
        const sellPutStrike = roundToStep(atmStrike - dist, optStep);
        const buyPutStrike = roundToStep(sellPutStrike - width, optStep);
        const sellCallStrike = roundToStep(atmStrike + dist, optStep);
        const buyCallStrike = roundToStep(sellCallStrike + width, optStep);

        const [sp, bp, sc, bc] = await Promise.all([
          resolveOptionInstrument({ underlying, expiry: optionExpiry, strike: sellPutStrike, type: "PE" }),
          resolveOptionInstrument({ underlying, expiry: optionExpiry, strike: buyPutStrike, type: "PE" }),
          resolveOptionInstrument({ underlying, expiry: optionExpiry, strike: sellCallStrike, type: "CE" }),
          resolveOptionInstrument({ underlying, expiry: optionExpiry, strike: buyCallStrike, type: "CE" }),
        ]);

        spreadLegs = {
          putCredit: { sell: sp, buy: bp },
          callCredit: { sell: sc, buy: bc },
        };

        // Option chain around ATM for OI/PCR/greeks context.
        const steps = Number.isFinite(chainSteps) ? Math.max(0, Math.min(10, Math.floor(chainSteps))) : 0;
        if (steps > 0) {
          const strikes = new Set<number>();
          for (let i = -steps; i <= steps; i++) {
            const s = roundToStep(atmStrike + i * optStep, optStep);
            if (s > 0) strikes.add(s);
          }
          const strikeList = [...strikes.values()].sort((a, b) => a - b);
          const resolved = await Promise.all(
            strikeList.map(async (strike) => {
              const [ce, pe] = await Promise.all([
                resolveOptionInstrument({ underlying, expiry: optionExpiry, strike, type: "CE" }),
                resolveOptionInstrument({ underlying, expiry: optionExpiry, strike, type: "PE" }),
              ]);
              return { strike, ce, pe } satisfies ChainStrike;
            }),
          );
          chain = resolved;
        }

        const chainTokens = chain.flatMap((c) => [c.ce.token, c.pe.token]);
        const optTokens = [options.ce.token, options.pe.token, sp.token, bp.token, sc.token, bc.token, ...chainTokens];
        const newOnes = optTokens.filter((t) => !subscribedOptionTokens.includes(t));
        if (newOnes.length) {
          subscribedOptionTokens = [...subscribedOptionTokens, ...newOnes];
          ticker.subscribe(newOnes);
          ticker.setMode(ticker.modeMap?.[mode] ?? mode, newOnes);
          // eslint-disable-next-line no-console
          console.error(JSON.stringify({ event: "options_subscribe", expiry: optionExpiry, atmStrike, tokens: newOnes }));
        }

        // Best-effort: wait briefly for option ticks so premiums can populate.
        await waitFor(
          () =>
            latest.has(options!.ce.token) &&
            latest.has(options!.pe.token) &&
            latest.has(sp.token) &&
            latest.has(bp.token) &&
            latest.has(sc.token) &&
            latest.has(bc.token),
          2_000,
          50,
        );
      } catch {
        // ignore options in --once mode if resolution fails
      }
    }

    await refreshNewsIfNeeded();

    const snap = buildOutputSnapshot();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(snap));
    if (telegram) {
      telegram.maybeSendSignal(snap).catch(() => {
        // ignore
      });
      telegram.maybeSendStockFlow(snap).catch(() => {
        // ignore
      });
    }

    try {
      ticker.disconnect();
    } catch {}
  }

  if (once) {
    await runOnce();
    process.exit(0);
  }

  const timer = setInterval(() => {
    if (!connected) return;

    // Fire-and-forget news refresh (cached).
    refreshNewsIfNeeded().catch(() => {
      // ignore
    });

    // Options: resolve/subscribe ATM options for the configured expiry.
    try {
      const futTick = latest.get(fut.token);
      const futLast = Number(futTick?.last_price);
      const futPrevClose = Number(futTick?.ohlc?.close);
      const spotLast = spot ? Number(latest.get(spot.token)?.last_price) : NaN;
      const spotPx = Number.isFinite(spotLast) ? spotLast : NaN;
      const refPx = Number.isFinite(spotPx) ? spotPx : (futLast || futPrevClose || 0);
      const atmStrike = nearestStrike(refPx, optStep);
      const need = atmStrike > 0 && (!options || options.atmStrike !== atmStrike || options.expiry !== optionExpiry);
      if (need && !optionsResolveInFlight) {
        optionsResolveInFlight = true;
        (async () => {
          const sel = await resolveAtmOptions({ underlying, expiry: optionExpiry, atmStrike });

          const dist = creditDistance;
          const width = creditWidth;
          const sellPutStrike = roundToStep(atmStrike - dist, optStep);
          const buyPutStrike = roundToStep(sellPutStrike - width, optStep);
          const sellCallStrike = roundToStep(atmStrike + dist, optStep);
          const buyCallStrike = roundToStep(sellCallStrike + width, optStep);

          const [sp, bp, sc, bc] = await Promise.all([
            resolveOptionInstrument({ underlying, expiry: optionExpiry, strike: sellPutStrike, type: "PE" }),
            resolveOptionInstrument({ underlying, expiry: optionExpiry, strike: buyPutStrike, type: "PE" }),
            resolveOptionInstrument({ underlying, expiry: optionExpiry, strike: sellCallStrike, type: "CE" }),
            resolveOptionInstrument({ underlying, expiry: optionExpiry, strike: buyCallStrike, type: "CE" }),
          ]);

          options = sel;
          spreadLegs = {
            putCredit: { sell: sp, buy: bp },
            callCredit: { sell: sc, buy: bc },
          };

          const steps = Number.isFinite(chainSteps) ? Math.max(0, Math.min(10, Math.floor(chainSteps))) : 0;
          if (steps > 0) {
            const strikes = new Set<number>();
            for (let i = -steps; i <= steps; i++) {
              const s = roundToStep(atmStrike + i * optStep, optStep);
              if (s > 0) strikes.add(s);
            }
            const strikeList = [...strikes.values()].sort((a, b) => a - b);
            const resolved = await Promise.all(
              strikeList.map(async (strike) => {
                const [ce, pe] = await Promise.all([
                  resolveOptionInstrument({ underlying, expiry: optionExpiry, strike, type: "CE" }),
                  resolveOptionInstrument({ underlying, expiry: optionExpiry, strike, type: "PE" }),
                ]);
                return { strike, ce, pe } satisfies ChainStrike;
              }),
            );
            chain = resolved;
          } else {
            chain = [];
          }

          const chainTokens = chain.flatMap((c) => [c.ce.token, c.pe.token]);
          const optTokens = [sel.ce.token, sel.pe.token, sp.token, bp.token, sc.token, bc.token, ...chainTokens];
          const newOnes = optTokens.filter((t) => !subscribedOptionTokens.includes(t));
          if (newOnes.length) {
            subscribedOptionTokens = [...subscribedOptionTokens, ...newOnes];
            ticker.subscribe(newOnes);
            ticker.setMode(ticker.modeMap?.[mode] ?? mode, newOnes);
            // eslint-disable-next-line no-console
            console.error(JSON.stringify({ event: "options_subscribe", expiry: optionExpiry, atmStrike, tokens: newOnes }));
          }
        })()
          .catch(() => {
            // ignore, keep running
          })
          .finally(() => {
            optionsResolveInFlight = false;
          });
      }
    } catch {
      // ignore
    }

    const snap = buildOutputSnapshot();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(snap));
    if (telegram) {
      telegram.maybeSendSignal(snap).catch(() => {
        // ignore
      });
      telegram.maybeSendStockFlow(snap).catch(() => {
        // ignore
      });
    }
  }, intervalMs);

  process.on("SIGINT", () => {
    clearInterval(timer);
    try {
      ticker.disconnect();
    } catch {}
    process.exit(0);
  });
}

main().catch((err) => {
  const anyErr = err as any;
  const isToken =
    anyErr?.error_type === "TokenException" ||
    /Incorrect `api_key` or `access_token`/i.test(String(anyErr?.message ?? "")) ||
    /TokenException/i.test(String(anyErr?.error_type ?? ""));

  if (isToken) {
    // eslint-disable-next-line no-console
    console.error(
      "Kite access token invalid/expired. Re-generate session and try again:\n" +
        "  1) npm run login:url\n" +
        "  2) npm run session:generate -- --request_token <TOKEN_FROM_REDIRECT>\n",
    );
  }

  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
