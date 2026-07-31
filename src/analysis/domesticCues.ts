/**
 * Domestic index cues — BANKNIFTY and SENSEX % change from Yahoo Finance.
 * Used as an intraday alignment signal alongside global cues.
 *
 * If BANKNIFTY and SENSEX are moving with NIFTY → stronger conviction.
 * If they diverge → confidence penalty (NIFTY move may be isolated/noise).
 *
 * Refreshed every 30 minutes during market hours.
 */

export type DomesticCueItem = {
  name:      string;
  symbol:    string;
  price:     number | null;
  changePct: number | null;
  signal:    "BULLISH" | "BEARISH" | "NEUTRAL";
};

export type DomesticCuesSnapshot = {
  bankNifty:  DomesticCueItem;
  sensex:     DomesticCueItem;
  biasScore:  number;   // -2 to +2
  bias:       "BULLISH" | "BEARISH" | "NEUTRAL";
  fetchedAt:  string;
};

async function fetchYahoo(symbol: string): Promise<{ price: number | null; changePct: number | null }> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { price: null, changePct: null };
    const data = (await res.json()) as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return { price: null, changePct: null };
    const price     = meta.regularMarketPrice ?? meta.previousClose ?? null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const changePct = price != null && prevClose && prevClose !== 0
      ? +((price - prevClose) / prevClose * 100).toFixed(2)
      : null;
    return { price: price != null ? +Number(price).toFixed(2) : null, changePct };
  } catch {
    return { price: null, changePct: null };
  }
}

function toSignal(changePct: number | null): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (changePct == null) return "NEUTRAL";
  if (changePct >  0.4) return "BULLISH";
  if (changePct < -0.4) return "BEARISH";
  return "NEUTRAL";
}

export async function fetchDomesticCues(): Promise<DomesticCuesSnapshot> {
  const [bnR, sxR] = await Promise.allSettled([
    fetchYahoo("^NSEBANK"),
    fetchYahoo("^BSESN"),
  ]);

  const bn = bnR.status === "fulfilled" ? bnR.value : { price: null, changePct: null };
  const sx = sxR.status === "fulfilled" ? sxR.value : { price: null, changePct: null };

  const bankNifty: DomesticCueItem = {
    name: "Bank Nifty", symbol: "^NSEBANK",
    price: bn.price, changePct: bn.changePct,
    signal: toSignal(bn.changePct),
  };
  const sensex: DomesticCueItem = {
    name: "Sensex", symbol: "^BSESN",
    price: sx.price, changePct: sx.changePct,
    signal: toSignal(sx.changePct),
  };

  let biasScore = 0;
  if (bankNifty.signal === "BULLISH") biasScore++;
  if (bankNifty.signal === "BEARISH") biasScore--;
  if (sensex.signal === "BULLISH")    biasScore++;
  if (sensex.signal === "BEARISH")    biasScore--;

  const bias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    biasScore >= 1 ? "BULLISH" : biasScore <= -1 ? "BEARISH" : "NEUTRAL";

  return { bankNifty, sensex, biasScore, bias, fetchedAt: new Date().toISOString() };
}
