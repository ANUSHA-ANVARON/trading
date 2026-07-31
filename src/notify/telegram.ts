import { env } from "../config/env";

type TelegramSendResult =
  | { ok: true; messageId: number | null }
  | { ok: false; error: string; status?: number; responseBody?: unknown };

function nowIso(): string {
  return new Date().toISOString();
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

// Draws the AlgoBot robot-face icon (head, antennae, eyes, smile) using canvas
// primitives — mirrors the bundled algobot-icon.svg template, scaled so its
// 100x112 viewBox fits within `size`.
function drawAlgobotIcon(ctx: any, cx: number, cy: number, size: number, accent: string, alpha: number): void {
  const s = size / 112;
  const X = (x: number) => cx + x * s;
  const Y = (y: number) => cy + (y + 78) * s; // shift so head is vertically centred

  ctx.save();
  ctx.globalAlpha = alpha;

  // Head
  ctx.fillStyle = accent;
  rr(ctx, X(-35), Y(-40), 70 * s, 60 * s, 10 * s);
  ctx.fill();

  // Antennae
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4 * s;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(X(-18), Y(-40)); ctx.lineTo(X(-18), Y(-65)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(X(18), Y(-40)); ctx.lineTo(X(18), Y(-65)); ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.arc(X(-18), Y(-68), 6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(X(18), Y(-68), 6 * s, 0, Math.PI * 2); ctx.fill();

  // Eyes
  ctx.fillStyle = "#04070c";
  ctx.beginPath(); ctx.arc(X(-13), Y(-15), 6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(X(13), Y(-15), 6 * s, 0, Math.PI * 2); ctx.fill();

  // Smile
  ctx.strokeStyle = "#04070c";
  ctx.lineWidth = 4 * s;
  ctx.beginPath();
  ctx.moveTo(X(-16), Y(5));
  ctx.quadraticCurveTo(X(0), Y(18), X(16), Y(5));
  ctx.stroke();

  ctx.restore();
}

// Diagonal background gradients ("colour grading") for each market state,
// echoing the AlgoBot card template's dark gradient look.
const CONDITION_GRADIENT: Record<MarketCondition, { from: string; to: string }> = {
  STRONG_BULLISH: { from: "#123018", to: "#04140a" },
  MILDLY_BULLISH: { from: "#1a2a1f", to: "#0a140d" },
  STRONG_BEARISH: { from: "#301214", to: "#140404" },
  MILDLY_BEARISH: { from: "#2a1518", to: "#140608" },
  NEUTRAL:        { from: "#302510", to: "#140d04" },
};

const ALGOBOT_GOLD = "#d4a574";

// Draws the shared AlgoBot card chrome (matches algobot_telegram_alert_template.svg):
// dark red/black gradient, top accent bar, bot icon, "ALGOBOT" title, a dynamic
// subtitle line, a divider, and the footer wordmark. Caller must wrap in
// ctx.save()/ctx.restore() (this clips to the card's rounded-rect bounds).
// Returns the content-area bounds below the divider for card-specific info.
function drawAlgobotTemplate(ctx: any, font: string, W: number, H: number, subtitle: string): { lx: number; rx: number; top: number; bottom: number } {
  rr(ctx, 0, 0, W, H, 18);
  ctx.clip();

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#3d1a1a");
  bg.addColorStop(1, "#1a0a0a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Top accent bar
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = ALGOBOT_GOLD;
  ctx.fillRect(0, 0, W, 4);
  ctx.globalAlpha = 1;

  // Bot icon
  drawAlgobotIcon(ctx, W / 2, 18, 120, ALGOBOT_GOLD, 1);

  // Title
  ctx.fillStyle = ALGOBOT_GOLD;
  ctx.font = `800 52px "${font}"`;
  ctx.letterSpacing = "2px";
  ctx.textAlign = "center";
  ctx.fillText("ALGOBOT", W / 2, 185);
  ctx.letterSpacing = "0px";

  // Subtitle
  ctx.fillStyle = "#e8d4b8";
  ctx.font = `400 16px "${font}"`;
  ctx.fillText(subtitle, W / 2, 222);
  ctx.textAlign = "left";

  // Divider
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = ALGOBOT_GOLD;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(60, 245); ctx.lineTo(W - 60, 245); ctx.stroke();
  ctx.globalAlpha = 1;

  // Footer
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = "#8b6f47";
  ctx.font = `400 12px "${font}"`;
  ctx.textAlign = "center";
  ctx.fillText("ALGOBOT TRADING INTELLIGENCE", W / 2, H - 28);
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";

  return { lx: 60, rx: W - 60, top: 270, bottom: H - 70 };
}

function toIst(iso: string): string {
  const d = new Date(iso);
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return String(ist.getUTCHours()).padStart(2, "0") + ":" + String(ist.getUTCMinutes()).padStart(2, "0") + " IST";
}

export type MarketCondition = "STRONG_BULLISH" | "MILDLY_BULLISH" | "STRONG_BEARISH" | "MILDLY_BEARISH" | "NEUTRAL";

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
  setupLabel?: string;
  lotSizeRec?: "PERFECT" | "GOOD" | "SMALL";
  partialExits?: Array<{ triggerPct: number; exitPct: number; priceLevel: number }>;
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
  if (state === "CE_EDGE")            return "MILDLY_BULLISH";
  if (state === "CLEAN_BEARISH_FLOW") return "STRONG_BEARISH";
  if (state === "PE_EDGE")            return "MILDLY_BEARISH";
  return "NEUTRAL";
}

const CONDITION_META: Record<MarketCondition, { label: string; icon: string; accent: string }> = {
  STRONG_BULLISH: { label: "STRONG BULLISH",  icon: "▲▲", accent: "#22c55e" },
  MILDLY_BULLISH: { label: "MILDLY BULLISH",  icon: "▲",  accent: "#86efac" },
  STRONG_BEARISH: { label: "STRONG BEARISH",  icon: "▼▼", accent: "#ef4444" },
  MILDLY_BEARISH: { label: "MILDLY BEARISH",  icon: "▼",  accent: "#f87171" },
  NEUTRAL:        { label: "NEUTRAL",          icon: "◆",  accent: "#f59e0b" },
};

async function renderMarketConditionCardPng(params: {
  condition: MarketCondition;
  session: string;
  asof: string;
  spartanUp: number;
  spartanDn: number;
  surfingUp: number;
  surfingDn: number;
  topStocks: Array<{ symbol: string; dir: "UP" | "DOWN" }>;
}): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const font = await ensureFonts();
  const meta = CONDITION_META[params.condition];

  const W = 690;
  const lx = 60, rx = W - 60, mid = (lx + rx) / 2;
  const condH  = 90;
  const flowH  = 100;
  const gap    = 12;
  const stockH = params.topStocks.length > 0 ? params.topStocks.length * 40 + 28 : 0;
  const H = 270 + condH + gap + flowH + (stockH > 0 ? gap + stockH : 0) + 70;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.save();
  drawAlgobotTemplate(ctx, font, W, H, `NIFTY 50  ·  ${params.session.replace(/_/g, " ")}  ·  ${toIst(params.asof)}`);

  // ── Box 1: Market Condition ──────────────────────────────────────────────
  let y = 270;
  rr(ctx, lx, y, rx - lx, condH, 10);
  ctx.fillStyle = "#2a1515"; ctx.fill();
  ctx.globalAlpha = 0.4; ctx.strokeStyle = ALGOBOT_GOLD; ctx.lineWidth = 1; ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = ALGOBOT_GOLD; ctx.font = `600 12px "${font}"`;
  ctx.fillText("MARKET CONDITION", lx + 20, y + 22);

  ctx.fillStyle = meta.accent; ctx.font = `800 40px "${font}"`;
  ctx.textAlign = "center";
  ctx.fillText(`${meta.icon}  ${meta.label}`, W / 2, y + 70);
  ctx.textAlign = "left";

  // ── Box 2: Spartan / Surfing flow ────────────────────────────────────────
  y += condH + gap;
  rr(ctx, lx, y, rx - lx, flowH, 10);
  ctx.fillStyle = "#1a1a2a"; ctx.fill();
  ctx.globalAlpha = 0.4; ctx.strokeStyle = ALGOBOT_GOLD; ctx.lineWidth = 1; ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = ALGOBOT_GOLD; ctx.font = `600 12px "${font}"`;
  ctx.fillText("SPARTAN FLOW", lx + 20, y + 22);
  ctx.fillText("SURFING FLOW",  mid + 20, y + 22);

  ctx.globalAlpha = 0.2; ctx.strokeStyle = ALGOBOT_GOLD; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(mid, y + 10); ctx.lineTo(mid, y + flowH - 10); ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#22c55e"; ctx.font = `700 28px "${font}"`;
  ctx.fillText(`▲  ${params.spartanUp}`, lx + 20, y + 58);
  ctx.fillText(`▲  ${params.surfingUp}`,  mid + 20, y + 58);

  ctx.fillStyle = "#ef4444"; ctx.font = `700 28px "${font}"`;
  ctx.fillText(`▼  ${params.spartanDn}`, lx + 20, y + 92);
  ctx.fillText(`▼  ${params.surfingDn}`,  mid + 20, y + 92);

  // ── Box 3: Top Spartan stocks (only when present) ────────────────────────
  if (params.topStocks.length > 0) {
    y += flowH + gap;
    rr(ctx, lx, y, rx - lx, stockH, 10);
    ctx.fillStyle = "#0d1020"; ctx.fill();
    ctx.globalAlpha = 0.4; ctx.strokeStyle = ALGOBOT_GOLD; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = ALGOBOT_GOLD; ctx.font = `600 12px "${font}"`;
    ctx.fillText("TOP SPARTAN STOCKS", lx + 20, y + 20);

    for (let i = 0; i < params.topStocks.length; i++) {
      const st = params.topStocks[i];
      const sy = y + 28 + i * 40;
      const col = st.dir === "UP" ? "#22c55e" : "#ef4444";
      ctx.fillStyle = "#e8d4b8"; ctx.font = `700 20px "${font}"`;
      ctx.fillText(st.symbol, lx + 20, sy + 24);
      ctx.fillStyle = col; ctx.font = `800 22px "${font}"`;
      ctx.textAlign = "right";
      ctx.fillText(st.dir === "UP" ? "▲" : "▼", rx - 20, sy + 24);
      ctx.textAlign = "left";
      if (i < params.topStocks.length - 1) {
        ctx.globalAlpha = 0.1; ctx.strokeStyle = ALGOBOT_GOLD; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(lx + 10, sy + 34); ctx.lineTo(rx - 10, sy + 34); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  ctx.restore();
  return canvas.toBuffer("image/png");
}

// Renders a SPARTAN stock-flow alert using the shared AlgoBot template, with
// each stock's direction/action coloured (green = bullish, red = bearish).
async function renderSpartanCardPng(stocks: Array<{ symbol: string; dir: string; action: string; label: string }>): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const font = await ensureFonts();

  const W = 690;
  const rowH = 56;
  const top = 270;
  const boxH = Math.max(1, stocks.length) * rowH + 24;
  const H = top + boxH + 90;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.save();
  const { lx, rx } = drawAlgobotTemplate(ctx, font, W, H, "SPARTAN Stock Alert");

  rr(ctx, lx, top, rx - lx, boxH, 10);
  ctx.fillStyle = "#2a1515"; ctx.fill();
  ctx.globalAlpha = 0.4; ctx.strokeStyle = ALGOBOT_GOLD; ctx.lineWidth = 1; ctx.stroke();
  ctx.globalAlpha = 1;

  for (let i = 0; i < stocks.length; i++) {
    const st = stocks[i];
    const isUp = st.dir === "LONG" || st.action === "BUY";
    const isDown = st.dir === "SHORT" || st.action === "SELL";
    const color = isUp ? "#22c55e" : isDown ? "#ef4444" : "#e8d4b8";
    const y = top + 12 + i * rowH;

    ctx.fillStyle = "#e8d4b8"; ctx.font = `700 22px "${font}"`;
    ctx.fillText(st.symbol, lx + 20, y + 26);

    ctx.fillStyle = color; ctx.font = `700 20px "${font}"`;
    ctx.textAlign = "right";
    ctx.fillText(`${st.dir}  ${st.action}`, rx - 20, y + 26);
    ctx.textAlign = "left";

    if (st.label) {
      ctx.fillStyle = "#b8a080"; ctx.font = `400 13px "${font}"`;
      ctx.fillText(st.label, lx + 20, y + 46);
    }

    if (i < stocks.length - 1) {
      ctx.globalAlpha = 0.15; ctx.strokeStyle = ALGOBOT_GOLD; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx + 12, y + rowH - 6); ctx.lineTo(rx - 12, y + rowH - 6); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
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
  setupLabel?: string;
  lotSizeRec?: "PERFECT" | "GOOD" | "SMALL";
  partialExits?: Array<{ triggerPct: number; exitPct: number; priceLevel: number }>;
}): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const font = await ensureFonts();
  const isLong = params.direction === "LONG";
  const accent = isLong ? "#22c55e" : "#ef4444";

  const hasPartials = (params.partialExits?.length ?? 0) > 0;
  const W = 820, H = hasPartials ? 510 : 440;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Bg + panel
  ctx.fillStyle = "#050810"; ctx.fillRect(0, 0, W, H);
  const pX = 12, pY = 10, pW = W - 24, pH = H - 20;
  const cardGrad = isLong ? CONDITION_GRADIENT.STRONG_BULLISH : CONDITION_GRADIENT.STRONG_BEARISH;

  // ── Branded panel: diagonal colour-graded background + AlgoBot icon ──────
  ctx.save();
  rr(ctx, pX, pY, pW, pH, 18); ctx.clip();
  const bgGrad = ctx.createLinearGradient(pX, pY, pX + pW, pY + pH);
  bgGrad.addColorStop(0, cardGrad.from);
  bgGrad.addColorStop(1, cardGrad.to);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(pX, pY, pW, pH);
  const hdrGrad = ctx.createLinearGradient(pX, pY, pX + pW, pY + 150);
  hdrGrad.addColorStop(0, accent + "30");
  hdrGrad.addColorStop(0.6, accent + "0c");
  hdrGrad.addColorStop(1, accent + "00");
  ctx.fillStyle = hdrGrad;
  ctx.fillRect(pX, pY, pW, 150);
  drawAlgobotIcon(ctx, pX + pW - 44, pY + pH - 38, 80, accent, 0.14);
  ctx.restore();

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

  // Session + lifecycle + lot size line
  const lotCol = params.lotSizeRec === "PERFECT" ? "#22c55e" : params.lotSizeRec === "GOOD" ? "#f59e0b" : "#9ca3af";
  ctx.fillStyle = "#6b7280"; ctx.font = `500 13px "${font}"`;
  ctx.fillText(params.session.replace(/_/g, " ") + "   ·   " + params.lifecycle.replace(/_/g, " "), lx, pY + 115);
  if (params.lotSizeRec) {
    ctx.fillStyle = lotCol; ctx.font = `700 13px "${font}"`;
    ctx.textAlign = "right"; ctx.fillText(`${params.lotSizeRec} SIZE`, rx, pY + 115); ctx.textAlign = "left";
  }
  // Setup label (abbreviated — skip dir + session prefix which are shown elsewhere)
  if (params.setupLabel) {
    const labelParts = params.setupLabel.split(" · ").slice(2).join(" · ");
    ctx.fillStyle = "#4b5563"; ctx.font = `400 11px "${font}"`;
    ctx.fillText(labelParts, lx, pY + 132);
  }

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

  // ── Partial exit chips (shown when available) ─────────────────────────────
  if (hasPartials && params.partialExits) {
    const pexY = pY + 388;
    ctx.fillStyle = "#4b5563"; ctx.font = `600 11px "${font}"`;
    ctx.fillText("PARTIAL EXITS", lx, pexY);
    const chipW = (barTotalW - (params.partialExits.length - 1) * 8) / params.partialExits.length;
    params.partialExits.forEach((pe, i) => {
      const cx5 = lx + i * (chipW + 8);
      const chipY = pexY + 8;
      const chipH = 52;
      rr(ctx, cx5, chipY, chipW, chipH, 8);
      ctx.fillStyle = "#0d1117"; ctx.fill();
      ctx.strokeStyle = accent + "33"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#4b5563"; ctx.font = `500 10px "${font}"`;
      ctx.fillText(`${pe.triggerPct}% progress → exit ${pe.exitPct}%`, cx5 + 10, chipY + 18);
      ctx.fillStyle = accent; ctx.font = `700 18px "${font}"`;
      ctx.fillText(pe.priceLevel.toFixed(0), cx5 + 10, chipY + 42);
    });
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
  private lastStockKey: string | null = null;
  private lastStockSentAt = 0;
  private warnedMissing = false;

  // Market condition tracking — only fires on state change to STRONG_BULLISH or STRONG_BEARISH
  private lastSentCondition: MarketCondition | null = null;

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

  private stockAlertRows(s: TelegramSignalSnapshot): Array<{ symbol: string; dir: string; action: string; label: string }> {
    const sigs = Array.isArray((s as any).stockSignals) ? ((s as any).stockSignals as any[]) : [];
    const sp = sigs
      .filter((x) => x && String(x.mode ?? "").toUpperCase() === "SPARTAN")
      .sort((a, b) => {
        const ta = typeof a.turnoverCr_1m === "number" ? a.turnoverCr_1m : -1;
        const tb = typeof b.turnoverCr_1m === "number" ? b.turnoverCr_1m : -1;
        return tb - ta;
      })
      .slice(0, 4);

    return sp.map((x) => ({
      symbol: String(x.symbol ?? x.key ?? "-"),
      dir: String(x.dir ?? "FLAT").toUpperCase(),
      action: String(x.action ?? "HOLD").toUpperCase(),
      label: String(x.label ?? ""),
    }));
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

  async maybeSendSignal(_snapshot: TelegramSignalSnapshot): Promise<void> {
    // Trading Alert cards (BUY CALL/PUT, SELL PUT/CALL SPREAD) are disabled.
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

    const rows = this.stockAlertRows(snapshot);
    if (!rows.length) return;

    try {
      const png = await renderSpartanCardPng(rows);
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
      const text = `SPARTAN ALERT\n` + rows.map((x) => `${x.symbol}  [${x.dir}] ${x.action}  ${x.label}`.trim()).join("\n");
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

    // Only alert for strong states — ignore MILDLY_BULLISH, MILDLY_BEARISH, and NEUTRAL
    if (condition !== "STRONG_BULLISH" && condition !== "STRONG_BEARISH") return;

    // Fire only on state change — never re-fire for the same state
    if (condition === this.lastSentCondition) return;

    // Extract Spartan/Surfing data from snapshot
    const sigs = Array.isArray((snapshot as any).stockSignals)
      ? ((snapshot as any).stockSignals as any[])
      : [];
    const spartanUp  = sigs.filter((x: any) => x?.label === "SPARTAN_UP").length;
    const spartanDn  = sigs.filter((x: any) => x?.label === "SPARTAN_DN").length;
    const surfingUp  = sigs.filter((x: any) => x?.label === "SURFINGUP").length;
    const surfingDn  = sigs.filter((x: any) => x?.label === "SURFINGDN").length;
    const topStocks  = sigs
      .filter((x: any) => x?.mode === "SPARTAN" && (x?.label === "SPARTAN_UP" || x?.label === "SPARTAN_DN"))
      .sort((a: any, b: any) => (Number(b?.turnoverCr_1m) || 0) - (Number(a?.turnoverCr_1m) || 0))
      .slice(0, 4)
      .map((x: any) => ({
        symbol: String(x.symbol ?? x.key ?? "–"),
        dir: (x.label === "SPARTAN_UP" ? "UP" : "DOWN") as "UP" | "DOWN",
      }));

    const session = String(lc.session ?? "–");
    const asof    = String(snapshot.asof ?? nowIso());

    try {
      const png = await renderMarketConditionCardPng({
        condition, session, asof,
        spartanUp, spartanDn, surfingUp, surfingDn, topStocks,
      });
      const meta = CONDITION_META[condition];
      for (const chatId of this.chatIds) {
        await sendTelegramPhoto({
          token: this.token as string,
          chatId,
          photoPng: png,
          filename: "market.png",
          caption: `${meta.icon} ${meta.label}  ·  ${session.replace(/_/g, " ")}  ·  Spartan ▲${spartanUp} ▼${spartanDn}`,
        });
      }
    } catch {
      const meta = CONDITION_META[condition];
      const text = [
        `${meta.icon} NIFTY: ${meta.label}`,
        `Session: ${session}`,
        `Spartan  ▲ ${spartanUp}  ▼ ${spartanDn}    Surfing  ▲ ${surfingUp}  ▼ ${surfingDn}`,
        topStocks.length ? topStocks.map(s => `${s.symbol} ${s.dir === "UP" ? "▲" : "▼"}`).join("  ") : "",
      ].filter(Boolean).join("\n");
      for (const chatId of this.chatIds) {
        await sendTelegramMessage({ token: this.token as string, chatId, text });
      }
    }

    this.lastSentCondition = condition;
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
      setupLabel:   pred.setupLabel,
      lotSizeRec:   pred.lotSizeRec,
      partialExits: pred.partialExits,
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
