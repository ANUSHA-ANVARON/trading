# AlgoBot Decision Engine — Technical Specification

## Overview

The engine runs as a continuous stream process (`stream-suggest.ts`) that ingests live market ticks via Kite WebSocket, aggregates them into 1m/5m/15m OHLCV candles, computes technical indicators, scores each timeframe independently, then combines the signals into a single trade recommendation every ~2 seconds.

---

## 1. Per-Timeframe Signal Scoring

Each timeframe (1m, 5m, 15m) is scored by `analyzeTimeframe()`. It evaluates 6 binary conditions:

| # | Condition | LONG requirement | SHORT requirement |
|---|---|---|---|
| 1 | **Trend (SMA cross)** | Fast SMA (9) > Slow SMA (21) | Fast SMA < Slow SMA |
| 2 | **RSI 14** | RSI ≥ 55 (≥ 52 aggressive) | RSI ≤ 45 (≤ 48 aggressive) |
| 3 | **Breadth move** | Weighted NIFTY50 move ≥ +0.15% AND adv/dec ≥ 1.2 | Move ≤ −0.15% AND adv/dec ≤ 0.8 |
| 4 | **Futures day change** | Futures % change ≥ 0 | Futures % change ≤ 0 |
| 5 | **ATR% floor** | ATR% ≥ 0.05% (volatility present) | same |
| 6 | **Bollinger Bands %B** | %B > 0.5 AND < 0.95 (above midband, not stretched) | %B < 0.5 AND > 0.05 |

**Gate**: ≥ 4 of 6 conditions must align (≥ 3 in aggressive mode) to produce LONG/SHORT. Otherwise: NO_TRADE.

### Confidence Formula

```
if NO_TRADE:
  confidence = clamp((aligned / 6) × 0.4, 0, 0.45)

if LONG/SHORT:
  confidence = clamp(0.35 + (aligned/6)×0.35 + winRateEstimate×0.3, 0, 0.95)
```

`winRateEstimate` is derived from a backtest on the last 7 days of candle history for that timeframe using the SMA-cross strategy.

### PnC Score (displayed in UI)

```
PnC = probability × confidence × confluenceFactor
```
Where `confluenceFactor` counts how many of the other 2 timeframes agree with this one.

---

## 2. Trade Timeframe Selection

The top recommendation shown in the header is driven by the **5m timeframe** for stability. If 5m is NO_TRADE, falls back to 15m, then 1m.

When `--tradeTf best` (default): picks whichever of 5m/15m has a non-NO_TRADE signal, preferring higher confidence. Falls back to 1m only if both are NO_TRADE.

---

## 3. Options-Layer Decision

After the timeframe consensus, the engine runs an options-specific analysis layer:

### 3a. Options Chain Signals

For each active chain row (up to 3 strikes each side of ATM), the engine evaluates:

| Signal | Bullish | Bearish |
|---|---|---|
| **PCR (Put/Call OI ratio)** | PCR > 1.2 | PCR < 0.8 |
| **CE OI momentum** | CE OI shrinking | CE OI growing |
| **PE OI momentum** | PE OI growing | PE OI shrinking |
| **CE/PE sweep** | PE buy > CE buy | CE buy > PE buy |
| **IV skew** | Call IV > Put IV | Put IV > Call IV |

Scoring: bull++ / bear++ per signal. Final call: bull ≥ 3 AND bull > bear → LONG, bear ≥ 3 AND bear > bull → SHORT, else NO_TRADE.

### 3b. Regime Classification

The engine classifies the current volatility regime using ATR and VIX:

| Regime | Condition |
|---|---|
| CALM | ATR% < 0.08% or VIX < 13 |
| NORMAL | 0.08% ≤ ATR% < 0.18% |
| ELEVATED | 0.18% ≤ ATR% < 0.28% |
| VOLATILE | ATR% ≥ 0.28% or VIX ≥ 22 |

---

## 4. Trade Style Selection: BUY vs CREDIT SPREAD

Given a directional signal, the engine decides whether to trade with **a simple option buy** or a **credit spread**:

### When to Sell (Credit Spread)

All three conditions must hold:

```
canSell = newsRisk != "high"
       && (impliedMovePct < 1.4 || vix < 18)   // low IV environment
       && (confidence >= 0.65 || impliedMovePct >= 1.2)  // meaningful edge
```

Additionally, `preferBuy = impliedMovePct >= 1.8 OR regime = VOLATILE` overrides `canSell`.

### LONG Direction

| Condition | Trade |
|---|---|
| `canSell && !preferBuy && putSpread available` | **SELL PUT SPREAD** (bull put spread) |
| otherwise | **BUY CALL** |

### SHORT Direction

| Condition | Trade |
|---|---|
| `canSell && !preferBuy && callSpread available` | **SELL CALL SPREAD** (bear call spread) |
| otherwise | **BUY PUT** |

---

## 5. Credit Spread Construction

### Put Credit Spread (SELL PUT SPREAD — used for LONG bias)

```
Sell PUT at ATM − creditDistance  (e.g. ATM − 100)
Buy  PUT at ATM − creditDistance − creditWidth  (e.g. ATM − 200)

Net credit   = sell_premium − buy_premium
Max profit   = net_credit × qty             (spread expires worthless)
Max loss     = (creditWidth − netCredit) × qty
Breakeven    = sell_strike − net_credit
```

**Exit — Target:** close spread when spread value decays to `netCredit × (1 − creditTakePct)`.  
Default `creditTakePct = 0.5` → exit when you've captured 50% of the credit.

**Exit — Stop:** close spread when spread value widens to `netCredit × creditStopMult`.  
Default `creditStopMult = 2` → stop when spread costs 2× what you received.

**Example:** sell at 70, buy at 40 → credit 30.  
- Target: exit when spread = 15 (profit = 15 pts)  
- Stop: exit when spread = 60 (loss = 30 pts)  
- The 60 is the **combined spread value**, not the short-leg price alone.

### Call Credit Spread (SELL CALL SPREAD — used for SHORT bias)

```
Sell CALL at ATM + creditDistance
Buy  CALL at ATM + creditDistance + creditWidth

Net credit   = sell_premium − buy_premium
Max profit   = net_credit × qty
Max loss     = (creditWidth − netCredit) × qty
Breakeven    = sell_strike + net_credit
```

Same exit logic as put credit spread.

---

## 6. Strike Selection for BUY Trades

For straight option buys, the engine picks the strike closest to the target delta:

| Moneyness Preference | Target Delta |
|---|---|
| ITM | |Δ| ≈ 0.62 |
| ATM | |Δ| ≈ 0.50 |
| OTM | |Δ| ≈ 0.35 |

Default: ATM. Switches to ITM in VOLATILE regime, OTM in aggressive mode.

If multiple candidates match, prefers higher open interest (more liquid).

---

## 7. Prediction Firing Logic

A prediction entry is created when the trade engine fires a live signal. Guards:

- **Debounce**: same direction cannot re-fire within `PRED_DEBOUNCE_MS = 10 min`
- **Market hours**: predictions only fire during active NIFTY trading sessions
- **NO_TRADE gate**: `tradeChosen.recommendation` must not be NO_TRADE
- **Confidence gate**: implicit via the 4/6 condition requirement above

### Outcome Resolution

Each PENDING prediction is re-evaluated every tick:

| Condition | Outcome |
|---|---|
| Spot crosses `targetPrice` | TARGET_HIT |
| Spot crosses `stopPrice` | STOP_HIT |
| 15:30 IST, still open | EXPIRED |

P&L = `(outcomePrice − entryPrice) × direction_sign`  
For SHORT: direction_sign = −1.

---

## 8. Persistence

1. **In-memory**: `predictionLog[]` array in stream-suggest.ts (up to 200 entries)
2. **File**: `data/predictions/YYYY-MM-DD.json` — written on every create/update
3. **Convex** (when `CONVEX_URL` set): primary store, upserted by `predId`
4. **Startup restore**: on process restart, today's log is loaded from file/Convex back into memory so the UI shows continuity

Daily `.md` report is generated automatically at market close (15:30 IST session transition).

---

## 9. Parameters Reference

| Flag | Default | Description |
|---|---|---|
| `--fast` | 9 | Fast SMA period |
| `--slow` | 21 | Slow SMA period |
| `--creditDistance` | 100 | Points OTM for short leg of spread |
| `--creditWidth` | 100 | Spread width in points |
| `--creditTakePct` | 0.5 | Take profit at X% of credit captured |
| `--creditStopMult` | 2 | Stop when spread widens to X× credit |
| `--tpPct` | 0.25 | Take profit % for straight buys |
| `--slPct` | 0.15 | Stop loss % for straight buys |
| `--tradeTf` | best | Trade timeframe: 1m / 5m / 15m / best |
| `--aggressive` | false | Lower confluence gate (3/6), tighter RSI |
| `--historyDays` | 7 | Days of candle history for win-rate estimate |
