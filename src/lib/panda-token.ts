import { getLiveCoin } from "./live-coins";
import { Coin } from "./types";

export function pandaTokenMint(): string | null {
  const v = process.env.NEXT_PUBLIC_PANDA_TOKEN_MINT?.trim();
  return v || null;
}

/**
 * $PANDA's own live Coin — logo, live price, market cap, 24h change, real price history — fetched the exact
 * same way its own coin page is (getLiveCoin = getLiveCoinBase + enrichCoinDetail), so it never depends on
 * surviving the general list's quality/clone/liquidity filters or on GeckoTerminal/Dexscreener having indexed
 * it into the bulk feed yet. `null` when NEXT_PUBLIC_PANDA_TOKEN_MINT isn't set, or the mint genuinely
 * couldn't be read right now (a transient upstream failure — never thrown, so a page using this never 500s
 * over $PANDA specifically).
 */
export async function getPandaToken(): Promise<Coin | null> {
  const mint = pandaTokenMint();
  if (!mint) return null;
  try {
    const { coin } = await getLiveCoin(mint);
    return coin ?? null;
  } catch {
    return null;
  }
}
