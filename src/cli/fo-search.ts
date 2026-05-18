import { getInstruments } from "../instruments/instrumentsCache";
import { searchNfoFo } from "../instruments/foSearch";
import { getArgValue } from "./_args";

async function main() {
  const query = getArgValue("--query");
  const underlying = getArgValue("--underlying");
  const type = (getArgValue("--type") as any) ?? null;
  const expiry = getArgValue("--expiry");
  const strikeRaw = getArgValue("--strike");
  const limitRaw = getArgValue("--limit");

  const strike = strikeRaw ? Number(strikeRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const instruments = await getInstruments("NFO");
  const results = searchNfoFo(instruments, { query: query ?? undefined, underlying: underlying ?? undefined, type: type ?? undefined, expiry: expiry ?? undefined, strike, limit });

  const rows = results.map((i) => {
    const exp = typeof i.expiry === "string" ? i.expiry.slice(0, 10) : i.expiry instanceof Date ? i.expiry.toISOString().slice(0, 10) : "";
    return {
      tradingsymbol: i.tradingsymbol,
      type: i.instrument_type,
      name: i.name,
      expiry: exp,
      strike: i.strike,
      lot: i.lot_size,
      token: i.instrument_token,
    };
  });

  // eslint-disable-next-line no-console
  console.table(rows);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
