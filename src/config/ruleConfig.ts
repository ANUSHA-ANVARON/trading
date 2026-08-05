/**
 * Rule gate configuration — persisted to data/rule-config.json.
 * Each gate can be disabled (skipped entirely) and its key threshold
 * overridden without touching source code.
 *
 * The engine reads this on every prediction tick so changes take effect
 * immediately without a restart.
 */

import { promises as fs } from "fs";
import * as path from "path";

export type GateOverride = {
  enabled: boolean;
  // Gate-specific threshold params (only the ones that make sense to tune)
  params?: Record<string, number | string | boolean>;
};

export type RuleConfig = {
  updatedAt: string;
  gates: Record<string, GateOverride>;
};

const CONFIG_PATH = path.join(process.cwd(), "data", "rule-config.json");

const DEFAULT_CONFIG: RuleConfig = {
  updatedAt: new Date().toISOString(),
  gates: {
    G0_SESSION:    { enabled: true },
    G1_LIFECYCLE:  { enabled: true },
    G2_TF_AGREE:   { enabled: true,  params: { minAgree: 2 } },
    G3_RSI:        { enabled: true,  params: { longMin5m: 50, longMin15m: 48, shortMax5m: 50, shortMax15m: 52 } },
    G4_BB:         { enabled: true,  params: { longLow: 0.45, longHigh: 0.88, shortLow: 0.12, shortHigh: 0.55 } },
    G5_BREADTH:    { enabled: true,  params: { minMovePct: 0.08, minAdvDec: 1.1, maxAdvDec: 0.91 } },
    G6_PCR:        { enabled: true,  params: { longMax: 1.30, shortMin: 0.70 } },
    G7_IV_SKEW:    { enabled: true,  params: { maxSkew: 0.08 } },
    G8_RSI_EXTEND: { enabled: true,  params: { longMax5m: 68, longMax15m: 65, shortMin5m: 32, shortMin15m: 35 } },
    G9_VWAP:       { enabled: true },
    G10_TREND:     { enabled: true },
    G11_OR_BIAS:   { enabled: true },
    G12_CHASE:     { enabled: true,  params: { maxExtendPct: 0.30 } },
    G13_GLOBAL:    { enabled: true },
    G14_DOMESTIC:  { enabled: true },
  },
};

let _cache: RuleConfig | null = null;
let _cacheReadAt = 0;
const CACHE_TTL_MS = 5_000; // re-read file at most every 5 seconds

export async function readRuleConfig(): Promise<RuleConfig> {
  const now = Date.now();
  if (_cache && now - _cacheReadAt < CACHE_TTL_MS) return _cache;
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuleConfig>;
    const merged: RuleConfig = { ...DEFAULT_CONFIG, ...parsed, gates: { ...DEFAULT_CONFIG.gates, ...(parsed.gates ?? {}) } };
    // Fill in any new gates that weren't in the saved file
    for (const [id, def] of Object.entries(DEFAULT_CONFIG.gates)) {
      if (!merged.gates[id]) merged.gates[id] = def;
    }
    _cache = merged;
  } catch {
    _cache = { ...DEFAULT_CONFIG };
  }
  _cacheReadAt = now;
  return _cache as RuleConfig;
}

export async function writeRuleConfig(config: RuleConfig): Promise<void> {
  config.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  _cache = config;
  _cacheReadAt = Date.now();
}

export function gateEnabled(config: RuleConfig, id: string): boolean {
  return config.gates[id]?.enabled !== false;
}

export function gateParam<T extends number | string | boolean>(
  config: RuleConfig,
  id: string,
  key: string,
  fallback: T
): T {
  const v = config.gates[id]?.params?.[key];
  return v !== undefined ? (v as T) : fallback;
}

// Synchronous version used inside the hot prediction loop — reads from cache only.
// Call readRuleConfig() once per tick before the gate loop to warm the cache.
let _syncCache: RuleConfig = DEFAULT_CONFIG;
export function syncRuleConfig(): RuleConfig { return _syncCache; }
export function updateSyncCache(c: RuleConfig) { _syncCache = c; }
