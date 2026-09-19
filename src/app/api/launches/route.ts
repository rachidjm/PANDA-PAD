import { NextResponse } from "next/server";
import { getLiveCoins } from "@/lib/live-coins";
import { fetchDexTokensBatch } from "@/lib/dexscreener/client";
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
const MIN_MARKET_CAP_USD = 3_000;
let cache: { launches: Launch[]; expires: number } | null = null;

/** The newest coins straight from Pump.fun's own launch feed (real launch time, real socials). */
async function fromPumpFeed(): Promise<Launch[]> {
  const feed = await fetchNewestPumpCoins(60);
  return feed
    .filter((c) => !c.nsfw && !c.banned && c.usdMarketCap >= MIN_MARKET_CAP_USD)
    .slice(0, SHOWN)
    .map((c) => ({
      mint: c.mint,
      ticker: c.symbol.toUpperCase(),
      name: c.name,
      image: c.image,
      bg: "#171512",
      marketCap: c.usdMarketCap,
      createdAt: c.createdAt,
      verified: true,
      source: c.graduated ? ("pumpswap" as const) : ("pump-fun" as const),
      twitterUrl: c.twitter,
    }));
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
