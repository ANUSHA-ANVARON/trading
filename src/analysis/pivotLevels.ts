export type LevelStatus = "ABOVE" | "NEAR" | "BELOW";

export type PivotLevel = {
  name: string;
  value: number;
  status: LevelStatus;
};

export type PivotLevelsOutput = {
  pdh: PivotLevel;
  pdl: PivotLevel;
  cpr: PivotLevel;
  tc: PivotLevel;
  bc: PivotLevel;
  r1: PivotLevel;
  r2: PivotLevel;
  s1: PivotLevel;
  s2: PivotLevel;
  s3: PivotLevel;
  prevDayOhlc: { h: number; l: number; c: number };
};

const NEAR_PCT = 0.002; // within 0.2% = NEAR

function levelStatus(value: number, current: number): LevelStatus {
  if (value <= 0) return "BELOW";
  const pct = Math.abs(current - value) / value;
  if (pct <= NEAR_PCT) return "NEAR";
  return current >= value ? "ABOVE" : "BELOW";
}

export function computePivotLevels(
  pdh: number,
  pdl: number,
  pdc: number,
  current: number,
): PivotLevelsOutput {
  const pivot = (pdh + pdl + pdc) / 3;
  const bc = (pdh + pdl) / 2;
  const tc = pivot * 2 - bc;
  const r1 = 2 * pivot - pdl;
  const r2 = pivot + (pdh - pdl);
  const s1 = 2 * pivot - pdh;
  const s2 = pivot - (pdh - pdl);
  const s3 = s1 - (pdh - pdl);

  const mk = (name: string, value: number): PivotLevel => ({
    name,
    value: Math.round(value * 10) / 10,
    status: levelStatus(value, current),
  });

  return {
    pdh: mk("PDH", pdh),
    pdl: mk("PDL", pdl),
    cpr: mk("CPR", pivot),
    tc: mk("TC", tc),
    bc: mk("BC", bc),
    r1: mk("R1", r1),
    r2: mk("R2", r2),
    s1: mk("S1", s1),
    s2: mk("S2", s2),
    s3: mk("S3", s3),
    prevDayOhlc: { h: pdh, l: pdl, c: pdc },
  };
}
