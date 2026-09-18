import { Coin, DoodleKind, Trade } from "./types";
import {
  fetchDexPoolsPages,
  fetchPoolTrades,
  fetchPoolHourlyCloses,
  fetchTokenInfo,
  fetchTokenPools,
  searchPools,
  tokenIdToAddress,
  GeckoPool,
  GeckoIncludedToken,
} from "./gecko/client";

const CARD_COLORS = ["#FFD23F", "#7FE0A0", "#FF9AD5", "#B8B4FF", "#FFC85C", "#8FD3FF", "#6FD8D0", "#FF8A5C"];
const CARD_DOODLES: DoodleKind[] = ["cat", "frog", "donut", "ghost", "egg", "cloud", "fish", "worm"];

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function fallbackLook(seed: string) {
  const h = hashSeed(seed);
  return { bg: CARD_COLORS[h % CARD_COLORS.length], doodle: CARD_DOODLES[h % CARD_DOODLES.length] };
}

function num(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function windowMap<T, R>(source: Record<string, T | undefined> | undefined, pick: (v: T) => R): Partial<Record<"m5" | "h1" | "h24", R>> | undefined {
  if (!source) return undefined;
  const out: Partial<Record<"m5" | "h1" | "h24", R>> = {};
  (["m5", "h1", "h24"] as const).forEach((k) => {
    const v = source[k];
    if (v !== undefined && v !== null) out[k] = pick(v);
  });
  return Object.keys(out).length ? out : undefined;
}

/** dexId is the raw GeckoTerminal dex id (e.g. "pump-fun", "raydium", "orca"). */
export function poolToCoin(pool: GeckoPool, token: GeckoIncludedToken | undefined, dexId: string): Coin {
  const mint = token ? tokenIdToAddress(token.id) : pool.relationships.base_token.data.id;
  const symbol = token?.attributes.symbol || pool.attributes.name.split("/")[0].trim();
  const look = fallbackLook(mint);
  const source = dexId === "pump-fun" || dexId === "pumpswap" ? dexId : "other";
  return {
    mint,
    ticker: symbol.toUpperCase(),
    name: token?.attributes.name || symbol,
    description: "",
    image: token?.attributes.image_url || undefined,
    doodle: look.doodle,
    bg: look.bg,
    marketCap: num(pool.attributes.market_cap_usd) || num(pool.attributes.fdv_usd),
    volume24h: num(pool.attributes.volume_usd?.h24),
    changePct: num(pool.attributes.price_change_percentage?.h24),
    priceHistory: buildApproxTrend(pool.attributes.price_change_percentage),
    creator: "",
    createdAt: pool.attributes.pool_created_at || new Date().toISOString(),
    source,
    dex: dexId,
    poolAddress: pool.attributes.address,
    quoteSymbol: pool.attributes.name.split("/")[1]?.trim() || "SOL",
    liquidityUsd: pool.attributes.reserve_in_usd ? num(pool.attributes.reserve_in_usd) : undefined,
    activity: windowMap(pool.attributes.transactions, (w) => w),
    volumeWindows: windowMap(pool.attributes.volume_usd, num),
    changeWindows: windowMap(pool.attributes.price_change_percentage, num),
  };
}

function buildApproxTrend(pct: Record<string, string | null>): number[] {
  // GeckoTerminal's pool list doesn't include OHLCV, so build a rough shape
  // from the timeframe % buckets it does give us. Replaced with real hourly
  // closes on the token detail page (see getLiveCoin).
  const buckets = ["h24", "h6", "h1", "m30", "m15", "m5"];
  let value = 100;
  const points = [value];
  for (const b of [...buckets].reverse()) {
    const change = num(pct[b]);
    value = value / (1 + change / 100);
    points.unshift(Number(value.toFixed(4)));
  }
  return points;
}

async function enrichSocials(coin: Coin): Promise<Coin> {
  const info = await fetchTokenInfo(coin.mint);
  if (!info) return coin;
  return {
    ...coin,
    description: info.description || coin.description,
    image: coin.image || info.image_url || undefined,
    website: info.websites?.[0] || null,
    twitter: info.twitter_handle || null,
    telegram: info.telegram_handle || null,
  };
}

let cache: { coins: Coin[]; expires: number } | null = null;
// Last successfully-fetched list, kept around (no expiry of its own) so a
// rate-limited or failed refresh can fall back to it instead of wiping the
// grid to empty — that silent "nothing happened" was being read as a broken
// Refresh button.
let lastGood: Coin[] | null = null;
let lastFetchAt = 0;
// getLiveCoins hits GeckoTerminal with 7 parallel requests (4 pump-fun pages +
// 3 pumpswap pages). That budget is shared server-side across every visitor,
// so "force" is a request to be fresh, not a license to always re-fetch —
// if anyone (this click or someone else's) already refreshed a moment ago,
// serve that instead of piling on more upstream calls.
const MIN_FORCE_INTERVAL_MS = 15_000;

/**
 * Live PANDA data always comes straight from chain (via GeckoTerminal's Pump.fun
 * / PumpSwap indexing) — there is no demo/mock fallback. If the feed is
 * genuinely empty or unreachable and there's no prior data to fall back on,
 * callers get `coins: []` and show an honest empty state instead of fabricated coins.
 */
export async function getLiveCoins(opts: { force?: boolean } = {}): Promise<{ coins: Coin[]; live: boolean }> {
  if (!opts.force && cache && cache.expires > Date.now()) return { coins: cache.coins, live: true };
  if (opts.force && cache && Date.now() - lastFetchAt < MIN_FORCE_INTERVAL_MS) {
    return { coins: cache.coins, live: true };
  }

  lastFetchAt = Date.now();
  const [pumpFun, pumpSwap] = await Promise.all([
    fetchDexPoolsPages("pump-fun", 4, opts.force),
    fetchDexPoolsPages("pumpswap", 3, opts.force),
  ]);

  const map = (res: typeof pumpFun, source: "pump-fun" | "pumpswap") =>
    res.data.map((pool) => {
      const tokenId = pool.relationships.base_token.data.id;
      const token = res.included?.find((t) => t.id === tokenId);
      return poolToCoin(pool, token, source);
    });

  const byMint = new Map<string, Coin>();
  for (const coin of [...map(pumpFun, "pump-fun"), ...map(pumpSwap, "pumpswap")]) {
    if (coin.marketCap > 0 && !byMint.has(coin.mint)) byMint.set(coin.mint, coin);
  }
  const merged = [...byMint.values()].sort((a, b) => b.volume24h - a.volume24h).slice(0, 60);

  const enriched = await Promise.all(merged.slice(0, 18).map((c) => enrichSocials(c).catch(() => c)));
  const coins = [...enriched, ...merged.slice(18)];

  if (coins.length > 0) {
    cache = { coins, expires: Date.now() + 60_000 };
    lastGood = coins;
    return { coins, live: true };
  }

  // Upstream failed (usually GeckoTerminal's rate limit) — serve the last
  // known-good list rather than an empty grid, but mark it as not live so
  // the UI can be honest that this isn't a fresh fetch.
  if (lastGood) return { coins: lastGood, live: false };
  return { coins: [], live: false };
}

/**
 * Live search across the WHOLE Solana network via GeckoTerminal's search
 * endpoint — every dex, not just Pump.fun/PumpSwap, so any real coin (BONK,
 * a Raydium listing, whatever) is findable. Trading through PANDA only
 * works for pump-fun/pumpswap coins (Coin.source tells the UI which), but
 * search and discovery cover all of Solana. This is what powers the search
 * boxes (unlike the cached top-60 list, it can find any coin, not just the
 * biggest ones already fetched).
 */
const searchCache = new Map<string, { coins: Coin[]; expires: number }>();

export async function searchLiveCoins(query: string): Promise<{ coins: Coin[]; live: boolean }> {
  const q = query.trim().toLowerCase();
  if (!q) return { coins: [], live: true };

  const cached = searchCache.get(q);
  if (cached && cached.expires > Date.now()) return { coins: cached.coins, live: true };

  // A single page keeps this to one upstream request per search — GeckoTerminal's
  // free public API rate-limits aggressively, and a real error here should
  // surface (not be swallowed into a misleading "no coins found").
  const { data, included = [] } = await searchPools(q, 1);

  // The same token often has many pools (different dexes, fee tiers, quote
  // assets) — keep only the most liquid pool per mint so each coin appears once.
  const byMint = new Map<string, Coin>();
  for (const pool of data) {
    const dexId = pool.relationships.dex?.data.id || "unknown";
    const tokenId = pool.relationships.base_token.data.id;
    const token = included.find((t) => t.id === tokenId);
    const coin = poolToCoin(pool, token, dexId);
    const existing = byMint.get(coin.mint);
    if (!existing || (coin.liquidityUsd || 0) > (existing.liquidityUsd || 0)) {
      byMint.set(coin.mint, coin);
    }
  }

  const coins = [...byMint.values()].sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0)).slice(0, 40);
  searchCache.set(q, { coins, expires: Date.now() + 15_000 });
  return { coins, live: true };
}

export async function getLiveCoin(mint: string): Promise<{ coin: Coin | undefined; live: boolean }> {
  const { coins, live } = await getLiveCoins();
  let coin = coins.find((c) => c.mint.toLowerCase() === mint.toLowerCase());

  // Not in the cached pump-fun/pumpswap top-60 — look it up directly by mint
  // across every dex, so any coin found via search still has a working page.
  if (!coin) {
    const { data, included = [] } = await fetchTokenPools(mint);
    const best = [...data].sort(
      (a, b) => Number(b.attributes.reserve_in_usd || 0) - Number(a.attributes.reserve_in_usd || 0)
    )[0];
    if (best) {
      const tokenId = best.relationships.base_token.data.id;
      const token = included.find((t) => t.id === tokenId);
      const dexId = best.relationships.dex?.data.id || "unknown";
      coin = poolToCoin(best, token, dexId);
    }
  }

  if (coin && coin.poolAddress) {
    const closes = await fetchPoolHourlyCloses(coin.poolAddress);
    if (closes.length > 4) {
      coin.priceHistory = closes;
      coin.range24h = { low: Math.min(...closes), high: Math.max(...closes) };
    }
  }
  return { coin, live };
}

export async function getCoinTrades(coin: Coin): Promise<{ trades: Trade[]; live: boolean }> {
  if (!coin.poolAddress) return { trades: [], live: false };
  const raw = await fetchPoolTrades(coin.poolAddress);
  const trades: Trade[] = raw.slice(0, 20).map((t, i) => ({
    id: `${t.attributes.tx_hash}-${i}`,
    side: t.attributes.kind,
    trader: `${t.attributes.tx_from_address.slice(0, 4)}…${t.attributes.tx_from_address.slice(-4)}`,
    sol: Number(Number(t.attributes.kind === "buy" ? t.attributes.from_token_amount : t.attributes.to_token_amount).toFixed(3)),
    tokens: Math.round(Number(t.attributes.kind === "buy" ? t.attributes.to_token_amount : t.attributes.from_token_amount)),
    time: timeAgo(t.attributes.block_timestamp),
    txHash: t.attributes.tx_hash,
  }));
  return { trades, live: true };
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
