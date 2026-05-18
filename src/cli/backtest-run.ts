import { getArgValue, usageAndExit } from "./_args";
import { loadCsvCandles } from "../backtest/loadCsvCandles";
import { runBacktest, summarizeBacktest } from "../backtest/engine";
import { createSmaCrossStrategy } from "../strategies/smaCross";

async function main() {
  const csv = getArgValue("--csv");
  if (!csv) usageAndExit("Usage: npm run backtest:run -- --csv <PATH_TO_CSV> [--skipHeader]");

  const skipHeader = process.argv.includes("--skipHeader") || process.argv.includes("--skip-header");

  const initialCash = Number(getArgValue("--cash") ?? "200000");
  const lotSize = Number(getArgValue("--lot") ?? "50");
  const brokeragePerOrder = Number(getArgValue("--fee") ?? "20");
  const slippageBps = Number(getArgValue("--slippage_bps") ?? getArgValue("--slippage-bps") ?? "2");

  const fast = Number(getArgValue("--fast") ?? "9");
  const slow = Number(getArgValue("--slow") ?? "21");
  const lots = Number(getArgValue("--lots") ?? "1");

  // Default layout: time,open,high,low,close,volume
  const candles = await loadCsvCandles(
    csv,
    { time: "0", open: "1", high: "2", low: "3", close: "4", volume: "5" },
    { skipHeader },
  );

  const strategy = createSmaCrossStrategy({ fast, slow, lots });

  const result = runBacktest(candles, strategy, {
    initialCash,
    market: { exchange: "NFO", tradingsymbol: getArgValue("--symbol") ?? "CSV" },
    lotSize,
    brokeragePerOrder,
    slippageBps,
  });

  const summary = summarizeBacktest(result);

  // eslint-disable-next-line no-console
  console.table({
    strategy: result.strategyName,
    candles: candles.length,
    trades: summary.trades,
    netPnl: summary.netPnl,
    returnPct: summary.returnPct,
    maxDrawdownPct: summary.maxDrawdown,
    finalEquity: result.final.equity,
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
