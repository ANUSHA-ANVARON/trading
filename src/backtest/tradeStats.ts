import type { BacktestResult } from "./engine";
import type { Side } from "../core/types";

export type TradeStat = {
  entryTime: string;
  exitTime: string;
  side: Side; // direction at entry
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  fees: number;
  pnl: number;
};

export type TradeStatsSummary = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number; // 0..1
  avgPnl: number;
  totalPnl: number;
};

function signFromSide(side: Side): 1 | -1 {
  return side === "BUY" ? 1 : -1;
}

export function computeTradeStats(result: BacktestResult): { trades: TradeStat[]; summary: TradeStatsSummary } {
  const fills = result.fills;
  const trades: TradeStat[] = [];

  let positionQty = 0;

  let openTrade:
    | {
        entryTime: string;
        side: Side;
        quantity: number;
        entryPrice: number;
        fees: number;
      }
    | null = null;

  for (const f of fills) {
    const signed = signFromSide(f.side) * f.quantity;
    const nextQty = positionQty + signed;

    // Opening from flat.
    if (positionQty === 0 && nextQty !== 0) {
      openTrade = {
        entryTime: f.time,
        side: f.side,
        quantity: Math.abs(nextQty),
        entryPrice: f.price,
        fees: f.fees,
      };
      positionQty = nextQty;
      continue;
    }

    // If somehow we have a fill while flat but couldn't openTrade, handle it.
    if (!openTrade && nextQty !== 0) {
      openTrade = {
        entryTime: f.time,
        side: f.side,
        quantity: Math.abs(nextQty),
        entryPrice: f.price,
        fees: f.fees,
      };
      positionQty = nextQty;
      continue;
    }

    // If we have an open trade, check close/flip conditions.
    if (openTrade) {
      const wasLong = openTrade.side === "BUY";
      const closingQty = Math.min(Math.abs(positionQty), f.quantity);

      // Close if we go flat OR flip direction.
      const closesExisting = nextQty === 0 || Math.sign(positionQty) !== Math.sign(nextQty);
      if (closesExisting) {
        const exitPrice = f.price;
        const gross = wasLong
          ? (exitPrice - openTrade.entryPrice) * closingQty
          : (openTrade.entryPrice - exitPrice) * closingQty;
        const fees = openTrade.fees + f.fees;
        const pnl = gross - fees;

        trades.push({
          entryTime: openTrade.entryTime,
          exitTime: f.time,
          side: openTrade.side,
          quantity: closingQty,
          entryPrice: openTrade.entryPrice,
          exitPrice,
          fees,
          pnl,
        });

        openTrade = null;
      } else {
        // Still same-position; just accumulate fees.
        openTrade.fees += f.fees;
      }

      // If we flipped, open a new trade at the same fill price for remaining qty.
      if (Math.sign(positionQty) !== 0 && Math.sign(positionQty) !== Math.sign(nextQty) && nextQty !== 0) {
        openTrade = {
          entryTime: f.time,
          side: f.side,
          quantity: Math.abs(nextQty),
          entryPrice: f.price,
          fees: 0,
        };
      }
    }

    positionQty = nextQty;
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl <= 0).length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgPnl = trades.length ? totalPnl / trades.length : 0;
  const winRate = trades.length ? wins / trades.length : 0;

  return {
    trades,
    summary: {
      trades: trades.length,
      wins,
      losses,
      winRate,
      avgPnl,
      totalPnl,
    },
  };
}
