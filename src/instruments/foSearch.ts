import type { KiteInstrument } from "./instrumentsCache";

export type FoType = "FUT" | "CE" | "PE";

export type FoSearchParams = {
  query?: string;
  underlying?: string;
  type?: FoType;
  expiry?: string; // YYYY-MM-DD
  strike?: number;
  limit?: number;
};

function normalize(s: string): string {
  return s.trim().toUpperCase();
}

function toExpiryString(expiry: unknown): string | null {
  if (!expiry) return null;
  if (typeof expiry === "string") {
    // Sometimes comes as ISO; keep date portion
    return expiry.slice(0, 10);
  }
  if (expiry instanceof Date) return expiry.toISOString().slice(0, 10);
  return null;
}

export function searchNfoFo(instruments: KiteInstrument[], params: FoSearchParams): KiteInstrument[] {
  const limit = params.limit ?? 25;

  const query = params.query ? normalize(params.query) : null;
  const underlying = params.underlying ? normalize(params.underlying) : null;
  const type = params.type ? normalize(params.type) : null;
  const expiry = params.expiry ? params.expiry.trim() : null;

  const results = instruments
    .filter((i) => (i.exchange ?? "").toUpperCase() === "NFO")
    .filter((i) => {
      const instrumentType = normalize(i.instrument_type ?? "");
      if (!type) return instrumentType === "FUT" || instrumentType === "CE" || instrumentType === "PE";
      return instrumentType === type;
    })
    .filter((i) => {
      if (!underlying) return true;
      const name = normalize(i.name ?? "");
      const symbol = normalize(i.tradingsymbol ?? "");
      return name === underlying || symbol.includes(underlying);
    })
    .filter((i) => {
      if (!query) return true;
      const symbol = normalize(i.tradingsymbol ?? "");
      const name = normalize(i.name ?? "");
      return symbol.includes(query) || name.includes(query);
    })
    .filter((i) => {
      if (!expiry) return true;
      const exp = toExpiryString(i.expiry);
      return exp === expiry;
    })
    .filter((i) => {
      if (params.strike === undefined || params.strike === null) return true;
      // FUT strike is 0; allow strike filter only for options
      return Number(i.strike) === Number(params.strike);
    })
    .slice(0, limit);

  return results;
}
