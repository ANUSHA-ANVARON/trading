/**
 * Order Flow analysis from Kite tick depth data.
 *
 * OBI (Order Book Imbalance):
 *   OBI = (totalBidQty_N - totalAskQty_N) / (totalBidQty_N + totalAskQty_N)
 *   Range: -1 (pure sell pressure) to +1 (pure buy pressure)
 *   Uses top N levels of the order book (default 3).
 *
 * Cumulative Delta (approx):
 *   True cumulative delta requires raw trade data (aggressor side) which Kite
 *   does not provide. We approximate by attributing each tick's volume increment
 *   to buyers when price rose vs the previous tick, sellers when it fell.
 *   This is a standard "tick rule" proxy and correlates well with real delta.
 *
 * Absorption:
 *   High volume increment at a price level with minimal price movement.
 *   Signals large orders absorbing the opposite side — often precedes reversals.
 */

export type DepthLevel = { quantity?: number; price?: number };

export type OBISnapshot = {
  obiRaw: number | null;
  obiSmoothed: number | null;
  obiSignal: "BUY" | "SELL" | "NEUTRAL" | null;
  cumulativeDelta: number;
  deltaPerTick: number | null;
  absorption: boolean;
  bidQtyTop3: number | null;
  askQtyTop3: number | null;
};

export class OBITracker {
  private readonly smoothWindow: number;
  private readonly depthLevels: number;
  private readonly absorptionVolThresh: number;
  private readonly absorptionPxThresh: number;

  private obiWindow: number[] = [];
  private cumDelta = 0;
  private lastPrice: number | null = null;
  private lastVol = 0;
  private deltaThisTick: number | null = null;
  private absorptionFlag = false;
  private lastBidQty: number | null = null;
  private lastAskQty: number | null = null;

  constructor(opts: {
    smoothWindow?: number;
    depthLevels?: number;
    absorptionVolThresh?: number; // cumulative volume delta that counts as "high"
    absorptionPxThresh?: number;  // price move fraction below which we call it absorbed
  } = {}) {
    this.smoothWindow        = opts.smoothWindow        ?? 10;
    this.depthLevels         = opts.depthLevels         ?? 3;
    this.absorptionVolThresh = opts.absorptionVolThresh ?? 5000;
    this.absorptionPxThresh  = opts.absorptionPxThresh  ?? 0.0003; // 0.03%
  }

  onTick(tick: {
    last_price?: number;
    volume_traded?: number;
    volume?: number;
    depth?: {
      buy?:  DepthLevel[];
      sell?: DepthLevel[];
    };
  }): void {
    const px  = Number(tick.last_price);
    const vol = typeof tick.volume_traded === "number" ? tick.volume_traded
              : typeof tick.volume         === "number" ? tick.volume : null;

    // ── OBI from top-N depth levels ────────────────────────────────────────
    const buyLevels  = (tick.depth?.buy  ?? []).slice(0, this.depthLevels);
    const sellLevels = (tick.depth?.sell ?? []).slice(0, this.depthLevels);
    const bidQty = buyLevels.reduce((s, l)  => s + (Number(l.quantity) || 0), 0);
    const askQty = sellLevels.reduce((s, l) => s + (Number(l.quantity) || 0), 0);

    if (bidQty + askQty > 0) {
      this.lastBidQty = bidQty;
      this.lastAskQty = askQty;
      const obi = (bidQty - askQty) / (bidQty + askQty);
      this.obiWindow.push(obi);
      if (this.obiWindow.length > this.smoothWindow) this.obiWindow.shift();
    }

    // ── Cumulative delta (tick rule proxy) ─────────────────────────────────
    this.deltaThisTick  = null;
    this.absorptionFlag = false;

    if (vol !== null && this.lastPrice !== null && Number.isFinite(px)) {
      const dvol   = Math.max(0, vol - this.lastVol);
      const pxMove = this.lastPrice > 0 ? (px - this.lastPrice) / this.lastPrice : 0;
      const dir    = pxMove > 0 ? 1 : pxMove < 0 ? -1 : 0;

      this.deltaThisTick = dir * dvol;
      this.cumDelta     += this.deltaThisTick;

      // Absorption: large volume absorbed with barely any price move
      if (dvol >= this.absorptionVolThresh && Math.abs(pxMove) <= this.absorptionPxThresh) {
        this.absorptionFlag = true;
      }
    }

    if (vol !== null) this.lastVol = vol;
    if (Number.isFinite(px)) this.lastPrice = px;
  }

  snapshot(): OBISnapshot {
    const obiRaw = this.obiWindow.length
      ? this.obiWindow[this.obiWindow.length - 1]
      : null;
    const obiSmoothed = this.obiWindow.length
      ? this.obiWindow.reduce((a, b) => a + b, 0) / this.obiWindow.length
      : null;

    let obiSignal: "BUY" | "SELL" | "NEUTRAL" | null = null;
    if (obiSmoothed !== null) {
      if      (obiSmoothed >  0.15) obiSignal = "BUY";
      else if (obiSmoothed < -0.15) obiSignal = "SELL";
      else                          obiSignal = "NEUTRAL";
    }

    return {
      obiRaw:          obiRaw      !== null ? +obiRaw.toFixed(4)      : null,
      obiSmoothed:     obiSmoothed !== null ? +obiSmoothed.toFixed(4) : null,
      obiSignal,
      cumulativeDelta: +this.cumDelta.toFixed(0),
      deltaPerTick:    this.deltaThisTick !== null ? +this.deltaThisTick.toFixed(0) : null,
      absorption:      this.absorptionFlag,
      bidQtyTop3:      this.lastBidQty,
      askQtyTop3:      this.lastAskQty,
    };
  }

  /** Reset at start of each new trading day */
  resetDay(): void {
    this.cumDelta    = 0;
    this.lastVol     = 0;
    this.lastPrice   = null;
    this.obiWindow   = [];
    this.lastBidQty  = null;
    this.lastAskQty  = null;
  }
}
