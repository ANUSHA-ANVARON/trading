import type { Market, Side } from "../core/types";
import { createKiteClient } from "../kite/kiteClient";

export type PaperConfig = {
  slippageBps: number;
  brokeragePerOrder: number;
};

export type PaperState = {
  cash: number;
  qty: number;
  avgPrice: number;
  realizedPnl: number;
};

function applySlippage(price: number, side: Side, bps: number): number {
  const m = bps / 10_000;
  return side === "BUY" ? price * (1 + m) : price * (1 - m);
}

export class PaperBroker {
  private state: PaperState;

  constructor(
    private readonly market: Market,
    initialCash: number,
    private readonly cfg: PaperConfig,
  ) {
    this.state = { cash: initialCash, qty: 0, avgPrice: 0, realizedPnl: 0 };
  }

  getState(): PaperState {
    return { ...this.state };
  }

  async ltp(): Promise<number> {
    const kite = await createKiteClient();
    const key = `${this.market.exchange}:${this.market.tradingsymbol}`;
    const data = await kite.getLTP([key]);
    const rec = data?.[key];
    const last = rec?.last_price;
    if (!last || !Number.isFinite(last)) throw new Error("Could not fetch LTP");
    return Number(last);
  }

  async marketOrder(side: Side, quantity: number): Promise<{ fillPrice: number; fees: number }> {
    const last = await this.ltp();
    const fillPrice = applySlippage(last, side, this.cfg.slippageBps);
    const fees = this.cfg.brokeragePerOrder;

    const signed = side === "BUY" ? 1 : -1;
    const newQty = this.state.qty + signed * quantity;

    // Realize PnL if reducing/flipping
    if (this.state.qty !== 0 && Math.sign(this.state.qty) !== Math.sign(newQty)) {
      const closingQty = Math.min(Math.abs(this.state.qty), quantity);
      const dir = Math.sign(this.state.qty);
      const pnlPerUnit = dir > 0 ? fillPrice - this.state.avgPrice : this.state.avgPrice - fillPrice;
      this.state.realizedPnl += pnlPerUnit * closingQty;
      this.state.avgPrice = newQty === 0 ? 0 : fillPrice;
    } else if (this.state.qty === 0 || Math.sign(this.state.qty) === Math.sign(newQty)) {
      // Weighted average
      const totalCost = this.state.avgPrice * this.state.qty + fillPrice * (signed * quantity);
      this.state.avgPrice = newQty === 0 ? 0 : totalCost / newQty;
    }

    this.state.qty = newQty;

    // Simple cash accounting
    this.state.cash -= signed * fillPrice * quantity;
    this.state.cash -= fees;

    return { fillPrice, fees };
  }
}
