import crypto from "crypto";
import type { Candle, EquityPoint, Fill, Market, Order, Position, Side } from "../core/types";
import type { Strategy, StrategyContext, StrategyState } from "../core/strategy";

export type BacktestConfig = {
  initialCash: number;
  market: Market;
  lotSize: number;
  brokeragePerOrder: number; // flat fee per order
  slippageBps: number; // slippage in basis points applied on fills
  /**
   * cash: spot-like cashflow (buy reduces cash by notional).
   * futures: MTM accounting (cash not reduced by notional; PnL is tracked via price changes).
   */
  accounting?: "cash" | "futures";
};

export type BacktestResult = {
  config: BacktestConfig;
  strategyName: string;
  fills: Fill[];
  equity: EquityPoint[];
  final: {
    cash: number;
    realizedPnl: number;
    unrealizedPnl: number;
    equity: number;
    position: Position;
  };
};

function nowId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function applySlippage(price: number, side: Side, bps: number): number {
  const m = bps / 10_000;
  return side === "BUY" ? price * (1 + m) : price * (1 - m);
}

function markToMarket(position: Position, lastPrice: number): number {
  if (position.quantity === 0) return 0;
  return (lastPrice - position.avgPrice) * position.quantity;
}

function nextPositionFromFill(position: Position, side: Side, qty: number, price: number): { position: Position; realizedDelta: number } {
  // Single-instrument engine; supports reducing/flipping.
  const signedQty = side === "BUY" ? qty : -qty;
  const newQty = position.quantity + signedQty;

  // If same direction or from flat: update weighted avg.
  if (position.quantity === 0 || Math.sign(position.quantity) === Math.sign(newQty)) {
    const totalCost = position.avgPrice * position.quantity + price * signedQty;
    const avgPrice = newQty === 0 ? 0 : totalCost / newQty;
    return { position: { ...position, quantity: newQty, avgPrice }, realizedDelta: 0 };
  }

  // Otherwise we're reducing or flipping: realize PnL on the closed portion.
  const closingQty = Math.min(Math.abs(position.quantity), Math.abs(signedQty));
  const dir = Math.sign(position.quantity); // + long, - short

  // For long: selling above avg is profit. For short: buying below avg is profit.
  const pnlPerUnit = dir > 0 ? price - position.avgPrice : position.avgPrice - price;
  const realizedDelta = pnlPerUnit * closingQty;

  // If flipped, remaining qty opens new position at fill price.
  const remainingQty = newQty;
  const avgPrice = remainingQty === 0 ? 0 : price;

  return { position: { ...position, quantity: remainingQty, avgPrice }, realizedDelta };
}

export function runBacktest(candles: Candle[], strategy: Strategy, config: BacktestConfig): BacktestResult {
  if (candles.length < 2) throw new Error("Need at least 2 candles");

  const accounting = config.accounting ?? "cash";
  let cash = config.initialCash;
  let realizedPnl = 0;
  const fills: Fill[] = [];
  const equity: EquityPoint[] = [];

  let position: Position = { market: config.market, quantity: 0, avgPrice: 0 };
  const state: StrategyState = {};

  const ctx: StrategyContext = { market: config.market, lotSize: config.lotSize };

  // Fill at next candle open to avoid look-ahead bias.
  for (let i = 0; i < candles.length - 1; i++) {
    const candle = candles[i];
    const next = candles[i + 1];

    const signal = strategy.onCandle(candle, state, ctx);
    if (signal) {
      const order: Order = {
        id: nowId(),
        time: next.time,
        market: config.market,
        side: signal.side,
        quantity: signal.quantity,
        type: "MARKET",
      };

      const rawFillPrice = next.open;
      const fillPrice = applySlippage(rawFillPrice, order.side, config.slippageBps);
      const fees = config.brokeragePerOrder;

      // Cash impact
      // - accounting=cash: subtract notional like spot
      // - accounting=futures: do not subtract notional; track PnL via realized/unrealized
      if (accounting === "cash") {
        const signed = order.side === "BUY" ? 1 : -1;
        cash -= signed * fillPrice * order.quantity;
      }
      cash -= fees;

      const { position: newPos, realizedDelta } = nextPositionFromFill(position, order.side, order.quantity, fillPrice);
      position = newPos;
      realizedPnl += realizedDelta;

      fills.push({ orderId: order.id, time: order.time, side: order.side, price: fillPrice, quantity: order.quantity, fees });
    }

    const unrealizedPnl = markToMarket(position, candle.close);
    const totalEquity = cash + unrealizedPnl;

    equity.push({
      time: candle.time,
      equity: totalEquity,
      cash,
      unrealizedPnl,
      realizedPnl,
    });
  }

  const last = candles[candles.length - 1];
  const finalUnrealized = markToMarket(position, last.close);

  return {
    config,
    strategyName: strategy.name,
    fills,
    equity,
    final: {
      cash,
      realizedPnl,
      unrealizedPnl: finalUnrealized,
      equity: cash + finalUnrealized,
      position,
    },
  };
}

export function summarizeBacktest(result: BacktestResult): {
  trades: number;
  netPnl: number;
  returnPct: number;
  maxDrawdown: number;
} {
  const eq = result.equity;
  if (eq.length === 0) return { trades: 0, netPnl: 0, returnPct: 0, maxDrawdown: 0 };

  const startEquity = eq[0].equity;
  const endEquity = result.final.equity;
  const netPnl = endEquity - startEquity;
  const returnPct = startEquity === 0 ? 0 : (netPnl / startEquity) * 100;

  let peak = -Infinity;
  let maxDd = 0;
  for (const p of eq) {
    peak = Math.max(peak, p.equity);
    const dd = peak === 0 ? 0 : (peak - p.equity) / peak;
    maxDd = Math.max(maxDd, dd);
  }

  return {
    trades: result.fills.length,
    netPnl,
    returnPct,
    maxDrawdown: maxDd * 100,
  };
}
