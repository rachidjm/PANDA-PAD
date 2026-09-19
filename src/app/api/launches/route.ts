import { NextResponse } from "next/server";
import { getLiveCoins } from "@/lib/live-coins";
import { fetchDexTokensBatch } from "@/lib/dexscreener/client";

export type Launch = {
  mint: string;
  ticker: string;
  name: string;
  image?: string;
  bg: string;
  marketCap: number;
  createdAt: string;
  /** Full X/Twitter profile URL the project itself published — never guessed. */
  twitterUrl?: string;
};

const CACHE_MS = 60_000;
let cache: { launches: Launch[]; expires: number } | null = null;

/**
 * Newest real launches from the live coin list, enriched with each project's
 * own published X link via one Dexscreener batch call (independent of
 * GeckoTerminal, so this never adds to that source's rate-limit pressure).
 */
export async function GET() {
  if (cache && cache.expires > Date.now()) return NextResponse.json({ launches: cache.launches });

  const { coins } = await getLiveCoins();
  const newest = [...coins].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6);

  const socials = new Map<string, string>();
  try {
    const pairs = await fetchDexTokensBatch(newest.map((c) => c.mint));
    for (const p of pairs) {
      const tw = p.info?.socials?.find((s) => s.type === "twitter")?.url;
      if (tw && !socials.has(p.baseToken.address)) socials.set(p.baseToken.address, tw);
    }
  } catch {
    // Socials are a nice-to-have — the launch rows still render without them.
  }

  const launches: Launch[] = newest.map((c) => ({
    mint: c.mint,
    ticker: c.ticker,
    name: c.name,
    image: c.image,
    bg: c.bg,
    marketCap: c.marketCap,
    createdAt: c.createdAt,
    twitterUrl: socials.get(c.mint),
  }));

  if (launches.length > 0) cache = { launches, expires: Date.now() + CACHE_MS };
  return NextResponse.json({ launches });
}
