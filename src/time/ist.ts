export type SessionRange = { from: Date; to: Date };

function istParts(date: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  return { y, m, d };
}

function istDateAt(y: number, m: number, d: number, hh: number, mm: number): Date {
  // Build a Date that represents the given IST wall time.
  // We do this by creating a UTC date at that time, then subtracting IST offset (5:30).
  const utcMs = Date.UTC(y, m - 1, d, hh, mm);
  const istOffsetMs = (5 * 60 + 30) * 60_000;
  return new Date(utcMs - istOffsetMs);
}

export function niftySessionRangeForIstDay(istDay: Date): SessionRange {
  const { y, m, d } = istParts(istDay);
  const from = istDateAt(y, m, d, 9, 15);
  const to = istDateAt(y, m, d, 15, 30);
  return { from, to };
}

export function istYesterday(): Date {
  const { y, m, d } = istParts(new Date());
  // Create "today" 00:00 IST then subtract 1 day.
  const todayStartUtc = istDateAt(y, m, d, 0, 0);
  return new Date(todayStartUtc.getTime() - 24 * 60 * 60_000);
}
