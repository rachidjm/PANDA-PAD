import { NextResponse } from "next/server";
import { dexPairToCoin, getLiveCoins } from "@/lib/live-coins";
import { assessCoin } from "@/lib/quality/coin-quality";
import { fetchDexTokensBatch, type DexPair } from "@/lib/dexscreener/client";
import { fetchNewestPumpCoins } from "@/lib/pump/frontend-api";
import type { CoinSource } from "@/lib/types";

export type Launch = {
  mint: string;
  ticker: string;
  name: string;
  image?: string;
  bg: string;
  marketCap: number;
  createdAt: string;
  /** True when `createdAt` is the coin's real Pump.fun launch time. */
  verified: boolean;
  source: CoinSource;
  /** Full X/Twitter URL the project itself published — never guessed. */
  twitterUrl?: string;
};

const CACHE_MS = 30_000;
const SHOWN = 6;
// Brand-new coins are mostly dust; skip the ones with no traction at all so the list isn't a wall of $2K coins.
const MIN_MARKET_CAP_USD = 8_000;
let cache: { launches: Launch[]; expires: number } | null = null;

/** The newest coins straight from Pump.fun's own launch feed (real launch time, real socials). */
async function fromPumpFeed(): Promise<Launch[]> {
  const feed = await fetchNewestPumpCoins(60);
  // One coin per name/ticker (highest market cap wins) — lookalikes launched minutes apart confuse buyers.
  const seen = new Set<string>();
  const unique = feed
    .filter((c) => !c.nsfw && !c.banned && c.usdMarketCap >= MIN_MARKET_CAP_USD)
    .sort((a, b) => b.usdMarketCap - a.usdMarketCap)
    .filter((c) => {
      const keys = [c.symbol, c.name].map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean);
      if (keys.some((k) => seen.has(k))) return false;
      keys.forEach((k) => seen.add(k));
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // The data-quality gate. Pump.fun's own market cap is only live while a coin is on the curve (there it must be a real
  // curve price); once graduated it goes stale, so a graduated launch is shown only if Dexscreener has a real pool for it
  // that passes the same checks as the coin lists — and then with THAT market cap, not the stale one.
  const candidates = unique.slice(0, 24);
  const graduatedMints = candidates.filter((c) => c.graduated).map((c) => c.mint);
  const pools = new Map<string, DexPair>();
  if (graduatedMints.length > 0) {
    try {
      for (const p of await fetchDexTokensBatch(graduatedMints)) {
        const cur = pools.get(p.baseToken.address);
        if (!cur || (p.liquidity?.usd || 0) > (cur.liquidity?.usd || 0)) pools.set(p.baseToken.address, p);
      }
    } catch {
      // No pool data: graduated launches can't be verified this round and are left out rather than shown unchecked.
    }
  }

  const verified: Launch[] = [];
  for (const c of candidates) {
    let marketCap = c.usdMarketCap;
    if (c.graduated) {
      const pair = pools.get(c.mint);
      if (!pair) continue;
      const coin = dexPairToCoin(pair);
      if (assessCoin(coin).quality !== "ok") continue;
      marketCap = coin.marketCap;
    } else if (assessCoin({ source: "pump-fun", marketCap, changePct: 0, liquidityUsd: undefined, sourceMarketCaps: undefined }).quality !== "ok") {
      continue;
    }
    verified.push({
      mint: c.mint,
      ticker: c.symbol.toUpperCase(),
      name: c.name,
      image: c.image,
      bg: "#171512",
      marketCap,
      createdAt: c.createdAt,
      verified: true,
      source: c.graduated ? ("pumpswap" as const) : ("pump-fun" as const),
      twitterUrl: c.twitter,
    });
  }
  return verified.slice(0, SHOWN);
}

/** Fallback if Pump.fun's feed is unreachable: the newest of the coins PANDA already lists, socials via Dexscreener. */
async function fromLiveList(): Promise<Launch[]> {
  const { coins } = await getLiveCoins();
  const newest = [...coins].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, SHOWN);

  const socials = new Map<string, string>();
  try {
    for (const p of await fetchDexTokensBatch(newest.map((c) => c.mint))) {
      const tw = p.info?.socials?.find((s) => s.type === "twitter")?.url;
      if (tw && !socials.has(p.baseToken.address)) socials.set(p.baseToken.address, tw);
    }
  } catch {
    // Socials are a nice-to-have.
  }

  return newest.map((c) => ({
    mint: c.mint,
    ticker: c.ticker,
    name: c.name,
    image: c.image,
    bg: c.bg,
    marketCap: c.marketCap,
    createdAt: c.createdAt,
    verified: !!c.launchVerified,
    source: c.source,
    twitterUrl: socials.get(c.mint),
  }));
}

export async function GET() {
  if (cache && cache.expires > Date.now()) return NextResponse.json({ launches: cache.launches });

  let launches: Launch[] = [];
  try {
    launches = await fromPumpFeed();
  } catch (err) {
    console.error("Pump.fun launch feed failed", err);
  }
  if (launches.length === 0) launches = await fromLiveList();

  if (launches.length > 0) cache = { launches, expires: Date.now() + CACHE_MS };
  return NextResponse.json({ launches });
}
