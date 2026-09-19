import { ActivityEvent, Coin, DoodleKind, Trade } from "./types";
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
import { searchDexPairs, fetchDexTokenPairs, fetchDexTokensBatch, DexPair } from "./dexscreener/client";

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

/** Upstream feeds sometimes hand back HTML-escaped names ("TED&AMP;TERRY") — show them as typed. */
function decodeEntities(v: string): string {
  return v.replace(/&(amp|lt|gt|quot|#39);/gi, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e.toLowerCase()] as string);
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
    ticker: decodeEntities(symbol).toUpperCase(),
    name: decodeEntities(token?.attributes.name || symbol),
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

/** Maps a Dexscreener pair into the same Coin shape poolToCoin produces, for the search/lookup fallback path. */
function dexPairToCoin(pair: DexPair): Coin {
  const mint = pair.baseToken.address;
  const symbol = pair.baseToken.symbol;
  const look = fallbackLook(mint);
  const source = pair.dexId === "pump-fun" || pair.dexId === "pumpfun" ? "pump-fun" : pair.dexId === "pumpswap" ? "pumpswap" : "other";
  const pick = (w?: Record<"m5" | "h1" | "h6" | "h24", number | undefined>) =>
    w ? ({ m5: w.m5, h1: w.h1, h24: w.h24 } as Partial<Record<"m5" | "h1" | "h24", number>>) : undefined;
  const pickTx = (w?: Record<"m5" | "h1" | "h6" | "h24", { buys: number; sells: number } | undefined>) => {
    if (!w) return undefined;
    const out: Partial<Record<"m5" | "h1" | "h24", { buys: number; sells: number; buyers: number; sellers: number }>> = {};
    (["m5", "h1", "h24"] as const).forEach((k) => {
      const v = w[k];
      if (v) out[k] = { buys: v.buys, sells: v.sells, buyers: v.buys, sellers: v.sells };
    });
    return out;
  };
  return {
    mint,
    ticker: decodeEntities(symbol).toUpperCase(),
    name: decodeEntities(pair.baseToken.name || symbol),
    description: "",
    image: pair.info?.imageUrl || undefined,
    doodle: look.doodle,
    bg: look.bg,
    website: pair.info?.websites?.[0]?.url || null,
    twitter: pair.info?.socials?.find((s) => s.type === "twitter")?.url.split("/").pop() || null,
    telegram: pair.info?.socials?.find((s) => s.type === "telegram")?.url.split("/").pop() || null,
    marketCap: pair.marketCap || pair.fdv || 0,
    volume24h: pair.volume?.h24 || 0,
    changePct: pair.priceChange?.h24 || 0,
    priceHistory: pair.priceChange
      ? buildApproxTrend({
          h24: String(pair.priceChange.h24 ?? 0),
          h6: String(pair.priceChange.h6 ?? 0),
          h1: String(pair.priceChange.h1 ?? 0),
          m5: String(pair.priceChange.m5 ?? 0),
        })
      : [],
    creator: "",
    createdAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : new Date().toISOString(),
    source,
    dex: pair.dexId,
    poolAddress: pair.pairAddress,
    quoteSymbol: pair.quoteToken.symbol,
    liquidityUsd: pair.liquidity?.usd,
    activity: pickTx(pair.txns),
    volumeWindows: pick(pair.volume),
    changeWindows: pick(pair.priceChange),
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
const MIN_FORCE_INTERVAL_MS = 10_000;

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

  let coins: Coin[] = [];
  if (Date.now() >= geckoCooldownUntil) {
    coins = await fetchListFromGecko(opts.force);
    // A rate-limited GeckoTerminal returns nothing (or only a stray page) —
    // stop hammering it for a minute instead of burning more of its budget.
    if (coins.length < MIN_HEALTHY_LIST) {
      geckoCooldownUntil = Date.now() + GECKO_COOLDOWN_MS;
      coins = [];
    }
  }

  // GeckoTerminal unavailable: refresh the last known list's prices through
  // Dexscreener (an independent source), or — cold start with nothing cached —
  // discover the list there. Either way the numbers are fresh, so this counts as live.
  if (coins.length === 0) {
    coins = lastGood ? (await requoteViaDexscreener(lastGood)) ?? [] : await discoverViaDexscreener();
  }

  // Rugged / abandoned pools that quote a few cents of market cap aren't worth a slot.
  coins = coins.filter((c) => c.marketCap >= MIN_LISTED_MARKET_CAP);

  if (coins.length > 0) {
    coins = await fillMissingImages(coins);
    cache = { coins, expires: Date.now() + 60_000 };
    lastGood = coins;
    return { coins, live: true };
  }

  // Every source failed — serve the last known-good list rather than an empty
  // grid, but mark it as not live so the UI can be honest that this isn't fresh.
  if (lastGood) return { coins: lastGood, live: false };
  return { coins: [], live: false };
}

let geckoCooldownUntil = 0;
const GECKO_COOLDOWN_MS = 60_000;
const MIN_HEALTHY_LIST = 15;
const MIN_LISTED_MARKET_CAP = 500;

async function fetchListFromGecko(force?: boolean): Promise<Coin[]> {
  const [pumpFun, pumpSwap] = await Promise.all([
    fetchDexPoolsPages("pump-fun", 4, force),
    fetchDexPoolsPages("pumpswap", 3, force),
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
  // No social enrichment here — it's only ever shown on the individual coin
  // page, never on these list cards. getLiveCoin() enriches lazily, one
  // request, only for the specific coin someone actually opens.
  return [...byMint.values()].sort((a, b) => b.volume24h - a.volume24h).slice(0, 60);
}

/** Best pair per token from a Dexscreener batch result — the coin's own pool when it's there, else the most liquid. */
function bestPairs(pairs: DexPair[], preferredPool?: Map<string, string | undefined>): Map<string, DexPair> {
  const best = new Map<string, DexPair>();
  for (const p of pairs) {
    const mint = p.baseToken.address;
    const cur = best.get(mint);
    const preferred = preferredPool?.get(mint);
    if (!cur) best.set(mint, p);
    else if (cur.pairAddress !== preferred && (p.pairAddress === preferred || (p.liquidity?.usd || 0) > (cur.liquidity?.usd || 0))) {
      best.set(mint, p);
    }
  }
  return best;
}

/** Re-quotes an already-known list with Dexscreener's batch endpoint: 30 tokens per request, so 60 coins cost 2 calls. */
async function requoteViaDexscreener(coins: Coin[]): Promise<Coin[] | null> {
  const chunks: string[][] = [];
  for (let i = 0; i < coins.length; i += 30) chunks.push(coins.slice(i, i + 30).map((c) => c.mint));
  const results = await Promise.all(chunks.map((c) => fetchDexTokensBatch(c).catch(() => [] as DexPair[])));
  const pairs = results.flat();
  if (pairs.length === 0) return null;

  const best = bestPairs(pairs, new Map(coins.map((c) => [c.mint, c.poolAddress])));
  return coins
    .map((coin) => {
      const pair = best.get(coin.mint);
      if (!pair) return coin;
      const fresh = dexPairToCoin(pair);
      return {
        ...coin,
        marketCap: fresh.marketCap || coin.marketCap,
        volume24h: fresh.volume24h,
        changePct: fresh.changePct,
        priceHistory: fresh.priceHistory.length ? fresh.priceHistory : coin.priceHistory,
        liquidityUsd: fresh.liquidityUsd ?? coin.liquidityUsd,
        activity: fresh.activity ?? coin.activity,
        volumeWindows: fresh.volumeWindows ?? coin.volumeWindows,
        changeWindows: fresh.changeWindows ?? coin.changeWindows,
        image: coin.image || fresh.image,
      };
    })
    .sort((a, b) => b.volume24h - a.volume24h);
}

/** Cold-start discovery when GeckoTerminal is down and nothing is cached yet. */
async function discoverViaDexscreener(): Promise<Coin[]> {
  const results = await Promise.all(["pumpswap", "pump.fun"].map((q) => searchDexPairs(q).catch(() => [] as DexPair[])));
  const pairs = results.flat().filter((p) => ["pumpswap", "pumpfun", "pump-fun"].includes(p.dexId));
  const coins = [...bestPairs(pairs).values()].map(dexPairToCoin).filter((c) => c.marketCap > 0);
  return coins.sort((a, b) => b.volume24h - a.volume24h).slice(0, 60);
}

/** Coins GeckoTerminal has no logo for get their real one from Dexscreener (one batch call) — never a drawn stand-in. */
async function fillMissingImages(coins: Coin[]): Promise<Coin[]> {
  const missing = coins.filter((c) => !c.image).map((c) => c.mint);
  if (missing.length === 0) return coins;
  try {
    const images = new Map<string, string>();
    for (const p of await fetchDexTokensBatch(missing)) {
      if (p.info?.imageUrl && !images.has(p.baseToken.address)) images.set(p.baseToken.address, p.info.imageUrl);
    }
    return coins.map((c) => (c.image ? c : { ...c, image: images.get(c.mint) }));
  } catch {
    return coins;
  }
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

  // A single page keeps this to one upstream request per search. GeckoTerminal
  // is the primary source (richer per-window stats), but its free public API
  // rate-limits aggressively — when it fails, fall over to Dexscreener (an
  // independent, real, free source covering the same Solana pools) instead
  // of surfacing a dead search box. Only if BOTH fail does the error surface.
  let coins: Coin[];
  try {
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
    coins = [...byMint.values()];
  } catch (geckoErr) {
    try {
      const pairs = await searchDexPairs(q);
      const byMint = new Map<string, Coin>();
      for (const pair of pairs) {
        const coin = dexPairToCoin(pair);
        const existing = byMint.get(coin.mint);
        if (!existing || (coin.liquidityUsd || 0) > (existing.liquidityUsd || 0)) {
          byMint.set(coin.mint, coin);
        }
      }
      coins = [...byMint.values()];
    } catch {
      throw geckoErr;
    }
  }

  coins = coins.sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0)).slice(0, 40);
  searchCache.set(q, { coins, expires: Date.now() + 15_000 });
  return { coins, live: true };
}

export async function getLiveCoin(mint: string): Promise<{ coin: Coin | undefined; live: boolean }> {
  const { coins, live } = await getLiveCoins();
  let coin = coins.find((c) => c.mint.toLowerCase() === mint.toLowerCase());

  // Not in the cached pump-fun/pumpswap top-60 — look it up directly by mint
  // across every dex, so any coin found via search still has a working page.
  // fetchTokenPools already swallows its own errors and returns an empty
  // list, so a GeckoTerminal outage looks the same as "no pools" here — fall
  // back to Dexscreener (independent real source) before giving up.
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
    } else {
      const pairs = await fetchDexTokenPairs(mint);
      const bestPair = [...pairs].sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      if (bestPair) coin = dexPairToCoin(bestPair);
    }
  }

  if (coin && coin.poolAddress) {
    const closes = await fetchPoolHourlyCloses(coin.poolAddress);
    if (closes.length > 4) {
      coin.priceHistory = closes;
      coin.range24h = { low: Math.min(...closes), high: Math.max(...closes) };
    }
  }
  // Description/website/socials only matter on this page, so fetch them
  // lazily here (one request) instead of eagerly for every coin in a list.
  if (coin) coin = await enrichSocials(coin).catch(() => coin as Coin);
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

let activityCache: { events: ActivityEvent[]; expires: number } | null = null;
const ACTIVITY_CACHE_MS = 30_000;
const ACTIVITY_COIN_COUNT = 6;
const ACTIVITY_PER_COIN = 6;

/**
 * A real, platform-wide "recent activity" feed — not simulated. Pulls the
 * most recent real trades from a handful of the busiest already-fetched
 * coins (no extra cost to find them) and merges them by real timestamp.
 * Each coin's trades cost one upstream request, so this is cached
 * server-side for ACTIVITY_CACHE_MS — the whole point of the feed is a
 * cheap, honest "still alive" signal, not a firehose.
 */
export async function getRecentActivity(): Promise<{ events: ActivityEvent[]; live: boolean }> {
  if (activityCache && activityCache.expires > Date.now()) return { events: activityCache.events, live: true };

  const { coins } = await getLiveCoins();
  const top = [...coins]
    .filter((c) => c.poolAddress)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, ACTIVITY_COIN_COUNT);

  const perCoin = await Promise.all(
    top.map(async (coin) => {
      const raw = await fetchPoolTrades(coin.poolAddress as string).catch(() => []);
      return raw.slice(0, ACTIVITY_PER_COIN).map((t, i): ActivityEvent => ({
        id: `${coin.mint}-${t.attributes.tx_hash}-${i}`,
        side: t.attributes.kind,
        trader: `${t.attributes.tx_from_address.slice(0, 4)}…${t.attributes.tx_from_address.slice(-4)}`,
        sol: Number(
          Number(t.attributes.kind === "buy" ? t.attributes.from_token_amount : t.attributes.to_token_amount).toFixed(3)
        ),
        tokens: Math.round(
          Number(t.attributes.kind === "buy" ? t.attributes.to_token_amount : t.attributes.from_token_amount)
        ),
        time: timeAgo(t.attributes.block_timestamp),
        txHash: t.attributes.tx_hash,
        ts: new Date(t.attributes.block_timestamp).getTime(),
        coinMint: coin.mint,
        coinTicker: coin.ticker,
        coinImage: coin.image,
        coinDoodle: coin.doodle,
        coinBg: coin.bg,
      }));
    })
  );

  const events = perCoin.flat().sort((a, b) => b.ts - a.ts).slice(0, 20);
  activityCache = { events, expires: Date.now() + ACTIVITY_CACHE_MS };
  return { events, live: true };
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
