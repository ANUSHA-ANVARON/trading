import { promises as fs } from "fs";
import type { Candle } from "../core/types";

export type CsvCandleLayout = {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
};

function toNumber(value: string, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${field}: ${value}`);
  return n;
}

function parseLine(line: string): string[] {
  // Minimal CSV parsing (no quoted commas). Keep it simple and explicit.
  return line.split(",").map((s) => s.trim());
}

export async function loadCsvCandles(
  filePath: string,
  layout: CsvCandleLayout,
  opts?: { skipHeader?: boolean },
): Promise<Candle[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const start = opts?.skipHeader ? 1 : 0;

  const candles: Candle[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = parseLine(lines[i]);

    const time = cols[Number(layout.time) as any] ?? cols[(layout as any).time];
    // The layout is provided as indices via CLI; we treat it as strings and then Number.
    const timeIdx = Number(layout.time);
    const openIdx = Number(layout.open);
    const highIdx = Number(layout.high);
    const lowIdx = Number(layout.low);
    const closeIdx = Number(layout.close);
    const volIdx = layout.volume !== undefined ? Number(layout.volume) : null;

    const t = cols[timeIdx];
    if (!t) throw new Error(`Missing time at line ${i + 1}`);

    const open = toNumber(cols[openIdx], "open");
    const high = toNumber(cols[highIdx], "high");
    const low = toNumber(cols[lowIdx], "low");
    const close = toNumber(cols[closeIdx], "close");
    const volume = volIdx !== null ? toNumber(cols[volIdx], "volume") : undefined;

    candles.push({ time: new Date(t).toISOString(), open, high, low, close, volume });
  }

  return candles;
}
