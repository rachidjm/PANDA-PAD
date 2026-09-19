import { fetchTokenPools } from "@/lib/gecko/client";
import { fetchDexTokenPairs, fetchDexTokensBatch } from "@/lib/dexscreener/client";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

/** Current USD price for many mints — Dexscreener first (one batch call), GeckoTerminal for whatever it missed. Only real quotes; unknown mints are simply absent. */
export async function usdPrices(mints: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const unique = [...new Set(mints)];

  try {
    const bestLiquidity = new Map<string, number>();
    for (const p of await fetchDexTokensBatch(unique)) {
      const price = Number(p.priceUsd);
      const liq = p.liquidity?.usd || 0;
      if (price > 0 && liq >= (bestLiquidity.get(p.baseToken.address) ?? -1)) {
        prices.set(p.baseToken.address, price);
        bestLiquidity.set(p.baseToken.address, liq);
      }
    }
  } catch {
    // fall through to GeckoTerminal
  }

  await Promise.all(
    unique
      .filter((m) => !prices.has(m))
      .map(async (m) => {
        const { data } = await fetchTokenPools(m);
        const best = [...data].sort((a, b) => Number(b.attributes.reserve_in_usd || 0) - Number(a.attributes.reserve_in_usd || 0))[0];
        const price = Number(best?.attributes.base_token_price_usd);
        if (price > 0) prices.set(m, price);
      })
  );
  return prices;
}

/** Current SOL price in USD, or 0 if no source could give one. */
export async function solPriceUsd(): Promise<number> {
  try {
    const pairs = await fetchDexTokenPairs(SOL_MINT);
    const best = [...pairs].sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (Number(best?.priceUsd) > 0) return Number(best.priceUsd);
  } catch {
    // fall through
  }
  return (await usdPrices([SOL_MINT])).get(SOL_MINT) || 0;
}
