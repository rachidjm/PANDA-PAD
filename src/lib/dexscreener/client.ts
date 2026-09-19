/**
 * Thin client for Dexscreener's public API (api.dexscreener.com) — real,
 * free, no key required. Used as a fallback data source for Solana pool
 * search/lookup when GeckoTerminal (the primary source, see
 * src/lib/gecko/client.ts) is rate-limited or unreachable, so a single
 * upstream outage doesn't take down search. Response shape verified
 * directly against the live API at implementation time.
 */

const BASE = "https://api.dexscreener.com";
const CHAIN = "solana";

async function dexGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Dexscreener ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export type DexPair = {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  txns?: Record<"m5" | "h1" | "h6" | "h24", { buys: number; sells: number } | undefined>;
  volume?: Record<"m5" | "h1" | "h6" | "h24", number | undefined>;
  priceChange?: Record<"m5" | "h1" | "h6" | "h24", number | undefined>;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { url: string; type: string }[];
  };
};

/** Searches pairs across every chain Dexscreener indexes — callers should filter to chainId === "solana". */
export async function searchDexPairs(query: string): Promise<DexPair[]> {
  const res = await dexGet<{ pairs: DexPair[] | null }>(`/latest/dex/search?q=${encodeURIComponent(query)}`);
  return (res.pairs || []).filter((p) => p.chainId === CHAIN);
}

/** One request for up to 30 tokens' best-known pairs (socials included) — Dexscreener's batch endpoint. */
export async function fetchDexTokensBatch(tokenAddresses: string[]): Promise<DexPair[]> {
  if (tokenAddresses.length === 0) return [];
  const res = await dexGet<DexPair[] | null>(`/tokens/v1/${CHAIN}/${tokenAddresses.slice(0, 30).join(",")}`);
  return (res || []).filter((p) => p.chainId === CHAIN);
}

/** All Solana pairs trading a given token, across every dex. */
export async function fetchDexTokenPairs(tokenAddress: string): Promise<DexPair[]> {
  try {
    const res = await dexGet<DexPair[] | null>(`/token-pairs/v1/${CHAIN}/${tokenAddress}`);
    return (res || []).filter((p) => p.chainId === CHAIN);
  } catch {
    return [];
  }
}
