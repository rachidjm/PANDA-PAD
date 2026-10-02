import type { GeckoOhlcvTimeframe } from "@/lib/gecko/client";
import type { DexPaprikaInterval } from "@/lib/dexpaprika/client";

export const TIMEFRAMES = ["1m", "5m", "1h", "4h", "1d", "1w", "30d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/**
 * Each timeframe's own real request to GeckoTerminal's OHLCV endpoint. Shortest to longest, and each one
 * genuinely covers what its name says (a past bug had "1d" pulling 30 DAYS of daily candles — a "30 days"
 * view mislabeled as "1 day", with no real "last 24h" view at all; fixed by giving every span its own,
 * correctly-sized request instead of reusing one preset for two different meanings).
 */
export const GECKO_PRESETS: Record<Timeframe, { timeframe: GeckoOhlcvTimeframe; aggregate: number; limit: number }> = {
  "1m": { timeframe: "minute", aggregate: 1, limit: 90 }, // ~1.5h
  "5m": { timeframe: "minute", aggregate: 5, limit: 72 }, // ~6h
  "1h": { timeframe: "hour", aggregate: 1, limit: 48 }, // ~2 days
  "4h": { timeframe: "hour", aggregate: 4, limit: 42 }, // ~7 days
  "1d": { timeframe: "minute", aggregate: 15, limit: 96 }, // last 24h, 15-minute candles
  "1w": { timeframe: "hour", aggregate: 1, limit: 168 }, // last 7 days, hourly
  "30d": { timeframe: "day", aggregate: 1, limit: 30 }, // last 30 days, daily
};

/**
 * DexPaprika's free tiers only cover a real subset of our tabs (see dexpaprika/client.ts for the exact,
 * documented limits) — "4h" has no matching interval in its enum, and "30d" needs a paid plan, so neither
 * gets a fallback: an honest "couldn't load" beats a mismatched substitute. `needsKey` tabs only work as a
 * fallback once DEXPAPRIKA_API_KEY is set (optional — see .env.example); without it they're skipped, same
 * as if no fallback existed for them.
 */
export const DEXPAPRIKA_FALLBACKS: Partial<Record<Timeframe, { start: string; interval: DexPaprikaInterval; limit: number; needsKey: boolean }>> = {
  // A past version of this requested "-2d" for the keyless tier, assuming DexPaprika would just trim the
  // window to what it actually has — verified directly against the live API that this is wrong: keyless asking
  // for more than the real 24h depth gets a hard 403 "plan_required", not a trimmed response. Fixed to the
  // real keyless window.
  "1h": { start: "-24h", interval: "1h", limit: 24, needsKey: false },
  "1d": { start: "-24h", interval: "1h", limit: 24, needsKey: false }, // same real 24h window as the Gecko preset, coarser (hourly instead of 15-minute) candles
  "1w": { start: "-7d", interval: "1h", limit: 168, needsKey: true }, // needs a free registered key — keyless tops out at 24h of history
};

/** How long a cached result is served as-is before a fresh upstream call is even tried — short timeframes
 *  move fast and get a short TTL, the slow ones barely change minute to minute. This (not any per-request
 *  logic) is the actual "don't saturate GeckoTerminal/DexPaprika" lever. */
export const FRESH_TTL_MS: Record<Timeframe, number> = {
  "1m": 20_000,
  "5m": 45_000,
  "1h": 180_000,
  "4h": 600_000,
  "1d": 60_000,
  "1w": 600_000,
  "30d": 1_800_000,
};

/** When BOTH the primary and the fallback fail (outage, double rate-limit), a cache entry already past its
 *  fresh TTL is still served as-is rather than showing nothing, up to this much older — real candles a
 *  little behind beat an empty chart. Still the correct timeframe's own data, never another tab's. */
export const STALE_SERVE_EXTRA_MS = 60 * 60_000;
