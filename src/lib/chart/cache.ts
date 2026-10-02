import { getRedis } from "@/lib/rate-limit";
import { FRESH_TTL_MS, STALE_SERVE_EXTRA_MS, type Timeframe } from "./config";

/**
 * Per (pool, timeframe) candle cache in Upstash — the real reason GeckoTerminal and the DexPaprika fallback
 * don't get hammered: most requests for a coin's chart are served straight from here, never touching either
 * upstream. Same reasoning as RugCheck's badge cache and the holder-count cache (src/lib/pump/holders-count.ts):
 * many people look at the same coin/tab, so this stays cheap either way.
 */

export type ChartCandle = { time: number; close: number };
type CacheEntry = { candles: ChartCandle[]; fetchedAt: number; source: "gecko" | "dexpaprika" };

const KEY = (pool: string, tf: Timeframe) => `panda:chart:v1:${pool}:${tf}`;

export async function getChartCache(pool: string, tf: Timeframe): Promise<CacheEntry | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const entry = await redis.get<CacheEntry>(KEY(pool, tf));
    return entry ?? null;
  } catch {
    return null;
  }
}

export async function setChartCache(pool: string, tf: Timeframe, entry: CacheEntry): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const exSeconds = Math.ceil((FRESH_TTL_MS[tf] + STALE_SERVE_EXTRA_MS) / 1000);
    await redis.set(KEY(pool, tf), entry, { ex: exSeconds });
  } catch {
    // Best-effort — the real candles were already fetched and are returned to the caller regardless.
  }
}

export function isFresh(entry: CacheEntry, tf: Timeframe): boolean {
  return Date.now() - entry.fetchedAt < FRESH_TTL_MS[tf];
}
