import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { fetchTokenPools } from "@/lib/gecko/client";
import { Coin, PortfolioHolding } from "@/lib/types";

const SOL_HOLDING: Omit<PortfolioHolding, "amount" | "valueUsd"> = {
  mint: "So11111111111111111111111111111111111111112",
  decimals: 9,
  symbol: "SOL",
  name: "Solana",
};

/**
 * Reads everything real that a wallet holds — its SOL balance plus every SPL
 * token account with a nonzero balance — directly from Solana. Read-only:
 * PANDA never touches these funds, only looks at them. Prices are filled in
 * only where a real source has one (PANDA-launched coins already in `coins`,
 * or any token GeckoTerminal indexes); everything else shows no price rather
 * than a guessed one.
 */
export async function getWalletPortfolio(
  connection: Connection,
  owner: PublicKey,
  coins: Coin[]
): Promise<PortfolioHolding[]> {
  const [lamports, tokenAccounts] = await Promise.all([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
  ]);

  const byMint = new Map(coins.map((c) => [c.mint.toLowerCase(), c]));

  const splHoldings = tokenAccounts.value
    .map((acc): PortfolioHolding | null => {
      const info = acc.account.data.parsed?.info;
      const amount = info?.tokenAmount?.uiAmount;
      if (!amount || amount <= 0) return null;
      const mint = info.mint as string;
      const coin = byMint.get(mint.toLowerCase());
      return {
        mint,
        amount,
        decimals: info.tokenAmount.decimals,
        symbol: coin?.ticker,
        name: coin?.name,
        image: coin?.image,
        doodle: coin?.doodle,
        bg: coin?.bg,
        changePct: coin?.changePct,
      };
    })
    .filter((h): h is PortfolioHolding => h !== null);

  // Fill in a real USD price/value for as many holdings as we reasonably can
  // — one GeckoTerminal request per unpriced token. GeckoTerminal's free
  // tier is a shared, easily-saturated rate limit (see live-coins.ts), so a
  // wallet holding many tokens only gets its largest few enriched; the rest
  // still show up, just without a value, instead of one portfolio load
  // burning the whole app's request budget.
  const MAX_PRICE_LOOKUPS = 12;
  const toPrice = [...splHoldings].sort((a, b) => b.amount - a.amount).slice(0, MAX_PRICE_LOOKUPS);
  const priceByMint = new Map<string, number>();
  await Promise.all(
    toPrice.map(async (h) => {
      const { data } = await fetchTokenPools(h.mint);
      const best = [...data].sort(
        (a, b) => Number(b.attributes.reserve_in_usd || 0) - Number(a.attributes.reserve_in_usd || 0)
      )[0];
      if (best?.attributes.base_token_price_usd) priceByMint.set(h.mint, Number(best.attributes.base_token_price_usd));
    })
  );
  const priced = splHoldings.map((h) => {
    const priceUsd = priceByMint.get(h.mint);
    return { ...h, priceUsd, valueUsd: priceUsd !== undefined ? priceUsd * h.amount : undefined };
  });

  const solPool = await fetchTokenPools(SOL_HOLDING.mint);
  const solBest = [...solPool.data].sort(
    (a, b) => Number(b.attributes.reserve_in_usd || 0) - Number(a.attributes.reserve_in_usd || 0)
  )[0];
  const solPriceUsd = solBest?.attributes.base_token_price_usd ? Number(solBest.attributes.base_token_price_usd) : undefined;
  const solAmount = lamports / LAMPORTS_PER_SOL;

  const sol: PortfolioHolding = {
    ...SOL_HOLDING,
    amount: solAmount,
    priceUsd: solPriceUsd,
    valueUsd: solPriceUsd !== undefined ? solPriceUsd * solAmount : undefined,
  };

  return [sol, ...priced].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
}

export function totalPortfolioValueUsd(holdings: PortfolioHolding[]): number | null {
  const known = holdings.filter((h) => h.valueUsd !== undefined);
  if (known.length === 0) return null;
  return known.reduce((sum, h) => sum + (h.valueUsd || 0), 0);
}
