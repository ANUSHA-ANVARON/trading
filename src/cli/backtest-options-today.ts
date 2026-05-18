import { getArgValue } from "./_args";
import { niftySessionRangeForIstDay } from "../time/ist";
import { pickNearestWeeklyNiftyOptionExpiry } from "../analysis/defaults";
import { getHistorical, type HistoricalCandle } from "../kite/marketData";
import { getInstruments } from "../instruments/instrumentsCache";
import { sma, atr } from "../analysis/indicators";
import type { Candle as CoreCandle } from "../core/types";

type Resolved = {
  key: string;
  token: number;
  tradingsymbol: string;
  lotSize: number;
  strike?: number;
  type?: "CE" | "PE";
};

function nearestStrike(price: number, step = 50): number {
  if (!Number.isFinite(price) || step <= 0) return 0;
  return Math.round(price / step) * step;
}

function roundToStep(n: number, step: number): number {
  if (!Number.isFinite(n) || step <= 0) return 0;
  return Math.round(n / step) * step;
}

async function resolveNiftyFutureToken(underlying: string): Promise<Resolved> {
  const futKey = await (await import("../analysis/defaults")).pickNearExpiryNiftyFutureKey(underlying);
  const [, tradingsymbol] = futKey.split(":");
  const nfo = await getInstruments("NFO");
  const inst = nfo.find(
    (i) => (i.exchange ?? "").toUpperCase() === "NFO" && (i.tradingsymbol ?? "") === tradingsymbol,
  );
  if (!inst?.instrument_token) throw new Error(`Could not resolve future token for ${futKey}`);
  return { key: futKey, token: Number(inst.instrument_token), tradingsymbol, lotSize: Number(inst.lot_size ?? 0) };
}

async function resolveOptionInstrument(params: {
  underlying: string;
  expiry: string;
  strike: number;
  type: "CE" | "PE";
}): Promise<Resolved> {
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

  let nfo = await getInstruments("NFO");
  let inst = findIn(nfo as any);
  if (!inst?.instrument_token) {
    nfo = await getInstruments("NFO", { refresh: true });
    inst = findIn(nfo as any);
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

function candleKey(c: HistoricalCandle): string {
  const d = typeof c.date === "string" ? new Date(c.date) : c.date;
  // normalize to minute key in ISO (UTC)
  return new Date(d).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

function indexCandles(candles: HistoricalCandle[]): Map<string, HistoricalCandle> {
  const m = new Map<string, HistoricalCandle>();
  for (const c of candles) m.set(candleKey(c), c);
  return m;
}

type Trade = {
  entryTs: string;
  exitTs: string;
  style: "BUY" | "CREDIT_SPREAD";
  side: "LONG" | "SHORT";
  pnl: number;
  maxLoss: number | null;
};

async function main() {
  const underlying = getArgValue("--underlying") ?? "NIFTY";
  const expiry = getArgValue("--expiry") ?? (await pickNearestWeeklyNiftyOptionExpiry(underlying));

  const optStep = Number(getArgValue("--optStep") ?? getArgValue("--opt-step") ?? "50");
  const creditDistance = Number(getArgValue("--creditDistance") ?? getArgValue("--credit-distance") ?? "100");
  const creditWidth = Number(getArgValue("--creditWidth") ?? getArgValue("--credit-width") ?? "100");

  const fast = Number(getArgValue("--fast") ?? "9");
  const slow = Number(getArgValue("--slow") ?? "21");
  const lots = Number(getArgValue("--lots") ?? "1");
  const feePerOrder = Number(getArgValue("--fee") ?? "20");

  const today = new Date();
  const session = niftySessionRangeForIstDay(today);
  const from = session.from;
  const to = new Date(Math.min(Date.now(), session.to.getTime()));
  if (to.getTime() <= from.getTime()) {
    throw new Error("Market session not started yet (IST). Try again after 09:15 IST.");
  }

  const fut = await resolveNiftyFutureToken(underlying);

  // Fetch FUT minute candles for today.
  const futCandles = await getHistorical(fut.token, from, to, "minute", { continuous: false, oi: false });
  if (futCandles.length < slow + 5) {
    throw new Error(`Not enough FUT candles (${futCandles.length}) to backtest today.`);
  }

  const coreCandles: CoreCandle[] = futCandles.map((c) => {
    const d = typeof c.date === "string" ? new Date(c.date) : c.date;
    return {
      time: new Date(d).toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    };
  });

  const closes = futCandles.map((c) => c.close);

  // Fix strikes for the day based on the first available FUT close.
  const refPx = futCandles[Math.min(slow, futCandles.length - 1)].close;
  const atm = nearestStrike(refPx, optStep);
  const sellPutStrike = roundToStep(atm - creditDistance, optStep);
  const buyPutStrike = roundToStep(sellPutStrike - creditWidth, optStep);
  const sellCallStrike = roundToStep(atm + creditDistance, optStep);
  const buyCallStrike = roundToStep(sellCallStrike + creditWidth, optStep);

  const [atmCE, atmPE, sp, bp, sc, bc] = await Promise.all([
    resolveOptionInstrument({ underlying, expiry, strike: atm, type: "CE" }),
    resolveOptionInstrument({ underlying, expiry, strike: atm, type: "PE" }),
    resolveOptionInstrument({ underlying, expiry, strike: sellPutStrike, type: "PE" }),
    resolveOptionInstrument({ underlying, expiry, strike: buyPutStrike, type: "PE" }),
    resolveOptionInstrument({ underlying, expiry, strike: sellCallStrike, type: "CE" }),
    resolveOptionInstrument({ underlying, expiry, strike: buyCallStrike, type: "CE" }),
  ]);

  const qty = (atmCE.lotSize || fut.lotSize || 50) * lots;

  const [ceCand, peCand, spCand, bpCand, scCand, bcCand] = await Promise.all([
    getHistorical(atmCE.token, from, to, "minute"),
    getHistorical(atmPE.token, from, to, "minute"),
    getHistorical(sp.token, from, to, "minute"),
    getHistorical(bp.token, from, to, "minute"),
    getHistorical(sc.token, from, to, "minute"),
    getHistorical(bc.token, from, to, "minute"),
  ]);

  const ceIdx = indexCandles(ceCand);
  const peIdx = indexCandles(peCand);
  const spIdx = indexCandles(spCand);
  const bpIdx = indexCandles(bpCand);
  const scIdx = indexCandles(scCand);
  const bcIdx = indexCandles(bcCand);

  const trades: Trade[] = [];

  let pos: null | { side: "LONG" | "SHORT"; style: "BUY" | "CREDIT_SPREAD"; entryKey: string; entryPx: any } = null;

  function getNextKey(i: number): string | null {
    if (i + 1 >= futCandles.length) return null;
    return candleKey(futCandles[i + 1]);
  }

  function atrPctAt(i: number): number | null {
    const a = atr(coreCandles.slice(0, i + 1), 14);
    if (a === null) return null;
    const px = closes[i];
    if (!Number.isFinite(px) || px === 0) return null;
    return (a / px) * 100;
  }

  function decideStyle(i: number, confidenceProxyValue: number): "BUY" | "CREDIT_SPREAD" {
    const atrp = atrPctAt(i);
    // Conservative: only allow credit spread in calm regime.
    if (atrp !== null && atrp < 0.7 && confidenceProxyValue >= 0.65) return "CREDIT_SPREAD";
    return "BUY";
  }

  function confidenceProxy(i: number): number {
    // Simple proxy: normalized SMA separation.
    const f = sma(closes.slice(0, i + 1), fast);
    const s = sma(closes.slice(0, i + 1), slow);
    if (f === null || s === null) return 0;
    const sep = Math.abs(f - s) / closes[i];
    return Math.max(0, Math.min(1, sep * 50));
  }

  for (let i = 0; i < futCandles.length - 2; i++) {
    const f = sma(closes.slice(0, i + 1), fast);
    const s = sma(closes.slice(0, i + 1), slow);
    if (f === null || s === null) continue;

    const signal: "LONG" | "SHORT" | "FLAT" = f > s ? "LONG" : f < s ? "SHORT" : "FLAT";
    const nextKey = getNextKey(i);
    if (!nextKey) continue;

    // Exit on FLAT or flip.
    if (pos) {
      const shouldExit = signal === "FLAT" || signal !== pos.side;
      if (shouldExit) {
        const exitKey = nextKey;
        let pnl = 0;
        let maxLoss: number | null = null;

        if (pos.style === "BUY") {
          const ent = pos.entryPx as { kind: "CE" | "PE"; entry: number };
          const exitC: HistoricalCandle | undefined = ent.kind === "CE" ? ceIdx.get(exitKey) : peIdx.get(exitKey);
          if (exitC) {
            pnl = (exitC.open - ent.entry) * qty;
            maxLoss = ent.entry * qty;
          }
          pnl -= feePerOrder * 2; // 1 leg entry+exit
        } else {
          const ent = pos.entryPx as { kind: "PUT_CREDIT" | "CALL_CREDIT"; sell: number; buy: number };
          let sellExit: HistoricalCandle | undefined;
          let buyExit: HistoricalCandle | undefined;
          if (ent.kind === "PUT_CREDIT") {
            sellExit = spIdx.get(exitKey);
            buyExit = bpIdx.get(exitKey);
          } else {
            sellExit = scIdx.get(exitKey);
            buyExit = bcIdx.get(exitKey);
          }
          if (sellExit && buyExit) {
            const entryCredit = ent.sell - ent.buy;
            const exitDebit = sellExit.open - buyExit.open;
            pnl = (entryCredit - exitDebit) * qty;
            maxLoss = (creditWidth - entryCredit) * qty;
          }
          pnl -= feePerOrder * 4; // 2 legs entry+exit
        }

        trades.push({ entryTs: pos.entryKey, exitTs: exitKey, style: pos.style, side: pos.side, pnl, maxLoss });
        pos = null;
      }
    }

    // Enter if flat and have directional signal.
    if (!pos && signal !== "FLAT") {
      const cp = confidenceProxy(i);
      const style = decideStyle(i, cp);
      const entryKey = nextKey;

      if (style === "BUY") {
        const c: HistoricalCandle | undefined = signal === "LONG" ? ceIdx.get(entryKey) : peIdx.get(entryKey);
        if (!c) continue;
        pos = { side: signal, style, entryKey, entryPx: { kind: signal === "LONG" ? "CE" : "PE", entry: c.open } };
        continue;
      }

      // CREDIT_SPREAD
      if (signal === "LONG") {
        const sellC = spIdx.get(entryKey);
        const buyC = bpIdx.get(entryKey);
        if (!sellC || !buyC) continue;
        pos = { side: signal, style, entryKey, entryPx: { kind: "PUT_CREDIT", sell: sellC.open, buy: buyC.open } };
      } else {
        const sellC = scIdx.get(entryKey);
        const buyC = bcIdx.get(entryKey);
        if (!sellC || !buyC) continue;
        pos = { side: signal, style, entryKey, entryPx: { kind: "CALL_CREDIT", sell: sellC.open, buy: buyC.open } };
      }
    }
  }

  const total = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl <= 0).length;
  const winRate = trades.length ? wins / trades.length : 0;

  const out = {
    day: "today",
    underlying,
    expiry,
    strikes: { optStep, atm, creditDistance, creditWidth, sellPutStrike, buyPutStrike, sellCallStrike, buyCallStrike },
    instruments: {
      fut: fut.key,
      atmCE: atmCE.key,
      atmPE: atmPE.key,
      putCredit: { sell: sp.key, buy: bp.key },
      callCredit: { sell: sc.key, buy: bc.key },
    },
    qty,
    params: { fast, slow, feePerOrder, lots },
    stats: { trades: trades.length, wins, losses, winRate: Number(winRate.toFixed(3)), pnl: Number(total.toFixed(2)) },
    trades: trades.slice(-50),
    notes: [
      "This is an intraday backtest using FUT SMA cross signals and option minute candles.",
      "Strikes are fixed for the day (picked from early-session FUT price); real ATM shifts intraday.",
      "This is analysis-only, not financial advice.",
    ],
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
