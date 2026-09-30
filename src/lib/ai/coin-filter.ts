import type { Coin } from "@/lib/types";
import type { RugLevel } from "@/lib/rugcheck/summary";

/** What "Buscar monedas" turns natural language into (src/app/api/ai/search-filters/route.ts) — every field
 *  null/false means "no opinion on this", so an empty filter matches everything, same as no filter at all. */
export type AiCoinFilter = {
  maxAgeHours: number | null;
  minLiquidityUsd: number | null;
  minMarketCap: number | null;
  maxMarketCap: number | null;
  /** True only when the user asked for a real safety signal ("verde", "seguras") — checked against RugCheck's own level, never invented. */
  rugSafe: boolean;
  sort: "new" | "trending" | "mcap" | "volume" | null;
};

export const EMPTY_AI_FILTER: AiCoinFilter = { maxAgeHours: null, minLiquidityUsd: null, minMarketCap: null, maxMarketCap: null, rugSafe: false, sort: null };

/** True when this filter would actually exclude anything (an all-null/false filter is a no-op, not "match nothing"). */
export function isActiveAiFilter(f: AiCoinFilter): boolean {
  return f.maxAgeHours !== null || f.minLiquidityUsd !== null || f.minMarketCap !== null || f.maxMarketCap !== null || f.rugSafe;
}

/**
 * Pure — no network. `rugLevelByMint` is whatever RugCheck data the caller already has (a coin with none is
 * simply not excluded by `rugSafe`, since "unknown" is never treated as unsafe OR safe — see the caller,
 * which fetches it in batch for the coins on screen before applying `rugSafe`).
 */
export function applyAiCoinFilter(coins: Coin[], filter: AiCoinFilter, rugLevelByMint: Record<string, RugLevel | undefined> = {}): Coin[] {
  const nowMs = Date.now();
  return coins.filter((c) => {
    if (filter.maxAgeHours !== null) {
      const ageHours = (nowMs - new Date(c.createdAt).getTime()) / 3_600_000;
      if (!(ageHours <= filter.maxAgeHours)) return false;
    }
    if (filter.minLiquidityUsd !== null && !(((c.liquidityUsd ?? 0) >= filter.minLiquidityUsd))) return false;
    if (filter.minMarketCap !== null && !(c.marketCap >= filter.minMarketCap)) return false;
    if (filter.maxMarketCap !== null && !(c.marketCap <= filter.maxMarketCap)) return false;
    if (filter.rugSafe) {
      const level = rugLevelByMint[c.mint];
      if (level !== "good") return false; // unknown (not yet fetched) is excluded too — "safe" must be a real, known signal
    }
    return true;
  });
}
