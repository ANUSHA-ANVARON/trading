import type { Candle } from "../core/types";

export function sma(values: number[], period: number): number | null {
  if (period <= 0) throw new Error("period must be > 0");
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

export function ema(values: number[], period: number): number | null {
  if (period <= 0) throw new Error("period must be > 0");
  if (values.length < period) return null;

  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

export function rsi(values: number[], period = 14): number | null {
  if (period <= 0) throw new Error("period must be > 0");
  if (values.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  const start = values.length - (period + 1);
  for (let i = start + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function trueRange(prevClose: number, high: number, low: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

export function atr(candles: Candle[], period = 14): number | null {
  if (period <= 0) throw new Error("period must be > 0");
  if (candles.length < period + 1) return null;

  const trs: number[] = [];
  for (let i = candles.length - (period + 1) + 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    trs.push(trueRange(prevClose, candles[i].high, candles[i].low));
  }

  return sma(trs, period);
}

export type BollingerBands = {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number; // (upper - lower) / middle
  pctB: number;      // where price sits within bands: 0=lower, 1=upper
};

export function bollingerBands(values: number[], period = 20, stdDevMult = 2): BollingerBands | null {
  if (period <= 0) throw new Error("period must be > 0");
  if (values.length < period) return null;

  const slice = values.slice(values.length - period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + stdDevMult * stdDev;
  const lower = middle - stdDevMult * stdDev;
  const price = values[values.length - 1];
  const bandwidth = middle !== 0 ? (upper - lower) / middle : 0;
  const pctB = upper !== lower ? (price - lower) / (upper - lower) : 0.5;

  return { upper: +upper.toFixed(2), middle: +middle.toFixed(2), lower: +lower.toFixed(2), bandwidth: +bandwidth.toFixed(4), pctB: +pctB.toFixed(4) };
}
