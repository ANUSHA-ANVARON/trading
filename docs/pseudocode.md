# AlgoBot — Complete System Pseudocode

> Plain-English logic of every step the system takes, in the order it happens.
> No programming knowledge needed to follow this.

---

## PART 1 — SYSTEM STARTUP

```
WHEN server starts:

  1. Read environment variables (API keys, credentials, settings)

  2. Load today's instrument list from NSE/NFO
       → Find which contract is the current NIFTY Futures (nearest expiry)
       → Find ATM options (CE and PE) based on current NIFTY level
       → Find all 50 NIFTY50 stock tokens

  3. Restore today's prediction history from file
       → So a server restart doesn't wipe the day's prediction log

  4. Connect to Kite WebSocket
       → Subscribe to NIFTY Futures (FULL mode — price + order book depth)
       → Subscribe to all 50 NIFTY50 stocks (FULL mode)
       → Subscribe to NIFTY Spot + India VIX (price-only mode)
       → Subscribe to ATM Call and Put options (FULL mode)

  5. Seed candle history
       → Fetch today's 1-minute candles from Kite historical API
       → Build 5-minute and 15-minute candles by grouping the 1-minute ones
       → This avoids a "cold start" where we have no history at market open

  6. Start the 2-second engine loop
```

---

## PART 2 — EVERY TIME A PRICE TICK ARRIVES (real-time, sub-second)

```
WHEN any instrument sends a price update:

  IF the instrument is NIFTY FUTURES:

    A. Update Candle Aggregators (1m, 5m, 15m)
         → Add this tick's price to the current open candle
         → IF current time has crossed into a new candle period:
              → Close the current candle (lock in Open, High, Low, Close, Volume)
              → Start a new open candle

    B. Update Order Flow Tracker (OBITracker)
         → Read the live order book from this tick:
              Bid side: how many contracts are waiting to BUY at top 3 price levels
              Ask side: how many contracts are waiting to SELL at top 3 price levels
         → Calculate OBI (Order Book Imbalance):
              OBI = (Total Bids - Total Asks) / (Total Bids + Total Asks)
              Result is between -1 (pure selling pressure) and +1 (pure buying pressure)
         → Add this OBI reading to a rolling window of last 10 readings
         → Calculate Smoothed OBI = average of those 10 readings

         → Calculate Cumulative Delta (who is the aggressor today):
              IF price went UP this tick → volume delta is POSITIVE (buyers hit the ask)
              IF price went DOWN this tick → volume delta is NEGATIVE (sellers hit the bid)
              Add this to running total (Cumulative Delta for the day)

         → Check for Absorption:
              IF volume on this tick is very large (≥5000 contracts)
              AND price barely moved (≤0.03%)
              → Flag ABSORPTION = TRUE
                 (a large player is absorbing all the supply/demand at this level)

  IF the instrument is a NIFTY50 STOCK:
    → Track price change from yesterday's close
    → Track cumulative volume × price (turnover) in the current 1-minute bucket
    → When the 1-minute bucket closes, classify the stock:
         IF turnover in that 1 minute ≥ ₹50 crore AND price went UP → SPARTAN_UP
         IF turnover in that 1 minute ≥ ₹50 crore AND price went DOWN → SPARTAN_DN
         IF turnover ≥ ₹10 crore AND price went UP → SURFINGUP
         IF turnover ≥ ₹10 crore AND price went DOWN → SURFINGDN
         ELSE → normal activity, not notable
```

---

## PART 3 — EVERY 2 SECONDS (the main engine loop)

```
EVERY 2 SECONDS during market hours:

  Run ALL of the following steps in sequence,
  then package everything into one snapshot and send it to the UI.
```

---

### STEP 3A — COLLECT CURRENT PRICES

```
  Collect:
    → NIFTY Futures price (latest tick)
    → NIFTY Spot price (latest tick) ← used for prediction entry/exit prices
    → India VIX value (latest tick)
    → All 50 NIFTY50 stock prices
    → ATM Call and Put option premiums
```

---

### STEP 3B — CALCULATE ALL TECHNICAL INDICATORS

```
  FOR EACH timeframe (1-minute candles, 5-minute candles, 15-minute candles):

    Take the list of closed candles for that timeframe.

    TREND INDICATORS:
      SMA Fast (9 bars)   = average of last 9 closing prices
      SMA Slow (21 bars)  = average of last 21 closing prices
      EMA 9               = exponentially weighted average (recent prices count more)
      EMA 21              = same, over 21 bars
      DEMA 21             = double-smoothed EMA (less lag than regular EMA)
      WMA 21              = linearly weighted average (most recent bar counts most)
      Linear Regression   = fit a straight line through last 20 closes, take the endpoint

    MOMENTUM INDICATORS:
      RSI 14              = ratio of average up-days to average down-days over 14 bars
                            → 0-100 scale; above 50 = bullish momentum
      MACD                = difference between EMA12 and EMA26, plus a 9-bar signal line
      Momentum 10         = current close minus close 10 bars ago
      TSI                 = double-smoothed momentum (filters out noise better than RSI)

    VOLATILITY INDICATORS:
      ATR 14              = average size of each candle (high-to-low range) over 14 bars
      ATR%                = ATR as a percentage of current price
      Bollinger Bands     = 20-bar average ± 2 standard deviations
        Upper Band        = mean + 2σ
        Middle Band       = 20-bar mean
        Lower Band        = mean - 2σ
        %B                = where current price sits within the band (0=bottom, 1=top)
        Bandwidth         = how wide the bands are (low = squeeze = breakout coming)
      Standard Deviation  = how spread out prices have been over 20 bars
      Historical Vol      = annualised log-return volatility over 20 bars

    VOLUME INDICATORS:
      VWAP                = average price weighted by how much was traded at each price
      PVT                 = running total of (volume × % price change) — cumulative flow
      Relative Volume     = this bar's volume ÷ average volume of last 20 bars
      Volume Oscillator   = (5-bar volume average - 20-bar volume average) / 20-bar avg

    PRICE ACTION INDICATORS:
      Candle Pattern      = shape of the last 1-2 candles:
                            DOJI (indecision), HAMMER (bullish reversal),
                            SHOOTING STAR (bearish reversal),
                            BULLISH/BEARISH ENGULFING (strong reversal),
                            MARUBOZU (pure momentum candle)
      Trend Structure     = are we making Higher Highs + Higher Lows? (UPTREND)
                            or Lower Highs + Lower Lows? (DOWNTREND)
                            or neither? (RANGING)
      Support Level       = highest recent swing low in last 20 bars
      Resistance Level    = lowest recent swing high in last 20 bars
```

---

### STEP 3C — SCORE EACH TIMEFRAME (The 6-Condition Gate)

```
  FOR EACH timeframe (1m, 5m, 15m):

    Evaluate 6 conditions, each returns BULL, BEAR, or FAIL:

    CONDITION 1 — Trend Direction (SMA Cross):
      IF SMA Fast (9) > SMA Slow (21) → BULL
      IF SMA Fast (9) < SMA Slow (21) → BEAR
      ELSE → no signal yet (not enough candles)

    CONDITION 2 — Momentum Strength (RSI):
      IF RSI ≥ 53 → BULL (momentum behind the move)
      IF RSI ≤ 47 → BEAR
      ELSE → FAIL (RSI in neutral zone, no conviction)

    CONDITION 3 — Broad Market Support (Breadth):
      Calculate weighted average price change across all 50 NIFTY stocks
      Count how many stocks are going up vs going down (Advancers/Decliners)
      IF weighted move ≥ +0.15% AND advancers > decliners by 20% → BULL
      IF weighted move ≤ -0.15% AND decliners > advancers by 20% → BEAR
      ELSE → FAIL (index moving but market not broadly participating)

    CONDITION 4 — Day's Established Trend (Futures Day Change):
      IF NIFTY Futures is up from yesterday's close → BULL
      IF NIFTY Futures is down from yesterday's close → BEAR

    CONDITION 5 — Volatility Present (ATR Floor):
      IF ATR% ≥ 0.05% → PASS (market is moving enough to trade)
      ELSE → FAIL (dead market, any signal is noise)

    CONDITION 6 — Price Position (Bollinger Band %B):
      FOR BULL signal: price must be above the middle band (%B > 0.5)
                       AND not already at the top (%B < 0.88)
      FOR BEAR signal: price must be below the middle band (%B < 0.5)
                       AND not already at the bottom (%B > 0.12)
      → This confirms direction AND prevents entering an overextended move

    COUNT how many of the 6 conditions align for BULL and for BEAR:

    IF BULL count ≥ 4 → timeframe recommendation = LONG
    IF BEAR count ≥ 4 → timeframe recommendation = SHORT
    ELSE → NO_TRADE

    CALCULATE CONFIDENCE (0 to 0.95):
      Base score = 0.35
      Add: (how many conditions aligned / 6) × 0.35
      Add: recent win rate of this strategy × 0.30
      → Higher confidence = stronger setup
```

---

### STEP 3D — BREADTH ANALYSIS (NIFTY50 stocks)

```
  For all 50 NIFTY50 stocks:

    Count SPARTAN_UP stocks   → heavy institutional buying
    Count SPARTAN_DN stocks   → heavy institutional selling
    Count SURFINGUP stocks    → elevated retail/small fund buying
    Count SURFINGDN stocks    → elevated retail/small fund selling

    Calculate:
      spartanNet = SPARTAN_UP count - SPARTAN_DN count
      surfNet    = SURFINGUP count  - SURFINGDN count

    Calculate weighted breadth move:
      Each stock's price change × its index weight → average across all 50
      → Tells you whether the ENTIRE index is moving or just 2-3 heavyweights

    Calculate Advancers / Decliners ratio:
      → If 35 stocks are up and 15 are down, ratio = 2.33 (strongly bullish breadth)
```

---

### STEP 3E — OPTIONS ANALYTICS

```
  Using the ATM Call and Put option prices:

  BASIC METRICS:
    ATM CE premium = price of the At-The-Money Call option
    ATM PE premium = price of the At-The-Money Put option
    Straddle       = CE premium + PE premium (total cost to own both)
    Implied Move % = straddle / NIFTY spot price
                     → Market's expectation of how much NIFTY will move today

  GREEKS (Black-Scholes calculation for ATM options):
    Delta   = how much option price moves per ₹1 NIFTY move
    Gamma   = how fast delta changes (highest at ATM, explodes near expiry)
    Theta   = how much premium decays per day (time working against buyer)
    Vega    = how much premium changes per 1% change in implied volatility
    IV      = implied volatility extracted from the option's market price

  IV SKEW:
    IF put IV significantly > call IV → market pricing in downside risk (bearish tilt)
    IF call IV significantly > put IV → market pricing in upside risk (bullish tilt)

  PUT/CALL RATIO (PCR):
    PCR = total Put Open Interest / total Call Open Interest
    IF PCR > 1.15 → more puts outstanding = bearish institutional positioning
    IF PCR < 0.85 → more calls outstanding = bullish institutional positioning

  ORDER SWEEPS (large urgent orders in the option):
    IF someone suddenly buys a large block of ATM CE → institutional buying calls → BULL
    IF someone suddenly buys a large block of ATM PE → institutional buying puts → BEAR

  REGIME CLASSIFICATION:
    IF VIX ≥ 18 OR Implied Move ≥ 1.6% → VOLATILE (high fear)
    IF VIX ≤ 14 AND Implied Move ≤ 1.0% → CALM (low fear)
    ELSE → NORMAL

  TRADE STYLE DECISION:
    IF regime is VOLATILE OR implied move ≥ 1.8%:
        → Prefer BUYING options (defined risk, unlimited reward)
    ELSE IF confidence ≥ 65% AND regime is CALM/NORMAL:
        → Consider SELLING credit spreads (collect premium, theta works for us)
    ELSE:
        → BUY options

  CREDIT SPREAD CONSTRUCTION (if selling):
    FOR LONG direction (Bull Put Spread):
      SELL a Put option 100 points below current NIFTY (collect premium)
      BUY  a Put option 200 points below current NIFTY (cap the loss)
      Net Credit = sell premium - buy premium (this is our profit if NIFTY stays up)
      Max Loss   = spread width - net credit
      Target exit: when we've captured 50% of the credit
      Stop exit  : when spread widens to 2× the credit we collected
```

---

### STEP 3F — LIFECYCLE STATE (The Overall Market Verdict)

```
  Combine EVERYTHING computed so far into a single market state:

  INPUTS to lifecycle:
    → 1m, 5m, 15m recommendations and confidence scores
    → RSI values for each timeframe
    → Breadth (weighted move, adv/dec ratio)
    → Spartan/Surfing net counts
    → PCR (from options)
    → VIX
    → Implied move %

  OUTPUT — one of these states:

    CLEAN_BULLISH_FLOW:
      Multiple TFs agree LONG + strong breadth + RSI healthy
      → Best condition for LONG predictions and alerts

    CLEAN_BEARISH_FLOW:
      Multiple TFs agree SHORT + weak breadth + RSI weak
      → Best condition for SHORT predictions and alerts

    CE_EDGE:
      Mildly bullish — some signals align but not all
      → Watch, but don't predict

    PE_EDGE:
      Mildly bearish — some signals align but not all
      → Watch, but don't predict

    INDETERMINATE:
      Signals are mixed or conflicting
      → Do nothing

    HIGH_RISK:
      News risk is high, or VIX is very elevated
      → Stay out

    Also tracks SESSION:
      PRE_OPEN (before 9:15am IST)
      OPEN (9:15–9:30am, volatile first 15 minutes)
      ACTIVE (9:30am–3:15pm, main trading hours)
      CLOSING (3:15–3:30pm)
      CLOSED (after 3:30pm, no trading)
```

---

### STEP 3G — PREDICTION ENGINE (The 8-Gate Decision)

```
  FOR EACH direction (LONG and SHORT):

    Gate 0 — Market must be open:
      IF session = CLOSED → skip
      (Never predict outside 9:15am–3:30pm IST on trading days)

    Gate 1 — Minimum time since last prediction (debounce):
      IF a prediction in this direction was fired less than 10 minutes ago → skip
      (Prevents rapid-fire predictions on noise)

    Gate 2 — Strong lifecycle state only:
      FOR LONG: lifecycle must be CLEAN_BULLISH_FLOW (NOT CE_EDGE)
      FOR SHORT: lifecycle must be CLEAN_BEARISH_FLOW (NOT PE_EDGE)
      → Mild conditions are excluded — only fire on strongest setups

    Gate 3 — All 3 timeframes must agree:
      1m, 5m, AND 15m must all say the same direction
      IF even one says NO_TRADE or the opposite → skip
      → Eliminates conflicting timeframe signals entirely

    Gate 4 — RSI confirms on BOTH higher timeframes:
      FOR LONG: RSI must be ≥ 53 on 5m AND ≥ 50 on 15m
      FOR SHORT: RSI must be ≤ 47 on 5m AND ≤ 50 on 15m
      → Both medium and long term momentum must be in sync

    Gate 5 — Bollinger Bands confirm, price not overextended:
      FOR LONG: %B must be between 0.45 and 0.88 on 5m OR 15m
      FOR SHORT: %B must be between 0.12 and 0.55 on 5m OR 15m
      → Confirms trend direction AND blocks entries at extremes

    Gate 6 — Breadth supports the direction:
      FOR LONG: weighted market move > +0.05% AND more stocks advancing than declining
      FOR SHORT: weighted market move < -0.05% AND more stocks declining than advancing
      → Ensures the whole market is moving, not just NIFTY futures

    Gate 7 — Options market (PCR) not betting against us:
      FOR LONG: PCR must be ≤ 1.15 (if PCR > 1.15, institutions are loading puts → bearish)
      FOR SHORT: PCR must be ≥ 0.85 (if PCR < 0.85, institutions are loading calls → bullish)
      IF no PCR data available → pass this gate automatically

    Gate 7b — IV Skew not against direction:
      FOR LONG: put IV must NOT be more than 8% higher than call IV
               (high put IV = market pricing in downside risk = don't go long)
      FOR SHORT: call IV must NOT be more than 8% higher than put IV
      IF no IV data available → pass this gate automatically

    Gate 8 — RSI not already exhausted:
      FOR LONG: RSI on 5m must be ≤ 68 AND RSI on 15m must be ≤ 65
      FOR SHORT: RSI on 5m must be ≥ 32 AND RSI on 15m must be ≥ 35
      → If RSI is already at extreme levels, the move is DONE, not STARTING
      → Entering here = buying the top / selling the bottom = stop hit

  IF ALL 8 GATES PASS:

    Calculate Entry Price:
      Use NIFTY SPOT price (not futures) to avoid basis distortion

    Calculate Target and Stop Loss (ATR-adaptive):
      Look up current ATR% (how much NIFTY is moving per candle right now)
      Stop Loss  = max(0.25%, ATR% × 1.2)   → must be outside NIFTY's noise floor
      Take Profit = max(0.55%, Stop Loss × 2.5) → maintain at least 2.5:1 reward:risk

      Example at ATR 0.15%:
        Stop Loss   = max(0.25%, 0.18%) = 0.25% = ~60 points on 24000
        Take Profit = max(0.55%, 0.625%) = 0.625% = ~150 points on 24000
        Ratio = 2.5:1 ✓

    Calculate Confidence:
      Start with the best confidence from 5m or 15m scoring
      IF Order Book (OBI) signal agrees with direction → boost confidence by 8%
      IF PCR strongly confirms direction → boost confidence by 5%
      Cap at 95%

    Record the Prediction:
      Entry price, Target, Stop, Confidence, Timeframe, Lifecycle state, all signals
      Status = PENDING

  EVERY 2 SECONDS — Check all PENDING predictions:
    IF NIFTY Spot has reached the Target price → mark TARGET_HIT, record profit in points
    IF NIFTY Spot has crossed the Stop price   → mark STOP_HIT, record loss in points
    IF prediction is older than its time limit  → mark EXPIRED
      (1m prediction: 15 min limit)
      (5m prediction: 45 min limit)
      (15m prediction: 90 min limit)
```

---

### STEP 3H — TELEGRAM ALERTS

```
  Check these 3 types of alerts:

  ALERT TYPE 1 — Market Condition Alert:
    IF lifecycle just changed TO CLEAN_BULLISH_FLOW → send STRONG BULLISH alert
    IF lifecycle just changed TO CLEAN_BEARISH_FLOW → send STRONG BEARISH alert
    IF lifecycle is MILDLY_BULLISH, MILDLY_BEARISH, or NEUTRAL → do NOT alert
    IF same condition as last alert → do NOT alert (only on change)
    Alert card includes:
      → Condition label (STRONG BULLISH / STRONG BEARISH)
      → How many Spartan stocks are going up vs down
      → How many Surfing stocks are going up vs down
      → Top 4 Spartan stocks (highest turnover) with direction

  ALERT TYPE 2 — Trade Signal Alert:
    IF lifecycle is NOT STRONG_BULLISH or STRONG_BEARISH → skip
    IF the trade recommendation (Buy Call / Sell Put Spread / etc.) has not changed → skip
    IF it's a credit spread AND less than 25 minutes since last spread alert → skip
    Alert card includes:
      → Trade action (BUY CALL / SELL PUT SPREAD / etc.)
      → Instrument name, entry premium, target, stop
      → Confidence %

  ALERT TYPE 3 — Prediction Alert:
    IF a new PENDING prediction was just created → send once (never resend same ID)
    Alert card includes:
      → Direction (LONG / SHORT), Timeframe
      → Entry price, Target price, Stop loss
      → Confidence arc gauge
      → RSI 5m, RSI 15m, BB %B, TF agreement

  ALL ALERTS:
    → Only sent between 9:15am and 3:30pm IST (market hours)
    → Not sent on weekends or NSE holidays
```

---

### STEP 3I — OUTPUT SNAPSHOT

```
  Package everything into one JSON object and broadcast to all connected browsers:

  {
    timestamp,
    NIFTY Futures price,
    Trade Recommendation (top-level),
    Timeframes: {
      1m: { direction, confidence, all indicators },
      5m: { direction, confidence, all indicators },
      15m: { direction, confidence, all indicators }
    },
    Order Flow: {
      OBI raw, OBI smoothed (10-tick avg), OBI signal (BUY/SELL/NEUTRAL),
      Cumulative Delta (day), Delta per tick, Absorption flag,
      Bid quantity (top 3 levels), Ask quantity (top 3 levels)
    },
    Breadth: { weighted move, advancers, decliners, Spartan counts, Surfing counts },
    Options: {
      ATM CE and PE premiums, straddle, implied move %,
      Greeks (delta, gamma, theta, vega, IV) for ATM options,
      PCR, OI sweeps, IV skew, regime, trade style, spread details
    },
    Lifecycle: { state, session, score },
    Pivot Levels: { CPR, S1/S2/S3, R1/R2/R3 },
    Predictions: [ last 200 predictions with outcomes and P&L ],
    Stock Signals: [ all 50 stocks with Spartan/Surfing labels ],
    News Risk Level
  }

  Browser receives this every 2 seconds and updates all panels in real-time.
  New browsers get the last snapshot immediately on connect (no waiting).
```

---

## PART 4 — DATA PERSISTENCE

```
  EVERY TIME a prediction is created or its outcome resolves:
    → Write to local file: data/predictions/YYYY-MM-DD.json
    → Write to Convex cloud database (if configured)

  AT END OF MARKET DAY (when session transitions to CLOSED):
    → Generate a Markdown report: data/predictions/YYYY-MM-DD.md
    → Report includes: all predictions, outcomes, total P&L, win rate

  ON SERVER RESTART:
    → Read today's prediction file → restore into memory
    → Prediction log is never lost due to a crash or redeploy
```

---

## PART 5 — AUTO SESSION (Daily Login Automation)

```
  Every morning at 9:14am IST (1 minute before market opens):

  IF no valid Kite session token exists:
    IF auto-login credentials are configured (user ID, password, TOTP secret):

      Step 1: POST to Kite login endpoint with username and password
              → Get back a request_id

      Step 2: Calculate the TOTP code for this moment:
              Take the TOTP secret (base32 string)
              Calculate: current_unix_time ÷ 30 (rounds down to 30-second window)
              Run HMAC-SHA1 hash of that number using the secret as the key
              Extract 6 digits from the hash using a specific bit-extraction formula
              → This is the same 6-digit code your Google Authenticator app shows

      Step 3: POST to Kite 2FA endpoint with the TOTP code + request_id
              → Kite sets session cookies

      Step 4: Follow the OAuth redirect flow
              → At the end, extract the request_token from the redirect URL

      Step 5: Call Kite's generateSession with request_token + API secret
              → Get back the access_token

      Step 6: Save the access_token to data/session.json
              → Engine can now connect to Kite WebSocket

    Session is now valid for the entire trading day.
    No manual login needed.
```

---

## SUMMARY — Decision Flow in One View

```
NIFTY tick arrives every millisecond
         ↓
Update candles (1m / 5m / 15m)
Update order book (OBI, delta, absorption)
Track stock turnover (Spartan / Surfing)
         ↓
Every 2 seconds:
         ↓
Calculate 30+ indicators on each timeframe
         ↓
Score each timeframe against 6 conditions
→ LONG / SHORT / NO_TRADE + confidence %
         ↓
Analyse options (PCR, Greeks, IV skew, sweeps, regime)
         ↓
Compute lifecycle state
(CLEAN_BULLISH / CLEAN_BEARISH / MILD / INDETERMINATE)
         ↓
Run Prediction Engine (8 gates)
→ IF all 8 pass: fire prediction with ATR-based TP/SL
→ Check existing predictions: TARGET_HIT / STOP_HIT / EXPIRED?
         ↓
Send Telegram alerts (only on state change, only strong conditions)
         ↓
Broadcast full snapshot to browser dashboard (SSE)
         ↓
Persist predictions to file + cloud
         ↓
Wait 2 seconds → repeat
```
