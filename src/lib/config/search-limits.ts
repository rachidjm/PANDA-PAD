/**
 * Thresholds for search result grouping and hiding (src/lib/market/search-rank.ts) — configurable so the
 * balance between "clean" and "nothing real goes missing" can be tuned without a code change.
 */

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Below this (and with no 24h volume), a coin is collapsed into "Mostrar resultados ocultos" by default —
 *  never deleted, and never applied to an exact contract-address match, a PANDA-launched coin, or one the
 *  searching wallet holds. Configurable via SEARCH_MIN_LIQUIDITY_USD; defaults to $1,000. */
export function searchMinLiquidityUsd(): number {
  return envNumber("SEARCH_MIN_LIQUIDITY_USD", 1000);
}

/** How many times more liquidity an unverified coin needs over a verified one to still lead its group.
 *  Configurable via SEARCH_DOMINANT_LIQUIDITY_RATIO; defaults to 3x. */
export function searchDominantLiquidityRatio(): number {
  return envNumber("SEARCH_DOMINANT_LIQUIDITY_RATIO", 3);
}

/** How different two names can be (as a fraction of the longer one's length) and still count as the same
 *  coin. Configurable via SEARCH_NAME_MAX_DISTANCE_RATIO; defaults to 0.15 (15%). */
export function searchNameMaxDistanceRatio(): number {
  return envNumber("SEARCH_NAME_MAX_DISTANCE_RATIO", 0.15);
}
