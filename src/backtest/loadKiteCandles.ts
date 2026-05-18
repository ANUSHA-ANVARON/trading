import { getHistorical } from "../kite/marketData";
import type { Candle } from "../core/types";

export async function loadKiteCandles(params: {
  instrumentToken: number;
  from: Date;
  to: Date;
  interval: "minute" | "5minute" | "15minute";
  oi?: boolean;
}): Promise<Candle[]> {
  const candles = await getHistorical(params.instrumentToken, params.from, params.to, params.interval, {
    continuous: false,
    oi: params.oi ?? false,
  });

  return (candles ?? []).map((c) => ({
    time: (c.date instanceof Date ? c.date : new Date(c.date)).toISOString(),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
  }));
}
