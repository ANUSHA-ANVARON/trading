import { env } from "../config/env";
import { readJsonIfExists } from "../storage/session";

export type KiteTickerInstance = any;

function loadKiteTickerCtor(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("kiteconnect");
  return mod.KiteTicker ?? mod.Ticker ?? mod;
}

export async function createKiteTicker(): Promise<KiteTickerInstance> {
  const session = await readJsonIfExists<{ accessToken: string }>(env.KITE_SESSION_PATH);
  if (!session?.accessToken) {
    throw new Error("Missing access token. Run: npm run session:generate -- --request_token <TOKEN>");
  }

  const KiteTicker = loadKiteTickerCtor();
  const ticker = new KiteTicker({ api_key: env.KITE_API_KEY, access_token: session.accessToken });
  return ticker;
}
