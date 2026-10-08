/**
 * Jupiter's token search (lite-api.jup.ag/tokens/v2/search, api-reference/tokens/search — field names verified
 * directly against developers.jup.ag at implementation time), used as the FALLBACK for what GeckoTerminal
 * doesn't have for a wallet's token (a name, a logo, a USD price, the 24h change), and as the source of truth
 * for a coin's `verified` status in search de-duplication (src/lib/market/search-rank.ts). One request covers
 * up to 100 mints. Server-side only (the browser talks to PANDA).
 */
export type JupToken = {
  name?: string;
  symbol?: string;
  image?: string;
  priceUsd?: number;
  change24h?: number;
  /** Jupiter's own `isVerified` — a human-curated flag, not inferred from liquidity or volume. */
  verified: boolean;
  liquidityUsd?: number;
};

const SEARCH = "https://lite-api.jup.ag/tokens/v2/search";

export async function fetchJupiterTokens(mints: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, JupToken>> {
  const out = new Map<string, JupToken>();
  const unique = [...new Set(mints)].slice(0, 100);
  if (unique.length === 0) return out;
  try {
    const res = await fetchImpl(`${SEARCH}?query=${unique.join(",")}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5_000), ...({ next: { revalidate: 60 } } as object) });
    if (!res.ok) return out;
    const list = (await res.json()) as unknown;
    if (!Array.isArray(list)) return out;
    for (const t of list as Record<string, unknown>[]) {
      const id = typeof t.id === "string" ? t.id : null;
      if (!id) continue;
      const price = typeof t.usdPrice === "number" && t.usdPrice > 0 ? t.usdPrice : undefined;
      const stats = t.stats24h as { priceChange?: unknown } | undefined;
      const change = typeof stats?.priceChange === "number" && Number.isFinite(stats.priceChange) ? stats.priceChange : undefined;
      const liquidity = typeof t.liquidity === "number" && t.liquidity >= 0 ? t.liquidity : undefined;
      out.set(id, {
        name: typeof t.name === "string" && t.name ? t.name : undefined,
        symbol: typeof t.symbol === "string" && t.symbol ? t.symbol : undefined,
        image: typeof t.icon === "string" && /^https:\/\//.test(t.icon) ? t.icon : undefined,
        priceUsd: price,
        change24h: change,
        verified: t.isVerified === true,
        liquidityUsd: liquidity,
      });
    }
  } catch {
    // down or slow: nothing from this source
  }
  return out;
}
