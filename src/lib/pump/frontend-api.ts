/**
 * Read-only client for Pump.fun's own web API (frontend-api-v3.pump.fun).
 * Pump.fun publishes no official public API — these are the endpoints its
 * website calls, undocumented and free to change or block without notice. So
 * everything built on this treats it as an OPTIONAL enrichment: any failure
 * returns nothing and callers fall back to GeckoTerminal/Dexscreener data.
 *
 * What it gives that the others don't: the coin's real launch time
 * (`created_timestamp`), its creator, and the socials/logo the creator set.
 * Endpoints verified live: `POST /coins/mints` (batch lookup) and
 * `GET /coins?sort=created_timestamp&order=DESC` (newest launches).
 */

const BASE = "https://frontend-api-v3.pump.fun";

export type PumpCoin = {
  mint: string;
  name: string;
  symbol: string;
  image?: string;
  description?: string;
  twitter?: string;
  website?: string;
  telegram?: string;
  creator: string;
  /** ISO time of the coin's real launch on Pump.fun. */
  createdAt: string;
  /** True once it has graduated from the bonding curve to PumpSwap. */
  graduated: boolean;
  usdMarketCap: number;
  nsfw: boolean;
  banned: boolean;
};

type RawPumpCoin = {
  mint: string;
  name?: string;
  symbol?: string;
  image_uri?: string;
  description?: string;
  twitter?: string | null;
  website?: string | null;
  telegram?: string | null;
  creator?: string;
  created_timestamp?: number;
  complete?: boolean;
  usd_market_cap?: number;
  nsfw?: boolean;
  is_banned?: boolean;
};

function mapCoin(raw: RawPumpCoin): PumpCoin | null {
  if (!raw.mint || !raw.created_timestamp) return null;
  return {
    mint: raw.mint,
    name: raw.name || raw.symbol || "",
    symbol: raw.symbol || "",
    image: raw.image_uri || undefined,
    description: raw.description || undefined,
    twitter: raw.twitter || undefined,
    website: raw.website || undefined,
    telegram: raw.telegram || undefined,
    creator: raw.creator || "",
    createdAt: new Date(raw.created_timestamp).toISOString(),
    graduated: !!raw.complete,
    usdMarketCap: raw.usd_market_cap || 0,
    nsfw: !!raw.nsfw,
    banned: !!raw.is_banned,
  };
}

// A launch time never changes, and "not a Pump.fun coin" rarely does — cache
// both so the list refresh doesn't re-ask about the same 60 mints every minute.
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { coin: PumpCoin | null; expires: number }>();

async function lookupBatch(mints: string[]): Promise<PumpCoin[]> {
  const res = await fetch(`${BASE}/coins/mints`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ mints }),
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Pump.fun /coins/mints → ${res.status}`);
  const raw = (await res.json()) as RawPumpCoin[];
  return raw.map(mapCoin).filter((c): c is PumpCoin => c !== null);
}

/** Pump.fun info for whichever of `mints` are Pump.fun coins. Coins made elsewhere are simply absent from the result. */
export async function fetchPumpCoins(mints: string[]): Promise<Map<string, PumpCoin>> {
  const now = Date.now();
  const out = new Map<string, PumpCoin>();
  const missing: string[] = [];

  for (const mint of new Set(mints)) {
    const hit = cache.get(mint);
    if (hit && hit.expires > now) {
      if (hit.coin) out.set(mint, hit.coin);
    } else {
      missing.push(mint);
    }
  }

  for (let i = 0; i < missing.length; i += 40) {
    const chunk = missing.slice(i, i + 40);
    try {
      const found = await lookupBatch(chunk);
      const byMint = new Map(found.map((c) => [c.mint, c]));
      for (const mint of chunk) {
        const coin = byMint.get(mint) || null;
        cache.set(mint, { coin, expires: now + CACHE_MS });
        if (coin) out.set(mint, coin);
      }
    } catch {
      // Optional source — a failed chunk is just left un-enriched, and not cached as a miss.
    }
  }
  return out;
}

/** The newest real launches on Pump.fun, newest first. Throws if the API is unreachable. */
export async function fetchNewestPumpCoins(limit: number): Promise<PumpCoin[]> {
  const res = await fetch(`${BASE}/coins?limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Pump.fun /coins → ${res.status}`);
  const raw = (await res.json()) as RawPumpCoin[];
  return raw.map(mapCoin).filter((c): c is PumpCoin => c !== null);
}
