import { fetchDexTokensBatch } from "@/lib/dexscreener/client";
import { solPriceUsd, usdPrices } from "@/lib/solana/prices";
import { USDC_MINT, type Rates } from "./plan";

/**
 * Server-only: the real, current numbers a strategy is checked against. Every field is either a real quote
 * from a live source or null — nothing is defaulted (a missing EUR rate disables EUR; it never becomes 1.1).
 */

export type StrategyQuote = Rates & {
  tokenUsd: number | null;
  /** USD liquidity of the deepest pool for this token. */
  liquidityUsd: number | null;
  /** How much the price moved in the last hour, in percent (can be negative). Null when unknown. */
  priceChangeH1Pct: number | null;
};

/** EUR→USD from the European Central Bank's daily reference rate (via frankfurter.dev). Null when it can't be read. */
export async function eurUsdRate(): Promise<number | null> {
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD", { next: { revalidate: 3600 }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const rate = Number(((await res.json()) as { rates?: { USD?: number } }).rates?.USD);
    return rate > 0.2 && rate < 5 ? rate : null;
  } catch {
    return null;
  }
}

/** The deepest pool's liquidity and its own 1-hour price change, from the same lookup (one Dexscreener call). */
async function tokenLiquidityAndChange(mint: string): Promise<{ liquidityUsd: number | null; priceChangeH1Pct: number | null }> {
  try {
    const best = (await fetchDexTokensBatch([mint])).filter((p) => p.baseToken.address === mint).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    const liq = best?.liquidity?.usd;
    const change = best?.priceChange?.h1;
    return {
      liquidityUsd: typeof liq === "number" && liq >= 0 ? liq : null,
      priceChangeH1Pct: typeof change === "number" && Number.isFinite(change) ? change : null,
    };
  } catch {
    return { liquidityUsd: null, priceChangeH1Pct: null };
  }
}

export async function strategyQuote(mint: string): Promise<StrategyQuote> {
  const [prices, solUsd, eurUsd, liquidity] = await Promise.all([
    usdPrices([mint, USDC_MINT]).catch(() => new Map<string, number>()),
    solPriceUsd().catch(() => 0),
    eurUsdRate(),
    tokenLiquidityAndChange(mint),
  ]);
  return {
    tokenUsd: prices.get(mint) ?? null,
    solUsd: solUsd > 0 ? solUsd : null,
    usdcUsd: prices.get(USDC_MINT) ?? null,
    eurUsd,
    ...liquidity,
  };
}
