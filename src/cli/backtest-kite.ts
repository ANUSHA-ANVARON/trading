import { getArgValue, usageAndExit } from "./_args";
import { createSmaCrossStrategy } from "../strategies/smaCross";
import { runBacktest, summarizeBacktest } from "../backtest/engine";
import { getInstruments } from "../instruments/instrumentsCache";
import { loadKiteCandles } from "../backtest/loadKiteCandles";
import { istYesterday, niftySessionRangeForIstDay } from "../time/ist";
import { pickNearExpiryNiftyFutureKey } from "../analysis/defaults";

function formatIstYmd(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

async function main() {
  const key = getArgValue("--instrument") ?? getArgValue("--key");
  if (!key) {
    usageAndExit(
      "Usage: npm run backtest:kite -- --instrument NFO:<SYMBOL> [--interval minute|5minute|15minute] [--day yesterday|YYYY-MM-DD]",
    );
  }

  const interval = (getArgValue("--interval") ?? "5minute") as any;
  const day = getArgValue("--day") ?? "yesterday";

  const initialCash = Number(getArgValue("--cash") ?? "200000");
  const lotSize = Number(getArgValue("--lot") ?? "50");
  const brokeragePerOrder = Number(getArgValue("--fee") ?? "20");
  const slippageBps = Number(getArgValue("--slippage_bps") ?? getArgValue("--slippage-bps") ?? "2");

  const fast = Number(getArgValue("--fast") ?? "9");
  const slow = Number(getArgValue("--slow") ?? "21");
  const lots = Number(getArgValue("--lots") ?? "1");

  let [exchange, tradingsymbol] = key.split(":");
  if (!exchange || !tradingsymbol) usageAndExit("Instrument key must look like EXCHANGE:SYMBOL");

  // Convenience: allow passing --instrument NFO:NIFTY to auto-pick near-expiry NIFTY FUT.
  if (exchange.toUpperCase() === "NFO" && tradingsymbol.toUpperCase() === "NIFTY") {
    const picked = await pickNearExpiryNiftyFutureKey("NIFTY");
    ;[exchange, tradingsymbol] = picked.split(":");
  }

  const ex = exchange.toUpperCase();
  const instruments = await getInstruments(ex === "NFO" ? "NFO" : "NSE");
  const inst = instruments.find((i) => (i.exchange ?? "").toUpperCase() === ex && i.tradingsymbol === tradingsymbol);
  if (!inst?.instrument_token) {
    if (ex === "NFO") {
      const futs = instruments
        .filter((i) => (i.exchange ?? "").toUpperCase() === "NFO")
        .filter((i) => (i.instrument_type ?? "").toUpperCase() === "FUT")
        .filter((i) => (i.name ?? "").toUpperCase().includes("NIFTY"))
        .slice(0, 15)
        .map((i) => i.tradingsymbol);

      throw new Error(
        `Could not resolve instrument_token for ${key}. This symbol is likely not live in the current instrument master. Try one of: ${futs.join(", ")}. Tip: you can also use --instrument NFO:NIFTY to auto-pick near-expiry FUT.`,
      );
    }

    throw new Error("Could not resolve instrument_token. Sync instruments first.");
  }

  let dayDate: Date;
  if (day.toLowerCase() === "yesterday") {
    dayDate = istYesterday();
  } else {
    // Interpreted as IST date.
    dayDate = new Date(`${day}T00:00:00+05:30`);
  }

  let usedDayDate = dayDate;
  let { from, to } = niftySessionRangeForIstDay(usedDayDate);

  let candles = await loadKiteCandles({ instrumentToken: inst.instrument_token as any, from, to, interval });

  // If yesterday was a holiday/non-trading day, Kite returns 0 candles.
  // For the convenience preset `--day yesterday`, fall back to the most recent prior trading day.
  if (day.toLowerCase() === "yesterday" && candles.length < 20) {
    for (let back = 1; back <= 7; back++) {
      const candidate = new Date(dayDate.getTime() - back * 24 * 60 * 60_000);
      const range = niftySessionRangeForIstDay(candidate);
      const c = await loadKiteCandles({ instrumentToken: inst.instrument_token as any, from: range.from, to: range.to, interval });
      if (c.length >= 20) {
        usedDayDate = candidate;
        from = range.from;
        to = range.to;
        candles = c;
        // eslint-disable-next-line no-console
        console.error(`No candles for yesterday; using last trading day: ${formatIstYmd(usedDayDate)}.`);
        break;
      }
    }
  }

  if (candles.length < 20) {
    throw new Error(
      `Not enough candles returned (${candles.length}). Try a different --day, or ensure the instrument traded during that session.`,
    );
  }

  const strategy = createSmaCrossStrategy({ fast, slow, lots });
  const result = runBacktest(candles, strategy, {
    initialCash,
    market: { exchange: ex, tradingsymbol },
    lotSize,
    brokeragePerOrder,
    slippageBps,
    accounting: "futures",
  });

  const summary = summarizeBacktest(result);
  // eslint-disable-next-line no-console
  console.table({
    instrument: `${ex}:${tradingsymbol}`,
    day: day.toLowerCase() === "yesterday" ? `yesterday (used ${formatIstYmd(usedDayDate)})` : day,
    interval,
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
