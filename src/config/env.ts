import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

function cleanEnvString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return s.slice(1, -1).trim();
    }
  }
  return s;
}

const envSchema = z.object({
  KITE_API_KEY: z.string().min(1),
  KITE_API_SECRET: z.string().min(1),
  KITE_SESSION_PATH: z.string().min(1).default("data/session.json"),
  KITE_INSTRUMENTS_DIR: z.string().min(1).default("data/instruments"),
  KITE_SNAPSHOTS_PATH: z.string().min(1).default("data/snapshots.json"),

  // Optional: Telegram alerts for signals.
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),
  TELEGRAM_CHAT_IDS: z.string().min(1).optional(),
  TELEGRAM_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse({
  KITE_API_KEY: cleanEnvString(process.env.KITE_API_KEY),
  KITE_API_SECRET: cleanEnvString(process.env.KITE_API_SECRET),
  KITE_SESSION_PATH: cleanEnvString(process.env.KITE_SESSION_PATH) ?? "data/session.json",
  KITE_INSTRUMENTS_DIR: cleanEnvString(process.env.KITE_INSTRUMENTS_DIR) ?? "data/instruments",
  KITE_SNAPSHOTS_PATH: cleanEnvString(process.env.KITE_SNAPSHOTS_PATH) ?? "data/snapshots.json",

  TELEGRAM_BOT_TOKEN: cleanEnvString(process.env.TELEGRAM_BOT_TOKEN),
  TELEGRAM_CHAT_ID: cleanEnvString(process.env.TELEGRAM_CHAT_ID),
  TELEGRAM_CHAT_IDS: cleanEnvString(process.env.TELEGRAM_CHAT_IDS),
  TELEGRAM_MIN_INTERVAL_MS: cleanEnvString(process.env.TELEGRAM_MIN_INTERVAL_MS),
});
