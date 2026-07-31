/**
 * Automates the daily Kite Connect login using user_id + password + TOTP.
 *
 * Reads env vars:  KITE_USER_ID, KITE_PASSWORD, KITE_TOTP_SECRET
 *                  KITE_API_KEY, KITE_API_SECRET (from config/env)
 * Writes:          data/session.json  (same file as manual session:generate)
 *
 * Run standalone:  npm run session:auto
 * Or imported:     await runAutoSession()
 */

import { createHmac } from "crypto";
import { generateAndStoreSession } from "../kite/auth";
import { env } from "../config/env";

// ── TOTP (RFC 6238) — no external deps ────────────────────────────────────

function base32Decode(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.toUpperCase().replace(/[\s=]+/g, "");
  let bits = 0, value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function computeTotp(secret: string, digits = 6, period = 30): string {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

// ── Cookie jar helpers ─────────────────────────────────────────────────────

function mergeSetCookies(res: Response, jar: string[]): string[] {
  const fresh: string[] =
    (res.headers as any).getSetCookie?.() ??
    (res.headers.get("set-cookie") ?? "")
      .split(/,(?=[^ ].*?=)/)
      .map((s: string) => s.trim())
      .filter(Boolean);

  const map = new Map<string, string>();
  for (const c of [...jar, ...fresh]) {
    const pair = c.split(";")[0].trim();
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`);
}

function cookieHeader(jar: string[]): string {
  return jar.map(c => c.split(";")[0]).join("; ");
}

// ── Step 3: follow redirects until we land on the redirect_uri ─────────────

async function extractRequestToken(jar: string[], apiKey: string): Promise<string> {
  // Note: skip_session=1 was removed — Kite deprecated it and now returns 400.
  // We already have a valid session cookie from steps 1+2, so it isn't needed.
  let url = `https://kite.zerodha.com/connect/login?v=3&api_key=${apiKey}`;

  for (let hop = 0; hop < 8; hop++) {
    console.error(`[auto-session] hop ${hop}: GET ${url}`);
    const res = await fetch(url, {
      headers: {
        Cookie: cookieHeader(jar),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "manual",
    });
    jar = mergeSetCookies(res, jar);
    console.error(`[auto-session] hop ${hop}: status ${res.status}`);

    const location = res.headers.get("location");

    if (!location) {
      // Non-redirect response — read body for diagnostics
      const body = await res.text().catch(() => "(unreadable)");
      throw new Error(
        `No redirect at hop ${hop} (status ${res.status}) from: ${url}\nBody: ${body.slice(0, 500)}`
      );
    }

    console.error(`[auto-session] hop ${hop}: → ${location}`);

    // Once the redirect leaves kite.zerodha.com the request_token is in the URL
    if (!location.includes("kite.zerodha.com")) {
      let parsed: URL;
      try { parsed = new URL(location); }
      catch { throw new Error(`Unparseable redirect URL: ${location}`); }
      const token = parsed.searchParams.get("request_token");
      if (!token) throw new Error(`No request_token found in redirect: ${location}`);
      return token;
    }

    url = location.startsWith("http") ? location : `https://kite.zerodha.com${location}`;
  }

  throw new Error("Too many redirects while fetching request_token");
}

// ── Main flow ──────────────────────────────────────────────────────────────

export async function runAutoSession(): Promise<void> {
  const userId = process.env.KITE_USER_ID?.trim();
  const password = process.env.KITE_PASSWORD?.trim();
  const totpSecret = process.env.KITE_TOTP_SECRET?.trim();

  if (!userId || !password || !totpSecret) {
    throw new Error(
      "KITE_USER_ID, KITE_PASSWORD, and KITE_TOTP_SECRET must all be set in .env to use auto-session"
    );
  }

  // Step 1 — login with user_id + password
  const loginRes = await fetch("https://kite.zerodha.com/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user_id: userId, password }),
  });
  let jar = mergeSetCookies(loginRes, []);
  const loginJson = await loginRes.json() as any;
  if (loginJson.status !== "success") {
    throw new Error(`Kite login failed: ${loginJson.message ?? JSON.stringify(loginJson)}`);
  }
  const requestId: string = loginJson.data.request_id;
  console.error("[auto-session] login OK, request_id:", requestId);

  // Step 2 — submit TOTP
  const totpCode = computeTotp(totpSecret);
  console.error("[auto-session] TOTP:", totpCode);
  const twoRes = await fetch("https://kite.zerodha.com/api/twofa", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({
      user_id: userId,
      request_id: requestId,
      twofa_value: totpCode,
      twofa_type: "totp",
    }),
    redirect: "manual",
  });
  jar = mergeSetCookies(twoRes, jar);
  if (twoRes.status !== 200 && twoRes.status !== 302) {
    const body = await twoRes.text();
    throw new Error(`2FA failed (HTTP ${twoRes.status}): ${body}`);
  }
  console.error("[auto-session] 2FA OK");

  // Step 3 — follow Kite Connect redirect to capture request_token
  const requestToken = await extractRequestToken(jar, env.KITE_API_KEY);
  console.error("[auto-session] request_token acquired");

  // Step 4 — exchange for access_token and write session.json
  await generateAndStoreSession(requestToken);
  console.error("[auto-session] session saved ✅");
}

// ── CLI entry ──────────────────────────────────────────────────────────────
async function main() {
  await runAutoSession();
  console.log("Kite session auto-generated successfully.");
}

main().catch((err) => {
  console.error("[auto-session] FAILED:", (err as Error).message);
  process.exit(1);
});
