import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { fetchTokenPools, fetchTokensMulti, priceOfMintInPools } from "@/lib/gecko/client";
import { Coin, PortfolioHolding } from "@/lib/types";

const SOL_HOLDING: Omit<PortfolioHolding, "amount" | "valueUsd"> = {
  mint: "So11111111111111111111111111111111111111112",
  decimals: 9,
  symbol: "SOL",
  name: "Solana",
};

/**
 * Reads everything real that a wallet holds — its SOL balance plus every SPL
 * and Token-2022 token account with a nonzero balance — directly from Solana. Read-only:
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
  // Pump.fun launches new coins under Token-2022, so a wallet's tokens live under TWO token programs: reading only the classic one hid
  // every recent pump.fun coin (the buyer saw the purchase in Activity but not in Holdings).
  const [lamports, classic, token2022] = await Promise.all([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);

  const byMint = new Map(coins.map((c) => [c.mint.toLowerCase(), c]));

  // One row per mint (several token accounts of the same mint are summed).
  const balances = new Map<string, { amount: number; decimals: number }>();
  for (const acc of [...classic.value, ...token2022.value]) {
    const info = acc.account.data.parsed?.info;
    const amount = info?.tokenAmount?.uiAmount;
    if (!amount || amount <= 0) continue;
    const mint = info.mint as string;
    const cur = balances.get(mint);
    balances.set(mint, { amount: (cur?.amount ?? 0) + amount, decimals: info.tokenAmount.decimals });
  }

  // Name, logo and price for tokens PANDA didn't launch come from GeckoTerminal — ONE batched request for the whole wallet (plus SOL).
  const mints = [...balances.keys()];
  const meta = await fetchTokensMulti([SOL_HOLDING.mint, ...mints]);

  const splHoldings = mints.map((mint): PortfolioHolding => {
    const { amount, decimals } = balances.get(mint)!;
    const coin = byMint.get(mint.toLowerCase());
    const info = meta.get(mint);
    return {
      mint,
      amount,
      decimals,
      symbol: coin?.ticker ?? (info?.symbol || undefined),
      name: coin?.name ?? (info?.name || undefined),
      image: coin?.image ?? (info?.image_url && !/missing/.test(info.image_url) ? info.image_url : undefined),
      doodle: coin?.doodle,
      bg: coin?.bg,
      changePct: coin?.changePct,
    };
  });

  const priceByMint = new Map<string, number>();
  const batchPrice = (mint: string) => {
    const p = Number(meta.get(mint)?.price_usd);
    return Number.isFinite(p) && p > 0 ? p : undefined;
  };
  for (const h of splHoldings) {
    const p = batchPrice(h.mint);
    if (p !== undefined) priceByMint.set(h.mint, p);
  }
  // Only tokens the batch couldn't price get an individual pool lookup (GeckoTerminal's free tier is a shared, easily-saturated rate
  // limit — see live-coins.ts — so only the largest few are tried; the rest show "no price" rather than a guessed one).
  const MAX_PRICE_LOOKUPS = 6;
  const toPrice = splHoldings.filter((h) => !priceByMint.has(h.mint)).sort((a, b) => b.amount - a.amount).slice(0, MAX_PRICE_LOOKUPS);
  await Promise.all(
    toPrice.map(async (h) => {
      const { data } = await fetchTokenPools(h.mint);
      const price = priceOfMintInPools(data, h.mint);
      if (price !== undefined) priceByMint.set(h.mint, price);
    })
  );
  const priced = splHoldings.map((h) => {
    const priceUsd = priceByMint.get(h.mint);
    return { ...h, priceUsd, valueUsd: priceUsd !== undefined ? priceUsd * h.amount : undefined };
  });

  const solPriceUsd = batchPrice(SOL_HOLDING.mint) ?? priceOfMintInPools((await fetchTokenPools(SOL_HOLDING.mint)).data, SOL_HOLDING.mint);
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
