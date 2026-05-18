import type { Candle, Market, Side } from "./types";

export type Signal = {
  side: Side;
  quantity: number;
};

export type StrategyContext = {
  market: Market;
  lotSize: number;
};

export interface Strategy {
  readonly name: string;

  /**
   * Called on each candle close.
   * Return BUY/SELL signal when you want to change position.
   */
  onCandle(candle: Candle, state: StrategyState, ctx: StrategyContext): Signal | null;
}

export type StrategyState = {
  // free-form bag for a strategy to track indicators, last signal, etc.
  [key: string]: unknown;
};
