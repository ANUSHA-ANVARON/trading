import { NIFTY50_SYMBOLS } from "../universe/nifty50";
import type { WeightRow } from "./nifty50Breadth";

export function equalWeightsForNifty50(): WeightRow[] {
  const equal = 100 / NIFTY50_SYMBOLS.length;
  return NIFTY50_SYMBOLS.map((s) => ({ key: `NSE:${s}`, weight: equal }));
}
