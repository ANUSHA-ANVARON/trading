import path from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { getArgValue } from "./_args";

type SuggestionOut = {
  asof: string;
  suggestion?: { timeframe?: string; recommendation?: "LONG" | "SHORT" | "NO_TRADE"; confidence?: number };
  options?: {
    expiry: string;
    atmStrike: number;
    atm?: { ce: { instrument: string; premium: number | null }; pe: { instrument: string; premium: number | null } };
    creditSpreads?: { put: any | null; call: any | null };
    ivProxy?: { straddle: number | null; impliedMovePct: number | null };
    suggestion:
      | { style: "WAIT" }
      | { style: "BUY"; action: "BUY CALL" | "BUY PUT"; instrument: string; premium: number | null; quantity: number; maxLoss: number | null }
      | { style: "CREDIT_SPREAD"; action: "SELL PUT SPREAD" | "SELL CALL SPREAD"; spread: any };
  };
};

type PaperPosition =
  | {
      style: "BUY";
      openedAt: string;
      action: "BUY CALL" | "BUY PUT";
      instrument: string;
      qty: number;
      entryPremium: number;
      entryFees: number;
      lastPremium: number | null;
    }
  | {
      style: "CREDIT_SPREAD";
      openedAt: string;
      action: "SELL PUT SPREAD" | "SELL CALL SPREAD";
      width: number;
      entryCredit: number;
      legs: {
        sell: { instrument: string; strike: number; qty: number; entry: number; last: number | null };
        buy: { instrument: string; strike: number; qty: number; entry: number; last: number | null };
      };
      entryFees: number;
    };

type TradeRecord = {
  openedAt: string;
  closedAt: string;
  style: PaperPosition["style"];
  action: string;
  pnl: number;
  fees: number;
  meta?: any;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function applySlippage(price: number, side: "BUY" | "SELL", bps: number): number {
  const m = bps / 10_000;
  return side === "BUY" ? price * (1 + m) : price * (1 - m);
}

function startSuggestProcess(args: string[]): ChildProcessWithoutNullStreams {
  const nodeBin = process.execPath;
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.join(process.cwd(), "src", "cli", "stream-suggest.ts");

  return spawn(nodeBin, [tsxCli, script, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

async function main() {
  // Paper params
  const slippageBps = Number(getArgValue("--slippageBps") ?? getArgValue("--slippage-bps") ?? "2");
  const feePerOrder = Number(getArgValue("--fee") ?? "20");
  const stopLossPctBuy = Number(getArgValue("--stopLossPctBuy") ?? getArgValue("--stop-loss-pct-buy") ?? "0.35");
  const takeProfitPctBuy = Number(getArgValue("--takeProfitPctBuy") ?? getArgValue("--take-profit-pct-buy") ?? "0.6");
  const stopLossPctSpread = Number(getArgValue("--stopLossPctSpread") ?? getArgValue("--stop-loss-pct-spread") ?? "0.5");
  const takeProfitPctSpread = Number(getArgValue("--takeProfitPctSpread") ?? getArgValue("--take-profit-pct-spread") ?? "0.5");
  const maxHoldMin = Number(getArgValue("--maxHoldMin") ?? getArgValue("--max-hold-min") ?? "45");

  const suggestArgs: string[] = [];
  const passthrough = [
    "--weights",
    "--mode",
    "--intervalMs",
    "--interval-ms",
    "--historyDays",
    "--history-days",
    "--fast",
    "--slow",
    "--underlying",
    "--expiry",
    "--optStep",
    "--opt-step",
    "--creditDistance",
    "--credit-distance",
    "--creditWidth",
    "--credit-width",
    "--newsMode",
    "--news-mode",
    "--newsTimespan",
    "--news-timespan",
    "--newsTtlMs",
    "--news-ttl-ms",
    "--lot",
    "--lots",
  ];

  for (const k of passthrough) {
    const v = getArgValue(k);
    if (v !== null) suggestArgs.push(k, v);
  }

  // Ensure we stream continuously (no --once)
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "paper_boot",
      paper: {
        slippageBps,
        feePerOrder,
        stopLossPctBuy,
        takeProfitPctBuy,
        stopLossPctSpread,
        takeProfitPctSpread,
        maxHoldMin,
      },
      engineArgs: suggestArgs,
    }),
  );

  const child = startSuggestProcess(suggestArgs);
  try {
    child.stdin.end();
  } catch {}

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    // eslint-disable-next-line no-console
    console.error(chunk.toString().trim());
  });

  child.stdout.setEncoding("utf8");
  let buffer = "";

  let pos: PaperPosition | null = null;
  const trades: TradeRecord[] = [];

  function positionAgeMin(openedAt: string): number {
    const ageMs = Date.now() - new Date(openedAt).getTime();
    return ageMs / 60_000;
  }

  function mtmPnl(position: PaperPosition): { pnl: number; fees: number; details: any } {
    if (position.style === "BUY") {
      const last = position.lastPremium;
      const pnl = last === null ? 0 : (last - position.entryPremium) * position.qty;
      return { pnl, fees: position.entryFees, details: { lastPremium: last } };
    }

    const sellLast = position.legs.sell.last;
    const buyLast = position.legs.buy.last;
    if (sellLast === null || buyLast === null) return { pnl: 0, fees: position.entryFees, details: { sellLast, buyLast } };

    const entryCredit = position.entryCredit;
    const currentCredit = sellLast - buyLast;
    const pnl = (entryCredit - currentCredit) * position.legs.sell.qty;
    return { pnl, fees: position.entryFees, details: { entryCredit, currentCredit, sellLast, buyLast } };
  }

  function closePnl(position: PaperPosition): { pnl: number; details: any } {
    if (position.style === "BUY") {
      if (position.lastPremium === null) return { pnl: 0, details: { lastPremium: null } };
      const exit = applySlippage(position.lastPremium, "SELL", slippageBps);
      return { pnl: (exit - position.entryPremium) * position.qty, details: { exitPremium: exit } };
    }

    if (position.legs.sell.last === null || position.legs.buy.last === null) {
      return { pnl: 0, details: { sellLast: position.legs.sell.last, buyLast: position.legs.buy.last } };
    }

    const sellExit = applySlippage(position.legs.sell.last, "BUY", slippageBps);
    const buyExit = applySlippage(position.legs.buy.last, "SELL", slippageBps);
    const currentCredit = sellExit - buyExit;
    const pnl = (position.entryCredit - currentCredit) * position.legs.sell.qty;
    return { pnl, details: { sellExit, buyExit, currentCredit } };
  }

  function closePosition(reason: string, asof: string) {
    const p = pos;
    if (!p) return;

    const { fees } = mtmPnl(p);
    const closed = closePnl(p);
    const gross = closed.pnl;

    // Add exit fees (approx):
    const exitFees = p.style === "BUY" ? feePerOrder : feePerOrder * 2;
    const totalFees = fees + exitFees;
    const net = gross - totalFees;

    trades.push({
      openedAt: p.openedAt,
      closedAt: asof,
      style: p.style,
      action: p.action,
      pnl: Number(net.toFixed(2)),
      fees: Number(totalFees.toFixed(2)),
      meta: { reason, details: closed.details },
    });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "paper_exit",
        asof,
        reason,
        position: p,
        result: { pnl: Number(net.toFixed(2)), fees: Number(totalFees.toFixed(2)) },
        trades: trades.length,
      }),
    );

    pos = null;
  }

  function maybeEnter(out: SuggestionOut) {
    const sug = out.options?.suggestion;
    if (!sug || sug.style === "WAIT") return;
    if (pos) return;

    if (sug.style === "BUY") {
      if (!sug.instrument || sug.premium === null || !Number.isFinite(sug.premium) || sug.quantity <= 0) return;

      const entry = applySlippage(sug.premium, "BUY", slippageBps);
      const fees = feePerOrder; // 1 leg entry

      pos = {
        style: "BUY",
        openedAt: out.asof,
        action: sug.action,
        instrument: sug.instrument,
        qty: sug.quantity,
        entryPremium: entry,
        entryFees: fees,
        lastPremium: sug.premium,
      };

      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ event: "paper_entry", asof: out.asof, position: pos }));
      return;
    }

    // CREDIT_SPREAD
    const sp = sug.spread;
    const sell = sp?.legs?.sell;
    const buy = sp?.legs?.buy;
    if (!sell?.instrument || !buy?.instrument) return;
    if (sell?.premium === null || buy?.premium === null) return;

    const sellEntry = applySlippage(Number(sell.premium), "SELL", slippageBps);
    const buyEntry = applySlippage(Number(buy.premium), "BUY", slippageBps);

    const qty = Number(sell.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return;

    const fees = feePerOrder * 2; // 2 legs entry

    const width = Number(sp?.width);
    if (!Number.isFinite(width) || width <= 0) return;

    const entryCredit = sellEntry - buyEntry;

    pos = {
      style: "CREDIT_SPREAD",
      openedAt: out.asof,
      action: sug.action,
      width,
      entryCredit,
      legs: {
        sell: { instrument: String(sell.instrument), strike: Number(sell.strike), qty, entry: sellEntry, last: Number(sell.premium) },
        buy: { instrument: String(buy.instrument), strike: Number(buy.strike), qty, entry: buyEntry, last: Number(buy.premium) },
      },
      entryFees: fees,
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "paper_entry", asof: out.asof, position: pos }));
  }

  function updatePositionWithTick(out: SuggestionOut) {
    const p = pos;
    if (!p) return;

    const options = out.options;
    if (!options) return;

    if (p.style === "BUY") {
      const ce = options.atm?.ce;
      const pe = options.atm?.pe;
      if (ce?.instrument === p.instrument && ce.premium !== null) p.lastPremium = Number(ce.premium);
      if (pe?.instrument === p.instrument && pe.premium !== null) p.lastPremium = Number(pe.premium);
      return;
    }

    const updFromSpread = (sp: any) => {
      const sellLeg = sp?.legs?.sell;
      const buyLeg = sp?.legs?.buy;
      if (sellLeg?.instrument === p.legs.sell.instrument && sellLeg?.premium !== null) p.legs.sell.last = Number(sellLeg.premium);
      if (buyLeg?.instrument === p.legs.buy.instrument && buyLeg?.premium !== null) p.legs.buy.last = Number(buyLeg.premium);
    };

    updFromSpread(options.suggestion?.style === "CREDIT_SPREAD" ? (options.suggestion as any).spread : null);
    updFromSpread(options.creditSpreads?.put);
    updFromSpread(options.creditSpreads?.call);
  }

  function checkExits(out: SuggestionOut) {
    if (!pos) return;

    // Time-based exit
    if (positionAgeMin(pos.openedAt) >= maxHoldMin) {
      closePosition("max_hold", out.asof);
      return;
    }

    // Signal flip / no-trade exit
    const rec = out.suggestion?.recommendation ?? "NO_TRADE";
    if (rec === "NO_TRADE") {
      closePosition("no_trade", out.asof);
      return;
    }

    // If direction flips (LONG vs SHORT), exit.
    if (pos.style === "BUY") {
      const wantLong = pos.action === "BUY CALL";
      if ((wantLong && rec === "SHORT") || (!wantLong && rec === "LONG")) {
        closePosition("signal_flip", out.asof);
        return;
      }
    } else {
      const wantLong = pos.action === "SELL PUT SPREAD";
      if ((wantLong && rec === "SHORT") || (!wantLong && rec === "LONG")) {
        closePosition("signal_flip", out.asof);
        return;
      }
    }

    // Risk exits
    const { pnl } = mtmPnl(pos);

    if (pos.style === "BUY") {
      const maxLoss = pos.entryPremium * pos.qty;
      const stop = -Math.abs(maxLoss) * clamp(stopLossPctBuy, 0.05, 1);
      const take = Math.abs(maxLoss) * clamp(takeProfitPctBuy, 0.05, 3);
      if (pnl <= stop) closePosition("stop_loss", out.asof);
      else if (pnl >= take) closePosition("take_profit", out.asof);
      return;
    }

    // Spread: stop/take based on max profit/loss estimates from entry credit.
    const maxProfit = pos.entryCredit * pos.legs.sell.qty;
    const maxLoss = Math.max(0, (pos.width - pos.entryCredit)) * pos.legs.sell.qty;

    const stop = -Math.abs(maxLoss) * clamp(stopLossPctSpread, 0.05, 1);
    const take = Math.abs(maxProfit) * clamp(takeProfitPctSpread, 0.05, 1);
    if (pnl <= stop) closePosition("stop_loss", out.asof);
    else if (pnl >= take) closePosition("take_profit", out.asof);
  }

  function emitStatus(out: SuggestionOut) {
    const summary = {
      event: "paper_status",
      asof: out.asof,
      rec: out.suggestion?.recommendation ?? "-",
      optStyle: out.options?.suggestion?.style ?? "-",
      optAction: (out.options?.suggestion as any)?.action ?? "-",
      news: (out as any).news?.level ?? "-",
      position: pos,
      mtm: pos ? mtmPnl(pos) : null,
      trades: trades.length,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary));
  }

  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx < 0) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line || !line.startsWith("{")) continue;

      let obj: SuggestionOut;
      try {
        obj = JSON.parse(line) as SuggestionOut;
      } catch {
        continue;
      }

      // Update prices for current position
      updatePositionWithTick(obj);

      // Exit checks
      checkExits(obj);

      // Enter if flat
      maybeEnter(obj);

      // Status
      emitStatus(obj);
    }
  });

  child.on("exit", async (code) => {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "paper_engine_exit", code }));
    // give it a moment then exit
    await sleep(250);
    process.exit(code ?? 1);
  });

  // keep process alive
  while (true) {
    await sleep(10_000);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
