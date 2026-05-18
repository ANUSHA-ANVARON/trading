import { getArgValue, usageAndExit } from "./_args";
import { PaperBroker } from "../paper/paperBroker";
import { createSmaCrossStrategy } from "../strategies/smaCross";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const tradingsymbol = getArgValue("--tradingsymbol");
  if (!tradingsymbol) {
    usageAndExit("Usage: npm run paper:run -- --tradingsymbol <NFO_SYMBOL> [--pollMs 2000]");
  }

  const exchange = getArgValue("--exchange") ?? "NFO";
  const pollMs = Number(getArgValue("--pollMs") ?? getArgValue("--poll-ms") ?? "2000");

  const cash = Number(getArgValue("--cash") ?? "200000");
  const lotSize = Number(getArgValue("--lot") ?? "50");
  const slippageBps = Number(getArgValue("--slippage_bps") ?? getArgValue("--slippage-bps") ?? "2");
  const fee = Number(getArgValue("--fee") ?? "20");

  const fast = Number(getArgValue("--fast") ?? "9");
  const slow = Number(getArgValue("--slow") ?? "21");
  const lots = Number(getArgValue("--lots") ?? "1");

  const broker = new PaperBroker({ exchange, tradingsymbol }, cash, { slippageBps, brokeragePerOrder: fee });
  const strategy = createSmaCrossStrategy({ fast, slow, lots });

  // Minimal loop: polls LTP and treats it like a candle close.
  // For proper live trading, you’d build real 1m/5m candles from ticks.
  const state: any = {};

  // eslint-disable-next-line no-console
  console.log({ mode: "paper", strategy: strategy.name, exchange, tradingsymbol, pollMs });

  while (true) {
    const ltp = await broker.ltp();
    const candle = {
      time: new Date().toISOString(),
      open: ltp,
      high: ltp,
      low: ltp,
      close: ltp,
    };

    const signal = strategy.onCandle(candle, state, { market: { exchange, tradingsymbol }, lotSize });
    if (signal) {
      const { fillPrice } = await broker.marketOrder(signal.side, signal.quantity);
      // eslint-disable-next-line no-console
      console.log({ time: candle.time, signal, fillPrice, state: broker.getState() });
    } else {
      // eslint-disable-next-line no-console
      console.log({ time: candle.time, ltp, state: broker.getState() });
    }

    await sleep(pollMs);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
