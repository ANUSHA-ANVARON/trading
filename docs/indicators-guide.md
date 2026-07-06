# AlgoBot — Indicator Reference Guide

> What every indicator does, why it's there, and what its signal means for a trade.

---

## How to Read This Guide

Each indicator is explained in three parts:
- **What it measures** — the mathematical idea in plain English
- **What signal it gives** — what a reading means in practice
- **Role in our engine** — whether it gates a trade, adds confidence, or is purely informational

Indicators in this system fall into four categories:

| Category | Role |
|---|---|
| **Gate conditions** | Must pass ≥4/6 for a signal to fire at all |
| **Prediction gates** | Additional filters before a prediction is logged |
| **Confidence modifiers** | Don't block a trade but affect how strongly we rate it |
| **Display-only** | Shown in the UI for your awareness; do not affect the engine's decision |

---

## Part 1 — The 6-Condition Scoring Gate

These are the core conditions. Every timeframe (1m, 5m, 15m) is evaluated independently. A minimum of **4 out of 6** must align before the engine recommends LONG or SHORT.

---

### 1. SMA Cross (Trend)

**What it measures:**
Simple Moving Average of closes over two windows — a fast one (9 bars) and a slow one (21 bars). When the fast line is above the slow line, recent prices are higher than the longer-term average: that's an uptrend. When it crosses below, it's a downtrend.

**What the signal means:**
- Fast > Slow → **BULL** (upward momentum)
- Fast < Slow → **BEAR** (downward momentum)
- Not enough data → NA (engine waits)

**Role:** Condition 1 of 6. Always passes if enough candles exist — it determines the *direction* of the trade. Every other condition is then evaluated in the context of that direction. If SMA says BULL, the engine only looks for LONG setups in the remaining conditions.

---

### 2. RSI 14 (Momentum Strength)

**What it measures:**
Relative Strength Index over 14 bars. It compares the average size of up-moves to down-moves over the last 14 candles, expressed as a 0–100 number. High RSI means recent candles have been mostly up; low RSI means mostly down.

**Thresholds we use:**
- LONG: RSI ≥ 55 (standard) or ≥ 52 (aggressive mode)
- SHORT: RSI ≤ 45 (standard) or ≤ 48 (aggressive mode)

**What the signal means:**
RSI at 60 on a bullish SMA cross tells you the upward momentum is real and accelerating — not a weak bounce. RSI at 50 on an SMA bull cross is ambiguous: price just crossed but there is no real force behind it yet.

We deliberately avoid the classic "overbought/oversold" interpretation (>70 = sell, <30 = buy). Instead we use RSI as a momentum *confirmation* — it needs to be on the right side of 50 with some room.

**Role:** Condition 2 of 6. Filters out weak, low-conviction crosses.

---

### 3. Breadth — Weighted Move + Adv/Dec

**What it measures:**
Two things combined:
1. **Weighted price move %** — the average price change across all NIFTY50 stocks, weighted by their index weight. This tells you whether the whole index is moving or just one or two heavyweights dragging it.
2. **Advancers / Decliners ratio** — how many stocks are up vs down. An adv/dec of 1.5 means 1.5× more stocks rising than falling.

**Thresholds:**
- LONG: weighted move ≥ +0.15% AND adv/dec ≥ 1.2
- SHORT: weighted move ≤ −0.15% AND adv/dec ≤ 0.8

**What the signal means:**
If NIFTY FUT is up 50 points but only 12 of 50 stocks are green, that move is narrow and fragile — likely driven by one or two stocks. If 38 of 50 stocks are green, the move has broad participation and is far more likely to sustain.

This is one of the most important filters in the engine. A signal with broad breadth behind it has a meaningfully higher win rate than a signal with narrow breadth.

**Role:** Condition 3 of 6. Ensures the trade is supported by real market-wide movement, not a single stock manipulation.

---

### 4. Futures Day Change %

**What it measures:**
How much NIFTY FUT has moved from its previous day's close, expressed as a percentage. Positive = up from yesterday, negative = down.

**What the signal means:**
Simple directional alignment. If the engine says LONG but the futures contract is down 0.3% from yesterday's close, the dominant daily flow is against you. This condition ensures you're not fighting the day's established trend.

It's a weak but fast-updating signal — it updates every tick and doesn't require any computation window.

**Role:** Condition 4 of 6. A quick sanity check that the day's established direction agrees with the signal.

---

### 5. ATR% Floor (Volatility Present)

**What it measures:**
Average True Range as a percentage of the current price. True Range is the largest of: (high − low), (high − prev close), (prev close − low). ATR is the 14-bar average of True Range.

**Threshold:** ATR% ≥ 0.05% (standard), ≥ 0.03% (aggressive)

**What the signal means:**
If ATR% is 0.02%, the market is essentially flat — there is no meaningful range being created, and any signal in a flat market is noise. There is literally not enough price movement to make the trade worthwhile against transaction costs.

ATR% ≥ 0.05% means the market is moving at least 5 rupees per 10,000, which is the minimum required for a tradeable setup.

**Role:** Condition 5 of 6. Guards against trading in dead, directionless markets.

---

### 6. Bollinger Bands %B (Price Position Within Bands)

**What it measures:**
Bollinger Bands place an upper and lower boundary around price based on a 20-bar moving average ± 2 standard deviations. %B tells you where the current price sits within that band:

```
%B = (price − lower band) / (upper band − lower band)
```

- %B = 1.0 → price is at the upper band
- %B = 0.5 → price is at the midline (mean)
- %B = 0.0 → price is at the lower band

**Thresholds:**
- LONG: %B > 0.5 AND %B < 0.95 (above midline, not overstretched to upside)
- SHORT: %B < 0.5 AND %B > 0.05 (below midline, not overstretched to downside)

**What the signal means:**
This does two jobs at once:

1. **Confirms direction** — a LONG signal with %B above 0.5 means price is above the mean, consistent with the bullish SMA cross. If price is above the SMA cross but below the BB midline, the two signals are contradicting each other.

2. **Filters overextension** — %B > 0.95 means price is touching or exceeding the upper band. Entering a LONG there means buying at a statistical extreme — the market is "stretched" and likely to pull back before continuing. We wait for a more comfortable entry.

**Role:** Condition 6 of 6. Confirms the direction AND prevents chasing overextended moves.

---

## Part 2 — Confidence & Win Rate

### Win Rate Estimate (Backtest)

**What it measures:**
For each timeframe, the engine runs a quick backtest of the SMA-cross strategy on the last 7 days of candle data and computes what percentage of trades would have hit target before stop.

**What the signal means:**
If the 5m SMA strategy has been right 65% of the time over the last 7 days in current market conditions, confidence gets a meaningful boost. If it's been wrong 60% of the time, confidence is suppressed.

**Role:** Directly feeds the confidence formula: `0.35 + (aligned/6)×0.35 + winRate×0.3`. A signal with 6/6 conditions aligned and a 70% recent win rate reaches ~0.86 confidence. The same 6/6 with a 30% win rate caps at ~0.66.

---

## Part 3 — Extended Trend Indicators

These do not affect the gate or confidence. They are computed after the gate decision and shown in the indicator panels for context and future use.

---

### EMA 9 and EMA 21 (Exponential Moving Average)

**What it measures:**
Like SMA but with exponential weighting — recent prices count more than older ones. EMA reacts faster to new data than SMA.

**What the signal means:**
- EMA9 > EMA21 = **BULL cross** (bullish short-term momentum)
- EMA9 < EMA21 = **BEAR cross**

The EMA cross and SMA cross often agree but occasionally diverge. When they diverge (SMA says BULL but EMA says BEAR), it's an early warning that momentum may be fading even though the trend hasn't reversed.

**Role:** Display-only. Cross direction shown as EMA Cross signal in the Trend section.

---

### DEMA 21 (Double EMA)

**What it measures:**
`DEMA = 2 × EMA(21) − EMA(EMA(21))`. The second EMA pass cancels out the lag inherent in a single EMA. The result tracks price more closely with less delay than a plain EMA.

**What the signal means:**
Compare current price to DEMA21. Price > DEMA21 in an uptrend = the trend is still strong and DEMA is acting as support. Price < DEMA21 while trend is BULL = momentum is weakening.

**Role:** Display-only. Gives a cleaner trend reference than EMA alone.

---

### WMA 21 (Weighted Moving Average)

**What it measures:**
Like SMA but each bar is weighted linearly — the most recent bar has weight 21, the one before has 20, ... the oldest has 1. This sits between SMA (equal weight) and EMA (exponential decay) in terms of responsiveness.

**Role:** Display-only. A third moving average perspective. When SMA, EMA, and WMA are all stacked in the same order (price > EMA > WMA > SMA in a bull), it signals a strong, clean trend.

---

### Linear Regression Curve (LRC 20)

**What it measures:**
Fits a straight line through the last 20 closes using ordinary least squares, then shows where that line ends (at the current bar). Unlike a moving average, it has no lag — it tells you exactly where a "best fit" trend line says price should be right now.

**What the signal means:**
- Price well above LRC = stretched above the regression trend, possible pullback
- Price near LRC = healthy, in-trend
- Price well below LRC in an uptrend = oversold relative to recent trend, potential bounce

**Role:** Display-only. Particularly useful for identifying when a trending move is over-extended vs still running in its normal trajectory.

---

## Part 4 — Momentum Indicators

---

### MACD (12 / 26 / 9)

**What it measures:**
Three values derived from EMAs:
- **MACD Line** = EMA(12) − EMA(26): the difference between fast and slow trend
- **Signal Line** = EMA(9) of MACD Line: a smoothed version of MACD
- **Histogram** = MACD Line − Signal Line: the momentum of the momentum

**What the signal means:**
- MACD Line > 0: short-term trend is stronger than long-term → bullish
- MACD Line < 0: short-term trend weaker than long-term → bearish
- Histogram growing (bars getting taller): momentum is accelerating
- Histogram shrinking (bars getting shorter): momentum is fading — watch for reversal
- MACD Line crosses Signal Line upward: classic buy signal
- MACD Line crosses Signal Line downward: classic sell signal

**Role:** Display-only. The histogram is the most useful — shrinking histogram in a trending move is an early warning before price reverses.

---

### Momentum (Rate of Change, period 10)

**What it measures:**
The simplest momentum indicator: `close[now] − close[10 bars ago]`. Positive = price higher than 10 bars ago. Negative = lower.

**What the signal means:**
- Large positive number = strong upward momentum over the last 10 bars
- Near zero = stalling, going sideways
- Negative and growing more negative = downtrend accelerating

**Role:** Display-only. A quick raw read on how much ground price has covered recently.

---

### TSI — True Strength Index (25 / 13)

**What it measures:**
Double-smoothed momentum oscillator. It takes the raw price change (close-to-close), smooths it with a 25-period EMA, then smooths that again with a 13-period EMA. It does the same for the absolute price change, then divides to normalise. Result is −100 to +100 but practically oscillates between −25 and +25.

**What the signal means:**
- TSI > 0: underlying momentum is positive (even if price paused)
- TSI < 0: underlying momentum is negative
- TSI crossing zero upward = momentum shift from bear to bull — often leads price
- TSI divergence (price makes new high but TSI doesn't): weakening momentum, warning

TSI is more powerful than plain momentum because the double smoothing filters out noise while keeping the underlying direction intact.

**Role:** Display-only. One of the best momentum indicators for trending markets like NIFTY. Complements MACD well.

---

## Part 5 — Volatility Indicators

---

### ATR% (Average True Range %)

Already explained in the gate section above. In the indicator panel it shows the full value (e.g. 0.12%) rather than just pass/fail.

**Additional context:**
- ATR% 0.05–0.10% = calm market, tight setups
- ATR% 0.10–0.18% = normal market
- ATR% 0.18–0.28% = elevated volatility, wider stops needed
- ATR% > 0.28% = high volatility; credit spreads preferred over buying

---

### Bollinger Bands — Full Display (Upper / Middle / Lower / Bandwidth / %B)

Already explained in gate section. The full panel shows all five values:

**Bandwidth** = `(upper − lower) / middle`. This measures how wide the bands are — low bandwidth = range contraction (squeeze), high bandwidth = expansion.

**BB Squeeze:** When bandwidth drops to very low levels, price is compressing. This often precedes a sharp directional move. The squeeze itself doesn't tell you direction — watch what breaks out of it.

**%B (repeated for emphasis):** The single most useful BB value for our engine. Below 0.2 = oversold relative to the recent range. Above 0.8 = overbought. Between 0.4–0.6 = healthy trend zone.

---

### Standard Deviation 20 (StdDev)

**What it measures:**
Population standard deviation of the last 20 closes. Measures how dispersed prices have been around their mean.

**What the signal means:**
High StdDev = high variability, wide price swings, uncertain market.
Low StdDev = tight clustering, prices not moving much.

**Role:** Display-only. Context for interpreting other indicators — a high RSI in a high-StdDev environment is less reliable than the same RSI in a calm, low-StdDev market.

---

### Historical Volatility 20 (HV%)

**What it measures:**
Annualised close-to-close log-return standard deviation over 20 bars. This is how professional traders and options desks measure volatility:

```
logReturn[i] = ln(close[i] / close[i-1])
HV = stdDev(logReturns) × √252 × 100
```

Expressed as a percentage (e.g. 15% means NIFTY is expected to move ~15% annualised).

**What the signal means:**
Comparing HV to IV (implied volatility from the options premiums) tells you if options are cheap or expensive. HV > IV = options are cheap relative to actual movement — good time to buy. HV < IV = options are expensive relative to movement — good time to sell (credit spreads).

**Role:** Display-only. Essential context for options selection decisions.

---

### VIX (India VIX)

**What it measures:**
India VIX is the NSE's official fear gauge — derived from NIFTY options prices, it measures the market's expectation of 30-day annualised volatility. Unlike HV (backward-looking), VIX is forward-looking: it reflects what the market *expects* to happen.

**What the signal means:**
- VIX < 13: extremely calm market; options are cheap; low fear
- VIX 13–18: normal market conditions
- VIX 18–22: elevated uncertainty; cautious with naked buys
- VIX > 22: high fear; regime = VOLATILE; prefer credit spreads or cash

**Role in our engine:**
- Feeds the regime classification (CALM / NORMAL / ELEVATED / VOLATILE)
- Used in the `canSell` decision for credit spreads: `VIX < 18` allows selling
- Passed to `scoreSuggestion()` as context and displayed in every TF panel
- High VIX also suppresses prediction confidence (indirectly via regime)

---

## Part 6 — Volume Indicators

---

### Volume (Raw)

**What it measures:**
The number of NIFTY FUT contracts traded in the current candle. Because Kite provides cumulative intraday volume on each tick, the candle volume is `currentCumulativeVolume − volumeAtCandleOpen`.

**What the signal means:**
Volume is the ultimate validation of a price move:
- Price moves up on HIGH volume = genuine buying interest, move is likely to continue
- Price moves up on LOW volume = weak, potentially manipulated or accidental
- Price reverses on HIGH volume = strong conviction in the reversal
- Price reverses on LOW volume = likely temporary

**Role:** Display-only but critical for context. Always check volume when a signal fires.

---

### Relative Volume (RelVol)

**What it measures:**
`currentBarVolume ÷ average(last20BarsVolume)`. A ratio of how unusual this bar's volume is relative to recent norms.

**What the signal means:**
- RelVol 1.0 = exactly average volume
- RelVol 2.0 = double the average — significant participation
- RelVol 0.5 = half the average — thin market, be cautious
- RelVol > 3.0 = very unusual — a major event is happening (large institutional order, news catalyst, or opening spike)

**Role:** Display-only. If a signal fires on RelVol > 2.0, that's high conviction. If RelVol is 0.3 when a signal fires, treat it with skepticism — the move may be happening in an empty market.

---

### Volume Oscillator (VolOsc)

**What it measures:**
`(fastVolumeMA5 − slowVolumeMA20) / slowVolumeMA20 × 100`. The percentage difference between a fast 5-bar volume average and a slow 20-bar volume average.

**What the signal means:**
- Positive VolOsc: recent bars have more volume than the 20-bar norm → buying/selling activity increasing → trend likely strengthening
- Negative VolOsc: recent bars are quieter than normal → participation fading → trend may be exhausting

**Role:** Display-only. Best used in combination with price direction: a bullish move with rising VolOsc = strong continuation signal. A bullish move with falling VolOsc = possible exhaustion.

---

### PVT — Price Volume Trend

**What it measures:**
A running cumulative sum that weights each bar's volume by the relative price change:

```
PVT += volume × (close − prevClose) / prevClose
```

It's similar to OBV (On-Balance Volume) but proportional: a large price move contributes more than a small one, even with the same volume.

**What the signal means:**
- PVT rising: net accumulation (more volume on up moves than down moves) → bullish
- PVT falling: net distribution (more volume on down moves) → bearish
- PVT divergence from price: if price makes a new high but PVT does not, the move is losing volume support — potential reversal

**Role:** Display-only. One of the cleanest volume-trend tools. PVT rising while price consolidates = accumulation in progress, expect breakout.

---

### VWAP 20 (Volume-Weighted Average Price)

**What it measures:**
The average price of the last 20 candles, weighted by how much was traded at each price:

```
VWAP = Σ(typicalPrice × volume) / Σ(volume)
```

where `typicalPrice = (high + low + close) / 3`.

**What the signal means:**
VWAP is the fairest representation of "average price actually paid" over the window. Large institutions often use VWAP as a benchmark — buying below VWAP = accumulating at better-than-average price.

- Price above VWAP: bulls are in control; buyers willing to pay above average
- Price below VWAP: bears dominate; sellers willing to sell below average
- Price returning to VWAP from above: potential support level
- Price returning to VWAP from below: potential resistance level

**Role:** Display-only. Especially useful as a dynamic support/resistance level intraday.

---

## Part 7 — Price Action Indicators

---

### Candle Pattern

**What it measures:**
The shape of the most recent 1–2 candles, decoded into a named pattern. Pattern is determined by body-to-range ratios and wick sizes.

**Patterns and what they mean:**

| Pattern | What it looks like | Signal |
|---|---|---|
| **DOJI** | Body < 10% of range (open ≈ close) | Indecision; market undecided; watch for breakout |
| **HAMMER** | Small body at top, long lower wick (>2× body), tiny upper wick | Buyers rejected selling; bullish reversal signal (especially after a downtrend) |
| **SHOOTING STAR** | Small body at bottom, long upper wick (>2× body), tiny lower wick | Sellers rejected rally; bearish reversal signal (especially after an uptrend) |
| **BULLISH ENGULFING** | Large bull candle that fully contains previous bear candle | Strong bullish reversal; buyers overwhelmed sellers |
| **BEARISH ENGULFING** | Large bear candle that fully contains previous bull candle | Strong bearish reversal; sellers overwhelmed buyers |
| **BULLISH MARUBOZU** | Body > 90% of range; almost no wicks, closed at high | Extreme bullish dominance; continuation likely |
| **BEARISH MARUBOZU** | Body > 90% of range; closed at low | Extreme bearish dominance; continuation likely |
| **SPINNING TOP** | Body 10–40% of range; roughly equal wicks on both sides | Indecision with more range than a Doji; neither side decisive |
| **NONE** | Normal candle; no significant pattern | No special message |

**Role:** Display-only. When the pattern aligns with the signal direction (e.g. Bullish Engulfing on a LONG signal) it's a high-conviction moment. A Shooting Star appearing during a LONG signal is a warning to reconsider.

---

### Trend Structure

**What it measures:**
Identifies whether price is making Higher Highs + Higher Lows (UPTREND), Lower Highs + Lower Lows (DOWNTREND), or neither (RANGING). Uses swing point detection over recent candles.

**What the signal means:**
- **UPTREND**: Each pullback holds above the previous pullback low; each rally exceeds the previous rally high. Classic healthy bull structure — safe to hold longs.
- **DOWNTREND**: Each bounce fails below the previous bounce high; each drop goes below the previous drop low. Safe to hold shorts; any long is fighting the structure.
- **RANGING**: No clear HH/HL or LL/LH pattern. Price is going sideways. Trend-following signals are less reliable here; breakout or mean-reversion approach needed instead.
- **NA**: Not enough candles for swing detection.

**Role:** Display-only. This is the most important price action context indicator. A LONG signal in UPTREND structure = with the flow. A LONG signal in DOWNTREND structure = fighting the structure, needs to be a much higher-conviction setup.

---

### Support Level

**What it measures:**
The highest local swing low in the last 20 bars — the price level where buyers have previously stepped in and prevented further downside.

**What the signal means:**
When price is near the support level, it's approaching a zone where buyers are historically active. This makes a LONG entry more attractive (buying at or near support = buying where others have bought before with the intent to hold).

A LONG signal that fires 3 bars after price bounced off support is a high-quality setup. A LONG signal with price far above support has less "natural" backing.

**Role:** Display-only. Use to assess the quality of an entry location.

---

### Resistance Level

**What it measures:**
The lowest local swing high in the last 20 bars — the price level where sellers have previously stepped in and capped any further upside.

**What the signal means:**
When price is near resistance, it's approaching a zone where sellers are historically active. A LONG signal with price right at resistance is a lower-quality entry — you're buying into a wall.

A SHORT signal near resistance is well-placed — selling into a level that has previously held.

**Role:** Display-only. Informs entry quality, not trade direction.

---

## Part 8 — Order Flow Indicators

These are different from all the above because they work at the **tick level** (sub-second), not the candle level. They come directly from the live Kite WebSocket depth data.

---

### OBI — Order Book Imbalance

**What it measures:**
At every tick, Kite provides the live order book — bids (buyers waiting) and asks (sellers waiting), at 5 price levels each. OBI aggregates the top 3 levels:

```
OBI = (total bid quantity at levels 1-3) − (total ask quantity at levels 1-3)
      ─────────────────────────────────────────────────────────────────────
      (total bid quantity at levels 1-3) + (total ask quantity at levels 1-3)
```

Range: −1.0 (all asks, no bids) to +1.0 (all bids, no asks).

The OBI displayed in the UI is the **smoothed** version — a rolling average of the last 10 tick readings — to avoid reacting to a single abnormal tick.

**Signal thresholds:**
- OBI > +0.15 → **BUY** (bid side is significantly heavier)
- OBI < −0.15 → **SELL** (ask side is significantly heavier)
- Between → **NEUTRAL**

**What the signal means:**
Order book imbalance is one of the strongest short-term directional predictors available to a retail trader. When large market participants are about to buy, they first place large limit orders on the bid to signal intent (or to get a better fill). The order book starts tilting toward the bid before the actual price move happens.

In academic research, OBI has been shown to predict the next tick's direction with 60–65% accuracy in liquid futures markets — far better than any lagging indicator.

**Practical examples:**
- LONG signal fires AND OBI is +0.4 (heavy bid stacking) → very high conviction
- LONG signal fires AND OBI is −0.3 (heavy ask pressure) → the market is not agreeing; consider waiting
- OBI flips from +0.2 to −0.3 suddenly during a rally → institutional selling coming in; potential top

**Role:** Display-only currently, but the most powerful real-time confirmation signal in the system. Plan: future version will add OBI as an optional 7th gate condition.

---

### Bid Qty × 3 and Ask Qty × 3

**What it measures:**
The raw absolute numbers feeding into OBI — total pending buy orders and total pending sell orders at the top 3 price levels.

**What the signal means:**
These numbers tell you the market depth in absolute terms. A Bid Qty of 50,000 vs Ask Qty of 5,000 is extreme imbalance — someone is ready to absorb enormous selling. A Bid Qty of 1,000 vs Ask Qty of 900 is a thin market — the signal is less reliable.

**Role:** Display-only. Context for interpreting OBI.

---

### Cumulative Delta (Day)

**What it measures:**
The running signed-volume total for the day:

```
each tick: delta = volumeDelta × direction
                   where direction = +1 if price ticked up, −1 if down, 0 if flat
cumDelta += delta
```

This approximates who has been the net aggressor across the entire trading day.

**What the signal means:**
- Positive and rising: buyers have been consistently aggressive throughout the day; the day is accumulating
- Positive but falling (becoming less positive): buying pressure drying up; possible reversal
- Negative: sellers have dominated the day overall

**The most powerful use case — divergence:**
If NIFTY is up 80 points on the day but cumulative delta is negative (or flat), it means the price has been pushed up primarily by sellers lifting their offers rather than buyers aggressively hitting asks. This is a weak, potentially unsustainable move. If price is up 80 points AND cumulative delta is strongly positive, it's a genuinely demand-driven rally.

**Role:** Display-only. The day's running story of who has been in control.

---

### Delta Per Tick

**What it measures:**
The signed volume of the most recent tick only. Positive = last tick was a buyer-driven tick; negative = seller-driven.

**What the signal means:**
Noise on its own. Only interesting when the numbers are very large (a block trade hitting the market) or when it's consistently in one direction over many ticks.

**Role:** Display-only. Texture / microstructure color.

---

### Absorption

**What it measures:**
A flag that fires when:
- Volume traded in the current tick period ≥ 5,000 contracts
- Price moved ≤ 0.03% (barely moved despite the large volume)

**What the signal means:**
This is one of the most important signals in the order flow toolkit. When a very large amount of contracts trade and price barely moves, it means a massive opposing order is being filled at that price. The large player is *absorbing* all the supply (or demand) without letting price escape.

**Example:**
Price has been falling. Suddenly 8,000 contracts trade at 24,000 and price moves from 24,000 to 24,003 — essentially flat. This means a large buyer absorbed all the selling at 24,000. This is called "demand absorption" — the level is likely to hold, and price may reverse sharply upward.

**Displayed as:** An amber "⚠ ABSORPTION" badge in the Order Flow panel.

**Role:** Display-only but extremely high-signal when it appears. If Absorption fires during a LONG signal at a support level, that is one of the highest-quality trade setups possible.

---

## Part 9 — SCSE / Spartan-Surfing Signals

### What SCSE Means
SCSE stands for **Spartan / Surfing / Clean / Edge** — the four lifecycle states where the engine considers conditions tradeable.

---

### Spartan Signal

**File:** `src/cli/stream-suggest.ts` — stock flow tracking section

**What it actually measures (the real implementation):**
Spartan is a **turnover-based signal**, not a technical indicator. For every NIFTY50 stock, the engine tracks the traded value (in Indian Rupees) inside each 1-minute candle bucket:

```
turnover (INR) = Σ (volume_delta × last_price) per 1-minute bucket
```

where `volume_delta` is the change in cumulative volume between ticks within that bucket.

**Thresholds:**
- `turnoverInr ≥ ₹50 crore in 1 minute` → **SPARTAN** (extremely high institutional activity)
- `₹10 crore ≤ turnoverInr < ₹50 crore` → **SURFING** (elevated but not institutional)
- `₹5 crore ≤ turnoverInr < ₹10 crore` → records lastBuy / lastSell timestamp only
- Below ₹5 crore → ignored

Direction is then overlaid:
- Stock price moved up from prev close (>0.02%) → `SPARTAN_UP` or `SURFINGUP`
- Stock price moved down (<−0.02%) → `SPARTAN_DN` or `SURFINGDN`
- Otherwise → `SPARTAN_FLAT` / `SURFINGFLAT`

**What the signal means:**
₹50 crore traded in a single minute in one NIFTY50 stock means a very large institution — a mutual fund, FII, or HNI — is making a significant move. These are exactly the participants who move the index. When you see 15–20 NIFTY50 stocks crossing this threshold in the same direction, the index move is being driven by real money, not retail noise.

**Example:**
RELIANCE shows SPARTAN_UP: ₹80cr traded in 1 minute, price up 0.4%.
TCS shows SPARTAN_UP: ₹55cr traded, price up 0.3%.
HDFC shows SPARTAN_UP: ₹65cr traded, price up 0.2%.

Three index heavyweights seeing institutional buying simultaneously → the NIFTY rally is real.

**Aggregate use:**
```
spartanUp  = count of stocks showing SPARTAN_UP right now
spartanDn  = count of stocks showing SPARTAN_DN right now
spartanNet = spartanUp − spartanDn   ← shown in stat bar
```

**Role:** Feeds directly into the lifecycle state (`CLEAN_BULLISH_FLOW`, `CLEAN_BEARISH_FLOW`). When spartanNet is significantly positive, lifecycle shifts toward bullish — prediction gates for LONG open up.

---

### Surfing Signal

**What it actually measures:**
Same turnover computation as Spartan, but at a lower threshold: **₹10–50 crore per minute**. This is elevated but not institutional-grade activity — could be large retail traders, smaller funds, or HNIs.

Direction uses the same price % change logic.

**What the signal means:**
Surfing represents "following the smart retail and small-fund money." Not as powerful as Spartan individually, but when many stocks are simultaneously SURFINGUP, it still indicates broad participation in a rally.

**Combined net:**
```
surfNet = surfingUp − surfingDn   ← shown in stat bar
```

**The combined score (spartanNet + surfNet) tells you:**
- Both positive and high: broad, deep buying across the index — highest quality bull signal
- spartanNet positive but surfNet negative: institutions buying but smart retail selling — mixed; caution
- Both negative: deep broad selling — highest quality bear signal

**Role:** Combined with spartanNet to compute lifecycle state. The lifecycle engine adds these counts as a "strength" parameter alongside RSI, trend, and breadth.

---

### Stock Signal History

For each NIFTY50 stock, the engine records the **timestamp** of its last Spartan/Surfing event:
- `lastSpartanUp`, `lastSpartanDn`
- `lastSurfingUp`, `lastSurfingDn`
- `lastBuy`, `lastSell` (any turnover ≥ ₹5cr in direction)

This history is displayed in the Stock Signals table in the UI, showing which stocks were recently active and in which direction. A stock that showed SPARTAN_UP 3 minutes ago is still relevant context even if this particular minute was quiet.

---

## Part 10 — CPR / Pivot Levels

### CPR — Central Pivot Range

**What it measures:**
Derived from the previous day's High, Low, and Close:

```
Pivot = (H + L + C) / 3
TC (Top Central) = (Pivot − BC) + Pivot
BC (Bottom Central) = (H + L) / 2
```

Also computes S1/S2/S3 (supports) and R1/R2/R3 (resistances).

**What the signal means:**
CPR is the single most important level for intraday trading. Where price opens relative to CPR determines the day's bias:
- Price opens above TC and holds: **bullish day** — look for LONG entries near CPR
- Price opens below BC and holds: **bearish day** — look for SHORT entries near CPR
- Price opens within CPR (narrow CPR): **indecisive** — wait for a clean break

The support/resistance levels (S1, S2, R1, R2) are natural target and stop levels — price tends to respect these much more than arbitrary percentage-based levels.

**Role:** Display-only in the Pivot Levels card. Provides the daily structural framework within which all other signals operate.

---

## Summary: How All Indicators Work Together

The engine layers these signals in three stages:

**Stage 1 — Does anything tradeable exist? (Gate conditions)**
SMA Cross establishes direction. RSI, Breadth, Futures Change, ATR%, and BB%B confirm that the setup has strength, market support, and is not overextended. 4/6 minimum → LONG or SHORT.

**Stage 2 — Is this a high-conviction prediction? (Prediction gates)**
Lifecycle state must match (CLEAN_BULLISH/BEARISH or CE/PE EDGE). At least 2/3 timeframes must agree. RSI and BB must confirm on a higher timeframe. Breadth must support. 10-minute debounce prevents churning.

**Stage 3 — What is the quality of the entry right now? (Display indicators)**
Order flow (OBI, cumulative delta, absorption) tells you if the real money is on your side at this exact moment. Volume (RelVol, VolOsc, PVT) tells you if the move has participation. Price action (pattern, trend structure, support/resistance) tells you if the setup is technically clean. MACD, TSI, Momentum tell you if the underlying momentum is accelerating or fading.

A perfect entry is: LONG signal (4+/6 conditions) → CLEAN_BULLISH_FLOW lifecycle → 3/3 TF agreement → OBI BUY → near support level → Hammer or Bullish Engulfing candle pattern → Absorption flag fired recently → RelVol > 1.5 → Cumulative Delta positive and rising. Every additional confirming indicator stacks conviction.
