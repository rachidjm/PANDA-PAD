import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { fetchDexTokensBatch, type DexPair } from "@/lib/dexscreener/client";
import { SOL_MINT } from "@/lib/solana/prices";

/**
 * The tokens a wallet can pay a buy with: what it really holds (read from Solana), keeping only the ones that have a
 * live market — a price and enough liquidity for Jupiter to route through — and skipping dust. Symbol, name, logo and
 * USD price come from Dexscreener's real pairs; nothing is invented, and a token with no market simply isn't offered.
 */

export type PayToken = { mint: string; symbol: string; name: string; image?: string; amount: number; decimals: number; priceUsd: number; valueUsd: number };
export type WalletTokenBalance = { mint: string; amount: number; decimals: number };

/** Below this much liquidity a swap out of the token is not worth offering. */
export const MIN_PAY_LIQUIDITY_USD = 1_000;
/** Below this much value a token isn't worth listing as a way to pay. */
export const MIN_PAY_VALUE_USD = 0.1;
export const MAX_PAY_TOKENS = 20;

/** Pure: joins balances with their best pair (the most liquid one where the token is the base) and keeps the payable ones, biggest first. */
export function buildPayTokens(balances: WalletTokenBalance[], pairs: DexPair[]): PayToken[] {
  const best = new Map<string, DexPair>();
  for (const p of pairs) {
    const cur = best.get(p.baseToken.address);
    if (!cur || (p.liquidity?.usd || 0) > (cur.liquidity?.usd || 0)) best.set(p.baseToken.address, p);
  }
  const out: PayToken[] = [];
  for (const b of balances) {
    if (b.mint === SOL_MINT || !(b.amount > 0)) continue;
    const pair = best.get(b.mint);
    const priceUsd = Number(pair?.priceUsd);
    if (!pair || !(priceUsd > 0) || (pair.liquidity?.usd || 0) < MIN_PAY_LIQUIDITY_USD) continue;
    const valueUsd = b.amount * priceUsd;
    if (valueUsd < MIN_PAY_VALUE_USD) continue;
    out.push({ mint: b.mint, symbol: pair.baseToken.symbol, name: pair.baseToken.name, image: pair.info?.imageUrl, amount: b.amount, decimals: b.decimals, priceUsd, valueUsd });
  }
  return out.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, MAX_PAY_TOKENS);
}

/** Every non-empty token balance of a wallet, classic SPL and Token-2022, one entry per mint. */
export async function readTokenBalances(connection: Connection, owner: PublicKey): Promise<WalletTokenBalance[]> {
  const [classic, token2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }).catch(() => ({ value: [] as never[] })),
  ]);
  const byMint = new Map<string, WalletTokenBalance>();
  for (const acc of [...classic.value, ...token2022.value]) {
    const info = acc.account.data.parsed?.info;
    const amount = Number(info?.tokenAmount?.uiAmount ?? 0);
    if (!info?.mint || !(amount > 0)) continue;
    const cur = byMint.get(info.mint);
    byMint.set(info.mint, { mint: info.mint, amount: (cur?.amount ?? 0) + amount, decimals: info.tokenAmount.decimals });
  }
  return [...byMint.values()];
}

export async function getPayTokens(connection: Connection, owner: PublicKey): Promise<PayToken[]> {
  const balances = (await readTokenBalances(connection, owner)).sort((a, b) => b.amount - a.amount).slice(0, 90);
  const chunks: string[][] = [];
  for (let i = 0; i < balances.length; i += 30) chunks.push(balances.slice(i, i + 30).map((b) => b.mint));
  const pairs = (await Promise.all(chunks.map((c) => fetchDexTokensBatch(c)))).flat();
  return buildPayTokens(balances, pairs);
}
