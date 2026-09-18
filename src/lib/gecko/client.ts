/**
 * Thin client for GeckoTerminal's public API (api.geckoterminal.com/api/v2).
 * GeckoTerminal (part of CoinGecko) indexes Solana on-chain activity, including
 * Pump.fun's bonding-curve dex ("pump-fun") and its post-graduation AMM
 * ("pumpswap"), directly from the chain — so this is real data, not a mock.
 *
 * Kept isolated here so the rest of the app never talks to the upstream API
 * shape directly, and so this can be swapped for another indexer later.
 */

const BASE = "https://api.geckoterminal.com/api/v2";
const NETWORK = "solana";

async function geckoGet<T>(path: string, revalidateSeconds: number, noCache = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json" },
    ...(noCache ? { cache: "no-store" as const } : { next: { revalidate: revalidateSeconds } }),
  });
  if (!res.ok) throw new Error(`GeckoTerminal ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export type GeckoTxWindow = { buys: number; sells: number; buyers: number; sellers: number };

export type GeckoPoolAttributes = {
  name: string;
  address: string;
  base_token_price_usd: string | null;
  fdv_usd: string | null;
  market_cap_usd: string | null;
  reserve_in_usd: string | null;
  volume_usd: Record<string, string | null>;
  price_change_percentage: Record<string, string | null>;
  transactions?: Record<string, GeckoTxWindow | undefined>;
  pool_created_at: string | null;
};

export type GeckoRelationship = { data: { id: string; type: string } };

export type GeckoPool = {
  id: string;
  attributes: GeckoPoolAttributes;
  relationships: {
    base_token: GeckoRelationship;
    quote_token: GeckoRelationship;
    dex?: GeckoRelationship;
  };
};

export type GeckoTokenAttributes = {
  address: string;
  name: string;
  symbol: string;
  image_url: string | null;
};

export type GeckoIncludedToken = {
  id: string;
  type: "token";
  attributes: GeckoTokenAttributes;
};

export type GeckoPoolsResponse = {
  data: GeckoPool[];
  included?: GeckoIncludedToken[];
};

export function tokenIdToAddress(id: string): string {
  // included token ids look like "solana_<address>"
  return id.startsWith(`${NETWORK}_`) ? id.slice(NETWORK.length + 1) : id;
}

export async function fetchDexPools(dex: "pump-fun" | "pumpswap", page = 1, noCache = false): Promise<GeckoPoolsResponse> {
  return geckoGet<GeckoPoolsResponse>(`/networks/${NETWORK}/dexes/${dex}/pools?include=base_token&page=${page}`, 60, noCache);
}

/** Fetches several pages of a dex's pools in parallel and merges them into one list. */
export async function fetchDexPoolsPages(dex: "pump-fun" | "pumpswap", pages: number, noCache = false): Promise<GeckoPoolsResponse> {
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetchDexPools(dex, i + 1, noCache).catch(() => ({ data: [], included: [] } as GeckoPoolsResponse))
    )
  );
  return {
    data: results.flatMap((r) => r.data),
    included: results.flatMap((r) => r.included || []),
  };
}

/**
 * Searches pools across the ENTIRE Solana network (not just the pump-fun /
 * pumpswap dex listings) so a search can find any coin by name or ticker,
 * not only the ones already sitting in our cached top-volume list.
 */
export async function searchPools(query: string, page = 1): Promise<GeckoPoolsResponse> {
  return geckoGet<GeckoPoolsResponse>(
    `/search/pools?query=${encodeURIComponent(query)}&network=${NETWORK}&include=base_token&page=${page}`,
    20
  );
}

export type GeckoTokenInfoAttributes = {
  address: string;
  name: string;
  symbol: string;
  image_url: string | null;
  websites: string[];
  discord_url: string | null;
  telegram_handle: string | null;
  twitter_handle: string | null;
  description: string | null;
};

export async function fetchTokenInfo(address: string): Promise<GeckoTokenInfoAttributes | null> {
  try {
    const res = await geckoGet<{ data: { attributes: GeckoTokenInfoAttributes } }>(
      `/networks/${NETWORK}/tokens/${address}/info`,
      120
    );
    return res.data.attributes;
  } catch {
    return null;
  }
}

export async function fetchPool(address: string): Promise<GeckoPoolsResponse["data"][number] | null> {
  try {
    const res = await geckoGet<{ data: GeckoPool; included?: GeckoIncludedToken[] }>(
      `/networks/${NETWORK}/pools/${address}?include=base_token`,
      30
    );
    return res.data;
  } catch {
    return null;
  }
}

export type GeckoTrade = {
  attributes: {
    block_timestamp: string;
    tx_hash: string;
    tx_from_address: string;
    kind: "buy" | "sell";
    from_token_amount: string;
    to_token_amount: string;
    volume_in_usd: string;
  };
};

export async function fetchPoolTrades(poolAddress: string): Promise<GeckoTrade[]> {
  try {
    const res = await geckoGet<{ data: GeckoTrade[] }>(`/networks/${NETWORK}/pools/${poolAddress}/trades`, 20);
    return res.data;
  } catch {
    return [];
  }
}

export type GeckoOhlcvTimeframe = "minute" | "hour" | "day";

export async function fetchPoolOhlcv(
  poolAddress: string,
  timeframe: GeckoOhlcvTimeframe,
  aggregate: number,
  limit: number
): Promise<{ time: number; close: number }[]> {
  try {
    const res = await geckoGet<{ data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } } }>(
      `/networks/${NETWORK}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`,
      timeframe === "minute" ? 30 : 120
    );
    return res.data.attributes.ohlcv_list.map((c) => ({ time: c[0], close: c[4] })).reverse();
  } catch {
    return [];
  }
}

export async function fetchPoolHourlyCloses(poolAddress: string, limit = 24): Promise<number[]> {
  const candles = await fetchPoolOhlcv(poolAddress, "hour", 1, limit);
  return candles.map((c) => c.close);
}
