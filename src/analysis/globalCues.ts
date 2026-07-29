/**
 * Global market cues — fetched once at startup, refreshed every 4 hours.
 *
 * Sources (all free, no auth):
 *   Yahoo Finance v8 chart API for S&P 500, Dow, Crude Oil, USD/INR
 *
 * Bias logic:
 *   S&P500 counts double (highest NIFTY correlation).
 *   Crude and USD/INR are INVERTED — rising crude / rising USD are bearish for NIFTY
 *   (India is an oil importer; strong USD triggers FII outflows).
 *   biasScore range: -5 to +5.
 *   STRONG = |biasScore| >= 3 → used as a hard morning gate.
 *   MODERATE = |biasScore| == 2 → confidence adjustment only.
 */

type YahooResult = {
  price:     number | null;
  prevClose: number | null;
  change:    number | null;
  changePct: number | null;
};

async function fetchYahoo(symbol: string): Promise<YahooResult> {
  const empty: YahooResult = { price: null, prevClose: null, change: null, changePct: null };
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return empty;
    const price     = meta.regularMarketPrice ?? meta.previousClose ?? null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change    = price != null && prevClose != null ? price - prevClose : null;
    const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
    return {
      price:     price     != null ? +Number(price).toFixed(2)     : null,
      prevClose: prevClose != null ? +Number(prevClose).toFixed(2) : null,
      change:    change    != null ? +Number(change).toFixed(2)    : null,
      changePct: changePct != null ? +Number(changePct).toFixed(2) : null,
    };
  } catch {
    return empty;
  }
}

export type GlobalCueItem = {
  name:      string;
  symbol:    string;
  price:     number | null;
  change:    number | null;
  changePct: number | null;
  signal:    "BULLISH" | "BEARISH" | "NEUTRAL";
};

export type GlobalCuesSnapshot = {
  sp500:       GlobalCueItem;
  dow:         GlobalCueItem;
  crude:       GlobalCueItem;
  usdInr:      GlobalCueItem;
  biasScore:   number;   // -5 to +5
  bias:        "BULLISH" | "BEARISH" | "NEUTRAL";
  biasStrong:  boolean;  // |score| >= 3 → hard morning gate
  fetchedAt:   string;
};

function toSignal(symbol: string, pct: number | null): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (pct == null) return "NEUTRAL";
  const THRESHOLD = 0.5; // 0.5% move counts as a signal
  const up = pct > THRESHOLD;
  const dn = pct < -THRESHOLD;
  // Crude oil and USD/INR are INVERTED for NIFTY
  if (symbol === "CL=F" || symbol === "USDINR=X") {
    return dn ? "BULLISH" : up ? "BEARISH" : "NEUTRAL";
  }
  return up ? "BULLISH" : dn ? "BEARISH" : "NEUTRAL";
}

export async function fetchGlobalCues(): Promise<GlobalCuesSnapshot> {
  const [sp500R, dowR, crudeR, usdInrR] = await Promise.allSettled([
    fetchYahoo("^GSPC"),
    fetchYahoo("^DJI"),
    fetchYahoo("CL=F"),
    fetchYahoo("USDINR=X"),
  ]);

  const get = (r: PromiseSettledResult<YahooResult>): YahooResult =>
    r.status === "fulfilled" ? r.value : { price: null, prevClose: null, change: null, changePct: null };

  const makeItem = (name: string, sym: string, r: YahooResult): GlobalCueItem => ({
    name, symbol: sym,
    price: r.price, change: r.change, changePct: r.changePct,
    signal: toSignal(sym, r.changePct),
  });

  const sp500  = makeItem("S&P 500",   "^GSPC",     get(sp500R));
  const dow    = makeItem("Dow Jones", "^DJI",      get(dowR));
  const crude  = makeItem("Crude Oil", "CL=F",      get(crudeR));
  const usdInr = makeItem("USD/INR",   "USDINR=X",  get(usdInrR));

  // S&P500 counts double — highest NIFTY correlation
  let biasScore = 0;
  for (const item of [sp500, dow, crude, usdInr]) {
    if (item.signal === "BULLISH") biasScore++;
    if (item.signal === "BEARISH") biasScore--;
  }
  if (sp500.signal === "BULLISH") biasScore++;
  if (sp500.signal === "BEARISH") biasScore--;

  const bias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    biasScore >= 2 ? "BULLISH" : biasScore <= -2 ? "BEARISH" : "NEUTRAL";

  return { sp500, dow, crude, usdInr, biasScore, bias, biasStrong: Math.abs(biasScore) >= 3, fetchedAt: new Date().toISOString() };
}
