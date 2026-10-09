import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { bondingCurvePda, isLegacyQuoteMint, PumpSdk } from "@pump-fun/pump-sdk";
import { fetchDexTokensBatch } from "@/lib/dexscreener/client";
import { solPriceUsd, usdPrices } from "@/lib/solana/prices";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { graduatedPoolFor } from "@/lib/pump/amm-trade";
import { resolveLiquidityUsd } from "./liquidity";
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

/** On-chain fallback for the liquidity (see liquidity.ts): the Pump.fun bonding curve's real SOL reserves, or the SOL
 *  side of the coin's PumpSwap pool. Each read is independent; any failure is just "not known" (null). */
async function onChainLiquidity(mint: string): Promise<{ curve: { complete: boolean; solQuoted: boolean; realSolLamports: number } | null; poolSolLamports: number | null }> {
  const out: { curve: { complete: boolean; solQuoted: boolean; realSolLamports: number } | null; poolSolLamports: number | null } = { curve: null, poolSolLamports: null };
  try {
    const connection = new Connection(serverRpcUrl(), "confirmed");
    const key = new PublicKey(mint);
    const vault = getAssociatedTokenAddressSync(NATIVE_MINT, graduatedPoolFor(key), true, TOKEN_PROGRAM_ID);
    const [curveInfo, vaultInfo] = await connection.getMultipleAccountsInfo([bondingCurvePda(key), vault]);
    const curve = curveInfo ? new PumpSdk().decodeBondingCurveNullable(curveInfo) : null;
    if (curve) out.curve = { complete: curve.complete, solQuoted: isLegacyQuoteMint(curve.quoteMint), realSolLamports: Number(curve.realQuoteReserves.toString()) };
    if (vaultInfo && vaultInfo.data.length >= 72) out.poolSolLamports = Number(vaultInfo.data.readBigUInt64LE(64));
  } catch {}
  return out;
}

export async function strategyQuote(mint: string): Promise<StrategyQuote> {
  const [prices, solUsd, eurUsd, market] = await Promise.all([
    usdPrices([mint, USDC_MINT]).catch(() => new Map<string, number>()),
    solPriceUsd().catch(() => 0),
    eurUsdRate(),
    tokenLiquidityAndChange(mint),
  ]);
  const sol = solUsd > 0 ? solUsd : null;
  // The feed first; only when it has no figure (typical for a coin still on its curve) is the chain read.
  const chain = market.liquidityUsd !== null && market.liquidityUsd > 0 ? { curve: null, poolSolLamports: null } : await onChainLiquidity(mint);
  const { liquidityUsd } = resolveLiquidityUsd({ dexUsd: market.liquidityUsd, curve: chain.curve, poolSolLamports: chain.poolSolLamports, solUsd: sol });
  return {
    tokenUsd: prices.get(mint) ?? null,
    solUsd: sol,
    usdcUsd: prices.get(USDC_MINT) ?? null,
    eurUsd,
    liquidityUsd,
    priceChangeH1Pct: market.priceChangeH1Pct,
  };
}
