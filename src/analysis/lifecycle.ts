export type SessionName =
  | "OPENING_RANGE"
  | "MORNING_MOMENTUM"
  | "MIDDAY_GRIND"
  | "AFTERNOON_TRANSITION"
  | "LATE_TRANSITION_CAUTION"
  | "POST_3PM_REDUCED_RISK"
  | "CLOSED";

export type FlowState =
  | "CLEAN_BULLISH_FLOW"
  | "CLEAN_BEARISH_FLOW"
  | "CE_EDGE"
  | "PE_EDGE"
  | "WEAK_EDGE_WAIT"
  | "CHOP_OR_CONFLICT";

export type TradeAction =
  | "BUY_OR_HOLD_CE"
  | "BUY_OR_HOLD_PE"
  | "NO_FRESH_ENTRY"
  | "WAIT_FOR_CLEAN_FLOW"
  | "REDUCE_OR_EXIT_ONLY";

export type LifecycleOutput = {
  asof: string;
  session: SessionName;
  maxExposurePct: number;
  state: FlowState;
  action: TradeAction;
  confidence: number;
  scse: number;
  dominance: { buy: number; sell: number; gap: number; side: "BUY" | "SELL" | "NEUTRAL" };
  spartan: { up: number; dn: number };
  surfing: { up: number; dn: number };
  rsi: { m1: number | null; m5: number | null; m15: number | null };
  rr: { rawCE: number; effCE: number; rawPE: number; effPE: number };
  explanation: string;
};

function istMinutes(): number {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function getSession(min: number): { session: SessionName; maxExposurePct: number } {
  // Market: 09:15 (555) to 15:30 (930)
  if (min < 555 || min >= 930) return { session: "CLOSED", maxExposurePct: 0 };
  if (min < 570) return { session: "OPENING_RANGE", maxExposurePct: 60 };      // 09:15-09:30
  if (min < 660) return { session: "MORNING_MOMENTUM", maxExposurePct: 100 };  // 09:30-11:00
  if (min < 780) return { session: "MIDDAY_GRIND", maxExposurePct: 80 };       // 11:00-13:00
  if (min < 870) return { session: "AFTERNOON_TRANSITION", maxExposurePct: 80 }; // 13:00-14:30
  if (min < 900) return { session: "LATE_TRANSITION_CAUTION", maxExposurePct: 40 }; // 14:30-15:00
  return { session: "POST_3PM_REDUCED_RISK", maxExposurePct: 20 };             // 15:00-15:30
}

type SignalInput = {
  // timeframe suggestion signals
  s1rec: string; s1conf: number | null; s1rsi: number | null;
  s5rec: string; s5conf: number | null; s5rsi: number | null;
  s15rec: string; s15conf: number | null; s15rsi: number | null;
  // breadth
  weightedMovePct: number;
  advancers: number;
  decliners: number;
  buySellImbalance: number | null;
  // spartan/surfing counts
  spartanUp: number;
  spartanDn: number;
  surfingUp: number;
  surfingDn: number;
  // options
  pcr: number | null;
  vix: number | null;
  impliedMovePct: number | null;
  cePremium: number | null;
  pePremium: number | null;
  tpPct: number;
  slPct: number;
};

export function computeLifecycle(input: SignalInput): LifecycleOutput {
  const min = istMinutes();
  const { session, maxExposurePct } = getSession(min);
  const asof = new Date().toISOString();

  const { s1rec, s1conf, s1rsi, s5rec, s5conf, s5rsi, s15rec, s15rsi } = input;
  const rsi1 = s1rsi;
  const rsi5 = s5rsi;
  const rsi15 = s15rsi;

  // ── SCSE composite score (0-100) ─────────────────────────────────
  // S: Spartan flow alignment (0-25)
  const spNet = input.spartanUp - input.spartanDn;
  const spScore = Math.min(25, Math.max(0, Math.abs(spNet) * 4 + (Math.abs(spNet) > 0 ? 5 : 0)));

  // C: Confluence of timeframes (0-25)
  const tfs = [s1rec, s5rec, s15rec];
  const longCount = tfs.filter((r) => r === "LONG").length;
  const shortCount = tfs.filter((r) => r === "SHORT").length;
  const aligned = Math.max(longCount, shortCount);
  const conflicting = Math.min(longCount, shortCount);
  const confScore = Math.min(25, aligned * 8 - conflicting * 5);

  // S: Signal RSI extremity (0-25)
  const rsiScore = (() => {
    if (rsi1 == null) return 0;
    if (rsi1 > 70 || rsi1 < 30) return 25;
    if (rsi1 > 62 || rsi1 < 38) return 18;
    if (rsi1 > 58 || rsi1 < 42) return 12;
    if (rsi1 > 55 || rsi1 < 45) return 6;
    return 0;
  })();

  // E: Edge clarity from breadth (0-25)
  const adv = input.advancers, dec = input.decliners;
  const advDec = dec > 0 ? adv / dec : (adv > 0 ? 5 : 1);
  const edgeScore = (() => {
    if (advDec > 2.5 || advDec < 0.4) return 25;
    if (advDec > 1.8 || advDec < 0.55) return 18;
    if (advDec > 1.4 || advDec < 0.7) return 12;
    if (advDec > 1.2 || advDec < 0.83) return 6;
    return 0;
  })();

  const scse = Math.round(Math.min(100, spScore + confScore + rsiScore + edgeScore));

  // ── Dominance ────────────────────────────────────────────────────
  // Buy = advancers + SPARTAN_UP weighted, Sell = decliners + SPARTAN_DN weighted
  const buyDom = Math.round((adv + input.spartanUp * 2) / 5 * 10) / 10;
  const sellDom = Math.round((dec + input.spartanDn * 2) / 5 * 10) / 10;
  const domGap = Math.round(Math.abs(buyDom - sellDom) * 10) / 10;
  const domSide: "BUY" | "SELL" | "NEUTRAL" =
    buyDom > sellDom + 1 ? "BUY" : sellDom > buyDom + 1 ? "SELL" : "NEUTRAL";

  // ── Flow state ───────────────────────────────────────────────────
  const isBullishTF = longCount >= 2 && conflicting === 0;
  const isBearishTF = shortCount >= 2 && conflicting === 0;
  const rsiOkLong = rsi1 != null && rsi1 >= 55 && (rsi5 == null || rsi5 >= 50);
  const rsiOkShort = rsi1 != null && rsi1 <= 45 && (rsi5 == null || rsi5 <= 50);
  const breadthBull = input.weightedMovePct > 0.15 && advDec > 1.2;
  const breadthBear = input.weightedMovePct < -0.15 && advDec < 0.83;

  let state: FlowState;

  if (isBullishTF && rsiOkLong && breadthBull && spNet >= 0) {
    state = "CLEAN_BULLISH_FLOW";
  } else if (isBearishTF && rsiOkShort && breadthBear && spNet <= 0) {
    state = "CLEAN_BEARISH_FLOW";
  } else if (longCount > shortCount && rsi1 != null && rsi1 >= 52 && input.weightedMovePct > 0) {
    state = "CE_EDGE";
  } else if (shortCount > longCount && rsi1 != null && rsi1 <= 48 && input.weightedMovePct < 0) {
    state = "PE_EDGE";
  } else if (longCount > 0 && shortCount > 0) {
    state = "CHOP_OR_CONFLICT";
  } else {
    state = "WEAK_EDGE_WAIT";
  }

  // ── Action ───────────────────────────────────────────────────────
  let action: TradeAction;

  if (session === "POST_3PM_REDUCED_RISK" || session === "CLOSED") {
    action = "REDUCE_OR_EXIT_ONLY";
  } else if (session === "LATE_TRANSITION_CAUTION") {
    action = state === "CLEAN_BULLISH_FLOW" || state === "CE_EDGE"
      ? "BUY_OR_HOLD_CE"
      : state === "CLEAN_BEARISH_FLOW" || state === "PE_EDGE"
      ? "BUY_OR_HOLD_PE"
      : "NO_FRESH_ENTRY";
  } else if (state === "CLEAN_BULLISH_FLOW" && scse >= 30) {
    action = "BUY_OR_HOLD_CE";
  } else if (state === "CLEAN_BEARISH_FLOW" && scse >= 30) {
    action = "BUY_OR_HOLD_PE";
  } else if (state === "CE_EDGE") {
    action = scse >= 25 ? "BUY_OR_HOLD_CE" : "WAIT_FOR_CLEAN_FLOW";
  } else if (state === "PE_EDGE") {
    action = scse >= 25 ? "BUY_OR_HOLD_PE" : "WAIT_FOR_CLEAN_FLOW";
  } else if (state === "CHOP_OR_CONFLICT") {
    action = "NO_FRESH_ENTRY";
  } else {
    action = "WAIT_FOR_CLEAN_FLOW";
  }

  // ── Confidence ───────────────────────────────────────────────────
  const baseConf = s1conf ?? 0;
  const s5c = s5conf ?? 0;
  const confidence = Math.round(
    Math.min(100, (baseConf * 0.5 + s5c * 0.35 + (scse / 100) * 0.15) * 100),
  );

  // ── RR ───────────────────────────────────────────────────────────
  const tp = input.tpPct > 0 ? input.tpPct : 0.25;
  const sl = input.slPct > 0 ? input.slPct : 0.15;
  const rawRR = Math.round((tp / sl) * 100) / 100;
  const ceQuality = state === "CLEAN_BULLISH_FLOW" || state === "CE_EDGE" ? baseConf + 0.1 : baseConf * 0.4;
  const peQuality = state === "CLEAN_BEARISH_FLOW" || state === "PE_EDGE" ? baseConf + 0.1 : baseConf * 0.4;
  const effCE = Math.round(rawRR * Math.min(ceQuality, 1) * 100) / 100;
  const effPE = Math.round(rawRR * Math.min(peQuality, 1) * 100) / 100;

  // ── Explanation ──────────────────────────────────────────────────
  const parts: string[] = [];
  parts.push(`${session.replace(/_/g, " ")} | ${state.replace(/_/g, " ")}`);
  if (state === "CLEAN_BULLISH_FLOW" || state === "CLEAN_BEARISH_FLOW") {
    parts.push(`${aligned}/3 TF aligned`);
    if (breadthBull) parts.push("breadth bullish");
    if (breadthBear) parts.push("bearish participation aligned");
    if (Math.abs(spNet) > 0) parts.push(`heavyweights/sectors ${spNet > 0 ? "strong" : "weak"}`);
  } else if (state === "CHOP_OR_CONFLICT") {
    parts.push(`TF conflict: ${longCount}L vs ${shortCount}S`);
    if (Math.abs(input.weightedMovePct) < 0.1) parts.push("breadth flat");
  } else {
    parts.push(`RSI 1m:${rsi1?.toFixed(0) ?? "-"} 5m:${rsi5?.toFixed(0) ?? "-"} 15m:${rsi15?.toFixed(0) ?? "-"}`);
    if (state === "CE_EDGE") parts.push("CE RR leads");
    if (state === "PE_EDGE") parts.push("PE RR leads");
  }
  if (session === "LATE_TRANSITION_CAUTION") parts.push("late session — reduced risk");
  if (session === "POST_3PM_REDUCED_RISK") parts.push("post-3PM: reduce exposure; avoid fresh trades");

  return {
    asof,
    session,
    maxExposurePct,
    state,
    action,
    confidence,
    scse,
    dominance: { buy: buyDom, sell: sellDom, gap: domGap, side: domSide },
    spartan: { up: input.spartanUp, dn: input.spartanDn },
    surfing: { up: input.surfingUp, dn: input.surfingDn },
    rsi: { m1: rsi1 != null ? Math.round(rsi1 * 10) / 10 : null, m5: rsi5 != null ? Math.round(rsi5 * 10) / 10 : null, m15: rsi15 != null ? Math.round(rsi15 * 10) / 10 : null },
    rr: { rawCE: rawRR, effCE, rawPE: rawRR, effPE },
    explanation: parts.join(" | "),
  };
}
