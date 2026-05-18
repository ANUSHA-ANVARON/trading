import { createKiteClient } from "./kiteClient";

export type KiteQuote = {
  instrument_token: number;
  last_price: number;
  ohlc?: { open: number; high: number; low: number; close: number };
  volume?: number;
  average_price?: number; // VWAP-like
  buy_quantity?: number;
  sell_quantity?: number;
  oi?: number;
  depth?: {
    buy: Array<{ price: number; quantity: number; orders?: number }>;
    sell: Array<{ price: number; quantity: number; orders?: number }>;
  };
};

export type CandleInterval = "minute" | "3minute" | "5minute" | "15minute";

export type HistoricalCandle = {
  date: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
};

function formatKiteDateIST(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  const hh = parts.find((p) => p.type === "hour")?.value;
  const mm = parts.find((p) => p.type === "minute")?.value;
  const ss = parts.find((p) => p.type === "second")?.value;

  if (!y || !m || !d || !hh || !mm || !ss) {
    // Fallback: ISO, trimmed. Kite expects space separator.
    return date.toISOString().slice(0, 19).replace("T", " ");
  }

  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

export async function getQuote(instruments: string[]): Promise<Record<string, KiteQuote>> {
  const kite = await createKiteClient();
  // kiteconnect: getQuote accepts array of "EXCHANGE:TRADINGSYMBOL"
  const data = await kite.getQuote(instruments);
  return data as Record<string, KiteQuote>;
}

export async function getLtp(instruments: string[]): Promise<Record<string, { instrument_token: number; last_price: number }>> {
  const kite = await createKiteClient();
  const data = await kite.getLTP(instruments);
  return data as Record<string, { instrument_token: number; last_price: number }>;
}

export async function getHistorical(
  instrumentToken: number,
  from: Date,
  to: Date,
  interval: CandleInterval,
  opts?: { continuous?: boolean; oi?: boolean },
): Promise<HistoricalCandle[]> {
  const kite = await createKiteClient();
  const data = await kite.getHistoricalData(
    instrumentToken,
    interval,
    formatKiteDateIST(from),
    formatKiteDateIST(to),
    opts?.continuous ?? false,
    opts?.oi ?? false,
  );
  return data as HistoricalCandle[];
}
