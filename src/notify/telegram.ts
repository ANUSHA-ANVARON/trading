import { env } from "../config/env";

type TelegramSendResult =
  | { ok: true; messageId: number | null }
  | { ok: false; error: string; status?: number; responseBody?: unknown };

function nowIso(): string {
  return new Date().toISOString();
}

function dirFromAction(action: string): "LONG" | "SHORT" | null {
  const a = action.toUpperCase();
  if (a.includes("BUY CALL")) return "LONG";
  if (a.includes("SELL PUT")) return "LONG";
  if (a.includes("BUY PUT")) return "SHORT";
  if (a.includes("SELL CALL")) return "SHORT";
  return null;
}

function safeString(x: unknown): string {
  if (x === null || x === undefined) return "";
  return typeof x === "string" ? x : JSON.stringify(x);
}

async function sendTelegramMessage(params: {
  token: string;
  chatId: string;
  text: string;
}): Promise<TelegramSendResult> {
  const url = `https://api.telegram.org/bot${params.token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.text,
        disable_web_page_preview: true,
      }),
    });

    const bodyText = await res.text();
    const body = (() => {
      try {
        return JSON.parse(bodyText);
      } catch {
        return bodyText;
      }
    })();

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `Telegram sendMessage failed (HTTP ${res.status})`,
        responseBody: body,
      };
    }

    const messageId = typeof (body as any)?.result?.message_id === "number" ? (body as any).result.message_id : null;
    return { ok: true, messageId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : safeString(e);
    return { ok: false, error: `Telegram sendMessage error: ${msg}` };
  }
}

async function sendTelegramPhoto(params: {
  token: string;
  chatId: string;
  photoPng: Uint8Array;
  filename?: string;
  caption?: string;
}): Promise<TelegramSendResult> {
  const url = `https://api.telegram.org/bot${params.token}/sendPhoto`;

  try {
    const fd = new FormData();
    fd.append("chat_id", params.chatId);
    if (params.caption) fd.append("caption", params.caption);
    fd.append("disable_web_page_preview", "true");

    const blob = new Blob([params.photoPng], { type: "image/png" });
    fd.append("photo", blob, params.filename ?? "alert.png");

    const res = await fetch(url, { method: "POST", body: fd });
    const bodyText = await res.text();
    const body = (() => {
      try {
        return JSON.parse(bodyText);
      } catch {
        return bodyText;
      }
    })();

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `Telegram sendPhoto failed (HTTP ${res.status})`,
        responseBody: body,
      };
    }

    const messageId = typeof (body as any)?.result?.message_id === "number" ? (body as any).result.message_id : null;
    return { ok: true, messageId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : safeString(e);
    return { ok: false, error: `Telegram sendPhoto error: ${msg}` };
  }
}

// Register a bundled font (works regardless of OS/container — no reliance on
// system fonts being present on Railway). Cached after first call.
let fontFamily: string | null = null;
async function ensureFonts(): Promise<string> {
  if (fontFamily) return fontFamily;
  const { GlobalFonts } = await import("@napi-rs/canvas");
  try {
    const path = await import("path");
    const base = path.join(process.cwd(), "node_modules", "@fontsource", "dejavu-sans", "files");
    GlobalFonts.registerFromPath(path.join(base, "dejavu-sans-latin-400-normal.woff2"), "DejaVu Sans");
    GlobalFonts.registerFromPath(path.join(base, "dejavu-sans-latin-700-normal.woff2"), "DejaVu Sans");
    fontFamily = "DejaVu Sans";
  } catch {
    fontFamily = "sans-serif";
  }
  return fontFamily;
}

function rr(ctx: any, x: number, y: number, w: number, h: number, rad: number) {
  const r = Math.min(rad, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function toIst(iso: string): string {
  const d = new Date(iso);
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return String(ist.getUTCHours()).padStart(2, "0") + ":" + String(ist.getUTCMinutes()).padStart(2, "0") + " IST";
}

async function renderAlertCardPng(params: { title: string; lines: string[] }): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const font = await ensureFonts();

  const W = 820, pad = 28;
  const lineH = 32, titleH = 52;
  const H = pad * 2 + titleH + Math.max(1, params.lines.length) * lineH + 16;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#050810"; ctx.fillRect(0, 0, W, H);
  rr(ctx, 12, 10, W - 24, H - 20, 16);
  ctx.fillStyle = "#0d1117"; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = "#b48a1a"; ctx.stroke();

  // accent strip
  rr(ctx, 12, 10, W - 24, 6, 4);
  ctx.fillStyle = "#b48a1a"; ctx.fill();

  ctx.fillStyle = "#fbbf24"; ctx.font = `800 26px "${font}"`;
  ctx.fillText(params.title.toUpperCase(), pad + 12, pad + titleH - 10);
  ctx.fillStyle = "#d1d5db"; ctx.font = `500 18px "${font}"`;
  for (let i = 0; i < params.lines.length; i++) {
    ctx.fillText(params.lines[i], pad + 12, pad + titleH + i * lineH + 20);
  }
  return canvas.toBuffer("image/png");
}

export type MarketCondition = "STRONG_BULLISH" | "MILDLY_BULLISH" | "BEARISH" | "NEUTRAL";

export type TelegramPrediction = {
  id: string;
  asof: string;
  timeframe: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  confidence: number;
  lifecycle: string;
  session: string;
  signals: {
    rsi5m: number | null; rsi15m: number | null;
    bbPctB5m: number | null; tfAgree: number;
    spartanNet: number; breadthMove: number;
  };
};

export type TelegramSignalSnapshot = {
  asof?: string;
  tradeTimeframe?: string;
  tradeTimeframeRequested?: string;
  options?: any;
  suggestion?: any;
  timeframes?: any;
  breadth?: any;
  stockSignals?: any;
  stockLogs?: any;
  news?: any;
  pivotLevels?: any;
  rms?: any;
  lifecycle?: any;
  predictionLog?: TelegramPrediction[];
};

export function lifecycleToCondition(state: string): MarketCondition {
  if (state === "CLEAN_BULLISH_FLOW") return "STRONG_BULLISH";
  if (state === "CE_EDGE") return "MILDLY_BULLISH";
  if (state === "CLEAN_BEARISH_FLOW" || state === "PE_EDGE") return "BEARISH";
  return "NEUTRAL";
}

const CONDITION_META: Record<MarketCondition, { label: string; icon: string; accent: string; panelBg: string }> = {
  STRONG_BULLISH: { label: "STRONG BULLISH",  icon: "▲▲", accent: "#22c55e", panelBg: "#08130a" },
  MILDLY_BULLISH: { label: "MILDLY BULLISH",  icon: "▲",  accent: "#86efac", panelBg: "#0a1610" },
  BEARISH:        { label: "BEARISH",          icon: "▼",  accent: "#ef4444", panelBg: "#150808" },
  NEUTRAL:        { label: "NEUTRAL",          icon: "◆",  accent: "#f59e0b", panelBg: "#141009" },
};

async function renderMarketConditionCardPng(params: {
  condition: MarketCondition;
  session: string;
  rsi1m: number | null; rsi5m: number | null; rsi15m: number | null;
  breadthMove: number | null;
  advancers: number; decliners: number;
  spartanUp: number; spartanDn: number;
  scse: number | null;
  pcr: number | null;
  asof: string;
}): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const font = await ensureFonts();
  const meta = CONDITION_META[params.condition];

  // ── Canvas setup ────────────────────────────────────────────────────────
  const W = 820, H = 430;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Outer bg
  ctx.fillStyle = "#050810"; ctx.fillRect(0, 0, W, H);

  // Card panel
  const pX = 12, pY = 10, pW = W - 24, pH = H - 20;
  rr(ctx, pX, pY, pW, pH, 18);
  ctx.fillStyle = meta.panelBg; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = meta.accent + "99"; ctx.stroke();

  // ── Left accent bar ──────────────────────────────────────────────────────
  const barW = 6;
  rr(ctx, pX, pY, barW, pH, 10);
  ctx.fillStyle = meta.accent; ctx.fill();

  const lx = pX + barW + 20; // left content x
  const rx = pX + pW - 22;   // right content x

  // ── Header row ──────────────────────────────────────────────────────────
  ctx.fillStyle = "#4b5563"; ctx.font = `600 12px "${font}"`;
  ctx.fillText("NIFTY 50  ·  MARKET CONDITION", lx, pY + 36);

  ctx.fillStyle = "#374151"; ctx.font = `500 12px "${font}"`;
  ctx.textAlign = "right";
  ctx.fillText(toIst(params.asof), rx, pY + 36);
  ctx.textAlign = "left";

  // ── Big condition label ──────────────────────────────────────────────────
  ctx.fillStyle = meta.accent; ctx.font = `800 48px "${font}"`;
  ctx.fillText(meta.label, lx, pY + 98);

  // session pill
  const sess = params.session.replace(/_/g, " ");
  ctx.fillStyle = "#111827";
  rr(ctx, lx, pY + 110, ctx.measureText(sess).width + 24, 26, 13);
  ctx.fill();
  ctx.fillStyle = "#9ca3af"; ctx.font = `500 13px "${font}"`;
  ctx.fillText(sess, lx + 12, pY + 128);

  // ── Divider ──────────────────────────────────────────────────────────────
  ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx, pY + 150); ctx.lineTo(rx, pY + 150); ctx.stroke();

  // ── RSI bars row ─────────────────────────────────────────────────────────
  const rsiItems = [
    { label: "RSI  1m", val: params.rsi1m },
    { label: "RSI  5m", val: params.rsi5m },
    { label: "RSI 15m", val: params.rsi15m },
  ];
  const barRowY = pY + 162;
  const barTotalW = rx - lx;
  const barSlotW = barTotalW / 3;
  const barTrackW = barSlotW - 24;
  const barH = 8;

  for (let i = 0; i < rsiItems.length; i++) {
    const bx = lx + i * barSlotW;
    const val = rsiItems[i].val;
    const pct = val != null ? Math.min(1, Math.max(0, val / 100)) : 0;
    const col = val != null ? (val > 60 ? "#22c55e" : val < 40 ? "#ef4444" : "#f59e0b") : "#374151";

    ctx.fillStyle = "#9ca3af"; ctx.font = `500 11px "${font}"`;
    ctx.fillText(rsiItems[i].label, bx, barRowY + 12);

    ctx.fillStyle = "#1f2937";
    rr(ctx, bx, barRowY + 18, barTrackW, barH, 4); ctx.fill();
    if (val != null) {
      ctx.fillStyle = col;
      rr(ctx, bx, barRowY + 18, barTrackW * pct, barH, 4); ctx.fill();
    }

    ctx.fillStyle = col; ctx.font = `700 22px "${font}"`;
    ctx.fillText(val != null ? val.toFixed(1) : "–", bx, barRowY + 58);
  }

  // ── SCSE score (right side of RSI row) ───────────────────────────────────
  const scseVal = params.scse ?? 0;
  const scseCol = scseVal >= 65 ? "#22c55e" : scseVal <= 35 ? "#ef4444" : "#f59e0b";
  const scseX = lx + 3 * barSlotW - 90;
  ctx.fillStyle = "#9ca3af"; ctx.font = `500 11px "${font}"`;
  ctx.fillText("SCSE", scseX, barRowY + 12);
  // arc gauge
  const cx3 = scseX + 34, cy3 = barRowY + 48, rad = 30;
  ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(cx3, cy3, rad, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
  const sweep = (scseVal / 100) * Math.PI * 1.5;
  ctx.strokeStyle = scseCol; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(cx3, cy3, rad, Math.PI * 0.75, Math.PI * 0.75 + sweep); ctx.stroke();
  ctx.fillStyle = scseCol; ctx.font = `700 18px "${font}"`;
  ctx.textAlign = "center"; ctx.fillText(String(scseVal), cx3, cy3 + 7); ctx.textAlign = "left";

  // ── Divider ──────────────────────────────────────────────────────────────
  ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx, pY + 242); ctx.lineTo(rx, pY + 242); ctx.stroke();

  // ── Bottom metric chips (2 rows × 4) ─────────────────────────────────────
  const chips: Array<{ label: string; value: string; color: string }> = [
    {
      label: "Breadth",
      value: params.breadthMove != null ? (params.breadthMove >= 0 ? "+" : "") + params.breadthMove.toFixed(2) + "%" : "–",
      color: params.breadthMove != null ? (params.breadthMove > 0.1 ? "#22c55e" : params.breadthMove < -0.1 ? "#ef4444" : "#f59e0b") : "#4b5563",
    },
    {
      label: "Adv / Dec",
      value: `${params.advancers}  /  ${params.decliners}`,
      color: params.advancers > params.decliners ? "#22c55e" : params.decliners > params.advancers ? "#ef4444" : "#e8ecf6",
    },
    {
      label: "Spartan Flow",
      value: `+${params.spartanUp}  /  -${params.spartanDn}`,
      color: params.spartanUp > params.spartanDn ? "#22c55e" : params.spartanDn > params.spartanUp ? "#ef4444" : "#e8ecf6",
    },
    {
      label: "PCR",
      value: params.pcr != null ? params.pcr.toFixed(2) : "–",
      color: params.pcr != null ? (params.pcr > 1.1 ? "#22c55e" : params.pcr < 0.85 ? "#ef4444" : "#f59e0b") : "#4b5563",
    },
  ];

  const chipTotalW = rx - lx;
  const chipW = (chipTotalW - 12) / 4;
  const chipY1 = pY + 256;

  for (let i = 0; i < chips.length; i++) {
    const cx4 = lx + i * (chipW + 4);
    rr(ctx, cx4, chipY1, chipW, 70, 10);
    ctx.fillStyle = "#0d1117"; ctx.fill();
    ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1; ctx.stroke();

    // colour left edge on chip
    ctx.fillStyle = chips[i].color + "33";
    rr(ctx, cx4, chipY1, chipW, 70, 10); ctx.fill();
    rr(ctx, cx4, chipY1, 4, 70, 4); ctx.fillStyle = chips[i].color; ctx.fill();

    ctx.fillStyle = "#6b7280"; ctx.font = `500 11px "${font}"`;
    ctx.fillText(chips[i].label, cx4 + 12, chipY1 + 20);
    ctx.fillStyle = chips[i].color; ctx.font = `700 22px "${font}"`;
    ctx.fillText(chips[i].value, cx4 + 12, chipY1 + 52);
  }

  // ── Adv/Dec proportion bar ───────────────────────────────────────────────
  const total = params.advancers + params.decliners;
  if (total > 0) {
    const barStartX = lx, barEndX = rx, propY = pY + 340;
    const advPct = params.advancers / total;
    ctx.fillStyle = "#1f2937";
    rr(ctx, barStartX, propY, barEndX - barStartX, 8, 4); ctx.fill();
    ctx.fillStyle = "#22c55e";
    rr(ctx, barStartX, propY, (barEndX - barStartX) * advPct, 8, 4); ctx.fill();
    ctx.fillStyle = "#4b5563"; ctx.font = `500 10px "${font}"`;
    ctx.fillText(`Adv ${Math.round(advPct * 100)}%  ·  Dec ${Math.round((1 - advPct) * 100)}%`, barStartX, propY + 22);
  }

  return canvas.toBuffer("image/png");
}

async function renderPredictionCardPng(params: {
  direction: "LONG" | "SHORT";
  timeframe: string;
  entryPrice: number; targetPrice: number; stopPrice: number;
  confidence: number;
  rsi5m: number | null; rsi15m: number | null;
  bbPctB5m: number | null;
  tfAgree: number;
  lifecycle: string; session: string;
  asof: string;
}): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const font = await ensureFonts();
  const isLong = params.direction === "LONG";
  const accent = isLong ? "#22c55e" : "#ef4444";
  const panelBg = isLong ? "#060e07" : "#0e0606";

  const W = 820, H = 440;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Bg + panel
  ctx.fillStyle = "#050810"; ctx.fillRect(0, 0, W, H);
  const pX = 12, pY = 10, pW = W - 24, pH = H - 20;
  rr(ctx, pX, pY, pW, pH, 18);
  ctx.fillStyle = panelBg; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = accent + "99"; ctx.stroke();

  // Left bar
  rr(ctx, pX, pY, 6, pH, 10); ctx.fillStyle = accent; ctx.fill();

  const lx = pX + 26, rx = pX + pW - 22;

  // ── Header ───────────────────────────────────────────────────────────────
  ctx.fillStyle = "#4b5563"; ctx.font = `600 12px "${font}"`;
  ctx.fillText("PREDICTION ENGINE  ·  NIFTY 50 OPTIONS", lx, pY + 36);
  ctx.fillStyle = "#374151"; ctx.font = `500 12px "${font}"`;
  ctx.textAlign = "right"; ctx.fillText(toIst(params.asof), rx, pY + 36); ctx.textAlign = "left";

  // ── Direction badge ───────────────────────────────────────────────────────
  const dirLabel = isLong ? "LONG" : "SHORT";
  const dirArrow = isLong ? "▲" : "▼";

  // Badge background
  const badgeW = 180, badgeH = 52;
  rr(ctx, lx, pY + 50, badgeW, badgeH, 12);
  ctx.fillStyle = accent + "22"; ctx.fill();
  ctx.strokeStyle = accent + "88"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = accent; ctx.font = `800 32px "${font}"`;
  ctx.fillText(`${dirArrow}  ${dirLabel}`, lx + 14, pY + 88);

  // Timeframe + TF agreement (right of badge)
  ctx.fillStyle = "#e8ecf6"; ctx.font = `700 28px "${font}"`;
  ctx.fillText(`${params.timeframe}`, lx + badgeW + 20, pY + 84);
  ctx.fillStyle = "#6b7280"; ctx.font = `500 13px "${font}"`;
  ctx.fillText(`${params.tfAgree}/3 timeframes agree`, lx + badgeW + 20, pY + 104);

  // Confidence arc (far right)
  const conf = Math.round(params.confidence * 100);
  const confCol = conf >= 70 ? "#22c55e" : conf >= 50 ? "#f59e0b" : "#9ca3af";
  const arcX = rx - 44, arcY = pY + 84, arcR = 36;
  ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 7; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(arcX, arcY, arcR, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
  const confSweep = (conf / 100) * Math.PI * 1.5;
  ctx.strokeStyle = confCol; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(arcX, arcY, arcR, Math.PI * 0.75, Math.PI * 0.75 + confSweep); ctx.stroke();
  ctx.fillStyle = confCol; ctx.font = `700 16px "${font}"`;
  ctx.textAlign = "center"; ctx.fillText(conf + "%", arcX, arcY + 6); ctx.textAlign = "left";
  ctx.fillStyle = "#4b5563"; ctx.font = `500 10px "${font}"`;
  ctx.textAlign = "center"; ctx.fillText("CONF", arcX, arcY + 20); ctx.textAlign = "left";

  // Session + lifecycle line
  ctx.fillStyle = "#6b7280"; ctx.font = `500 13px "${font}"`;
  ctx.fillText(
    params.session.replace(/_/g, " ") + "   ·   " + params.lifecycle.replace(/_/g, " "),
    lx, pY + 124,
  );

  // ── Divider ───────────────────────────────────────────────────────────────
  ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx, pY + 140); ctx.lineTo(rx, pY + 140); ctx.stroke();

  // ── Three price boxes ─────────────────────────────────────────────────────
  const ptsDiff = (v: number) => {
    const d = v - params.entryPrice;
    return (d >= 0 ? "+" : "") + d.toFixed(0) + " pts";
  };
  const boxTotalW = rx - lx;
  const boxW = (boxTotalW - 16) / 3;
  const boxY = pY + 154;
  const boxH = 88;
  const boxDefs = [
    { label: "ENTRY PRICE",  value: params.entryPrice.toFixed(2),  sub: "",               valCol: "#e8ecf6",  bg: "#0d1117",  edge: "#1f2937" },
    { label: "TARGET",       value: params.targetPrice.toFixed(2), sub: ptsDiff(params.targetPrice), valCol: "#22c55e", bg: "#071009",  edge: "#166534" },
    { label: "STOP LOSS",    value: params.stopPrice.toFixed(2),   sub: ptsDiff(params.stopPrice),   valCol: "#ef4444", bg: "#100707",  edge: "#7f1d1d" },
  ];
  for (let i = 0; i < 3; i++) {
    const bx = lx + i * (boxW + 8);
    rr(ctx, bx, boxY, boxW, boxH, 12);
    ctx.fillStyle = boxDefs[i].bg; ctx.fill();
    ctx.strokeStyle = boxDefs[i].edge; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "#4b5563"; ctx.font = `600 11px "${font}"`;
    ctx.fillText(boxDefs[i].label, bx + 14, boxY + 22);
    ctx.fillStyle = boxDefs[i].valCol; ctx.font = `700 30px "${font}"`;
    ctx.fillText(boxDefs[i].value, bx + 14, boxY + 60);
    if (boxDefs[i].sub) {
      ctx.fillStyle = boxDefs[i].valCol + "aa"; ctx.font = `500 13px "${font}"`;
      ctx.fillText(boxDefs[i].sub, bx + 14, boxY + 78);
    }
  }

  // ── R:R visual bar ────────────────────────────────────────────────────────
  const rrBarY = pY + 256;
  const reward = Math.abs(params.targetPrice - params.entryPrice);
  const risk   = Math.abs(params.stopPrice   - params.entryPrice);
  const rrRatio = risk > 0 ? reward / risk : 0;
  const barTotalW = rx - lx;
  const riskFrac  = Math.min(1, risk   / (risk + reward + 0.0001));
  const rewardFrac = Math.min(1, reward / (risk + reward + 0.0001));

  // track bg
  ctx.fillStyle = "#1f2937"; rr(ctx, lx, rrBarY, barTotalW, 10, 5); ctx.fill();
  // risk (left, red)
  ctx.fillStyle = "#ef4444"; rr(ctx, lx, rrBarY, barTotalW * riskFrac, 10, 5); ctx.fill();
  // reward (right, green) — drawn right-aligned
  ctx.fillStyle = "#22c55e";
  const rwX = lx + barTotalW - barTotalW * rewardFrac;
  rr(ctx, rwX, rrBarY, barTotalW * rewardFrac, 10, 5); ctx.fill();

  ctx.fillStyle = "#6b7280"; ctx.font = `500 11px "${font}"`;
  ctx.fillText(`Risk  ${risk.toFixed(0)} pts`, lx, rrBarY + 24);
  ctx.fillStyle = "#9ca3af"; ctx.font = `700 11px "${font}"`;
  ctx.textAlign = "center"; ctx.fillText(`R:R  ${rrRatio.toFixed(1)}`, lx + barTotalW / 2, rrBarY + 24); ctx.textAlign = "left";
  ctx.fillStyle = "#6b7280"; ctx.font = `500 11px "${font}"`;
  ctx.textAlign = "right"; ctx.fillText(`Reward  ${reward.toFixed(0)} pts`, rx, rrBarY + 24); ctx.textAlign = "left";

  // ── Divider ───────────────────────────────────────────────────────────────
  ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx, pY + 298); ctx.lineTo(rx, pY + 298); ctx.stroke();

  // ── Indicator chips row ───────────────────────────────────────────────────
  const indChips = [
    {
      label: "RSI 5m",
      value: params.rsi5m != null ? params.rsi5m.toFixed(1) : "–",
      color: params.rsi5m != null ? (params.rsi5m > 60 ? "#22c55e" : params.rsi5m < 40 ? "#ef4444" : "#f59e0b") : "#4b5563",
    },
    {
      label: "RSI 15m",
      value: params.rsi15m != null ? params.rsi15m.toFixed(1) : "–",
      color: params.rsi15m != null ? (params.rsi15m > 60 ? "#22c55e" : params.rsi15m < 40 ? "#ef4444" : "#f59e0b") : "#4b5563",
    },
    {
      label: "BB %B 5m",
      value: params.bbPctB5m != null ? Math.round(params.bbPctB5m * 100) + "%" : "–",
      color: params.bbPctB5m != null
        ? (params.bbPctB5m > 0.8 ? "#ef4444" : params.bbPctB5m < 0.2 ? "#22c55e" : "#f59e0b")
        : "#4b5563",
    },
    {
      label: "TF Agreement",
      value: `${params.tfAgree} / 3`,
      color: params.tfAgree >= 3 ? "#22c55e" : params.tfAgree === 2 ? "#f59e0b" : "#ef4444",
    },
  ];

  const ichipW = (barTotalW - 12) / 4;
  const ichipY = pY + 312;
  for (let i = 0; i < indChips.length; i++) {
    const cx5 = lx + i * (ichipW + 4);
    rr(ctx, cx5, ichipY, ichipW, 62, 10);
    ctx.fillStyle = "#0d1117"; ctx.fill();
    ctx.strokeStyle = indChips[i].color + "44"; ctx.lineWidth = 1; ctx.stroke();
    rr(ctx, cx5, ichipY, 4, 62, 4); ctx.fillStyle = indChips[i].color; ctx.fill();
    ctx.fillStyle = "#6b7280"; ctx.font = `500 11px "${font}"`;
    ctx.fillText(indChips[i].label, cx5 + 12, ichipY + 20);
    ctx.fillStyle = indChips[i].color; ctx.font = `700 24px "${font}"`;
    ctx.fillText(indChips[i].value, cx5 + 12, ichipY + 50);
  }

  // ── Direction glow stripe at bottom ──────────────────────────────────────
  const grad = ctx.createLinearGradient(lx, 0, rx, 0);
  grad.addColorStop(0, accent + "33");
  grad.addColorStop(0.5, accent + "11");
  grad.addColorStop(1, accent + "00");
  ctx.fillStyle = grad;
  ctx.fillRect(pX + 6, pY + pH - 10, pW - 12, 8);

  return canvas.toBuffer("image/png");
}

export class TelegramNotifier {
  private readonly token: string | null;
  private readonly chatIds: string[];
  private readonly minIntervalMs: number;
  private lastKey: string | null = null;
  private lastSentAt = 0;
  private lastStockKey: string | null = null;
  private lastStockSentAt = 0;
  private warnedMissing = false;

  // Market condition tracking
  private lastCondition: MarketCondition | null = null;
  private lastConditionAt = 0;
  private readonly conditionDebounceMs = 15 * 60_000; // 15 min between same condition

  // Prediction tracking — avoid sending same ID twice
  private readonly sentPredIds = new Set<string>();

  constructor(params?: { token?: string; chatId?: string; minIntervalMs?: number }) {
    this.token = params?.token ?? env.TELEGRAM_BOT_TOKEN ?? null;

    const idsRaw = (env as any).TELEGRAM_CHAT_IDS as string | undefined;
    const ids = (idsRaw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const single = params?.chatId ?? env.TELEGRAM_CHAT_ID ?? null;
    this.chatIds = ids.length ? ids : single ? [single] : [];
    this.minIntervalMs = params?.minIntervalMs ?? env.TELEGRAM_MIN_INTERVAL_MS ?? 15_000;
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.chatIds.length);
  }

  private buildKey(s: TelegramSignalSnapshot): string {
    const opt = s.options ?? {};
    const sug = opt?.suggestion ?? {};
    const decision = opt?.decision ?? {};

    const action = String(decision?.action ?? "");
    const take = Boolean(decision?.takeTrade);

    if (!take || !action || sug?.style === "WAIT") return "WAIT";

    if (sug?.style === "BUY") {
      return [
        "BUY",
        String(sug?.action ?? ""),
        String(sug?.instrument ?? ""),
        String(sug?.strike ?? ""),
        String(opt?.expiry ?? ""),
      ].join("|");
    }

    if (sug?.style === "CREDIT_SPREAD") {
      const sp = sug?.spread ?? {};
      const legs = sp?.legs ?? {};
      return [
        "SPREAD",
        String(sug?.action ?? ""),
        String(legs?.sell?.instrument ?? ""),
        String(legs?.sell?.strike ?? ""),
        String(legs?.buy?.instrument ?? ""),
        String(legs?.buy?.strike ?? ""),
        String(opt?.expiry ?? ""),
      ].join("|");
    }

    return ["OTHER", action, String(opt?.expiry ?? "")].join("|");
  }

  private formatMessage(s: TelegramSignalSnapshot): string {
    const asof = String(s.asof ?? nowIso());
    const opt = s.options ?? null;
    const decision = opt?.decision ?? null;
    const sug = opt?.suggestion ?? null;
    const plan = opt?.tradePlan ?? null;

    const tradeTf = s.tradeTimeframe ? String(s.tradeTimeframe) : null;

    const action = String(decision?.action ?? "WAIT");
    const dir = dirFromAction(action);

    const lines: string[] = [];
    lines.push(`TRADE SIGNAL (${asof})`);
    lines.push(`TF: ${tradeTf ?? "-"} | DIR: ${dir ?? "-"} | ACTION: ${action}`);

    if (sug?.style === "BUY") {
      const inst = String(sug.instrument ?? "-");
      const qty = typeof sug.quantity === "number" ? sug.quantity : null;
      const entry = plan?.kind === "BUY_PREMIUM" ? plan.entryPremium : typeof sug.premium === "number" ? Number(sug.premium.toFixed(2)) : null;
      const tgt = plan?.kind === "BUY_PREMIUM" ? plan.targetPremium : null;
      const sl = plan?.kind === "BUY_PREMIUM" ? plan.stopPremium : null;

      lines.push(`BUY: ${inst}${qty ? ` | QTY: ${qty}` : ""}`);
      if (entry !== null) {
        lines.push(`ENTRY: ${entry}${tgt !== null ? ` | TGT: ${tgt}` : ""}${sl !== null ? ` | SL: ${sl}` : ""}`);
      }
    } else if (sug?.style === "CREDIT_SPREAD") {
      const sp = sug.spread;
      const sell = sp?.legs?.sell;
      const buy = sp?.legs?.buy;
      const qty = typeof sell?.quantity === "number" ? sell.quantity : null;
      const credit = typeof sp?.netCredit === "number" ? Number(sp.netCredit.toFixed(2)) : null;
      const tBuyback = plan?.kind === "CREDIT_SPREAD" ? plan.targetBuyback : null;
      const slBuyback = plan?.kind === "CREDIT_SPREAD" ? plan.stopBuyback : null;

      if (sell && buy) {
        lines.push(`SELL: ${sell.instrument} ${sell.strike} @ ${sell.premium ?? "-"}`);
        lines.push(`BUY:  ${buy.instrument} ${buy.strike} @ ${buy.premium ?? "-"}${qty ? ` | QTY: ${qty}` : ""}`);
      }
      if (credit !== null) {
        lines.push(`CREDIT: ${credit}${tBuyback !== null ? ` | TGT BUYBACK: ${tBuyback}` : ""}${slBuyback !== null ? ` | SL BUYBACK: ${slBuyback}` : ""}`);
      }
    }

    return lines.join("\n");
  }

  private buildStockKey(s: TelegramSignalSnapshot): string {
    const sigs = Array.isArray((s as any).stockSignals) ? ((s as any).stockSignals as any[]) : [];
    const sp = sigs
      .filter((x) => x && String(x.mode ?? "").toUpperCase() === "SPARTAN")
      .sort((a, b) => {
        const ta = typeof a.turnoverCr_1m === "number" ? a.turnoverCr_1m : -1;
        const tb = typeof b.turnoverCr_1m === "number" ? b.turnoverCr_1m : -1;
        return tb - ta;
      })
      .slice(0, 6);

    if (!sp.length) return "NO_SPARTAN";
    return sp
      .map((x) => `${String(x.symbol ?? x.key ?? "-")}:${String(x.label ?? "-")}`)
      .join("|");
  }

  private stockCardLines(s: TelegramSignalSnapshot): string[] {
    const sigs = Array.isArray((s as any).stockSignals) ? ((s as any).stockSignals as any[]) : [];
    const sp = sigs
      .filter((x) => x && String(x.mode ?? "").toUpperCase() === "SPARTAN")
      .sort((a, b) => {
        const ta = typeof a.turnoverCr_1m === "number" ? a.turnoverCr_1m : -1;
        const tb = typeof b.turnoverCr_1m === "number" ? b.turnoverCr_1m : -1;
        return tb - ta;
      })
      .slice(0, 4);

    return sp.map((x) => {
      const sym = String(x.symbol ?? x.key ?? "-");
      const dir = String(x.dir ?? "FLAT").toUpperCase();
      const act = String(x.action ?? "HOLD").toUpperCase();
      const lbl = String(x.label ?? "");
      return `${sym}  [${dir}] ${act}  ${lbl}`.trim();
    });
  }

  async sendText(text: string): Promise<void> {
    if (!this.isConfigured()) {
      // eslint-disable-next-line no-console
      console.error("Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID/TELEGRAM_CHAT_IDS in .env");
      return;
    }

    let anyFailed = false;

    for (const chatId of this.chatIds) {
      const result = await sendTelegramMessage({ token: this.token as string, chatId, text });
      if (!result.ok) {
        anyFailed = true;
        // eslint-disable-next-line no-console
        console.error(`${result.error} (chatId=${chatId})`);
        if (result.responseBody) {
          // eslint-disable-next-line no-console
          console.error(typeof result.responseBody === "string" ? result.responseBody : JSON.stringify(result.responseBody, null, 2));
        }
      }
    }

    if (anyFailed) {
      throw new Error("Telegram send failed (check TELEGRAM_CHAT_ID/TELEGRAM_CHAT_IDS and ensure users started the bot)");
    }
  }

  private buildSignalCardLines(s: TelegramSignalSnapshot): string[] {
    const asof = String(s.asof ?? nowIso());
    const opt = s.options ?? null;
    const decision = opt?.decision ?? null;
    const sug = opt?.suggestion ?? null;
    const plan = opt?.tradePlan ?? null;
    const tradeTf = s.tradeTimeframe ? String(s.tradeTimeframe) : null;
    const action = String(decision?.action ?? "WAIT");
    const dir = dirFromAction(action);

    const lines: string[] = [];
    lines.push(`TRADE SIGNAL  ${asof.slice(11, 19)} IST`);
    lines.push(`TF: ${tradeTf ?? "-"}  DIR: ${dir ?? "-"}  ACTION: ${action}`);

    if (sug?.style === "BUY") {
      const inst = String(sug.instrument ?? "-");
      const entry = plan?.kind === "BUY_PREMIUM" ? plan.entryPremium : typeof sug.premium === "number" ? Number(sug.premium.toFixed(2)) : null;
      const tgt = plan?.kind === "BUY_PREMIUM" ? plan.targetPremium : null;
      const sl = plan?.kind === "BUY_PREMIUM" ? plan.stopPremium : null;
      lines.push(`BUY: ${inst}`);
      if (entry !== null) lines.push(`Entry:${entry}  TGT:${tgt ?? "-"}  SL:${sl ?? "-"}`);
      if (sug.maxLoss != null) lines.push(`Max Loss: ₹${Number(sug.maxLoss).toFixed(0)}`);
    } else if (sug?.style === "CREDIT_SPREAD") {
      const sp = sug.spread;
      const sell = sp?.legs?.sell;
      const buy = sp?.legs?.buy;
      const credit = sp?.netCredit != null ? Number(sp.netCredit.toFixed(2)) : null;
      const tBuyback = plan?.kind === "CREDIT_SPREAD" ? plan.targetBuyback : null;
      const slBuyback = plan?.kind === "CREDIT_SPREAD" ? plan.stopBuyback : null;
      if (sell && buy) {
        lines.push(`SELL: ${sell.instrument} @${sell.premium ?? "-"}`);
        lines.push(`BUY:  ${buy.instrument} @${buy.premium ?? "-"}`);
      }
      if (credit !== null) lines.push(`Credit:${credit}  TGT:${tBuyback ?? "-"}  SL:${slBuyback ?? "-"}`);
      if (sp?.maxLoss != null) lines.push(`Max Loss: ₹${Number(sp.maxLoss).toFixed(0)}`);
    }

    const conf = s.suggestion?.confidence;
    if (conf != null) lines.push(`Confidence: ${(Number(conf) * 100).toFixed(1)}%`);

    // Add top pivot levels relative to current price
    const piv = s.pivotLevels;
    if (piv) {
      const near = ["r2","r1","cpr","s1","s2"].map((k) => piv[k]).filter(Boolean);
      const pivLine = near.map((lv: any) => `${lv.name}:${lv.value.toFixed(0)}(${lv.status})`).join("  ");
      if (pivLine) lines.push(`Levels: ${pivLine}`);
    }

    // RMS context
    const rms = s.rms;
    if (rms?.maxDailyLoss != null) lines.push(`Daily Loss Cap: ₹${rms.maxDailyLoss.toLocaleString()}`);

    return lines;
  }

  async maybeSendSignal(snapshot: TelegramSignalSnapshot): Promise<void> {
    const key = this.buildKey(snapshot);

    if (!this.isConfigured()) {
      if (!this.warnedMissing) {
        this.warnedMissing = true;
        // eslint-disable-next-line no-console
        console.error(
          "Telegram notifier enabled but not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env",
        );
      }
      return;
    }

    if (key === "WAIT") return;

    const now = Date.now();
    if (this.lastKey === key) return;
    if (now - this.lastSentAt < this.minIntervalMs) return;

    const lines = this.buildSignalCardLines(snapshot);
    const action = String(snapshot.options?.decision?.action ?? "TRADE SIGNAL");

    try {
      const png = await renderAlertCardPng({ title: action, lines });
      for (const chatId of this.chatIds) {
        const result = await sendTelegramPhoto({
          token: this.token as string,
          chatId,
          photoPng: png,
          filename: "signal.png",
          caption: lines.slice(0, 2).join(" | "),
        });
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.error(`${result.error} (chatId=${chatId})`);
        }
      }
    } catch {
      // Fallback to plain text if canvas rendering fails.
      const text = this.formatMessage(snapshot);
      for (const chatId of this.chatIds) {
        const result = await sendTelegramMessage({ token: this.token as string, chatId, text });
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.error(result.error);
          if (result.responseBody) {
            // eslint-disable-next-line no-console
            console.error(typeof result.responseBody === "string" ? result.responseBody : JSON.stringify(result.responseBody, null, 2));
          }
        }
      }
    }

    this.lastKey = key;
    this.lastSentAt = now;
  }

  async maybeSendStockFlow(snapshot: TelegramSignalSnapshot): Promise<void> {
    const key = this.buildStockKey(snapshot);
    if (key === "NO_SPARTAN") return;

    if (!this.isConfigured()) {
      if (!this.warnedMissing) {
        this.warnedMissing = true;
        // eslint-disable-next-line no-console
        console.error(
          "Telegram notifier enabled but not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID/TELEGRAM_CHAT_IDS in .env",
        );
      }
      return;
    }

    const now = Date.now();
    if (this.lastStockKey === key) return;
    if (now - this.lastStockSentAt < this.minIntervalMs) return;

    const lines = this.stockCardLines(snapshot);
    if (!lines.length) return;

    try {
      const png = await renderAlertCardPng({ title: "CAUTION", lines });
      for (const chatId of this.chatIds) {
        const result = await sendTelegramPhoto({
          token: this.token as string,
          chatId,
          photoPng: png,
          filename: "spartan.png",
        });
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.error(`${result.error} (chatId=${chatId})`);
          if (result.responseBody) {
            // eslint-disable-next-line no-console
            console.error(typeof result.responseBody === "string" ? result.responseBody : JSON.stringify(result.responseBody, null, 2));
          }
        }
      }
    } catch (e) {
      // Fallback to text-only if rendering fails.
      const text = `SPARTAN ALERT\n` + lines.join("\n");
      for (const chatId of this.chatIds) {
        await sendTelegramMessage({ token: this.token as string, chatId, text });
      }
    }

    this.lastStockKey = key;
    this.lastStockSentAt = now;
  }

  async sendMarketCondition(snapshot: TelegramSignalSnapshot): Promise<void> {
    if (!this.isConfigured()) return;
    const lc = snapshot.lifecycle;
    if (!lc) return;
    if (lc.session === "CLOSED") return;

    const condition = lifecycleToCondition(String(lc.state ?? ""));
    const now = Date.now();

    // Only send if condition changed OR >15 min since last alert for same condition
    if (condition === this.lastCondition && now - this.lastConditionAt < this.conditionDebounceMs) return;

    const b = snapshot.breadth ?? {};
    const params = {
      condition,
      session: String(lc.session ?? "–"),
      rsi1m:  lc.rsi?.m1  ?? null,
      rsi5m:  lc.rsi?.m5  ?? null,
      rsi15m: lc.rsi?.m15 ?? null,
      breadthMove: typeof b.weighted_move_pct === "number" ? b.weighted_move_pct : null,
      advancers:  Number(b.advancers  ?? 0),
      decliners:  Number(b.decliners  ?? 0),
      spartanUp:  Number(lc.spartan?.up ?? 0),
      spartanDn:  Number(lc.spartan?.dn ?? 0),
      scse:       lc.scse ?? null,
      pcr:        snapshot.options?.chain?.totals?.pcr ?? null,
      asof:       String(snapshot.asof ?? nowIso()),
    };

    try {
      const png = await renderMarketConditionCardPng(params);
      const meta = CONDITION_META[condition];
      for (const chatId of this.chatIds) {
        await sendTelegramPhoto({
          token: this.token as string,
          chatId,
          photoPng: png,
          filename: "market.png",
          caption: `${meta.icon} ${meta.label}  ·  ${params.session.replace(/_/g, " ")}`,
        });
      }
    } catch {
      const meta = CONDITION_META[condition];
      const text = `${meta.icon} NIFTY: ${meta.label}\nSession: ${params.session}\nRSI 5m: ${params.rsi5m ?? "–"}  15m: ${params.rsi15m ?? "–"}\nSCSE: ${params.scse ?? "–"}  PCR: ${params.pcr ?? "–"}`;
      for (const chatId of this.chatIds) {
        await sendTelegramMessage({ token: this.token as string, chatId, text });
      }
    }

    this.lastCondition = condition;
    this.lastConditionAt = now;
  }

  async sendPrediction(pred: TelegramPrediction): Promise<void> {
    if (!this.isConfigured()) return;
    if (this.sentPredIds.has(pred.id)) return;
    this.sentPredIds.add(pred.id);
    // Keep set bounded
    if (this.sentPredIds.size > 500) {
      const first = this.sentPredIds.values().next().value;
      if (first !== undefined) this.sentPredIds.delete(first);
    }

    const params = {
      direction:  pred.direction,
      timeframe:  pred.timeframe,
      entryPrice: pred.entryPrice,
      targetPrice: pred.targetPrice,
      stopPrice:  pred.stopPrice,
      confidence: pred.confidence,
      rsi5m:      pred.signals.rsi5m,
      rsi15m:     pred.signals.rsi15m,
      bbPctB5m:   pred.signals.bbPctB5m,
      tfAgree:    pred.signals.tfAgree,
      lifecycle:  pred.lifecycle,
      session:    pred.session,
      asof:       pred.asof,
    };

    const dirLabel = pred.direction === "LONG" ? "▲ LONG" : "▼ SHORT";
    try {
      const png = await renderPredictionCardPng(params);
      for (const chatId of this.chatIds) {
        await sendTelegramPhoto({
          token: this.token as string,
          chatId,
          photoPng: png,
          filename: "prediction.png",
          caption: `${dirLabel}  ·  ${pred.timeframe}  ·  Entry ${pred.entryPrice.toFixed(0)}  TGT ${pred.targetPrice.toFixed(0)}  SL ${pred.stopPrice.toFixed(0)}`,
        });
      }
    } catch {
      const text = `PREDICTION: ${dirLabel} (${pred.timeframe})\nEntry: ${pred.entryPrice}  TGT: ${pred.targetPrice}  SL: ${pred.stopPrice}\nConf: ${Math.round(pred.confidence * 100)}%  RSI 5m: ${pred.signals.rsi5m ?? "–"}  15m: ${pred.signals.rsi15m ?? "–"}\n${pred.lifecycle.replace(/_/g, " ")}`;
      for (const chatId of this.chatIds) {
        await sendTelegramMessage({ token: this.token as string, chatId, text });
      }
    }
  }
}
