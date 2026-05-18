import { env } from "../config/env";
import { writeJson } from "../storage/session";

export function getLoginUrl(): string {
  // Login URL does not require access token
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("kiteconnect");
  const KiteConnect = mod.KiteConnect ?? mod;
  const kite = new KiteConnect({ api_key: env.KITE_API_KEY });
  return kite.getLoginURL();
}

export async function generateAndStoreSession(requestToken: string): Promise<void> {
  // Ensure session generation does not depend on (or get confused by) any existing
  // access token that might be present on disk (e.g., expired token from a prior day).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("kiteconnect");
  const KiteConnect = mod.KiteConnect ?? mod;
  const kite = new KiteConnect({ api_key: env.KITE_API_KEY });

  const response = await kite.generateSession(requestToken, env.KITE_API_SECRET);
  const accessToken: string | undefined = response?.access_token;
  const publicToken: string | undefined = response?.public_token;
  const userId: string | undefined = response?.user_id;

  if (!accessToken) {
    throw new Error("Kite generateSession did not return access_token");
  }

  await writeJson(env.KITE_SESSION_PATH, {
    accessToken,
    publicToken,
    userId,
    createdAt: new Date().toISOString(),
  });
}
