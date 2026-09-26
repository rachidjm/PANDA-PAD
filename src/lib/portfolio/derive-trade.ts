const LAMPORTS_PER_SOL = 1_000_000_000;
const WSOL = "So11111111111111111111111111111111111111112";
// Priced in something other than SOL, or just plumbing: not a "buy/sell of a coin for SOL".
const IGNORED_MINTS = new Set([
  WSOL,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

type TokenBalance = { mint: string; owner?: string; uiTokenAmount: { uiAmount: number | null } };

/** The parts of a parsed transaction this needs, in plain data (so it can be tested without web3.js). */
export type TxView = {
  keys: { pubkey: string; signer: boolean }[];
  preBalances: number[];
  postBalances: number[];
  preTokenBalances?: TokenBalance[] | null;
  postTokenBalances?: TokenBalance[] | null;
  fee: number;
};

export type DerivedTrade = { mint: string; side: "buy" | "sell"; solAmount: number; tokenAmount: number };

/**
 * If `tx` is a clean swap of exactly one non-stable coin against SOL for
 * `wallet`, returns it as a buy or sell; otherwise null (transfers, airdrops,
 * multi-token transactions, stablecoin-priced swaps, failed txs).
 * The SOL amount is the wallet's net SOL change adjusted for the network fee,
 * so it also includes any account rent — an estimate, not an exact price.
 */
/** `minSol`: smaller SOL movements are treated as transfers, not trades (0.0005 SOL by default; the fee checker lowers it to read tiny test trades). */
export function deriveTrade(tx: TxView, wallet: string, minSol = 0.0005): DerivedTrade | null {
  const walletIndex = tx.keys.findIndex((k) => k.pubkey === wallet && k.signer);
  if (walletIndex === -1) return null;

  const nativeDelta = ((tx.postBalances[walletIndex] ?? 0) - (tx.preBalances[walletIndex] ?? 0)) / LAMPORTS_PER_SOL;

  const deltas = new Map<string, number>();
  const add = (balances: TokenBalance[] | null | undefined, sign: 1 | -1) => {
    for (const b of balances || []) {
      if (b.owner !== wallet) continue;
      deltas.set(b.mint, (deltas.get(b.mint) || 0) + sign * (b.uiTokenAmount.uiAmount || 0));
    }
  };
  add(tx.postTokenBalances, 1);
  add(tx.preTokenBalances, -1);

  const moved = [...deltas.entries()].filter(([mint, d]) => !IGNORED_MINTS.has(mint) && Math.abs(d) > 0);
  if (moved.length !== 1) return null;
  const [mint, tokenDelta] = moved[0];

  const solDelta = nativeDelta + (deltas.get(WSOL) || 0);
  const fee = tx.fee / LAMPORTS_PER_SOL;
  const side = tokenDelta > 0 && solDelta < 0 ? "buy" : tokenDelta < 0 && solDelta > 0 ? "sell" : null;
  if (!side) return null;

  const solAmount = Math.abs(solDelta) - (side === "buy" ? fee : -fee);
  if (solAmount < minSol) return null; // a transfer or airdrop, not a paid swap
  return { mint, side, solAmount, tokenAmount: Math.abs(tokenDelta) };
}
