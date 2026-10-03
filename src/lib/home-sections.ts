import { Coin } from "./types";
import { DictKey } from "./i18n/translations";

export type SectionId = "launched" | "graduated" | "recentlyActive" | "topGainers" | "trending" | "new";

export const SECTION_TITLE_KEYS: Record<SectionId, DictKey> = {
  launched: "home.section.launched",
  new: "home.section.new",
  trending: "home.section.trending",
  topGainers: "home.section.topGainers",
  recentlyActive: "home.section.recentlyActive",
  graduated: "home.section.graduated",
};

const DEFAULT_LAUNCHED_SPOTLIGHT_HOURS = 6;

export function launchedSpotlightMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.LAUNCHED_SPOTLIGHT_HOURS);
  const hours = Number.isFinite(n) && n > 0 ? n : DEFAULT_LAUNCHED_SPOTLIGHT_HOURS;
  return hours * 3_600_000;
}

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
 * "Lanzadas en PANDA" claims first (so it's never emptied out by the other
 * sections picking its coins first), then Tendencia, Mayores subidas, Activas,
 * Nuevas and Graduadas as before.
 */
export function buildHomeSections(coins: Coin[], perSection = 6, now: number = Date.now()): Record<SectionId, Coin[]> {
  const spotlightCutoff = now - launchedSpotlightMs();
  // Within the spotlight window, newest first; older PANDA launches still show, just below the spotlighted ones.
  const launched = [...coins]
    .filter((c) => c.launchedOnPanda)
    .sort((a, b) => {
      const aFresh = (a.pandaLaunchedAt ?? 0) >= spotlightCutoff;
      const bFresh = (b.pandaLaunchedAt ?? 0) >= spotlightCutoff;
      if (aFresh !== bFresh) return aFresh ? -1 : 1;
      return (b.pandaLaunchedAt ?? 0) - (a.pandaLaunchedAt ?? 0);
    });
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
    launched: claim(launched),
    trending: claim(trending),
    topGainers: claim(topGainers),
    recentlyActive: claim(recentlyActive),
    new: claim(fresh),
    graduated: claim(graduated),
  };
}
