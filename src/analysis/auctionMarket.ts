/**
 * Auction Market Theory (AMT) signal detection.
 *
 * Four signal types, mirroring real tape-reading setups:
 *
 *   HEAVY_FLOW      — aggressive delta in a 30-second window (buy/sell imbalance at speed)
 *   ACCEPTANCE      — ≥2 of last 3 × 5m candle closes on same side of VWAP/CPR
 *   EXHAUSTION      — ≥3 touches of a support/resistance level with declining volume
 *   AGGRESSIVE_5M   — 5m candle with body ≥80% of range AND volume ≥1.3× average
 *
 * Composite: if ≥2 of the 4 signals agree on a direction → BULL or BEAR composite.
 */

import type { Candle } from "../core/types";

export type AMTFlowSignal       = "HEAVY_BULL_FLOW" | "HEAVY_BEAR_FLOW" | null;
export type AMTAcceptanceSignal = "BULL_ACCEPTANCE"  | "BEAR_ACCEPTANCE"  | null;
export type AMTExhaustionSignal = "SUPPORT_EXHAUSTION" | "RESISTANCE_EXHAUSTION" | null;
export type AMTCandleSignal     = "AGGRESSIVE_BULL_5M" | "AGGRESSIVE_BEAR_5M" | null;

export type AMTSnapshot = {
  /** Rolling 30-second signed-volume balance. Positive = buyers aggressive. */
  heavyFlow:                AMTFlowSignal;
  flowDelta30s:             number;
  flowThreshold:            number;

  /** ≥2 of last 3 × 5m closes on same side of a key level. */
  acceptance:               AMTAcceptanceSignal;
  acceptanceLevel:          number | null;
  acceptanceLevelName:      string | null;
  acceptanceDescription:    string | null;

  /** Repeated touches of a level with shrinking volume (buyers/sellers running out). */
  exhaustion:               AMTExhaustionSignal;
  exhaustionLevel:          number | null;
  exhaustionVolumes:        number[];
  exhaustionDeclinePct:     number | null;

  /** Last closed 5m candle with near-full body and outsized volume. */
  aggressiveCandle:         AMTCandleSignal;
  aggressiveBodyRatio:      number | null;

  /** How many AMT signals agree on a direction. */
  compositeSignal:          "BULL" | "BEAR" | null;
  compositeScore:           number;
};

export class AMTTracker {
  private readonly FLOW_WINDOW_MS        = 30_000;
  private readonly FLOW_THRESHOLD        = 500;
  private readonly AGGRESSIVE_BODY_RATIO = 0.80;
  private readonly AGGRESSIVE_VOL_MULT   = 1.30;
  private readonly EXHAUSTION_DECLINE    = 0.70;  // last touch must be <70% of first
  private readonly NEAR_LEVEL_PCT        = 0.002; // within 0.2% counts as "touching"
  private readonly MIN_TOUCHES           = 3;

  private deltaWindow: Array<{ tsMs: number; delta: number }> = [];
  private lastPrice: number | null = null;
  private lastVol   = 0;

  onTick(tick: {
    last_price?:    number;
    volume_traded?: number;
    volume?:        number;
  }): void {
    const px     = Number(tick.last_price);
    const volRaw = tick.volume_traded ?? tick.volume;
    const vol    = typeof volRaw === "number" && Number.isFinite(volRaw) ? Number(volRaw) : null;

    if (!Number.isFinite(px) || vol === null) return;

    const dvol   = Math.max(0, vol - this.lastVol);
    const pxMove = this.lastPrice !== null && this.lastPrice > 0
      ? (px - this.lastPrice) / this.lastPrice
      : 0;
    const dir = pxMove > 0 ? 1 : pxMove < 0 ? -1 : 0;

    if (dvol > 0) {
      const now = Date.now();
      this.deltaWindow.push({ tsMs: now, delta: dir * dvol });
      const cutoff = now - this.FLOW_WINDOW_MS;
      while (this.deltaWindow.length && this.deltaWindow[0].tsMs < cutoff) {
        this.deltaWindow.shift();
      }
    }

    this.lastVol   = vol;
    this.lastPrice = px;
  }

  computeSignals(params: {
    candles5m:  Candle[];
    candles15m?: Candle[];
    vwap:       number | null;
    cpr:        number | null;
    pdh:        number | null;
    pdl:        number | null;
  }): AMTSnapshot {
    // ── 1. Heavy Flow ────────────────────────────────────────────────────────
    const delta30s   = this.deltaWindow.reduce((s, e) => s + e.delta, 0);
    const heavyFlow: AMTFlowSignal =
      delta30s >=  this.FLOW_THRESHOLD ? "HEAVY_BULL_FLOW" :
      delta30s <= -this.FLOW_THRESHOLD ? "HEAVY_BEAR_FLOW" :
      null;

    // ── 2. Price Acceptance ──────────────────────────────────────────────────
    let acceptance:            AMTAcceptanceSignal = null;
    let acceptanceLevel:       number | null       = null;
    let acceptanceLevelName:   string | null       = null;
    let acceptanceDescription: string | null       = null;

    // Prefer VWAP, fall back to CPR, then previous-day close levels
    const refLevels: Array<{ value: number; name: string }> = [];
    if (params.vwap !== null) refLevels.push({ value: params.vwap, name: "VWAP" });
    if (params.cpr  !== null) refLevels.push({ value: params.cpr,  name: "CPR"  });
    if (params.pdh  !== null) refLevels.push({ value: params.pdh,  name: "PDH"  });
    if (params.pdl  !== null) refLevels.push({ value: params.pdl,  name: "PDL"  });

    if (params.candles5m.length >= 3) {
      const last3 = params.candles5m.slice(-3);
      for (const lvl of refLevels) {
        const above = last3.filter((c) => Number(c.close) > lvl.value).length;
        const below = last3.filter((c) => Number(c.close) < lvl.value).length;
        if (above >= 2) {
          acceptance          = "BULL_ACCEPTANCE";
          acceptanceLevel     = lvl.value;
          acceptanceLevelName = lvl.name;
          acceptanceDescription = `${above}/3 closes above ${lvl.name} ${lvl.value.toFixed(0)}`;
          break;
        }
        if (below >= 2) {
          acceptance          = "BEAR_ACCEPTANCE";
          acceptanceLevel     = lvl.value;
          acceptanceLevelName = lvl.name;
          acceptanceDescription = `${below}/3 closes below ${lvl.name} ${lvl.value.toFixed(0)}`;
          break;
        }
      }
    }

    // ── 3. Aggressive 5m Candle ──────────────────────────────────────────────
    let aggressiveCandle:   AMTCandleSignal = null;
    let aggressiveBodyRatio: number | null  = null;

    if (params.candles5m.length >= 5) {
      // Use last CLOSED candle (second-to-last to avoid the still-forming one)
      const idx      = params.candles5m.length - 1;
      const last     = params.candles5m[idx];
      const prev4    = params.candles5m.slice(Math.max(0, idx - 4), idx);
      const avgVol   = prev4.length
        ? prev4.reduce((s, c) => s + Number(c.volume), 0) / prev4.length
        : 0;

      const range    = Number(last.high) - Number(last.low);
      const body     = Math.abs(Number(last.close) - Number(last.open));
      const ratio    = range > 0 ? body / range : 0;
      const vol      = Number(last.volume);

      if (ratio >= this.AGGRESSIVE_BODY_RATIO && avgVol > 0 && vol >= avgVol * this.AGGRESSIVE_VOL_MULT) {
        aggressiveCandle    = Number(last.close) > Number(last.open)
          ? "AGGRESSIVE_BULL_5M"
          : "AGGRESSIVE_BEAR_5M";
        aggressiveBodyRatio = +ratio.toFixed(3);
      }
    }

    // ── 4. Exhaustion at Support / Resistance ────────────────────────────────
    let exhaustion:         AMTExhaustionSignal = null;
    let exhaustionLevel:    number | null       = null;
    let exhaustionVolumes:  number[]            = [];
    let exhaustionDeclinePct: number | null     = null;

    if (params.candles5m.length >= 10) {
      const candles     = params.candles5m.slice(-20);
      const supportLvl  = Math.min(...candles.map((c) => Number(c.low)));
      const resistLvl   = Math.max(...candles.map((c) => Number(c.high)));

      const touchesAt = (level: number, side: "low" | "high"): number[] =>
        candles
          .filter((c) => {
            const val = side === "low" ? Number(c.low) : Number(c.high);
            return level > 0 && Math.abs(val - level) / level <= this.NEAR_LEVEL_PCT;
          })
          .map((c) => Number(c.volume))
          .filter((v) => v > 0);

      const supVols = touchesAt(supportLvl, "low");
      if (supVols.length >= this.MIN_TOUCHES) {
        const first = supVols[0];
        const last  = supVols[supVols.length - 1];
        if (first > 0 && last < first * this.EXHAUSTION_DECLINE) {
          exhaustion        = "SUPPORT_EXHAUSTION";
          exhaustionLevel   = +supportLvl.toFixed(2);
          exhaustionVolumes = supVols;
          exhaustionDeclinePct = +((1 - last / first) * 100).toFixed(1);
        }
      }

      if (!exhaustion) {
        const resVols = touchesAt(resistLvl, "high");
        if (resVols.length >= this.MIN_TOUCHES) {
          const first = resVols[0];
          const last  = resVols[resVols.length - 1];
          if (first > 0 && last < first * this.EXHAUSTION_DECLINE) {
            exhaustion        = "RESISTANCE_EXHAUSTION";
            exhaustionLevel   = +resistLvl.toFixed(2);
            exhaustionVolumes = resVols;
            exhaustionDeclinePct = +((1 - last / first) * 100).toFixed(1);
          }
        }
      }
    }

    // ── Composite ────────────────────────────────────────────────────────────
    let bull = 0;
    let bear = 0;

    if (heavyFlow === "HEAVY_BULL_FLOW")        bull++;
    if (heavyFlow === "HEAVY_BEAR_FLOW")         bear++;
    if (acceptance === "BULL_ACCEPTANCE")        bull++;
    if (acceptance === "BEAR_ACCEPTANCE")        bear++;
    if (aggressiveCandle === "AGGRESSIVE_BULL_5M") bull++;
    if (aggressiveCandle === "AGGRESSIVE_BEAR_5M") bear++;
    // Exhaustion: support exhaustion = bears failing = net bullish; resistance = bulls failing = net bearish
    if (exhaustion === "SUPPORT_EXHAUSTION")     bull++;
    if (exhaustion === "RESISTANCE_EXHAUSTION")  bear++;

    const compositeSignal: "BULL" | "BEAR" | null =
      bull >= 2 && bull > bear ? "BULL" :
      bear >= 2 && bear > bull ? "BEAR" :
      null;

    return {
      heavyFlow,
      flowDelta30s:         +delta30s.toFixed(0),
      flowThreshold:        this.FLOW_THRESHOLD,
      acceptance,
      acceptanceLevel,
      acceptanceLevelName,
      acceptanceDescription,
      exhaustion,
      exhaustionLevel,
      exhaustionVolumes,
      exhaustionDeclinePct,
      aggressiveCandle,
      aggressiveBodyRatio,
      compositeSignal,
      compositeScore:       Math.max(bull, bear),
    };
  }

  resetDay(): void {
    this.deltaWindow = [];
    this.lastPrice   = null;
    this.lastVol     = 0;
  }
}
