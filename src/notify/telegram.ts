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
};

export class TelegramNotifier {
  private readonly token: string | null;
  private readonly chatIds: string[];
  private readonly minIntervalMs: number;
  private lastKey: string | null = null;
  private lastSentAt = 0;
  private lastStockKey: string | null = null;
  private lastStockSentAt = 0;
  private warnedMissing = false;

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
}
