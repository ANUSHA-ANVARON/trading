import type { Candle } from "../core/types";

function floorToBucketMs(tsMs: number, bucketMs: number): number {
  return Math.floor(tsMs / bucketMs) * bucketMs;
}

export class CandleAggregator {
  private readonly bucketMs: number;
  private readonly maxCandles: number;

  private current:
    | {
        bucketStartMs: number;
        open: number;
        high: number;
        low: number;
        close: number;
      }
    | null = null;

  private readonly closed: Candle[] = [];

  constructor(params: { timeframeSec: number; maxCandles?: number }) {
    if (!Number.isFinite(params.timeframeSec) || params.timeframeSec <= 0) {
      throw new Error("timeframeSec must be > 0");
    }
    this.bucketMs = Math.round(params.timeframeSec * 1000);
    this.maxCandles = params.maxCandles ?? 600;
  }

  onTick(price: number, ts: Date): void {
    if (!Number.isFinite(price)) return;
    const tsMs = ts.getTime();
    const bucketStartMs = floorToBucketMs(tsMs, this.bucketMs);

    if (!this.current) {
      this.current = { bucketStartMs, open: price, high: price, low: price, close: price };
      return;
    }

    if (bucketStartMs !== this.current.bucketStartMs) {
      // finalize previous bucket
      this.closed.push({
        time: new Date(this.current.bucketStartMs).toISOString(),
        open: this.current.open,
        high: this.current.high,
        low: this.current.low,
        close: this.current.close,
      });
      if (this.closed.length > this.maxCandles) this.closed.splice(0, this.closed.length - this.maxCandles);

      this.current = { bucketStartMs, open: price, high: price, low: price, close: price };
      return;
    }

    this.current.high = Math.max(this.current.high, price);
    this.current.low = Math.min(this.current.low, price);
    this.current.close = price;
  }

  getClosedCandles(): Candle[] {
    return [...this.closed];
  }

  getLastClosed(): Candle | null {
    return this.closed.length ? this.closed[this.closed.length - 1] : null;
  }

  seedClosedCandles(candles: Candle[]): void {
    if (!Array.isArray(candles) || candles.length === 0) return;

    const normalized = candles
      .filter((c) => c && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close) && !!c.time)
      .slice(-this.maxCandles);

    this.closed.splice(0, this.closed.length, ...normalized);
  }
}
