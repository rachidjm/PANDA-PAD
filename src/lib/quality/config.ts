/**
 * Every threshold of the coin data-quality filter, in ONE place. Starting values are deliberately conservative: a
 * healthy coin wrongly hidden costs a click (it is still reachable by its link and in the "suspect" list); a junk pool
 * shown on the home page costs users money. Retune only by looking at src/lib/quality/*.test.ts and the real list.
 *
 * Calibrated against the real production list (panda-pad.vercel.app/api/coins, 50 coins, 2026-09-23):
 *  - healthy graduated pools had market cap / liquidity of 4–19 (median ~5) and 24h change up to ~5,500%;
 *  - the junk pools had 25–126 (ECTF 126, USDF 126, OURA 95, FRIC 54, VSOF 39, USMS 34, AROS 29) with 24h changes of
 *    13,983%–261,149%;
 *  - the smallest healthy liquidity was ~$15.5k;
 *  - live bonding-curve coins had market caps of $33k–$84k and NO liquidity figure (a curve pair has no pool).
 */
export const QUALITY_CONFIG = {
  /** Below this a pool is too thin for any price to mean anything (smallest healthy pool seen: ~$15.5k). */
  minLiquidityUsd: 5_000,

  /**
   * Market cap above this many times the pool's liquidity is a price that liquidity can't support: someone moved the
   * price with a sliver of liquidity. Healthy pools were 4–19×, junk 25–126×. (The launch bar was "never above 100×";
   * 30× keeps a wide margin under that and above every healthy pool seen.)
   */
  maxMarketCapToLiquidity: 30,

  /** A 24h change above this (percent) on a thin pool is not organic (healthy hot coins peaked around 5,500%; junk started at ~14,000%)... */
  extremeChangePct: 3_000,
  /** ...where "thin" means less than this much liquidity. Above it, only the market-cap/liquidity rule applies. */
  extremeChangeLowLiquidityUsd: 500_000,

  /**
   * A coin still on Pump.fun's bonding curve has a market cap that is bounded by the curve (highest seen: ~$84k). Above
   * this it is not a real curve price — roughly 3× the highest seen, so normal variation never trips it.
   */
  maxCurveMarketCapUsd: 250_000,

  /**
   * Two independent sources must agree on the market cap of the same coin: (max − min) / min above this is "the
   * sources disagree", so neither is trusted. Pump.fun's live curve and Dexscreener normally agree within a few
   * percent; 35% leaves room for a stale quote without letting a 2× disagreement through.
   */
  maxSourceDisagreement: 0.35,
} as const;

export type QualityConfig = typeof QUALITY_CONFIG;
