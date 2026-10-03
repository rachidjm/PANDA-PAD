import { getRedis } from "@/lib/rate-limit";

/**
 * A coin's real-time USD price, completely independent of any chart/OHLCV source — Jupiter's own Price API
 * v3, verified directly against developers.jup.ag/docs/price:
 *
 *   GET https://api.jup.ag/price/v3?ids=<mint1>,<mint2>,...  (up to 50 ids per call)
 *   -> { [mint]: { usdPrice, blockId, decimals, priceChange24h } }
 *
 * No API key is required (keyless requests are rate-limited to 0.5 req/sec per Jupiter's own docs; the same
 * JUPITER_API_KEY this app already uses for Trigger orders raises that, if set). A token with no reliable
 * recent trade is simply OMITTED from the response — never a fabricated price — so a missing mint here must
 * read as "no live price", never as 0.
 *
 * Cached in Upstash per mint (short TTL — this is meant to feel live) so real traffic never multiplies into
 * many requests against Jupiter's tight keyless budget.
 */

const BASE = "https://api.jup.ag/price/v3";
const TTL_S = 20;
const KEY = (mint: string) => `panda:jupprice:v1:${mint}`;

export type LivePrice = { usdPrice: number; priceChange24h: number | null };

export async function fetchJupiterPrices(mints: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, LivePrice>> {
  const out = new Map<string, LivePrice>();
  const unique = [...new Set(mints)].filter(Boolean);
  if (unique.length === 0) return out;
  try {
    const apiKey = process.env.JUPITER_API_KEY;
    const res = await fetchImpl(`${BASE}?ids=${unique.map(encodeURIComponent).join(",")}`, {
      headers: { Accept: "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return out;
    const data = (await res.json()) as Record<string, { usdPrice?: unknown; priceChange24h?: unknown }>;
    for (const [mint, v] of Object.entries(data)) {
      const usdPrice = Number(v.usdPrice);
      if (Number.isFinite(usdPrice) && usdPrice > 0) {
        const change = Number(v.priceChange24h);
        out.set(mint, { usdPrice, priceChange24h: Number.isFinite(change) ? change : null });
      }
    }
  } catch {
    // network/timeout failure — caller falls back to another source
  }
  return out;
}

/** One mint, cache-first. */
export async function getLivePrice(mint: string): Promise<LivePrice | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<LivePrice>(KEY(mint));
      if (cached && typeof cached.usdPrice === "number") return cached;
    } catch {
      // falls through to a real fetch
    }
  }
  const price = (await fetchJupiterPrices([mint])).get(mint) ?? null;
  if (price && redis) {
    try {
      await redis.set(KEY(mint), price, { ex: TTL_S });
    } catch {
      // best-effort — the real price was already read and is returned below regardless
    }
  }
  return price;
}
