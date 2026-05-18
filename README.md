# Kite Connect F&O (Node + TypeScript)

Minimal CLI utilities for Zerodha Kite Connect focused on Futures & Options (NFO).

This repo is set up to support a clean workflow:

1) Research/analysis on historical data
2) Backtest with costs & no look-ahead
3) Paper trading using live LTP
4) Small live trading (only after (1)-(3) look solid)

## Prereqs

- Node.js 18+ (recommended 20+)
- A Kite Connect app with API key + secret

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill in:

- `KITE_API_KEY`
- `KITE_API_SECRET`

## Auth (daily access token)

1. Get login URL:

```bash
npm run login:url
```

2. Open the printed URL, login, and after redirect copy the `request_token`.

3. Generate and store session:

```bash
npm run session:generate -- --request_token <REQUEST_TOKEN>
```

This writes `data/session.json` (gitignored).

## F&O instruments (NFO)

Sync instrument dump (cached to `data/instruments/NFO.json`):

```bash
npm run instruments:sync:nfo
```

Sync NSE instruments (needed for NIFTY50 breadth token resolution):

```bash
npm run instruments:sync:nse
```

Search futures/options:

```bash
npm run fo:search -- --query NIFTY
npm run fo:search -- --underlying NIFTY --type FUT
npm run fo:search -- --underlying NIFTY --type CE --strike 22000
```

## LTP / Quote

```bash
npm run quote:ltp -- --instruments NFO:NIFTY26MARFUT NFO:BANKNIFTY26MAR48000CE
```

## Place an F&O order (guarded)

Dry-run (prints params):

```bash
npm run order:fo -- --tradingsymbol NIFTY26MARFUT --exchange NFO --qty 50 --side BUY --order_type MARKET --product NRML
```

Actually place (requires `--confirm`):

```bash
npm run order:fo -- --tradingsymbol NIFTY26MARFUT --exchange NFO --qty 50 --side BUY --order_type MARKET --product NRML --confirm
```

Notes:
- This is live trading. Start small.
- Ensure your app permissions and account segment are enabled for derivatives.

## Backtesting (properly, first)

You should backtest before paper/live trading.

### 1) Get historical candles

This repo includes a CSV backtest runner. Export a CSV with columns like:

`time,open,high,low,close,volume`

Where `time` can be parseable by JavaScript `Date` (ISO recommended).

### 2) Run a sample backtest (SMA crossover)

```bash
npm run backtest:run -- --csv data/your_candles.csv --skipHeader --symbol NIFTYFUT --cash 200000 --lot 50 --fee 20 --slippage-bps 2 --fast 9 --slow 21 --lots 1
```

What it does:
- Uses **next candle open** for fills (reduces look-ahead bias)
- Applies `--fee` per order and `--slippage-bps` to fills

### 3) Iterate

Once you have a strategy idea, implement your own strategy in `src/strategies/` using the `Strategy` interface.

### Backtest directly from Kite (yesterday / chosen day)

If you have Kite access tokens set up, you can backtest using Kite historical candles (no CSV needed):

```bash
# Example: backtest yesterday 5m candles on a NIFTY futures symbol
npm run backtest:kite -- --instrument NFO:NIFTY26MARFUT --interval 5minute --day yesterday --cash 200000 --lot 50 --fee 20 --slippage-bps 2 --fast 9 --slow 21 --lots 1
```

Notes:
- This backtests price-based strategies on **futures candles** (fees+slippage included).
- Backtesting PCR/option-chain-OI driven signals requires external historical options OI snapshots (see `src/analysis/limitations.md`).

## Paper trading

Paper trading runs a loop that polls Kite LTP and simulates fills + PnL locally.

```bash
npm run paper:run -- --tradingsymbol NIFTY26MARFUT --exchange NFO --pollMs 2000 --cash 200000 --lot 50 --fee 20 --slippage-bps 2 --fast 9 --slow 21 --lots 1
```

Notes:
- This is a minimal paper loop: it treats each poll as a "candle" close.
- For realistic paper/live, you typically build real 1m/5m candles from ticks.

### Paper trade options (today, continuous)

This runs the live suggestion engine (`stream:suggest`) and simulates **today’s intraday options trades** based on the `options.suggestion` block:
- `BUY CALL` / `BUY PUT` (premium-risk)
- `SELL PUT SPREAD` / `SELL CALL SPREAD` (defined-risk credit spread)

```bash
npm run paper:options:today -- --intervalMs 2000 --historyDays 7 --fast 9 --slow 21 --lots 1 --fee 20 --slippageBps 2
```

Risk controls (optional):

```bash
npm run paper:options:today -- --stopLossPctBuy 0.35 --takeProfitPctBuy 0.6 --stopLossPctSpread 0.5 --takeProfitPctSpread 0.5 --maxHoldMin 45
```

## Real-time market bias (JSON, no execution)

This prints a conservative, structured bias JSON by combining:
- Spot + futures quote
- Futures depth (bid/ask imbalance)
- Futures VWAP position
- NFO option-chain OI around ATM (PCR)
- 1m/5m/15m trend from recent futures candles
- OI build-up inference using a stored snapshot (price+OI deltas)

Example:

```bash
npm run analyze:nifty -- --spot "NSE:NIFTY 50" --underlying NIFTY --strikes 10 --vix "NSE:INDIA VIX" --news neutral --global mixed
```

Defaults:
- If `--fut` is omitted, it auto-picks the **near-expiry NIFTY futures** contract.
- If `--expiry` is omitted, it auto-picks the **nearest weekly options expiry** (fallbacks to nearest expiry if needed).

You can print what it will pick:

```bash
npm run defaults:nifty
```

Output is strict JSON:

```json
{
	"market_bias": "BULLISH / BEARISH / SIDEWAYS",
	"confidence_score": 0,
	"trend_type": "TRENDING / REVERSAL / RANGE",
	"key_signals": [],
	"risk_level": "LOW / MEDIUM / HIGH",
	"suggested_strategy": "BUY CALL / BUY PUT / WAIT / SELL OPTION (advanced)",
	"reasoning": "..."
}
```

Important:
- If fewer than 3 factors align (or signals conflict), the engine returns `SIDEWAYS` with lower confidence.
- This is for analysis + paper-first validation. Only consider live orders after paper performance is stable.

## NIFTY50 breadth / weightage contribution (JSON)

You can optionally analyze the 50 constituent stocks using your own weightage file:

1) Create `nifty50-weights.json` by copying `nifty50-weights.example.json` and filling the correct weights.

2) Run breadth:

```bash
npm run analyze:breadth -- --weights nifty50-weights.json
```

If you do not pass `--weights`, these tools default to an equal-weight NIFTY50 universe.

This outputs:
- weighted_move_pct (sum of weight% * stock change%)
- advancers/decliners/unchanged
- aggregated buy vs sell quantity imbalance (from quotes)
- top contributors + laggards

Note on "dynamic weights":
- NIFTY50 index weights don’t continuously change tick-by-tick; they change mainly during periodic rebalances and corporate actions.
- Kite does not provide official index weight data.
- If you don’t provide weights, these tools fall back to an **equal-weight NIFTY50 universe** so you can still track breadth + buy/sell imbalance live.

### WebSocket streaming (lower latency)

Kite provides live `buy_quantity`, `sell_quantity`, and (in `full` mode) 5-level depth over WebSocket.
You can stream breadth continuously:

```bash
npm run stream:breadth -- --weights nifty50-weights.json --mode quote --intervalMs 2000
```

### Continuous trade suggestion (analysis-only, JSON)

This combines:
- NIFTY50 breadth (price change % across constituents)
- NIFTY near-expiry futures 1m/5m candles built from ticks
- Multiple indicators (SMA trend + RSI + ATR volatility filter)

It prints a JSON suggestion every `intervalMs` with a **baseline win-rate estimate** computed from the last `historyDays` of futures candles.

It also includes an `options` block:
- Automatically selects **nearest weekly NIFTY option expiry** and current **ATM strike** (step 50)
- Resolves ATM **CE/PE instruments**, streams their live premiums, and suggests a simple directional action:
	- `LONG` → `BUY CALL`
	- `SHORT` → `BUY PUT`
	- `NO_TRADE` → `WAIT`

It also supports **sell-side** suggestions via **defined-risk credit spreads** (not naked option selling):
- Bullish (`LONG`) → `SELL PUT SPREAD` (put credit spread)
- Bearish (`SHORT`) → `SELL CALL SPREAD` (call credit spread)
- The engine chooses between BUY vs CREDIT_SPREAD based on a conservative volatility/confidence heuristic.

```bash
npm run stream:suggest -- --weights nifty50-weights.json --mode quote --intervalMs 2000 --historyDays 7 --fast 9 --slow 21
```

To override the option expiry:

```bash
npm run stream:suggest -- --expiry 2026-03-30
```

To tune credit spread strikes (distance from ATM and width):

```bash
npm run stream:suggest -- --creditDistance 100 --creditWidth 100 --optStep 50
```

To include a small option-chain around ATM for OI/PCR context (best-effort; uses live ticks):

```bash
# +/- 3 strikes around ATM (CE+PE)
npm run stream:suggest -- --chainSteps 3
```

To adjust the risk-free rate used for IV/Greeks (Black–Scholes, approximate):

```bash
npm run stream:suggest -- --riskFreeRate 0.06
```

For liquidity sweep heuristics (top-of-book changes), prefer `--mode full` so depth is available:

```bash
npm run stream:suggest -- --mode full
```

To be extra conservative during high-impact news (disables sell-side suggestions):

```bash
npm run stream:suggest -- --newsRisk high
```

Notes:
- `probability` / `winning_percentage` are empirical estimates from recent history; they are **not guaranteed**.
- This command does **not** place orders. Use it for paper trading first.
- Options suggestions include BUY (risk-limited to premium) and CREDIT SPREADS (defined-risk). No naked selling is suggested.

### Intraday options backtest (today)

Backtests a simplified intraday options strategy for **today**:
- Signal: FUT 1m SMA cross (fast/slow)
- Execution: next-candle open
- Instruments: fixed strikes for the day (picked from early-session FUT price)

```bash
npm run backtest:options:today -- --fast 9 --slow 21 --lots 1 --fee 20
```

### News integration (free)

The live suggestion engine derives `news.level` from:
- GDELT (headline volume for macro/geopolitical keywords)
- Official feeds (RSS/Atom)

To quickly verify news fetching without any Kite session:

```bash
npm run news:check -- --timespan 2h --max 30
```

### UI (continuous, live-updating)

This starts a local web UI that continuously shows strike-level NIFTY options analytics (options-only mode), the take/no-take decision, and a NIFTY50 buy/sell contribution heatmap.

```bash
npm run ui:suggest -- --port 3000 --historyDays 7 --intervalMs 2000
```

If you want the raw JSON stream (options-only) without the UI:

```bash
npm run stream:suggest -- --optionsOnly --historyDays 7 --intervalMs 2000
```

### Telegram alerts (signals)

You can send the engine’s actionable signals (BUY / CREDIT_SPREAD) to Telegram.

1) Create a bot with BotFather and get `TELEGRAM_BOT_TOKEN`.

2) Get your `TELEGRAM_CHAT_ID`:
- For a private chat: start the bot, then use a helper like `@userinfobot` to get your numeric chat id.
- For a channel/group: add the bot, send a message, and use a Telegram “getUpdates” helper to find the chat id (or use the `@channelusername` form for public channels).

3) Add to `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456:ABCDEF...
# Single recipient:
TELEGRAM_CHAT_ID=123456789
# Multiple recipients (comma-separated), for example you + your friend:
# TELEGRAM_CHAT_IDS=123456789,987654321
# Optional (default 15000): minimum gap between alerts
TELEGRAM_MIN_INTERVAL_MS=15000
```

4) Enable alerts with `--telegram`:

```bash
npm run ui:suggest -- --telegram --port 3000 --historyDays 7 --intervalMs 2000
```

Choose which timeframe drives the trade decision (and Telegram alerts):
- `--tradeTf 1m` (default)
- `--tradeTf 5m`
- `--tradeTf 15m`
- `--tradeTf best` (picks the strongest of 1m/5m/15m)

Example (trade signals driven by the strongest timeframe):

```bash
npm run ui:suggest -- --telegram --tradeTf best --port 3000 --historyDays 7 --intervalMs 2000
```

Or for JSON only:

```bash
npm run stream:suggest -- --optionsOnly --telegram --historyDays 7 --intervalMs 2000
```

Quick config check (sends a test message):

```bash
npm run telegram:test -- --text "hello from bot"
```

If you get `chat not found`, your chat id is wrong (or you haven’t started the bot). Do this:
- Open the bot in Telegram and press **Start**, then send `hi`.
- Run:

```bash
npm run telegram:chatids
```

It prints the chat IDs the bot can see. Copy those into `TELEGRAM_CHAT_ID` / `TELEGRAM_CHAT_IDS`.

Open:

`http://127.0.0.1:3000`

Notes / limitations:
- Kite gives **snapshots** like total buy quantity / sell quantity and top 5 depth levels. It does **not** expose "each individual order" for you to reconstruct the full order book.
- Kite historical candles are OHLCV (+ optional OI for futures). Historical APIs do **not** provide historical market depth or historical buy/sell orderbook totals.

UI note:
- The UI is intentionally compact (no Raw JSON panel). Use `stream:suggest` if you want the full JSON output.
