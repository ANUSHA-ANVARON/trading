import { env } from "../config/env";

function maskToken(token: string): string {
  if (token.length <= 10) return "(set)";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  const text = await res.text();
  const body = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  })();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    (err as any).body = body;
    throw err;
  }
  return body;
}

async function main() {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");
  }

  // eslint-disable-next-line no-console
  console.log(`Using bot token: ${maskToken(token)}`);

  const webhook = await fetchJson(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const webhookUrl = String(webhook?.result?.url ?? "");
  if (webhookUrl) {
    // eslint-disable-next-line no-console
    console.log(`Webhook is set (${webhookUrl}). getUpdates may be empty until webhook is deleted.`);
    // eslint-disable-next-line no-console
    console.log(`Run (in browser): https://api.telegram.org/bot<token>/deleteWebhook?drop_pending_updates=true`);
  }

  const updates = await fetchJson(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=message`);
  const arr: any[] = Array.isArray(updates?.result) ? updates.result : [];

  const chats = new Map<number, any>();
  for (const u of arr) {
    const msg = u?.message;
    const chat = msg?.chat;
    const id = chat?.id;
    if (typeof id !== "number") continue;
    if (!chats.has(id)) chats.set(id, chat);
  }

  if (!chats.size) {
    // eslint-disable-next-line no-console
    console.log("No chats found in getUpdates.");
    // eslint-disable-next-line no-console
    console.log("Make sure you and your friend have opened the bot and sent a message (e.g., 'hi').");
    // eslint-disable-next-line no-console
    console.log("Then run this command again.");
    return;
  }

  // eslint-disable-next-line no-console
  console.log("Chats seen by bot:");
  for (const [id, chat] of chats.entries()) {
    const type = String(chat?.type ?? "");
    const username = chat?.username ? `@${chat.username}` : "";
    const title = chat?.title ? String(chat.title) : "";
    const name = [chat?.first_name, chat?.last_name].filter(Boolean).join(" ");
    // eslint-disable-next-line no-console
    console.log(`- id=${id} type=${type} ${username} ${title || name}`.trim());
  }

  // eslint-disable-next-line no-console
  console.log("\nSet one of these IDs in .env as TELEGRAM_CHAT_ID (single) or TELEGRAM_CHAT_IDS (comma-separated).");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to read chat IDs from Telegram updates.");
  const anyErr = err as any;
  if (anyErr?.body) {
    // eslint-disable-next-line no-console
    console.error(typeof anyErr.body === "string" ? anyErr.body : JSON.stringify(anyErr.body, null, 2));
  }
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
