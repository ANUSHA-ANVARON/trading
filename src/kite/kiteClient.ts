import { env } from "../config/env";
import { readJsonIfExists } from "../storage/session";

export type KiteConnectInstance = any;

function loadKiteConnectCtor(): any {
  // kiteconnect is published as CommonJS in many setups.
  // Using require keeps it compatible with tsx + commonjs.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("kiteconnect");
  return mod.KiteConnect ?? mod;
}

export async function createKiteClient(): Promise<KiteConnectInstance> {
  const KiteConnect = loadKiteConnectCtor();
  const kite: KiteConnectInstance = new KiteConnect({ api_key: env.KITE_API_KEY });

  // KITE_ACCESS_TOKEN env var takes priority — useful for Railway/cloud where
  // you update it daily in the environment dashboard instead of using session.json.
  const envToken = process.env.KITE_ACCESS_TOKEN;
  if (envToken && envToken.trim()) {
    kite.setAccessToken(envToken.trim());
    return kite;
  }

  const session = await readJsonIfExists<{ accessToken: string }>(env.KITE_SESSION_PATH);
  if (session?.accessToken) {
    kite.setAccessToken(session.accessToken);
  }

  return kite;
}
