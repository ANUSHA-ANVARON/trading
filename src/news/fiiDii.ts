/**
 * FII / DII institutional flow data from NSE India.
 *
 * NSE publishes the previous day's FII and DII cash market buy/sell data
 * on their website, usually by 6 PM IST. This gives a daily institutional
 * bias that persists into the next morning.
 *
 * NSE requires browser-like headers + a session cookie obtained by first
 * hitting the homepage. We handle that here automatically.
 *
 * Bias thresholds:
 *   FII net > +₹500cr → BULLISH
 *   FII net < -₹500cr → BEARISH
 *   DII tends to be counter-cyclical (buys when FII sells), so we weight FII 2× DII.
 */

export type FiiDiiEntry = {
  date:  string;
  fii:   { buy: number; sell: number; net: number };
  dii:   { buy: number; sell: number; net: number };
};

export type FiiDiiSnapshot = {
  latest:         FiiDiiEntry | null;
  fiiSignal:      "BULLISH" | "BEARISH" | "NEUTRAL";
  diiSignal:      "BULLISH" | "BEARISH" | "NEUTRAL";
  combinedSignal: "BULLISH" | "BEARISH" | "NEUTRAL";
  fetchedAt:      string;
};

const FII_DII_URL  = "https://www.nseindia.com/api/fiidiiTradeReact";
const NSE_HOME_URL = "https://www.nseindia.com";
const THRESHOLD_CR = 500; // ₹500 crore net = signal

async function getNseCookie(): Promise<string> {
  const res = await fetch(NSE_HOME_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(10_000),
  });
  // Collect Set-Cookie headers
  const cookies: string[] = [];
  res.headers.forEach((val, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const name = val.split(";")[0];
      if (name) cookies.push(name.trim());
    }
  });
  return cookies.join("; ");
}

async function fetchNseJson(cookie: string): Promise<any> {
  const res = await fetch(FII_DII_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      Referer: NSE_HOME_URL,
      Cookie: cookie,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`NSE FII/DII HTTP ${res.status}`);
  return res.json();
}

function parseRow(row: any): FiiDiiEntry | null {
  try {
    const date = String(row.date ?? row.tradeDate ?? "").slice(0, 10);
    const fiiB = Number(row.fiiBuy   ?? row.fii_buy   ?? 0);
    const fiiS = Number(row.fiiSell  ?? row.fii_sell  ?? 0);
    const diiB = Number(row.diiBuy   ?? row.dii_buy   ?? 0);
    const diiS = Number(row.diiSell  ?? row.dii_sell  ?? 0);
    if (!date || (!fiiB && !fiiS)) return null;
    return {
      date,
      fii: { buy: fiiB, sell: fiiS, net: +(fiiB - fiiS).toFixed(2) },
      dii: { buy: diiB, sell: diiS, net: +(diiB - diiS).toFixed(2) },
    };
  } catch {
    return null;
  }
}

function netSignal(net: number): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (net >  THRESHOLD_CR) return "BULLISH";
  if (net < -THRESHOLD_CR) return "BEARISH";
  return "NEUTRAL";
}

export async function fetchFiiDii(): Promise<FiiDiiSnapshot> {
  const fallback: FiiDiiSnapshot = {
    latest: null,
    fiiSignal: "NEUTRAL",
    diiSignal: "NEUTRAL",
    combinedSignal: "NEUTRAL",
    fetchedAt: new Date().toISOString(),
  };

  try {
    const cookie = await getNseCookie();
    // Small delay to avoid being flagged as bot
    await new Promise((r) => setTimeout(r, 800));
    const data = await fetchNseJson(cookie);

    // NSE returns an array of rows; most recent first or last
    const rows: any[] = Array.isArray(data) ? data : (data?.data ?? data?.fiidiiData ?? []);
    if (!rows.length) return fallback;

    // Parse all rows and pick the most recent non-null entry
    const entries = rows.map(parseRow).filter((e): e is FiiDiiEntry => e !== null);
    if (!entries.length) return fallback;

    // Sort descending by date, take latest
    entries.sort((a, b) => b.date.localeCompare(a.date));
    const latest = entries[0];

    const fiiSignal = netSignal(latest.fii.net);
    const diiSignal = netSignal(latest.dii.net);

    // Combined: FII dominates (weight 2), DII weight 1
    // FII and DII often go opposite directions; we care more about FII
    let score = 0;
    if (fiiSignal === "BULLISH") score += 2;
    if (fiiSignal === "BEARISH") score -= 2;
    if (diiSignal === "BULLISH") score += 1;
    if (diiSignal === "BEARISH") score -= 1;

    const combinedSignal: "BULLISH" | "BEARISH" | "NEUTRAL" =
      score >= 2 ? "BULLISH" : score <= -2 ? "BEARISH" : "NEUTRAL";

    return { latest, fiiSignal, diiSignal, combinedSignal, fetchedAt: new Date().toISOString() };
  } catch {
    return fallback;
  }
}
