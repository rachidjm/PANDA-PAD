/**
 * Thin client for DexPaprika's public OHLCV endpoint (api.dexpaprika.com) — a real, independent indexer,
 * used ONLY as a fallback when GeckoTerminal (the primary source, src/lib/gecko/client.ts) is rate-limited
 * or unreachable. Verified directly against DexPaprika's own official docs
 * (docs.dexpaprika.com/api-reference/pools/get-ohlcv-data-for-a-pool-pair) at implementation time — nothing
 * here is guessed.
 *
 * Real, documented limits that shape where this can stand in (see chart/cache.ts for how these map to tabs):
 *   - No key:       intervals 1h/6h/12h/24h only, history depth the last 24 hours, 15 req/min, 10k/30 days.
 *   - Free key:     intervals 10m and longer, history depth the last 7 days, 30 req/min, 100k/30 days.
 *     (30-day depth needs a paid "Dev" plan — there is no free way to back up the "30d" tab.)
 * A key is optional (DEXPAPRIKA_API_KEY) and, per the docs, goes raw in the Authorization header (no "Bearer").
 */

const BASE = "https://api.dexpaprika.com";
const NETWORK = "solana";

export type DexPaprikaInterval = "1m" | "5m" | "10m" | "15m" | "30m" | "1h" | "6h" | "12h" | "24h";

type DexPaprikaCandle = {
  time_open: string;
  time_close: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * `start` uses DexPaprika's own relative-offset syntax ("-24h", "-7d", ...). Returns the same `{time, close}`
 * shape as GeckoTerminal's client, `time` taken from `time_open` (a candle's start, same convention this app
 * already uses) — real failures (wrong plan, rate limit, network) resolve to `[]`, never thrown, so a fallback
 * attempt never crashes the route that's already handling a primary-source failure.
 */
/** Pure: turns DexPaprika's own candle shape into this app's `{time, close}`, dropping anything malformed. */
export function toChartCandles(data: DexPaprikaCandle[]): { time: number; close: number }[] {
  return data
    .map((c) => ({ time: Math.floor(new Date(c.time_open).getTime() / 1000), close: c.close }))
    .filter((c) => Number.isFinite(c.time) && c.time > 0 && Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => a.time - b.time);
}

export async function fetchPoolOhlcvDexPaprika(
  poolAddress: string,
  opts: { start: string; interval: DexPaprikaInterval; limit: number },
  apiKey?: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ time: number; close: number }[]> {
  try {
    const url = `${BASE}/networks/${NETWORK}/pools/${poolAddress}/ohlcv?start=${encodeURIComponent(opts.start)}&interval=${opts.interval}&limit=${opts.limit}`;
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json", ...(apiKey ? { Authorization: apiKey } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as DexPaprikaCandle[];
    if (!Array.isArray(data)) return [];
    return toChartCandles(data);
  } catch {
    return [];
  }
}
