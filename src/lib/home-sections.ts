import { Coin } from "./types";
import { DictKey } from "./i18n/translations";

export type SectionId = "graduated" | "recentlyActive" | "topGainers" | "trending" | "new";

export const SECTION_TITLE_KEYS: Record<SectionId, DictKey> = {
  new: "home.section.new",
  trending: "home.section.trending",
  topGainers: "home.section.topGainers",
  recentlyActive: "home.section.recentlyActive",
  graduated: "home.section.graduated",
};

function activityCount(coin: Coin): number {
  const w = coin.activity?.h1 || coin.activity?.m5;
  return w ? w.buys + w.sells : 0;
}

/**
 * Splits the real, already-fetched coin list into distinct sections — no
 * synthetic padding. Coins are claimed in priority order so a coin already
 * shown never repeats in another section, full stop — with a small live
 * pool that can leave a later section with fewer than perSection coins, or
 * none at all (see HomeSection, which renders nothing for an empty list),
 * rather than ever reusing a coin just to fill the row.
 * Claim order matches the sections' on-page order (see HomeFeed's SECTION_ORDER):
 * a coin that's already shown in Tendencia never also shows in Mayores subidas,
 * Activas, Nuevas or Graduadas.
 */
export function buildHomeSections(coins: Coin[], perSection = 6): Record<SectionId, Coin[]> {
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
    return picked;
  };

  return {
    trending: claim(trending),
    topGainers: claim(topGainers),
    recentlyActive: claim(recentlyActive),
    new: claim(fresh),
    graduated: claim(graduated),
  };
}
