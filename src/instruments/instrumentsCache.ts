import { promises as fs } from "fs";
import * as path from "path";
import { env } from "../config/env";
import { createKiteClient } from "../kite/kiteClient";
import { readJsonIfExists, writeJson } from "../storage/session";

export type Exchange = "NFO" | "NSE" | "BSE" | "MCX";

export type KiteInstrument = {
  instrument_token: number;
  exchange_token: string;
  tradingsymbol: string;
  name: string;
  last_price: number;
  expiry?: string | Date;
  strike: number;
  tick_size: number;
  lot_size: number;
  instrument_type: string;
  segment: string;
  exchange: string;
};

function instrumentsPath(exchange: Exchange): string {
  return path.join(env.KITE_INSTRUMENTS_DIR, `${exchange}.json`);
}

export async function readCachedInstruments(exchange: Exchange): Promise<KiteInstrument[] | null> {
  const cached = await readJsonIfExists<{ updatedAt: string; instruments: KiteInstrument[] }>(
    instrumentsPath(exchange),
  );
  return cached?.instruments ?? null;
}

export async function syncInstruments(exchange: Exchange): Promise<KiteInstrument[]> {
  const kite = await createKiteClient();
  const instruments: KiteInstrument[] = await kite.getInstruments(exchange);

  await fs.mkdir(env.KITE_INSTRUMENTS_DIR, { recursive: true });
  await writeJson(instrumentsPath(exchange), { updatedAt: new Date().toISOString(), instruments });

  return instruments;
}

export async function getInstruments(exchange: Exchange, opts?: { refresh?: boolean }): Promise<KiteInstrument[]> {
  if (!opts?.refresh) {
    const cached = await readCachedInstruments(exchange);
    if (cached) return cached;
  }
  return syncInstruments(exchange);
}
