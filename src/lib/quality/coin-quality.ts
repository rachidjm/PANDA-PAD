import type { Coin, QualityReason } from "@/lib/types";
import { QUALITY_CONFIG, type QualityConfig } from "./config";

/**
 * The one data-quality gate for coin lists (home, Discover, search, Analytics, activity). It never deletes: a coin
 * that fails is returned marked `quality: "suspect"` with its reasons, so it can be audited, and the public lists use
 * only the `ok` ones. Pure and deterministic — thresholds live in ./config.ts.
 */

export type CoinQuality = { quality: "ok" | "suspect"; reasons: QualityReason[] };

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function assessCoin(coin: Pick<Coin, "mint" | "source" | "marketCap" | "liquidityUsd" | "changePct" | "sourceMarketCaps">, cfg: QualityConfig = QUALITY_CONFIG): CoinQuality {
  // The allowlist wins over every rule.
  if (cfg.allowlistMints.includes(coin.mint)) return { quality: "ok", reasons: [] };

  const reasons: QualityReason[] = [];

  if (!positive(coin.marketCap)) reasons.push("invalid_data");

  if (coin.source === "pump-fun") {
    // On the bonding curve: there is no pool, so no liquidity figure — the curve itself bounds the market cap.
    if (positive(coin.marketCap) && coin.marketCap > cfg.maxCurveMarketCapUsd) reasons.push("curve_mc_too_high");
  } else if (!positive(coin.liquidityUsd)) {
    reasons.push("no_liquidity_data");
  } else {
    if (coin.liquidityUsd < cfg.minLiquidityUsd) reasons.push("low_liquidity");
    if (positive(coin.marketCap) && coin.marketCap > coin.liquidityUsd * cfg.maxMarketCapToLiquidity) reasons.push("mc_over_liquidity");
    if (Number.isFinite(coin.changePct) && coin.changePct > cfg.extremeChangePct && coin.liquidityUsd < cfg.extremeChangeLowLiquidityUsd) {
      reasons.push("extreme_change_low_liquidity");
    }
  }

  const reported = Object.values(coin.sourceMarketCaps ?? {}).filter(positive);
  if (reported.length >= 2) {
    const lo = Math.min(...reported);
    const hi = Math.max(...reported);
    if ((hi - lo) / lo > cfg.maxSourceDisagreement) reasons.push("sources_disagree");
  }

  return { quality: reasons.length ? "suspect" : "ok", reasons };
}

/** Marks a coin without changing anything else. */
export function withQuality<T extends Coin>(coin: T, cfg?: QualityConfig): T {
  const q = assessCoin(coin, cfg);
  return { ...coin, quality: q.quality, qualityReasons: q.reasons };
}

/** Splits a list into what may be shown and what is kept aside (marked, with reasons). Order is preserved; nothing is dropped. */
export function partitionByQuality<T extends Coin>(coins: T[], cfg?: QualityConfig): { ok: T[]; suspect: T[] } {
  const ok: T[] = [];
  const suspect: T[] = [];
  for (const c of coins) {
    const marked = withQuality(c, cfg);
    (marked.quality === "ok" ? ok : suspect).push(marked);
  }
  return { ok, suspect };
}
