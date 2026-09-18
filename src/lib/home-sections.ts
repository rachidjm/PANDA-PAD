import { Coin } from "./types";

export type SectionId = "graduated" | "recentlyActive" | "topGainers" | "trending" | "new";

export const SECTION_TITLES: Record<SectionId, string> = {
  new: "New",
  trending: "Trending",
  topGainers: "Top Gainers",
  recentlyActive: "Recently Active",
  graduated: "Graduated",
};

function activityCount(coin: Coin): number {
  const w = coin.activity?.h1 || coin.activity?.m5;
  return w ? w.buys + w.sells : 0;
}

/**
 * Splits the real, already-fetched coin list into distinct sections — no
 * synthetic padding. Coins are claimed in priority order so the same coin
 * doesn't dominate every section; a coin only repeats across sections if a
 * section would otherwise come up empty. A section with zero real
 * qualifying coins is simply left empty (see HomeSection, which renders
 * nothing for an empty list) rather than backfilled with anything fake.
 */
export function buildHomeSections(coins: Coin[], perSection = 8): Record<SectionId, Coin[]> {
  const graduated = [...coins].filter((c) => c.source === "pumpswap");
  const recentlyActive = [...coins].sort((a, b) => activityCount(b) - activityCount(a));
  const topGainers = [...coins].filter((c) => c.changePct > 0).sort((a, b) => b.changePct - a.changePct);
  const trending = [...coins].sort((a, b) => b.volume24h - a.volume24h);
  const fresh = [...coins].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const claimed = new Set<string>();
  const claim = (list: Coin[]): Coin[] => {
    const picked: Coin[] = [];
    for (const coin of list) {
      if (picked.length >= perSection) break;
      if (claimed.has(coin.mint)) continue;
      picked.push(coin);
      claimed.add(coin.mint);
    }
    // Only fall back to allowing repeats if this section would otherwise be
    // completely empty — never just to pad out the count.
    if (picked.length === 0) return list.slice(0, perSection);
    return picked;
  };

  return {
    graduated: claim(graduated),
    recentlyActive: claim(recentlyActive),
    topGainers: claim(topGainers),
    trending: claim(trending),
    new: claim(fresh),
  };
}
