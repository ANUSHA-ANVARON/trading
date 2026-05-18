import { getArgValue } from "./_args";
import { TelegramNotifier } from "../notify/telegram";

async function main() {
  const text = getArgValue("--text") ?? "Test message from kite-fo-cli (telegram)";
  const telegram = new TelegramNotifier();
  await telegram.sendText(text);
  // eslint-disable-next-line no-console
  console.log("Telegram test sent (check your chats).");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
