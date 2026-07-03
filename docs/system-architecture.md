# AlgoBot — Full System Architecture

> Last updated: 2026-07-03  
> Stack: Node 20 / TypeScript / Kite Connect v5 / Convex (optional) / Railway

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Process Model](#2-process-model)
3. [Data Ingestion — Kite WebSocket](#3-data-ingestion--kite-websocket)
4. [Candle Aggregation](#4-candle-aggregation)
5. [Technical Indicators](#5-technical-indicators)
6. [Order Flow Analysis](#6-order-flow-analysis)
7. [Per-Timeframe Scoring Engine](#7-per-timeframe-scoring-engine)
8. [Lifecycle & Session State](#8-lifecycle--session-state)
9. [Options Layer](#9-options-layer)
10. [Prediction Engine](#10-prediction-engine)
11. [Signal Output Snapshot](#11-signal-output-snapshot)
12. [Storage & Persistence](#12-storage--persistence)
13. [Telegram Alerts](#13-telegram-alerts)
14. [Market Hours Gating](#14-market-hours-gating)
15. [Auto Session Login](#15-auto-session-login)
16. [UI Server & SSE Streaming](#16-ui-server--sse-streaming)
17. [Deployment (Railway)](#17-deployment-railway)
18. [Configuration Reference](#18-configuration-reference)

---

## 1. High-Level Architecture

```
                           ┌─────────────────────────────────┐
                           │         ui-suggest.ts           │
                           │    (HTTP + SSE server, :3333)   │
  Browser ──SSE──────────► │                                 │
  Browser ──HTTP GET──────►│  /  /events  /report  /api/*   │
                           │                                 │
                           │  spawns & supervises child:     │
                           └────────────┬────────────────────┘
                                        │ stdout (JSON lines)
                                        ▼
                           ┌─────────────────────────────────┐
                           │       stream-suggest.ts         │
                           │   (signal engine child process) │
                           │                                 │
   Kite WebSocket ────────►│  ticks → candles → indicators  │
   NIFTY50 ticks  ────────►│  → score → lifecycle → predict │
   VIX tick       ────────►│  → snapshot JSON every 2s      │
                           │                                 │
                           │  persists to:                   │
                           │   data/predictions/YYYY-MM-DD.json
                           │   Convex (if CONVEX_URL set)   │
                           └─────────────────────────────────┘
```

All live data flows through a single Kite WebSocket connection opened by `stream-suggest.ts`. The parent (`ui-suggest.ts`) is a pure HTTP/SSE relay and never touches Kite directly.

---

## 2. Process Model

### Parent: `src/cli/ui-suggest.ts`

- Starts an HTTP server on `PORT` (default 3333)
- Manages one child process (`stream-suggest.ts`) via `ensureChild()`
- Child is spawned as `tsx stream-suggest.ts <args>` with stdout piped
- Parent reads child's stdout line-by-line, parses JSON, caches last snapshot (`lastSnapshot`)
- Any `/events` SSE client immediately receives `lastSnapshot` on connect, then lives updates
- Auto-restarts child if it crashes (with exponential back-off)
- Runs a 60-second interval that auto-starts the child at 09:14 IST on weekdays once a valid Kite token exists
- Serves static HTML/CSS/JS as inline template strings (no bundler)

### Child: `src/cli/stream-suggest.ts`

- Opens Kite WebSocket ticker
- Subscribes to NIFTY50 tokens (full mode), NIFTY FUT (full mode), NIFTY SPOT + VIX (LTP mode)
- Runs `buildOutputSnapshot()` every `intervalMs` (default 2 s)
- Outputs one JSON line per snapshot to stdout

### Communication

```
Parent reads child stdout:   { event: "tick", ... }  ← signal snapshots
                             { event: "error", ... }  ← errors logged
Child stdout → JSON lines → parent's SSE broadcast → browser EventSource
```

---

## 3. Data Ingestion — Kite WebSocket

### Instruments subscribed

| Instrument | Mode | Purpose |
|---|---|---|
| NIFTY50 constituents (50 tokens) | `full` | Breadth analysis, Spartan/Surfing signals |
| NIFTY FUT (near expiry) | `full` | Price, candles, OBI depth data |
| NIFTY SPOT (NSE:NIFTY 50) | `ltpMode` | Clean spot price for predictions |
| INDIA VIX | `ltpMode` | Regime classification |
| ATM CE + PE | `full` | Options premiums, IV, delta |
| Chain strikes (±3 from ATM) | `ltpMode` | PCR, OI sweep signals |

### Tick structure (relevant fields)

```typescript
type Tick = {
  instrument_token: number;
  last_price: number;
  ohlc: { close: number; open: number };  // prev-day OHLC
  volume_traded: number;                  // cumulative intraday volume
  oi: number;                             // open interest (futures/options)
  depth: {                                // only in full mode
    buy:  Array<{ quantity: number; price: number }>;  // 5 levels
    sell: Array<{ quantity: number; price: number }>;
  };
  exchange_timestamp: Date;
};
```

Note: `volume_traded` is **cumulative** for the day, not per-tick. Candle volume is computed as `volLast - volStart` within each bucket.

---

## 4. Candle Aggregation

**File:** `src/live/candleAggregator.ts`  
**Class:** `CandleAggregator`

Three aggregators run in parallel, each producing closed OHLCV candles:

| Aggregator | Bucket | Max candles |
|---|---|---|
| `agg1m` | 60 s | 600 |
| `agg5m` | 300 s | 600 |
| `agg15m` | 900 s | 600 |

`onTick(price, timestamp, volume?)` — assigns each tick to the correct bucket using `floor(tsMs / bucketMs)`. When a new bucket starts, the previous candle is finalised and pushed to the closed list.

Volume per candle: `Math.max(0, volLast - volStart)` where `volStart` is the cumulative volume at candle open and `volLast` is the last seen cumulative volume in the bucket.

At startup, candle history is seeded via Kite's historical API (`getHistorical`) for the current day to avoid a cold-start period for indicators.

---

## 5. Technical Indicators

**File:** `src/analysis/indicators.ts`

All functions are **pure** — they take arrays of numbers or `Candle[]` and return a value or `null` when insufficient data. They are called inside `scoreSuggestion()` on every 2-second tick.

### Trend

| Function | Inputs | Output | Notes |
|---|---|---|---|
| `sma(values, period)` | closes | `number\|null` | Simple moving average |
| `ema(values, period)` | closes | `number\|null` | Exponentially weighted |
| `dema(values, period)` | closes | `number\|null` | 2×EMA − EMA(EMA); less lag |
| `wma(values, period)` | closes | `number\|null` | Linearly weighted |
| `linearRegressionCurve(values, 20)` | closes | `number\|null` | End-point of OLS line over 20 bars |

### Momentum

| Function | Inputs | Output | Notes |
|---|---|---|---|
| `rsi(values, 14)` | closes | `number\|null` | Wilder RSI; 0–100 |
| `macd(values, 12, 26, 9)` | closes | `{macd, signal, histogram}\|null` | Standard MACD |
| `momentum(values, 10)` | closes | `number\|null` | close − close[10] |
| `tsi(values, 25, 13)` | closes | `number\|null` | True Strength Index; double-smoothed momentum oscillator |

### Volatility

| Function | Inputs | Output | Notes |
|---|---|---|---|
| `atr(candles, 14)` | OHLCV | `number\|null` | Average True Range |
| `bollingerBands(values, 20, 2)` | closes | `{upper, middle, lower, bandwidth, pctB}\|null` | 2σ bands |
| `stdDev(values, 20)` | closes | `number\|null` | Population std dev |
| `historicalVolatility(values, 20)` | closes | `number\|null` | Annualised log-return vol (×√252×100) |

### Volume

| Function | Inputs | Output | Notes |
|---|---|---|---|
| `pvt(candles)` | OHLCV | `number\|null` | Price Volume Trend — cumulative `vol × (ΔC/C)` |
| `vwap(candles, 20)` | OHLCV | `number\|null` | Volume-weighted avg price over last 20 candles |
| `relativeVolume(candles, 20)` | OHLCV | `number\|null` | Current bar vol ÷ 20-bar avg vol |
| `volumeOscillator(candles, 5, 20)` | OHLCV | `number\|null` | `(fastVolSMA − slowVolSMA) / slowVolSMA × 100` |

### Price Action

| Function | Inputs | Output | Notes |
|---|---|---|---|
| `candlePattern(candles)` | OHLCV | `CandlePattern` | Detects: DOJI, HAMMER, SHOOTING_STAR, BULLISH/BEARISH_ENGULF, BULLISH/BEARISH_MARUBOZU, SPINNING_TOP, NONE |
| `trendStructure(candles, 5)` | OHLCV | `"UPTREND"\|"DOWNTREND"\|"RANGING"\|"NA"` | HH+HL = UPTREND; LH+LL = DOWNTREND |
| `supportLevel(candles, 20)` | OHLCV | `number\|null` | Highest local swing low in last 20 bars |
| `resistanceLevel(candles, 20)` | OHLCV | `number\|null` | Lowest local swing high in last 20 bars |

### Swing

| Function | Inputs | Output | Notes |
|---|---|---|---|
| `asi(candles)` | OHLCV | `number\|null` | Accumulating Swing Index (Wilder) |

---

## 6. Order Flow Analysis

**File:** `src/analysis/orderFlow.ts`  
**Class:** `OBITracker`

Fed **every NIFTY FUT tick** (not candle-based — this is real-time, sub-second).

### Order Book Imbalance (OBI)

```
OBI_raw = (bidQty_top3 − askQty_top3) / (bidQty_top3 + askQty_top3)
OBI_smoothed = rolling average of last 10 raw OBI values
```

Range: −1 (pure selling pressure) to +1 (pure buying pressure).

**Signal classification:**
- `> +0.15` → **BUY** (bids dominating)
- `< −0.15` → **SELL** (asks dominating)
- otherwise → **NEUTRAL**

### Cumulative Delta (approx)

Kite does not provide aggressor-side trade data (that requires exchange co-lo Level 3 feed). We use the **tick rule proxy**:

```
vol_delta = current_cumulative_volume − previous_cumulative_volume
dir = +1 if price rose, −1 if price fell, 0 if unchanged
delta_this_tick = dir × vol_delta
cumulative_delta += delta_this_tick
```

Positive cumulative delta = net buying dominant over the day.

### Absorption Detection

When a tick shows:
- `vol_delta ≥ 5000` (large volume transacted)
- `|price_move| ≤ 0.03%` (price barely moved)

→ **Absorption** flag fires. This signals a large order absorbing the opposite side — often precedes a reversal or strong continuation.

### Daily Reset

`obiTracker.resetDay()` is called when session transitions from `CLOSED` → `PRE_OPEN`, resetting cumulative delta and OBI window.

---

## 7. Per-Timeframe Scoring Engine

**File:** `src/cli/stream-suggest.ts` — `scoreSuggestion()`

Runs independently for each of the three timeframes (1m, 5m, 15m) on every snapshot cycle.

### 6-Condition Gate

| # | Condition | LONG | SHORT |
|---|---|---|---|
| 1 | **SMA Cross** (always passes if data available) | fastSMA(9) > slowSMA(21) | fastSMA < slowSMA |
| 2 | **RSI 14** | RSI ≥ 55 (52 aggressive) | RSI ≤ 45 (48 aggressive) |
| 3 | **Breadth** (NIFTY50 weighted move + adv/dec) | move ≥ +0.15% AND adv/dec ≥ 1.2 | move ≤ −0.15% AND adv/dec ≤ 0.8 |
| 4 | **Futures day change %** | futChangePct ≥ 0 | futChangePct ≤ 0 |
| 5 | **ATR% floor** (volatility present) | atrPct ≥ 0.05% | same |
| 6 | **Bollinger %B** (price in right zone) | pctB > 0.5 AND < 0.95 | pctB < 0.5 AND > 0.05 |

**Gate:** ≥ 4/6 aligned → LONG or SHORT. < 4 → NO_TRADE. (Aggressive mode: ≥ 3/6.)

### Confidence Formula

```
if NO_TRADE:
  confidence = clamp((aligned/6) × 0.4, 0, 0.45)

if LONG/SHORT:
  confidence = clamp(0.35 + (aligned/6)×0.35 + winRateEstimate×0.3, 0, 0.95)
```

`winRateEstimate` = backtested win rate of SMA-cross strategy on last 7 days of candles for that timeframe.

### Extended Indicators (display-only, do not affect gate)

All computed after the gate, included in `signals` output:

- **Trend:** EMA9, EMA21, EMA cross, DEMA21, WMA21, LinearReg20
- **Momentum:** MACD line/signal/histogram, Momentum10, TSI
- **Volatility:** BB (all fields), ATR%, StdDev20, HistVol20, VIX
- **Volume:** Raw volume, RelativeVolume, VolumeOscillator, PVT, VWAP20
- **Price Action:** CandlePattern, TrendStructure, Support, Resistance
- **Breadth & Swing:** BreadthMove%, Adv/Dec, ASI

---

## 8. Lifecycle & Session State

**File:** `src/analysis/lifecycle.ts`  
**Function:** `computeLifecycle()`

Synthesises all timeframe signals + breadth + options into a single named state.

### Session States

| Session | Condition |
|---|---|
| `PRE_OPEN` | Before 09:15 IST |
| `OPEN` | 09:15–09:30 IST (first 15 min, high volatility) |
| `ACTIVE` | 09:30–15:15 IST (normal trading) |
| `CLOSING` | 15:15–15:30 IST |
| `CLOSED` | After 15:30 IST |

### Lifecycle States (key ones)

| State | Meaning |
|---|---|
| `CLEAN_BULLISH_FLOW` | Strong multi-TF bull alignment, good breadth |
| `CLEAN_BEARISH_FLOW` | Strong multi-TF bear alignment |
| `CE_EDGE` | Conditions favour call buyers |
| `PE_EDGE` | Conditions favour put buyers |
| `INDETERMINATE` | Mixed signals |
| `HIGH_RISK` | News risk high, VIX elevated, or regime VOLATILE |

### Regime Classification

| Regime | Condition |
|---|---|
| `CALM` | ATR% < 0.08% or VIX < 13 |
| `NORMAL` | 0.08% ≤ ATR% < 0.18% |
| `ELEVATED` | 0.18% ≤ ATR% < 0.28% |
| `VOLATILE` | ATR% ≥ 0.28% or VIX ≥ 22 |

---

## 9. Options Layer

### ATM Options

After the NIFTY FUT is identified, ATM CE and PE are subscribed at the strike closest to the current spot price. Refreshed every 5 minutes or on large spot moves.

### Chain Analysis (±3 strikes from ATM)

For each chain strike, the engine evaluates:

| Signal | Bullish | Bearish |
|---|---|---|
| **PCR** (Put/Call OI ratio) | PCR > 1.2 | PCR < 0.8 |
| **CE OI change** | CE OI shrinking | CE OI growing |
| **PE OI change** | PE OI growing | PE OI shrinking |
| **Sweep** (depth drop + price move) | PE buy sweep | CE buy sweep |
| **IV skew** | Call IV > Put IV | Put IV > Call IV |

Score: bull++ / bear++ per signal. ≥ 3 and majority → chain direction.

### Trade Style Decision

```
canSell = newsRisk != "high"
       && (impliedMovePct < 1.4 OR vix < 18)
       && (confidence >= 0.65 OR impliedMovePct >= 1.2)

preferBuy = impliedMovePct >= 1.8 OR regime = VOLATILE
```

| Direction | Condition | Trade |
|---|---|---|
| LONG | canSell && !preferBuy && putSpread available | SELL PUT SPREAD |
| LONG | otherwise | BUY CALL |
| SHORT | canSell && !preferBuy && callSpread available | SELL CALL SPREAD |
| SHORT | otherwise | BUY PUT |

### Credit Spread Construction

**Bull Put Spread (LONG bias):**
```
Sell PUT @ ATM − creditDistance (default 100 pts OTM)
Buy  PUT @ ATM − creditDistance − creditWidth (default 100 pts wide)

Net credit  = sell_premium − buy_premium
Max profit  = net_credit × qty
Max loss    = (creditWidth − netCredit) × qty
Breakeven   = sell_strike − net_credit

Target exit: spread value decays to netCredit × (1 − creditTakePct)  [default: 50%]
Stop exit:   spread value widens to netCredit × creditStopMult        [default: 2×]
```

**Bear Call Spread (SHORT bias):** Mirror of above with call options.

### Greeks (Black-Scholes)

Computed for every selected option: delta, gamma, theta/day, vega, IV. Used for:
- Strike selection (target delta: ITM=0.62, ATM=0.50, OTM=0.35)
- Position-level greek aggregation (especially for credit spreads)
- IV skew computation across chain strikes

---

## 10. Prediction Engine

**Location:** `buildOutputSnapshot()` in `stream-suggest.ts`

### Prediction Firing — 5 Gates

All 5 must pass simultaneously for a LONG or SHORT prediction to fire:

| Gate | Condition |
|---|---|
| 0 | Market is open (not CLOSED session) |
| 1 | Debounce: same direction not fired in last **10 minutes** |
| 2 | Lifecycle state matches direction (`CLEAN_BULLISH_FLOW` or `CE_EDGE` for LONG; `CLEAN_BEARISH_FLOW` or `PE_EDGE` for SHORT) |
| 3 | **≥ 2 of 3 timeframes** agree (1m/5m/15m all scored independently) |
| 4 | RSI confirms on 5m or 15m (≥52 for LONG, ≤48 for SHORT) |
| 5 | BB confirms on 5m or 15m (pctB in right zone, not overstretched) |

### Entry / Target / Stop

Uses **NIFTY SPOT** price (not futures) as the reference to avoid basis distortion:

```
entryPrice  = spot LTP
targetPrice = entry ± (entry × tpPct / 100)   [default tpPct = 0.25%]
stopPrice   = entry ∓ (entry × slPct / 100)   [default slPct = 0.15%]
```

### Outcome Resolution

Re-evaluated every 2 seconds against live spot price:

| Condition | Outcome |
|---|---|
| spot crosses `targetPrice` | `TARGET_HIT` |
| spot crosses `stopPrice` | `STOP_HIT` |
| age ≥ TF expiry (1m→15min, 5m→45min, 15m→90min) | `EXPIRED` |

P&L = `(outcomePrice − entryPrice)` for LONG; `(entryPrice − outcomePrice)` for SHORT.

### Prediction Record Schema

```typescript
{
  id: string;                    // `${timestamp}-${direction}`
  asof: string;                  // ISO timestamp fired
  timeframe: "1m"|"5m"|"15m";
  direction: "LONG"|"SHORT";
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  confidence: number;            // 0–0.95
  lifecycle: string;             // lifecycle state at fire time
  session: string;               // session state at fire time
  signals: {
    rsi1m, rsi5m, rsi15m,
    bbPctB5m, bbPctB15m,
    spartanNet, surfNet,
    breadthMove, tfAgree
  };
  outcome: "PENDING"|"TARGET_HIT"|"STOP_HIT"|"EXPIRED";
  outcomePrice: number|null;
  outcomeAt: string|null;
  pnlPoints: number|null;
}
```

---

## 11. Signal Output Snapshot

Every 2 seconds, `buildOutputSnapshot()` emits one JSON object to stdout:

```
{
  asof,                    // ISO timestamp
  future,                  // instrument key e.g. "NFO:NIFTYYYMM"
  futureLtp,               // live futures price
  suggestion,              // top-level trade suggestion
  timeframes: {
    "1m": { recommendation, confidence, signals: { ...all indicators... } },
    "5m": { ... },
    "15m": { ... },
  },
  breadth,                 // NIFTY50 breadth metrics
  orderFlow: {             // OBITracker snapshot
    obiRaw, obiSmoothed, obiSignal,
    cumulativeDelta, deltaPerTick,
    absorption, bidQtyTop3, askQtyTop3
  },
  lifecycle,               // { state, session, score, ... }
  lifecycleHistory,        // last 60 lifecycle states
  options,                 // full options suggestion + chain + greeks + regime
  pivotLevels,             // daily CPR, S1/S2/S3, R1/R2/R3
  predictionLog,           // last 200 predictions with outcomes
  stockSignals,            // per-stock Spartan/Surfing signals
  news,                    // news risk level + headlines
  rms,                     // risk management params
  notes,                   // disclaimers
}
```

---

## 12. Storage & Persistence

### Three-layer persistence (in priority order)

1. **Convex** (if `CONVEX_URL` env var set): primary cloud store; mutations called via `ConvexHttpClient` for every prediction create/update
2. **Local JSON file**: `data/predictions/YYYY-MM-DD.json` — written on every create/update; readable even without Convex
3. **In-memory**: `predictionLog[]` array (max 200 entries) in `stream-suggest.ts`

### Startup Restore

On child process start, today's predictions are loaded from file or Convex back into `predictionLog[]` so a server restart never loses history visible in the UI.

### Daily Markdown Report

At market close (CLOSED session transition), `generateDailyReport()` produces `data/predictions/YYYY-MM-DD.md` summarising all predictions, outcomes, and P&L for the day.

### Period Statistics

`fetchPeriodStats(predictionsDir)` aggregates resolved predictions by month (`YYYY-MM`) and quarter (`YYYY-QN`) — used by the `/api/period-stats` endpoint and the Report page monthly/quarterly tables.

---

## 13. Telegram Alerts

**File:** `src/notify/telegram.ts`  
**Class:** `TelegramNotifier`

Fires on every new prediction that passes both the prediction gates AND `isMarketOpen()`.

Alert card is rendered as a server-side PNG via `@napi-rs/canvas` using the AlgoBot SVG template, then sent as a photo message to all configured chat IDs (`TELEGRAM_CHAT_IDS`).

**Rate limiting:** minimum `TELEGRAM_MIN_INTERVAL_MS` (default 15 s) between alerts.

**Market hours gate:** `if (telegram && isMarketOpen())` — alerts are completely suppressed outside trading hours and on holidays.

---

## 14. Market Hours Gating

Two independent checks, both using IST offset (`Date.now() + 5.5 × 3600000`):

### Backend (`stream-suggest.ts`)

```typescript
function isMarketOpen(): boolean {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  if (ist.getUTCDay() === 0 || ist.getUTCDay() === 6) return false;
  if (NSE_HOLIDAYS.has(ist.toISOString().slice(0, 10))) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}
```

Used to gate: Telegram alerts, prediction firing.

### Frontend (`ui-suggest.ts` inline JS)

History log filters entries to IST 09:15–15:30 Mon–Fri only before rendering.

### NSE Holidays

Hardcoded set of dates for 2025–2026. **Must be updated annually** from the official NSE holiday circular.

---

## 15. Auto Session Login

**File:** `src/cli/auto-session.ts`

Eliminates daily manual Kite login. Requires three env vars: `KITE_USER_ID`, `KITE_PASSWORD`, `KITE_TOTP_SECRET`.

### Flow

```
1. POST kite.zerodha.com/api/login        { user_id, password }
   ← { status:"success", data:{ request_id } }

2. Compute TOTP from KITE_TOTP_SECRET      (RFC 6238, HMAC-SHA1, 30s window)
   POST kite.zerodha.com/api/twofa         { user_id, request_id, twofa_value, twofa_type:"totp" }
   ← sets session cookies

3. GET kite.zerodha.com/connect/login?v=3&api_key=...&skip_session=1
   Follow redirects until one leaves kite.zerodha.com
   ← redirect URL contains ?request_token=xxx

4. kite.generateSession(request_token, api_secret)
   ← { access_token, public_token, user_id }
   Saved to data/session.json
```

TOTP is computed purely with Node's built-in `crypto` (no external dependency):
- Base32-decode the secret → key bytes
- Counter = `floor(unixTimestamp / 30)`
- HMAC-SHA1(key, 8-byte big-endian counter)
- Dynamic truncation → 6-digit code

### Integration with ui-suggest.ts

`tryAutoSession()` is called in the 60-second interval when:
- No valid Kite token exists
- All three auto-login env vars are present

The interval runs at 09:14 IST, meaning the session is generated automatically every morning before market open.

Run standalone: `npm run session:auto`

---

## 16. UI Server & SSE Streaming

**File:** `src/cli/ui-suggest.ts`

### Routes

| Route | Description |
|---|---|
| `GET /` | Main dashboard (HTML + inline CSS/JS) |
| `GET /events` | SSE stream; replays `lastSnapshot` immediately on connect |
| `GET /report` | P&L report page with monthly/quarterly tables |
| `GET /api/predictions?date=YYYY-MM-DD` | Predictions for a given date |
| `GET /api/report-dates` | Dates that have prediction data |
| `GET /api/period-stats` | Monthly and quarterly P&L aggregates |
| `POST /api/session` | Trigger Kite auth (manual fallback) |
| `POST /api/start` | Start the engine child manually |
| `POST /api/stop` | Stop the engine child |

### SSE Snapshot Caching

```typescript
let lastSnapshot: string | null = null;

function broadcast(line: string) {
  lastSnapshot = line;   // cache for new clients
  for (const [, client] of clients) client.res.write(`data: ${line}\n\n`);
}

// On new client connect:
if (lastSnapshot) res.write(`data: ${lastSnapshot}\n\n`);
clients.set(id, { id, res });
```

This ensures a freshly opened browser tab gets the last state immediately without waiting up to 2 seconds.

### UI Panels

| Panel | What it shows |
|---|---|
| Stat bar | Spot/Fut price, session, lifecycle, VIX, breadth, Spartan/Surf net |
| Recommendation card | Current trade direction, style (BUY/CREDIT SPREAD), instrument, premium, entry/target/stop |
| Options card | ATM CE/PE premiums, straddle, implied move, greeks, regime |
| Lifecycle card | State, score, session timeline |
| Signal Reasoning & Indicators | Per-TF (1m/5m/15m) full indicator breakdown + Order Flow panel |
| Predictions table | Last 200 predictions with outcome badges and P&L |
| History log | Last 40 lifecycle entries (market hours only) |
| Stock signals | Per-stock Spartan/Surfing signal table |

### Order Flow Panel

Positioned above the TF indicator grid. Shows:
- OBI Signal chip (BUY/SELL/NEUTRAL with colour)
- OBI smoothed (10-tick avg) and raw values
- Bid Qty and Ask Qty (top 3 levels)
- Cumulative Delta for the day
- Delta per tick
- Absorption badge (amber, shows when large volume absorbed with tiny price move)

---

## 17. Deployment (Railway)

**File:** `Dockerfile`

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y \
    libfontconfig1 libpixman-1-0 libfreetype6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start"]
```

The Dockerfile is required because Railway switched from nixpacks to railpack as the default build driver, which silently dropped the `fontconfig` nixpkg that `@napi-rs/canvas` (used for Telegram card rendering) needs at runtime.

`npm run start` = `tsx src/cli/ui-suggest.ts --telegram`

**Environment variables on Railway:**

```
KITE_API_KEY
KITE_API_SECRET
KITE_USER_ID          ← auto-login
KITE_PASSWORD         ← auto-login
KITE_TOTP_SECRET      ← auto-login
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_IDS
CONVEX_URL            ← optional; enables cloud prediction storage
PORT                  ← injected by Railway automatically
```

---

## 18. Configuration Reference

### CLI flags for `stream-suggest.ts`

| Flag | Default | Description |
|---|---|---|
| `--fast` | 9 | Fast SMA period |
| `--slow` | 21 | Slow SMA period |
| `--tradeTf` | `best` | Trade timeframe: `1m`/`5m`/`15m`/`best` |
| `--aggressive` | false | Gate: 3/6 conditions (vs 4/6); tighter RSI thresholds |
| `--historyDays` | 7 | Days of candle history for win-rate backtest |
| `--tpPct` | 0.25 | Take-profit % of spot price for BUY predictions |
| `--slPct` | 0.15 | Stop-loss % of spot price for BUY predictions |
| `--creditDistance` | 100 | Points OTM for short leg of credit spread |
| `--creditWidth` | 100 | Spread width in points |
| `--creditTakePct` | 0.5 | Exit credit spread when X% of credit is captured |
| `--creditStopMult` | 2 | Stop credit spread when spread widens to X× credit |
| `--intervalMs` | 2000 | Snapshot emit interval (ms) |
| `--telegram` | false | Enable Telegram alert sending |
| `--newsRisk` | auto | Force news risk level: `low`/`medium`/`high` |
| `--optionsOnly` | false | Skip equity signals; show only options data |

### Key file paths

| Path | Purpose |
|---|---|
| `data/session.json` | Kite access token (generated daily) |
| `data/instruments/` | Cached NFO/NSE instrument lists |
| `data/predictions/YYYY-MM-DD.json` | Daily prediction log |
| `data/predictions/YYYY-MM-DD.md` | Daily Markdown report |
| `.env` | All credentials (gitignored) |
| `docs/decision-engine-spec.md` | Detailed credit spread + scoring spec |
| `docs/system-architecture.md` | This document |
