import { Coin } from "./types";
import { SectionId } from "./home-sections";

/**
 * Guarantees $PANDA is in `sections.launched`, always first, and nowhere else — overriding whatever
 * `buildHomeSections` naturally decided, so it's never at the mercy of the general feed's freshness sort or a
 * spam/clone/liquidity filter applied upstream, and never silently duplicated into another section it also
 * happened to get claimed into. A no-op when `pandaCoin` is null (NEXT_PUBLIC_PANDA_TOKEN_MINT unset, or
 * genuinely unreadable this request).
 */
export function ensurePandaLaunchedFirst(sections: Record<SectionId, Coin[]>, pandaCoin: Coin | null): Record<SectionId, Coin[]> {
  if (!pandaCoin) return sections;
  const mint = pandaCoin.mint.toLowerCase();
  const next = { ...sections };
  for (const id of Object.keys(next) as SectionId[]) {
    if (id === "launched") continue;
    next[id] = next[id].filter((c) => c.mint.toLowerCase() !== mint);
  }
  next.launched = [pandaCoin, ...next.launched.filter((c) => c.mint.toLowerCase() !== mint)];
  return next;
}

export type MintItem = { mint: string };

/**
 * Same guarantee for a flat "latest launches" style list (src/app/api/launches/route.ts): `panda` always
 * first, de-duplicated, list length capped at `maxLength`. A no-op when `panda` is null.
 */
export function ensurePandaLaunchFirst<T extends MintItem>(list: T[], panda: T | null, maxLength: number): T[] {
  if (!panda) return list.slice(0, maxLength);
  const mint = panda.mint.toLowerCase();
  return [panda, ...list.filter((l) => l.mint.toLowerCase() !== mint)].slice(0, maxLength);
}
