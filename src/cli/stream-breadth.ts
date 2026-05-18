import { getArgValue, usageAndExit } from "./_args";
import { loadWeights } from "../analysis/nifty50Breadth";
import type { WeightRow } from "../analysis/nifty50Breadth";
import { getInstruments } from "../instruments/instrumentsCache";
import { createKiteTicker } from "../kite/ticker";
import { analyzeBreadthFromTicks } from "../analysis/breadthFromTicks";
import { equalWeightsForNifty50 } from "../analysis/weightsFallback";

function serializeErr(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  if (typeof err === "object" && err !== null) {
    try {
      return JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    } catch {
      return { value: String(err) };
    }
  }

  return { value: String(err) };
}

async function main() {
  const weightsPath = getArgValue("--weights");
  const mode = (getArgValue("--mode") ?? "quote") as any; // ltp|quote|full
  const intervalMs = Number(getArgValue("--intervalMs") ?? getArgValue("--interval-ms") ?? "2000");

  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ event: "boot", script: "stream-breadth", mode, intervalMs, weightsPath: weightsPath ?? null }));

  let weights: WeightRow[];
  if (!weightsPath) {
    weights = equalWeightsForNifty50();
  } else {
    try {
      weights = await loadWeights(weightsPath);
    } catch {
      weights = equalWeightsForNifty50();
    }

    if (weights.length < 30) {
      // eslint-disable-next-line no-console
      console.error(`Weights file has only ${weights.length} rows; falling back to equal-weight NIFTY50 universe.`);
      weights = equalWeightsForNifty50();
    }
  }

  function resolveTokens(nse: any[]) {
    const resolved: Array<any> = [];
    const missing: string[] = [];
    for (const w of weights) {
      const [, symbol] = w.key.split(":");
      const inst = nse.find((i) => (i.exchange ?? "").toUpperCase() === "NSE" && i.tradingsymbol === symbol);
      if (!inst?.instrument_token) {
        missing.push(w.key);
        continue;
      }
      resolved.push({ ...w, token: Number(inst.instrument_token) });
    }
    return { resolved, missing };
  }

  let nse = await getInstruments("NSE");
  let { resolved: withTokens, missing } = resolveTokens(nse as any);

  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(
      `Missing ${missing.length} instrument tokens; refreshing NSE instruments cache and retrying. First few: ${missing
        .slice(0, 5)
        .join(", ")}`,
    );
    nse = await getInstruments("NSE", { refresh: true });
    const second = resolveTokens(nse as any);
    withTokens = second.resolved;
    missing = second.missing;
  }

  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(
      `Still missing ${missing.length} symbols after refresh; skipping them. If this is unexpected, run: npm run instruments:sync:nse. First few: ${missing
        .slice(0, 10)
        .join(", ")}`,
    );
  }

  if (withTokens.length < 30) {
    throw new Error(`Resolved only ${withTokens.length} symbols; refusing to stream breadth.`);
  }

  const tokens = withTokens.map((w) => w.token);
  const latest = new Map<number, any>();

  const ticker = await createKiteTicker();

  let connected = false;

  ticker.on("connect", () => {
    connected = true;
    ticker.subscribe(tokens);
    ticker.setMode(ticker.modeMap?.[mode] ?? mode, tokens);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "connect", subscribed: tokens.length, mode }));
  });

  ticker.on("ticks", (ticks: any[]) => {
    for (const t of ticks ?? []) {
      if (t?.instrument_token) latest.set(t.instrument_token, t);
    }
  });

  ticker.on("order_update", (data: any) => {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "order_update", data }));
  });

  ticker.on("error", (err: any) => {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "error", err: serializeErr(err) }));
  });

  ticker.on("close", () => {
    connected = false;
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "close" }));
  });

  ticker.connect();

  const timer = setInterval(() => {
    if (!connected) return;
    const out = analyzeBreadthFromTicks(withTokens as any, latest);
    // JSON only on stdout
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out));
  }, intervalMs);

  process.on("SIGINT", () => {
    clearInterval(timer);
    try {
      ticker.disconnect();
    } catch {}
    process.exit(0);
  });
}

main().catch((err) => {
  const anyErr = err as any;
  const isToken =
    anyErr?.error_type === "TokenException" ||
    /Incorrect `api_key` or `access_token`/i.test(String(anyErr?.message ?? "")) ||
    /TokenException/i.test(String(anyErr?.error_type ?? ""));

  if (isToken) {
    // eslint-disable-next-line no-console
    console.error(
      "Kite access token invalid/expired. Re-generate session and try again:\n" +
        "  1) npm run login:url\n" +
        "  2) npm run session:generate -- --request_token <TOKEN_FROM_REDIRECT>\n",
    );
  }

  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ event: "fatal", err: serializeErr(err) }));
  process.exit(1);
});
