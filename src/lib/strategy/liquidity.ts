/**
 * Which liquidity figure a strategy is checked against, from the sources that may or may not answer for a coin. Pure,
 * so the choice is tested without a network (the reads themselves live in market.ts).
 *
 *   1. The market data feed (Dexscreener) when it reports a pool liquidity.
 *   2. A coin still on its Pump.fun bonding curve: the curve's REAL SOL reserves — the SOL that actually pays a seller —
 *      counted on both sides like a pool's liquidity (×2), at the live SOL price. Dexscreener often has no liquidity
 *      figure at all for curve coins, which used to block every order with "liquidity can't be read".
 *   3. A graduated coin the feed doesn't know yet: its PumpSwap pool's SOL side, ×2.
 *   4. Nothing readable: null — and the UI says so plainly ("try again in a minute"), never a guess.
 */

export type LiquiditySources = {
  dexUsd: number | null;
  /** The coin's bonding curve, if it has one: whether it's complete, and its real SOL reserves in lamports. */
  curve: { complete: boolean; solQuoted: boolean; realSolLamports: number } | null;
  /** SOL held by the coin's PumpSwap pool (lamports), if it has one. */
  poolSolLamports: number | null;
  solUsd: number | null;
};

export type LiquiditySource = "dex" | "curve" | "pool" | null;

export function resolveLiquidityUsd(s: LiquiditySources): { liquidityUsd: number | null; source: LiquiditySource } {
  if (typeof s.dexUsd === "number" && Number.isFinite(s.dexUsd) && s.dexUsd > 0) return { liquidityUsd: s.dexUsd, source: "dex" };
  const sol = s.solUsd && s.solUsd > 0 ? s.solUsd : null;
  if (sol && s.curve && !s.curve.complete && s.curve.solQuoted && s.curve.realSolLamports >= 0) {
    return { liquidityUsd: ((2 * s.curve.realSolLamports) / 1e9) * sol, source: "curve" };
  }
  if (sol && typeof s.poolSolLamports === "number" && s.poolSolLamports > 0) {
    return { liquidityUsd: ((2 * s.poolSolLamports) / 1e9) * sol, source: "pool" };
  }
  return { liquidityUsd: null, source: null };
}
