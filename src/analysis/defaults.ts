import { getInstruments } from "../instruments/instrumentsCache";

function expiryToYmd(expiry: unknown): string | null {
  if (!expiry) return null;
  if (typeof expiry === "string") return expiry.slice(0, 10);
  if (expiry instanceof Date) return expiry.toISOString().slice(0, 10);
  return null;
}

function istTodayYmd(): string {
  // YYYY-MM-DD in Asia/Kolkata
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return new Date().toISOString().slice(0, 10);
  return `${y}-${m}-${d}`;
}

function isLastThursday(ymd: string): boolean {
  const [yStr, mStr, dStr] = ymd.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;

  // JS month: 0-11. Use UTC to avoid TZ drift.
  const monthIndex = m - 1;
  const date = new Date(Date.UTC(y, monthIndex, d));
  const day = date.getUTCDay(); // 0 Sun .. 4 Thu
  if (day !== 4) return false;

  // last day of month
  const lastDay = new Date(Date.UTC(y, monthIndex + 1, 0));
  const lastDayDow = lastDay.getUTCDay();
  // distance back to Thursday (4)
  const diff = (lastDayDow - 4 + 7) % 7;
  const lastThu = new Date(Date.UTC(y, monthIndex + 1, 0 - diff));

  return lastThu.getUTCDate() === d;
}

export async function pickNearExpiryNiftyFutureKey(underlying = "NIFTY"): Promise<string> {
  const today = istTodayYmd();
  const instruments = await getInstruments("NFO");

  const futs = instruments
    .filter((i) => (i.exchange ?? "").toUpperCase() === "NFO")
    .filter((i) => (i.name ?? "").toUpperCase() === underlying.toUpperCase())
    .filter((i) => (i.instrument_type ?? "").toUpperCase() === "FUT")
    .map((i) => ({ sym: i.tradingsymbol, exp: expiryToYmd(i.expiry) }))
    .filter((x) => !!x.sym && !!x.exp && x.exp! >= today)
    .sort((a, b) => a.exp!.localeCompare(b.exp!));

  const chosen = futs[0];
  if (!chosen?.sym) {
    throw new Error("Could not auto-pick near-expiry NIFTY future. Try passing --fut explicitly.");
  }

  return `NFO:${chosen.sym}`;
}

export async function pickNearestWeeklyNiftyOptionExpiry(underlying = "NIFTY"): Promise<string> {
  const today = istTodayYmd();

  // On expiry day past 14:30 IST, skip today — options near worthless.
  const nowIst = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const [hStr, minStr] = nowIst.split(":");
  const minutesIntoDay = Number(hStr) * 60 + Number(minStr);
  const cutoff = minutesIntoDay >= 14 * 60 + 30; // 14:30 IST
  const minExp = cutoff ? (() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })() : today;

  const instruments = await getInstruments("NFO");

  const expiries = new Set<string>();
  for (const i of instruments) {
    if ((i.exchange ?? "").toUpperCase() !== "NFO") continue;
    if ((i.name ?? "").toUpperCase() !== underlying.toUpperCase()) continue;
    const t = (i.instrument_type ?? "").toUpperCase();
    if (t !== "CE" && t !== "PE") continue;
    const exp = expiryToYmd(i.expiry);
    if (!exp || exp < minExp) continue;
    expiries.add(exp);
  }

  const sorted = [...expiries].sort((a, b) => a.localeCompare(b));

  // Prefer a non-monthly expiry (not last Thursday) as "weekly".
  const weekly = sorted.find((e) => !isLastThursday(e));
  if (weekly) return weekly;

  // Fallback: only monthly in cache — likely stale instruments. Take nearest.
  if (sorted[0]) return sorted[0];

  throw new Error(
    "Could not auto-pick nearest weekly expiry. " +
    "Run: npm run instruments:sync:nfo — then retry. Or pass --expiry YYYY-MM-DD explicitly.",
  );
}
