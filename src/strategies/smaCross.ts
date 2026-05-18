import type { Candle, Side } from "../core/types";
import type { Strategy, StrategyContext, StrategyState } from "../core/strategy";

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

export type SmaCrossParams = {
  fast: number;
  slow: number;
  lots: number; // number of lots to trade
};

export function createSmaCrossStrategy(params: SmaCrossParams): Strategy {
  if (params.fast >= params.slow) throw new Error("fast must be < slow");

  return {
    name: `sma-cross-${params.fast}-${params.slow}`,

    onCandle(candle: Candle, state: StrategyState, ctx: StrategyContext) {
      const closes = (state.closes as number[] | undefined) ?? [];
      closes.push(candle.close);
      state.closes = closes;

      const fast = sma(closes, params.fast);
      const slow = sma(closes, params.slow);
      if (fast === null || slow === null) return null;

      const prevFast = state.prevFast as number | undefined;
      const prevSlow = state.prevSlow as number | undefined;
      state.prevFast = fast;
      state.prevSlow = slow;

      if (prevFast === undefined || prevSlow === undefined) return null;

      const qty = params.lots * ctx.lotSize;

      // Crossover logic
      if (prevFast <= prevSlow && fast > slow) {
        return { side: "BUY" as Side, quantity: qty };
      }
      if (prevFast >= prevSlow && fast < slow) {
        return { side: "SELL" as Side, quantity: qty };
      }

      return null;
    },
  };
}
