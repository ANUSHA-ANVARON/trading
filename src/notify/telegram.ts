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

async function renderAlertCardPng(params: { title: string; lines: string[] }): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");

  const width = 820;
  const paddingX = 26;
  const paddingY = 22;
  const lineH = 28;
  const titleH = 42;
  const height = paddingY * 2 + titleH + Math.max(1, params.lines.length) * lineH;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, width, height);

  // Panel
  const r = 18;
  const panelX = 16;
  const panelY = 12;
  const panelW = width - 32;
  const panelH = height - 24;

  const roundRect = (x: number, y: number, w: number, h: number, rad: number) => {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  };

  roundRect(panelX, panelY, panelW, panelH, r);
  ctx.fillStyle = "#0c0f16";
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = "#b48a1a";
  ctx.stroke();

  // Title + icon
  const iconX = panelX + paddingX;
  const iconY = panelY + paddingY + 6;
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.moveTo(iconX + 12, iconY);
  ctx.lineTo(iconX + 24, iconY + 22);
  ctx.lineTo(iconX, iconY + 22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.font = "bold 14px system-ui, Segoe UI, Arial";
  ctx.fillText("!", iconX + 9.5, iconY + 17);

  ctx.fillStyle = "#fbbf24";
  ctx.font = "800 28px system-ui, Segoe UI, Arial";
  ctx.fillText(params.title.toUpperCase(), iconX + 36, panelY + paddingY + 28);

  // Lines
  ctx.fillStyle = "#e8ecf6";
  ctx.font = "700 20px system-ui, Segoe UI, Arial";
  const startY = panelY + paddingY + titleH;
  for (let i = 0; i < params.lines.length; i++) {
    ctx.fillText(params.lines[i], panelX + paddingX, startY + i * lineH + 10);
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
  const meta = CONDITION_META[params.condition];
  const W = 820, H = 320, pad = 24;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#05060a"; ctx.fillRect(0, 0, W, H);

  // Panel
  const pX = 14, pY = 10, pW = W - 28, pH = H - 20, r = 16;
  ctx.beginPath();
  ctx.moveTo(pX + r, pY); ctx.lineTo(pX + pW - r, pY);
  ctx.quadraticCurveTo(pX + pW, pY, pX + pW, pY + r);
  ctx.lineTo(pX + pW, pY + pH - r); ctx.quadraticCurveTo(pX + pW, pY + pH, pX + pW - r, pY + pH);
  ctx.lineTo(pX + r, pY + pH); ctx.quadraticCurveTo(pX, pY + pH, pX, pY + pH - r);
  ctx.lineTo(pX, pY + r); ctx.quadraticCurveTo(pX, pY, pX + r, pY);
  ctx.closePath();
  ctx.fillStyle = meta.panelBg; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = meta.accent; ctx.stroke();

  // Top accent strip
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pX + r, pY); ctx.lineTo(pX + pW - r, pY);
  ctx.quadraticCurveTo(pX + pW, pY, pX + pW, pY + r);
  ctx.lineTo(pX + pW, pY + 8);
  ctx.lineTo(pX, pY + 8);
  ctx.lineTo(pX, pY + r);
  ctx.quadraticCurveTo(pX, pY, pX + r, pY);
  ctx.closePath();
  ctx.fillStyle = meta.accent; ctx.fill();
  ctx.restore();

  const tX = pX + pad;

  // Header label
  ctx.fillStyle = "#9ca3af"; ctx.font = "600 13px system-ui, Segoe UI, Arial";
  ctx.fillText("NIFTY 50  ·  MARKET CONDITION", tX, pY + 40);

  // Time (right aligned)
  const d = new Date(params.asof);
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const timeStr = String(ist.getUTCHours()).padStart(2, "0") + ":" + String(ist.getUTCMinutes()).padStart(2, "0") + " IST";
  ctx.fillStyle = "#6b7280"; ctx.font = "500 12px system-ui, Segoe UI, Arial";
  ctx.textAlign = "right";
  ctx.fillText(timeStr, pX + pW - pad, pY + 40);
  ctx.textAlign = "left";

  // Big condition text
  ctx.fillStyle = meta.accent; ctx.font = `900 44px system-ui, Segoe UI, Arial`;
  ctx.fillText(meta.icon + "  " + meta.label, tX, pY + 90);

  // Session
  ctx.fillStyle = "#9ca3af"; ctx.font = "500 15px system-ui, Segoe UI, Arial";
  ctx.fillText(params.session.replace(/_/g, " "), tX, pY + 116);

  // Separator
  ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tX, pY + 130); ctx.lineTo(pX + pW - pad, pY + 130); ctx.stroke();

  // Metric chips — two rows of 4
  const chips: Array<{ label: string; value: string; color?: string }> = [
    { label: "RSI 1m",   value: params.rsi1m  != null ? params.rsi1m.toFixed(1)  : "–", color: params.rsi1m  != null ? (params.rsi1m  > 55 ? "#22c55e" : params.rsi1m  < 45 ? "#ef4444" : "#e8ecf6") : "#6b7280" },
    { label: "RSI 5m",   value: params.rsi5m  != null ? params.rsi5m.toFixed(1)  : "–", color: params.rsi5m  != null ? (params.rsi5m  > 55 ? "#22c55e" : params.rsi5m  < 45 ? "#ef4444" : "#e8ecf6") : "#6b7280" },
    { label: "RSI 15m",  value: params.rsi15m != null ? params.rsi15m.toFixed(1) : "–", color: params.rsi15m != null ? (params.rsi15m > 55 ? "#22c55e" : params.rsi15m < 45 ? "#ef4444" : "#e8ecf6") : "#6b7280" },
    { label: "SCSE",     value: params.scse   != null ? String(params.scse)       : "–", color: params.scse   != null ? (params.scse   >= 65 ? "#22c55e" : params.scse   <= 35 ? "#ef4444" : "#e8ecf6") : "#6b7280" },
    { label: "Breadth",  value: params.breadthMove != null ? (params.breadthMove >= 0 ? "+" : "") + params.breadthMove.toFixed(2) + "%" : "–", color: params.breadthMove != null ? (params.breadthMove > 0 ? "#22c55e" : params.breadthMove < 0 ? "#ef4444" : "#e8ecf6") : "#6b7280" },
    { label: "Adv / Dec", value: `${params.advancers} / ${params.decliners}`, color: params.advancers > params.decliners ? "#22c55e" : params.decliners > params.advancers ? "#ef4444" : "#e8ecf6" },
    { label: "Spartan",  value: `↑${params.spartanUp} ↓${params.spartanDn}`, color: params.spartanUp > params.spartanDn ? "#22c55e" : params.spartanDn > params.spartanUp ? "#ef4444" : "#e8ecf6" },
    { label: "PCR",      value: params.pcr != null ? params.pcr.toFixed(2) : "–", color: params.pcr != null ? (params.pcr > 1.1 ? "#22c55e" : params.pcr < 0.9 ? "#ef4444" : "#e8ecf6") : "#6b7280" },
  ];

  const chipW = (pW - pad * 2 - 14) / 4;
  const row1Y = pY + 148, row2Y = pY + 218;

  for (let i = 0; i < chips.length; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const cx2 = tX + col * (chipW + 4);
    const cy2 = row === 0 ? row1Y : row2Y;

    // Chip bg
    ctx.fillStyle = "#111827";
    ctx.beginPath(); ctx.roundRect(cx2, cy2, chipW, 58, 8); ctx.fill();

    ctx.fillStyle = "#6b7280"; ctx.font = "500 11px system-ui, Segoe UI, Arial";
    ctx.fillText(chips[i].label, cx2 + 10, cy2 + 18);
    ctx.fillStyle = chips[i].color ?? "#e8ecf6"; ctx.font = `700 22px system-ui, Segoe UI, Arial`;
    ctx.fillText(chips[i].value, cx2 + 10, cy2 + 46);
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
  const isLong = params.direction === "LONG";
  const accent = isLong ? "#22c55e" : "#ef4444";
  const panelBg = isLong ? "#08130a" : "#150808";
  const W = 820, H = 300, pad = 24;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#05060a"; ctx.fillRect(0, 0, W, H);

  // Panel
  const pX = 14, pY = 10, pW = W - 28, pH = H - 20, r = 16;
  ctx.beginPath();
  ctx.moveTo(pX + r, pY); ctx.lineTo(pX + pW - r, pY);
  ctx.quadraticCurveTo(pX + pW, pY, pX + pW, pY + r);
  ctx.lineTo(pX + pW, pY + pH - r); ctx.quadraticCurveTo(pX + pW, pY + pH, pX + pW - r, pY + pH);
  ctx.lineTo(pX + r, pY + pH); ctx.quadraticCurveTo(pX, pY + pH, pX, pY + pH - r);
  ctx.lineTo(pX, pY + r); ctx.quadraticCurveTo(pX, pY, pX + r, pY);
  ctx.closePath();
  ctx.fillStyle = panelBg; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = accent; ctx.stroke();

  // Accent top strip
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pX + r, pY); ctx.lineTo(pX + pW - r, pY);
  ctx.quadraticCurveTo(pX + pW, pY, pX + pW, pY + r);
  ctx.lineTo(pX + pW, pY + 8); ctx.lineTo(pX, pY + 8);
  ctx.lineTo(pX, pY + r); ctx.quadraticCurveTo(pX, pY, pX + r, pY);
  ctx.closePath();
  ctx.fillStyle = accent; ctx.fill();
  ctx.restore();

  const tX = pX + pad;

  // Header: direction + TF + TF count
  ctx.fillStyle = "#9ca3af"; ctx.font = "600 13px system-ui, Segoe UI, Arial";
  ctx.fillText("PREDICTION ENGINE  ·  NIFTY 50", tX, pY + 40);

  const d = new Date(params.asof);
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const timeStr = String(ist.getUTCHours()).padStart(2, "0") + ":" + String(ist.getUTCMinutes()).padStart(2, "0") + " IST";
  ctx.fillStyle = "#6b7280"; ctx.font = "500 12px system-ui, Segoe UI, Arial";
  ctx.textAlign = "right"; ctx.fillText(timeStr, pX + pW - pad, pY + 40); ctx.textAlign = "left";

  // Big direction text
  ctx.fillStyle = accent; ctx.font = `900 46px system-ui, Segoe UI, Arial`;
  ctx.fillText((isLong ? "▲  LONG" : "▼  SHORT") + `  ·  ${params.timeframe}  ·  ${params.tfAgree}/3 TFs`, tX, pY + 92);

  // Session + lifecycle
  ctx.fillStyle = "#9ca3af"; ctx.font = "500 13px system-ui, Segoe UI, Arial";
  ctx.fillText(params.session.replace(/_/g, " ") + "  ·  " + params.lifecycle.replace(/_/g, " "), tX, pY + 116);

  // Separator
  ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tX, pY + 130); ctx.lineTo(pX + pW - pad, pY + 130); ctx.stroke();

  // Three big price boxes: ENTRY | TARGET | STOP
  const boxW = (pW - pad * 2 - 16) / 3;
  const boxes = [
    { label: "ENTRY",  value: params.entryPrice.toFixed(2),  color: "#e8ecf6",    bg: "#111827" },
    { label: "TARGET", value: params.targetPrice.toFixed(2), color: "#22c55e",    bg: "#0a1a0e" },
    { label: "STOP",   value: params.stopPrice.toFixed(2),   color: "#ef4444",    bg: "#1a0a0a" },
  ];

  const boxY = pY + 142;
  for (let i = 0; i < 3; i++) {
    const bx = tX + i * (boxW + 8);
    ctx.fillStyle = boxes[i].bg;
    ctx.beginPath(); ctx.roundRect(bx, boxY, boxW, 68, 8); ctx.fill();
    ctx.fillStyle = "#6b7280"; ctx.font = "700 11px system-ui, Segoe UI, Arial";
    ctx.fillText(boxes[i].label, bx + 12, boxY + 18);
    ctx.fillStyle = boxes[i].color; ctx.font = `700 28px system-ui, Segoe UI, Arial`;
    ctx.fillText(boxes[i].value, bx + 12, boxY + 52);
  }

  // Bottom row of indicator chips
  const conf = Math.round(params.confidence * 100);
  const chips2 = [
    { label: "Confidence", value: conf + "%", color: conf >= 70 ? "#22c55e" : conf >= 50 ? "#f59e0b" : "#9ca3af" },
    { label: "RSI 5m",  value: params.rsi5m  != null ? params.rsi5m.toFixed(0)           : "–", color: params.rsi5m  != null ? (params.rsi5m  > 55 ? "#22c55e" : params.rsi5m  < 45 ? "#ef4444" : "#e8ecf6") : "#6b7280" },
    { label: "RSI 15m", value: params.rsi15m != null ? params.rsi15m.toFixed(0)           : "–", color: params.rsi15m != null ? (params.rsi15m > 55 ? "#22c55e" : params.rsi15m < 45 ? "#ef4444" : "#e8ecf6") : "#6b7280" },
    { label: "BB %B 5m", value: params.bbPctB5m != null ? Math.round(params.bbPctB5m * 100) + "%" : "–", color: "#e8ecf6" },
  ];

  const chipW2 = (pW - pad * 2 - 12) / 4;
  const chipY = pY + 222;
  for (let i = 0; i < chips2.length; i++) {
    const cx2 = tX + i * (chipW2 + 4);
    ctx.fillStyle = "#111827";
    ctx.beginPath(); ctx.roundRect(cx2, chipY, chipW2, 48, 8); ctx.fill();
    ctx.fillStyle = "#6b7280"; ctx.font = "500 11px system-ui, Segoe UI, Arial";
    ctx.fillText(chips2[i].label, cx2 + 10, chipY + 16);
    ctx.fillStyle = chips2[i].color; ctx.font = `700 19px system-ui, Segoe UI, Arial`;
    ctx.fillText(chips2[i].value, cx2 + 10, chipY + 38);
  }

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
