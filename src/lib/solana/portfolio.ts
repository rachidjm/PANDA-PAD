import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Coin, PortfolioHolding } from "@/lib/types";
import type { TokenMeta } from "@/lib/tokens/meta";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_HOLDING: Omit<PortfolioHolding, "amount" | "valueUsd"> = {
  mint: SOL_MINT,
  decimals: 9,
  symbol: "SOL",
  name: "Solana",
};

/** Name, logo, price and 24 h change for these mints, from PANDA's own /api/tokens/meta (the browser never calls the indexers itself). */
async function fetchMeta(mints: string[]): Promise<Record<string, TokenMeta>> {
  const out: Record<string, TokenMeta> = {};
  for (let i = 0; i < mints.length; i += 60) {
    try {
      const res = await fetch(`/api/tokens/meta?mints=${mints.slice(i, i + 60).join(",")}`, { cache: "no-store" });
      if (!res.ok) continue;
      Object.assign(out, ((await res.json()) as { tokens?: Record<string, TokenMeta> }).tokens ?? {});
    } catch {
      // that batch stays without metadata: the holdings are still listed
    }
  }
  return out;
}

/**
 * Reads everything real that a wallet holds — its SOL balance plus every SPL and Token-2022 token account with a nonzero balance — directly
 * from Solana, the way a wallet app lists it: SOL first-class, both token programs, one row per mint, each with its USD value and 24 h change.
 * Read-only: PANDA never touches these funds, only looks at them. Names, logos, prices and 24 h changes come from PANDA-launched coins already in
 * `coins`, else from PANDA's /api/tokens/meta (GeckoTerminal, then Jupiter); whatever no source has stays absent — no price and no change
 * rather than a guessed one.
 */
export async function getWalletPortfolio(connection: Connection, owner: PublicKey, coins: Coin[]): Promise<PortfolioHolding[]> {
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

  const mints = [...balances.keys()];
  const meta = await fetchMeta([SOL_MINT, ...mints]);
  const priceOf = (mint: string) => {
    const p = meta[mint]?.priceUsd;
    return typeof p === "number" && Number.isFinite(p) && p > 0 ? p : undefined;
  };

  const tokens = mints.map((mint): PortfolioHolding => {
    const { amount, decimals } = balances.get(mint)!;
    const coin = byMint.get(mint.toLowerCase());
    const m = meta[mint];
    const priceUsd = priceOf(mint);
    return {
      mint,
      amount,
      decimals,
      symbol: coin?.ticker ?? m?.symbol,
      name: coin?.name ?? m?.name,
      image: coin?.image ?? m?.image,
      doodle: coin?.doodle,
      bg: coin?.bg,
      changePct: coin?.changePct ?? m?.change24h,
      priceUsd,
      valueUsd: priceUsd !== undefined ? priceUsd * amount : undefined,
    };
  });

  const solAmount = lamports / LAMPORTS_PER_SOL;
  const solPrice = priceOf(SOL_MINT);
  const sol: PortfolioHolding = {
    ...SOL_HOLDING,
    amount: solAmount,
    image: meta[SOL_MINT]?.image,
    changePct: meta[SOL_MINT]?.change24h,
    priceUsd: solPrice,
    valueUsd: solPrice !== undefined ? solPrice * solAmount : undefined,
  };

  return [sol, ...tokens].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
}

export function totalPortfolioValueUsd(holdings: PortfolioHolding[]): number | null {
  const known = holdings.filter((h) => h.valueUsd !== undefined);
  if (known.length === 0) return null;
  return known.reduce((sum, h) => sum + (h.valueUsd || 0), 0);
}

/**
 * The wallet's 24 h change in USD and percent, like the figure at the top of a wallet app: for every priced holding with a 24 h change, what it
 * was worth a day ago is value / (1 + change/100). Holdings without a price or a change are left out of BOTH sides (`covered` says how many
 * were counted), so the figure is never inflated by guesses. null when nothing has both.
 */
export function portfolioChange24h(holdings: PortfolioHolding[]): { usd: number; pct: number; covered: number; of: number } | null {
  let now = 0;
  let before = 0;
  let covered = 0;
  for (const h of holdings) {
    if (h.valueUsd === undefined || h.changePct === undefined || !Number.isFinite(h.changePct) || h.changePct <= -100) continue;
    now += h.valueUsd;
    before += h.valueUsd / (1 + h.changePct / 100);
    covered++;
  }
  if (covered === 0 || before <= 0) return null;
  return { usd: now - before, pct: (now / before - 1) * 100, covered, of: holdings.filter((h) => h.valueUsd !== undefined).length };
}
