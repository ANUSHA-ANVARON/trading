import type { Candle } from "../core/types";

// ── Helpers ────────────────────────────────────────────────────────────────

function emaArray(values: number[], period: number): number[] | null {
  if (period <= 0 || values.length < period) return null;
  const k = 2 / (period + 1);
  const result: number[] = [];
  let e = values[0];
  for (let i = 0; i < values.length; i++) {
    e = i === 0 ? values[0] : values[i] * k + e * (1 - k);
    result.push(e);
  }
  return result;
}

// ── Trend ──────────────────────────────────────────────────────────────────

export function sma(values: number[], period: number): number | null {
  if (period <= 0) throw new Error("period must be > 0");
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(values: number[], period: number): number | null {
  if (period <= 0) throw new Error("period must be > 0");
  const arr = emaArray(values, period);
  return arr ? arr[arr.length - 1] : null;
}

/** Double EMA: 2×EMA(n) − EMA(EMA(n)) */
export function dema(values: number[], period: number): number | null {
  const e1 = emaArray(values, period);
  if (!e1) return null;
  const e2 = emaArray(e1, period);
  if (!e2) return null;
  return 2 * e1[e1.length - 1] - e2[e2.length - 1];
}

/** Weighted Moving Average */
export function wma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const slice = values.slice(values.length - period);
  let sum = 0, weightSum = 0;
  for (let i = 0; i < slice.length; i++) {
    const w = i + 1;
    sum += slice[i] * w;
    weightSum += w;
  }
  return sum / weightSum;
}

/** Linear Regression Curve — last value on the regression line over `period` bars */
export function linearRegressionCurve(values: number[], period = 20): number | null {
  if (period <= 0 || values.length < period) return null;
  const slice = values.slice(values.length - period);
  const n = slice.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += slice[i]; sumXY += i * slice[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return slope * (n - 1) + intercept;
}

// ── Momentum ───────────────────────────────────────────────────────────────

export function rsi(values: number[], period = 14): number | null {
  if (period <= 0) throw new Error("period must be > 0");
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  const start = values.length - (period + 1);
  for (let i = start + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses += -diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export type MACDResult = { macd: number; signal: number; histogram: number };

/** MACD (12/26/9 default) */
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MACDResult | null {
  if (values.length < slow + signalPeriod) return null;
  const e12 = emaArray(values, fast);
  const e26 = emaArray(values, slow);
  if (!e12 || !e26) return null;
  const macdLine = e12.map((v, i) => v - e26[i]);
  const sig = emaArray(macdLine, signalPeriod);
  if (!sig) return null;
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSig  = sig[sig.length - 1];
  return { macd: +lastMacd.toFixed(2), signal: +lastSig.toFixed(2), histogram: +(lastMacd - lastSig).toFixed(2) };
}

/** Rate-of-change momentum: close − close[period] */
export function momentum(values: number[], period = 10): number | null {
  if (values.length < period + 1) return null;
  return values[values.length - 1] - values[values.length - 1 - period];
}

/** True Strength Index (double-smoothed momentum oscillator) */
export function tsi(values: number[], longPeriod = 25, shortPeriod = 13): number | null {
  if (values.length < longPeriod + shortPeriod + 2) return null;
  const changes    = values.slice(1).map((v, i) => v - values[i]);
  const absChanges = changes.map(Math.abs);
  const s1  = emaArray(changes,    longPeriod);
  const s2  = s1  ? emaArray(s1,  shortPeriod) : null;
  const as1 = emaArray(absChanges, longPeriod);
  const as2 = as1 ? emaArray(as1, shortPeriod) : null;
  if (!s2 || !as2) return null;
  const den = as2[as2.length - 1];
  if (den === 0) return null;
  return +(100 * s2[s2.length - 1] / den).toFixed(2);
}

// ── Volatility ─────────────────────────────────────────────────────────────

function trueRange(prevClose: number, high: number, low: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

export function atr(candles: Candle[], period = 14): number | null {
  if (period <= 0) throw new Error("period must be > 0");
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    trs.push(trueRange(candles[i - 1].close, candles[i].high, candles[i].low));
  }
  return sma(trs, period);
}

export type BollingerBands = { upper: number; middle: number; lower: number; bandwidth: number; pctB: number };

export function bollingerBands(values: number[], period = 20, stdDevMult = 2): BollingerBands | null {
  if (period <= 0) throw new Error("period must be > 0");
  if (values.length < period) return null;
  const slice  = values.slice(values.length - period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + stdDevMult * stdDev;
  const lower = middle - stdDevMult * stdDev;
  const price = values[values.length - 1];
  const bandwidth = middle !== 0 ? (upper - lower) / middle : 0;
  const pctB = upper !== lower ? (price - lower) / (upper - lower) : 0.5;
  return { upper: +upper.toFixed(2), middle: +middle.toFixed(2), lower: +lower.toFixed(2), bandwidth: +bandwidth.toFixed(4), pctB: +pctB.toFixed(4) };
}

/** Population standard deviation over `period` bars */
export function stdDev(values: number[], period = 20): number | null {
  if (period <= 0 || values.length < period) return null;
  const slice = values.slice(values.length - period);
  const mean  = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  return +Math.sqrt(variance).toFixed(4);
}

/** Historical close-to-close volatility, annualised % */
export function historicalVolatility(values: number[], period = 20): number | null {
  if (values.length < period + 1) return null;
  const slice = values.slice(values.length - period - 1);
  const logReturns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] <= 0) return null;
    logReturns.push(Math.log(slice[i] / slice[i - 1]));
  }
  const mean     = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / logReturns.length;
  // Annualise assuming ~252 trading days × (390 candles for 1m / 78 for 5m / 26 for 15m)
  return +(Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(2);
}

// ── Volume ─────────────────────────────────────────────────────────────────

/** Price Volume Trend — cumulative running indicator */
export function pvt(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  let result = 0;
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i].volume ?? 0;
    const prevClose = candles[i - 1].close;
    if (prevClose === 0) continue;
    result += vol * (candles[i].close - prevClose) / prevClose;
  }
  return +result.toFixed(0);
}

/** Volume-weighted average price over last `period` candles (Volume Fixed Range proxy) */
export function vwap(candles: Candle[], period = 20): number | null {
  if (!candles.length) return null;
  const slice = candles.slice(-period);
  let sumPV = 0, sumV = 0;
  for (const c of slice) {
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.volume ?? 1;
    sumPV += typical * vol;
    sumV  += vol;
  }
  return sumV === 0 ? null : +(sumPV / sumV).toFixed(2);
}

// ── Swing ──────────────────────────────────────────────────────────────────

function swingIndex(prev: Candle, curr: Candle): number {
  const C = curr.close, C1 = prev.close, O = curr.open, O1 = prev.open;
  const H = curr.high,  L  = curr.low;
  const num = (C - C1) + 0.5 * (C - O) + 0.25 * (C1 - O1);
  const R   = Math.max(Math.abs(H - C1), Math.abs(L - C1), H - L);
  return R === 0 ? 0 : 50 * num / R;
}

/** Accumulating Swing Index — cumulative sum of per-bar Wilder swing index */
export function asi(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  let result = 0;
  for (let i = 1; i < candles.length; i++) result += swingIndex(candles[i - 1], candles[i]);
  return +result.toFixed(2);
}
